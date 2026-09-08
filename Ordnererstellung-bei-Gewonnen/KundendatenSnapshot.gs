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
    // Nur Logger, nicht ins Sheet: der Handler laeuft seit 26.08. bei JEDER Deal-Aenderung, ein
    // Deal ohne Person wuerde also endlos dieselbe Zeile erzeugen (Sheets-Limit 10 Mio Zellen).
    Logger.log(`Kundendaten-Snapshot Deal ${dealId}: keine verknuepfte Person -- nichts zu tun.`);
    return 'keine Person';
  }

  const cf = deal.custom_fields || {};
  // Billiger Vorab-Ausstieg, wenn alle drei Felder stehen -- spart den Person-Abruf.
  // Nur Logger, nicht ins Sheet (siehe Kommentar oben, gleicher Grund).
  if (cf[KUNDE_NAME_FIELD_KEY] && cf[KUNDE_TELEFON_FIELD_KEY] && cf[KUNDE_ADRESSE_FIELD_KEY]) {
    Logger.log(`Kundendaten-Snapshot Deal ${dealId}: bereits vollstaendig befuellt -- nichts zu tun.`);
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
  // != null statt !== undefined: ein leeres Adressfeld kommt als null, und "null !== undefined"
  // ist true -- dadurch gab es fuer JEDE Person ohne Adresse eine WARNUNG-Zeile pro Event, was die
  // echten Struktur-Warnungen verwaessert hat.
  if (!adresse && adrObj != null) {
    logRow(dealId, deal.title, null, 'WARNUNG', null, `Kundendaten-Snapshot: Adresse-Feld hat unerwartete Struktur: ${JSON.stringify(adrObj)}`);
  }

  const payload = {};
  if (name) payload[KUNDE_NAME_FIELD_KEY] = name;
  if (telefon) payload[KUNDE_TELEFON_FIELD_KEY] = telefon;
  if (adresse) payload[KUNDE_ADRESSE_FIELD_KEY] = adresse;

  if (Object.keys(payload).length === 0) {
    Logger.log(`Kundendaten-Snapshot Deal ${dealId}: Person hat weder Name noch Telefon noch Adresse -- nichts zu tun.`);
    return 'übersprungen (Person ohne Daten)';
  }

  // FIX 27.08.2026 -- nicht terminierende Selbst-Trigger-Kette:
  // Der Vorab-Guard oben verlangt ALLE DREI Felder, geschrieben werden aber nur die nicht-leeren.
  // Bei einer Person ohne Telefonnummer (oder ohne Adresse) war der Guard damit UNERFUELLBAR:
  // jeder eintreffende change.deal-Event holte die Person und schickte einen PATCH mit exakt
  // denselben Werten -- und dieser PATCH ist selbst eine Deal-Aenderung, also kam sofort das
  // naechste Event. Seit der Umstellung auf "reagiert auf jede Aenderung" (Commit 26480f3) lief
  // das dauerhaft: 2 GET + 1 PATCH + 1 Sheet-Zeile pro Runde, ohne Abbruchbedingung. Mit dem
  // Duplikat-Webhook 1687275 verdoppelte sich das pro Runde zusaetzlich.
  // Richtige Abbruchbedingung ist nicht "alles befuellt", sondern "es aendert sich nichts".
  const zuSchreiben = {};
  Object.keys(payload).forEach(key => {
    if (String(cf[key] === undefined || cf[key] === null ? '' : cf[key]) !== String(payload[key])) {
      zuSchreiben[key] = payload[key];
    }
  });
  if (Object.keys(zuSchreiben).length === 0) {
    Logger.log(`Kundendaten-Snapshot Deal ${dealId}: Werte unveraendert -- kein PATCH (bricht die Event-Kette).`);
    return 'übersprungen (unverändert)';
  }

  if (DRY_RUN) {
    logRow(dealId, deal.title, null, 'DRY-RUN', null, `Kundendaten-Snapshot würde schreiben: ${JSON.stringify(zuSchreiben)}`);
    return 'DRY-RUN';
  }

  patchPipedrive(`deals/${dealId}`, { custom_fields: zuSchreiben });
  logRow(dealId, deal.title, null, 'angelegt', null, `Kundendaten-Snapshot geschrieben: ${JSON.stringify(zuSchreiben)}`);
  return 'geschrieben';
}

// ===== BACKFILL FÜR BEREITS GEWONNENE ALTDEALS =====
// Der Webhook (sobald live) erfasst nur KÜNFTIGE Statuswechsel auf "won" -- für Deals, die schon
// vorher gewonnen wurden, muss einmalig nachgetragen werden. Analog zum "437 Altdeals bekommen nie
// automatisch einen Ordner"-Punkt bei der Ordnererstellung selbst.

// _V2 seit 8.9.2026: die Deal-Abfrage unten hat jetzt sort_by=id (seit 2.9.). Ein Cursor aus der
// alten, unsortierten Abfrage passt nicht mehr dazu (Pipedrive-Cursor sind opake Tokens einer
// konkreten Sortierung) -- ein gemerkter Cursor von vor dem 2.9. haette beim naechsten Backfill
// Deals uebersprungen und danach still "sauber" gemeldet. Neuer Property-Name = alter Cursor wird
// automatisch ignoriert, der naechste Lauf startet einmalig wieder bei Deal 1.
// Gleiches Vorgehen wie BUNDESLAND_RESUME_CURSOR_V2 (Bundesland-aus-PLZ/Code.js:95).
const PROP_BACKFILL_CURSOR = 'KUNDENDATEN_BACKFILL_CURSOR_V2';
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
      const path = `deals?status=won&limit=100&sort_by=id&sort_direction=asc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
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
