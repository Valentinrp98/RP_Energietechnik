// ===== KUNDENDATEN-SNAPSHOT =====
// Grund: Mail-Vorlagen in Pipedrive nutzen Person-Merge-Felder (kleines Personen-Symbol). Die
// ziehen ihre Werte vom Empfänger der jeweiligen Mail, NICHT vom Deal. Schickt man aus Versehen
// an eine andere Person, als die am Deal hängt, zeigt die Mail trotzdem "richtig" aus, enthält
// aber die falschen Kundendaten. Diese Deal-Custom-Fields ($-Symbol) sind ein einmaliger Snapshot
// beim Gewinnen -- fix am Deal, unabhängig davon, an wen später gemailt wird.

/**
 * Schreibt Name/Telefonnummer/Adresse der verknüpften Person in die Kundendaten-Snapshot-Felder
 * am Deal. Läuft unabhängig vom Ordner-Anlegen-Flow (siehe FolderCreation.gs) -- deshalb dort ganz
 * am Anfang aufgerufen, VOR den Ordner-spezifischen Skip-Bedingungen (Montagepartner fehlt o.ä.),
 * damit der Snapshot auch dann geschrieben wird, wenn die Ordner-Logik aus anderen Gründen aussteigt.
 * Überschreibt nichts, wenn alle 3 Felder schon befüllt sind (idempotent bei mehrfachem Aufruf,
 * z.B. Webhook UND Backfill auf denselben Deal). Gibt einen Status-String zurück (für Zusammenfassungen
 * im Backfill unten), analog zu processGewonnenDeal() in FolderCreation.gs.
 */
function schreibeKundendatenSnapshot(dealId, deal) {
  if (!deal.person_id) {
    logRow(dealId, deal.title, null, 'übersprungen', null, 'Kundendaten-Snapshot: Deal hat keine verknüpfte Person');
    return 'keine Person';
  }

  const cf = deal.custom_fields || {};
  if (cf[KUNDE_NAME_FIELD_KEY] && cf[KUNDE_TELEFON_FIELD_KEY] && cf[KUNDE_ADRESSE_FIELD_KEY]) {
    logRow(dealId, deal.title, null, 'übersprungen', null, 'Kundendaten-Snapshot bereits vollständig befüllt');
    return 'übersprungen (bereits befüllt)';
  }

  const person = fetchPipedrive(`persons/${deal.person_id}`);
  const name = person.name || '';

  // person.phones: Array von {value, label, primary}. Primäre Nummer bevorzugen, sonst erste.
  const phones = person.phones || [];
  const telefonEintrag = phones.find(p => p.primary) || phones[0];
  const telefon = telefonEintrag?.value || '';

  // Gleiche Adresse-Feld-Logik wie in FolderCreation.gs: Subfelder nur befüllt, wenn die Adresse
  // per Google-Maps-Autocomplete angelegt wurde, sonst steht alles in "value".
  const adrObj = person.custom_fields?.[ADRESSE_FIELD_KEY];
  const adresse = adrObj?.formatted_address || adrObj?.value || '';
  if (!adresse && adrObj !== undefined) {
    logRow(dealId, deal.title, null, 'WARNUNG', null, `Kundendaten-Snapshot: Adresse-Feld hat unerwartete Struktur: ${JSON.stringify(adrObj)}`);
  }

  const payload = {};
  if (name) payload[KUNDE_NAME_FIELD_KEY] = name;
  if (telefon) payload[KUNDE_TELEFON_FIELD_KEY] = telefon;
  if (adresse) payload[KUNDE_ADRESSE_FIELD_KEY] = adresse;

  if (Object.keys(payload).length === 0) {
    logRow(dealId, deal.title, null, 'übersprungen', null, 'Kundendaten-Snapshot: Person hat weder Name noch Telefon noch Adresse');
    return 'übersprungen (Person ohne Daten)';
  }

  if (DRY_RUN) {
    logRow(dealId, deal.title, null, 'DRY-RUN', null, `Kundendaten-Snapshot würde schreiben: ${JSON.stringify(payload)}`);
    return 'DRY-RUN';
  }

  patchPipedrive(`deals/${dealId}`, { custom_fields: payload });
  logRow(dealId, deal.title, null, 'angelegt', null, `Kundendaten-Snapshot geschrieben: ${JSON.stringify(payload)}`);
  return 'geschrieben';
}

// ===== BACKFILL FÜR BEREITS GEWONNENE ALTDEALS =====
// Der Webhook (sobald live) erfasst nur KÜNFTIGE Statuswechsel auf "won" -- für Deals, die schon
// vorher gewonnen wurden, muss einmalig nachgetragen werden. Analog zum "437 Altdeals bekommen nie
// automatisch einen Ordner"-Punkt bei der Ordnererstellung selbst.

const PROP_BACKFILL_CURSOR = 'KUNDENDATEN_BACKFILL_CURSOR';
const BACKFILL_MAX_LAUFZEIT_MS = 4.5 * 60 * 1000; // Apps-Script-Laufzeitlimit ist 6 Min, Puffer einplanen

/**
 * Wie fetchPipedrive() (siehe Config.gs), gibt aber die KOMPLETTE Antwort zurück (inkl.
 * additional_data.next_cursor) statt nur .data. fetchPipedrive() selbst liefert nur .data, ohne
 * alle bestehenden Aufrufer anzufassen -- wird nur hier für die Pagination gebraucht.
 */
function fetchPipedriveSeite(path) {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = UrlFetchApp.fetch(url, {
      headers: { 'x-api-token': getApiToken() },
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code === 200) return JSON.parse(response.getContentText());
    if (code === 429 || code >= 500) {
      if (attempt === maxAttempts) {
        throw new Error(`Pipedrive API-Fehler ${code} bei "${path}" nach ${maxAttempts} Versuchen: ${response.getContentText()}`);
      }
      Utilities.sleep(1000 * Math.pow(2, attempt));
      continue;
    }
    throw new Error(`Pipedrive API-Fehler ${code} bei "${path}": ${response.getContentText()}`);
  }
}

/**
 * Trägt den Kundendaten-Snapshot für ALLE aktuell gewonnenen Deals nach (v2-API: nur
 * status=won|open|lost|deleted gültig, KEIN "all_not_deleted" -- siehe CLAUDE.md-Learnings).
 * Bricht nach ~4,5 Min freiwillig ab und merkt sich den Cursor in ScriptProperties -- Funktion
 * einfach nochmal ausführen, macht dort weiter, wo sie aufgehört hat. Deals, die schon alle 3
 * Felder haben, werden von schreibeKundendatenSnapshot() selbst übersprungen (idempotent), also
 * ist auch ein erneuter kompletter Durchlauf ohne Cursor gefahrlos.
 */
function backfillKundendatenSnapshotAlleGewonnenenDeals() {
  starteLauf('backfillKundendatenSnapshotAlleGewonnenenDeals');
  const props = PropertiesService.getScriptProperties();
  const startZeit = Date.now();
  const summary = { geschrieben: 0, uebersprungen: 0, keinePerson: 0, dryRun: 0, fehler: 0 };
  let cursor = props.getProperty(PROP_BACKFILL_CURSOR) || null;
  let zeitlimitErreicht = false;

  try {
    do {
      if (Date.now() - startZeit > BACKFILL_MAX_LAUFZEIT_MS) {
        zeitlimitErreicht = true;
        break;
      }
      const path = `deals?status=won&limit=100${cursor ? `&cursor=${cursor}` : ''}`;
      const seite = fetchPipedriveSeite(path);
      const deals = seite.data || [];

      deals.forEach(deal => {
        try {
          const ergebnis = schreibeKundendatenSnapshot(deal.id, deal);
          if (ergebnis === 'geschrieben') summary.geschrieben++;
          else if (ergebnis === 'keine Person') summary.keinePerson++;
          else if (ergebnis === 'DRY-RUN') summary.dryRun++;
          else summary.uebersprungen++;
        } catch (err) {
          summary.fehler++;
          logRow(deal.id, deal.title, null, 'FEHLER', null, err.message);
        }
      });

      cursor = seite.additional_data?.next_cursor || null;
    } while (cursor);

    if (zeitlimitErreicht) {
      props.setProperty(PROP_BACKFILL_CURSOR, cursor);
      Logger.log('Zeitlimit erreicht -- Cursor gespeichert. Funktion einfach nochmal ausführen, macht dort weiter.');
    } else {
      props.deleteProperty(PROP_BACKFILL_CURSOR);
    }
  } finally {
    logLaufEnde(zeitlimitErreicht ? 'PAUSIERT (Zeitlimit)' : (summary.fehler > 0 ? 'FEHLER' : 'OK'), summary);
    flushLog();
  }
}
