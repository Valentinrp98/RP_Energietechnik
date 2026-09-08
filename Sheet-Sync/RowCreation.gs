// ===== ZEILEN-ERSTELLUNG (Pipedrive → Sheet, einmalig pro Deal) =====

/**
 * Läuft über alle gewonnenen Deals und legt im passenden Partner-Sheet eine Zeile an,
 * falls noch keine existiert. Erkennungslogik: Ordner-Link ist gesetzt (= Projekt
 * "Ordnererstellung-bei-Gewonnen" ist fertig) UND es gibt noch keine Zeile mit dieser Deal-ID.
 * Für den zeitgesteuerten Trigger gedacht (siehe SetupHelpers.gs).
 *
 * LOG-PRINZIP (Fix 2.9.2026): createSheetRowForDeal() loggt nur noch echte SCHREIBVORGÄNGE
 * (angelegt / DRY-RUN). Jeder Skip wird hier gezählt und pro Lauf zu EINER Zeile aggregiert.
 * Vorher schrieb jeder Lauf ~63 "Zeile existiert bereits"-Zeilen und 6 identische FEHLER-Zeilen
 * ins Log -- alle 15 Minuten, also ~6.600 Zeilen/Tag, in denen die eine relevante Meldung unterging.
 */
function syncNeueZeilen() {
  // LockService (Umfeld Befund D2): am 2.9.2026 haben ein Timer-Lauf und ein manueller
  // testCreateSheetRow()-Lauf gleichzeitig Deal 7319 verarbeitet und BEIDE "Zeile 20" berechnet.
  // Dort blieb es folgenlos -- gleicher Deal, gleiche Zeile, also idempotent. Bei zwei
  // VERSCHIEDENEN Deals wäre der zweite in die Zeile des ersten geschrieben worden:
  // findNextEmptyRowFor() + Schreiben ist nicht atomar. Ein Lauf dauert inzwischen 30-140s, also
  // liegt der nächste Timer nicht weit weg. tryLock statt waitLock: ein übersprungener Lauf ist
  // harmlos, der nächste kommt in 15 Minuten.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log('syncNeueZeilen: ein anderer Lauf schreibt gerade -- übersprungen.');
    return;
  }

  starteLauf('syncNeueZeilen');
  let cursor = null;
  let processed = 0;
  // kandidaten = Deals mit gesetztem DOKU_STATUS_FIELD_KEY (TRIGGER oder DONE), also überhaupt für
  // eine Zeile in Frage kommen. Nur darauf darf der Alarm unten schauen (siehe dort).
  let kandidaten = 0;
  const summary = {
    angelegt: 0, dryRun: 0, existiert: 0,
    keinOrdnerLink: 0, keinPartner: 0, sheetFehler: 0, nichtReady: 0
  };
  // Deal-IDs der Kandidaten, die HÄNGEN -- das ist die einzige Information, die aus einem Lauf
  // ohne neue Zeile heraus etwas wert ist.
  const haengt = { keinOrdnerLink: [], keinPartner: [], sheetFehler: [] };

  try {
    do {
      // sort_by=id (Fix 2.9.2026): Deal 7195/7319 fehlten in mehreren aufeinanderfolgenden Live-
      // Läufen komplett -- nicht mal als "übersprungen" geloggt, obwohl beide durchgehend
      // status=won + DOKU_STATUS bereit waren (per Einzelabruf verifiziert). Ohne festen
      // Sortierschlüssel kann Cursor-Pagination bei mehreren Seiten (469 Deals / 100 pro Seite =
      // ~5 Seiten) Datensätze an Seitengrenzen verlieren, wenn mehrere Deals denselben Default-
      // Sortierwert (vermutlich update_time) haben. id ist garantiert eindeutig, also keine Ties
      // mehr an der Seitengrenze möglich.
      const path = `deals?status=won&limit=100&sort_by=id&sort_direction=asc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`;
      const response = callPipedriveWithRetryRaw(url);
      const deals = response.data || [];
      cursor = response.additional_data?.next_cursor || null;

      for (const deal of deals) {
        // GEÄNDERT 1.9.2026 (Valentins Vorgabe): statt eines Zeit-Cutoffs jetzt dasselbe Feld, das
        // auch den Projektdoku-Generator auslöst ("Projektdokumentation-Partner" = "rdy for
        // creation") -- ein Deal bekommt hier nur dann automatisch eine Zeile, wenn das Feld auf
        // TRIGGER (235) ODER schon DONE (234) steht (der Wert bleibt nach der Doku-Erstellung auf
        // 234 stehen, siehe Config.gs-Kommentar). Der Altbestand (21 gewonnene Deals ohne Zeile,
        // siehe DRY-RUN vom 1.9.) bleibt für diese Automatik unsichtbar, solange das Feld dort nicht
        // gesetzt wird -- Nachziehen bei Bedarf weiterhin manuell (testCreateSheetRow() bzw.
        // Namensabgleich-Projekt).
        const dokuStatus = String((deal.custom_fields || {})[DOKU_STATUS_FIELD_KEY]);
        const istReady = dokuStatus === String(DOKU_STATUS_OPTION_TRIGGER) || dokuStatus === String(DOKU_STATUS_OPTION_DONE);
        if (!istReady) {
          processed++;
          summary.nichtReady++;
          continue;
        }
        kandidaten++;
        // deal kommt schon vollständig aus der Liste (inkl. custom_fields) -- kein zusätzlicher
        // Einzelabruf pro Deal nötig, spart bei jedem 15-Minuten-Lauf viele API-Calls.
        const result = createSheetRowForDeal(deal);
        processed++;
        switch (result.code) {
          case 'angelegt': summary.angelegt++; break;
          case 'dry-run': summary.dryRun++; break;
          case 'existiert': summary.existiert++; break;
          case 'kein-ordnerlink': summary.keinOrdnerLink++; haengt.keinOrdnerLink.push(deal.id); break;
          case 'kein-partner': summary.keinPartner++; haengt.keinPartner.push(deal.id); break;
          default: summary.sheetFehler++; haengt.sheetFehler.push(deal.id); break;
        }
      }
    } while (cursor);
  } finally {
    // Ein Kandidat, der auf den Ordner-Link wartet, ist der Normalfall kurz nach dem Gewinn --
    // erst wenn das über Tage so bleibt, ist die Kette wirklich blockiert. Deshalb hier nur als
    // Hinweiszeile, nicht als Lauf-Status.
    if (haengt.keinOrdnerLink.length) {
      logRow('zeile anlegen', null, null, null, 'wartet auf Ordner',
             `${haengt.keinOrdnerLink.length} Kandidat(en) ohne Kundenordner-Link: ${kuerzeIdListe(haengt.keinOrdnerLink)}`);
    }
    // Kein Montagepartner am Deal = Endstation. Weder dieses Script noch "Montagepartner-aus-
    // Bundesland" holen das nach (dort hängt es meist am fehlenden/falschen Bundesland, siehe
    // Befund "Pipedrive PLZ-Feld unzuverlässig"). Eine Zeile pro Lauf mit allen betroffenen
    // Deal-IDs -- in 30 Sekunden entscheidbar, statt 6 identischer FEHLER-Zeilen alle 15 Minuten.
    if (haengt.keinPartner.length) {
      logRow('zeile anlegen', null, null, null, 'MANUELL_KLAEREN',
             `${haengt.keinPartner.length} Deal(s) ohne Montagepartner -- Feld in Pipedrive setzen, dann kommt die Zeile automatisch: ${kuerzeIdListe(haengt.keinPartner)}`);
    }
    if (haengt.sheetFehler.length) {
      logRow('zeile anlegen', null, null, null, 'FEHLER',
             `${haengt.sheetFehler.length} Deal(s) mit Sheet-/Spalten-Problem: ${kuerzeIdListe(haengt.sheetFehler)}`);
    }

    // Lauf-Status (überarbeitet 2.9.2026): Der Alarm hing vorher an "kandidaten > 0 && angelegt
    // === 0". Das ist aber der eingeschwungene Normalzustand -- alle 69 Kandidaten haben ihre
    // Zeile, also feuerte KETTE_BLOCKIERT bei JEDEM 15-Minuten-Lauf. Genau der Fall, den der
    // Kommentar vom 1.9. vermeiden wollte, nur eine Ebene höher. Jetzt schaut der Status
    // ausschließlich auf Kandidaten, die tatsächlich HÄNGEN.
    const status = (summary.keinPartner || summary.sheetFehler) ? 'MANUELL_KLAEREN'
                 : (summary.keinOrdnerLink && !summary.angelegt && !summary.dryRun) ? 'KETTE_BLOCKIERT'
                 : 'OK';
    logLaufEnde(status, Object.assign({ geprueft: processed, kandidaten: kandidaten }, summary));
    flushLog();
    lock.releaseLock();
  }
}

/** Deal-ID-Listen fürs Log kürzen -- eine Log-Zelle mit 400 IDs liest niemand. */
function kuerzeIdListe(ids, max) {
  const grenze = max || 25;
  return ids.length <= grenze
    ? ids.join(', ')
    : `${ids.slice(0, grenze).join(', ')} ... (+${ids.length - grenze} weitere)`;
}

/**
 * Für einen einzelnen Deal: legt bei Bedarf die Sheet-Zeile im passenden Partner-Sheet an.
 * deal: entweder ein volles Deal-Objekt (aus der Liste) oder eine Deal-ID (dann wird nachgeladen --
 * praktisch für Einzeltests, siehe testCreateSheetRow() in SetupHelpers.gs).
 *
 * Rückgabe: { code, text } -- code ist stabil und maschinenlesbar ('angelegt' | 'dry-run' |
 * 'existiert' | 'kein-ordnerlink' | 'kein-partner' | 'sheet-fehler'), text ist die Klartextzeile
 * für Logger.log bei Einzelaufrufen. Vorher wurde in syncNeueZeilen() auf den deutschen Text
 * gematcht (result.startsWith('angelegt')) -- eine Formulierungsänderung hätte die Zählung still
 * verfälscht.
 */
function createSheetRowForDeal(deal) {
  if (typeof deal === 'number' || typeof deal === 'string') {
    deal = fetchPipedrive(`deals/${deal}`);
  }
  const dealId = deal.id;
  const cf = deal.custom_fields || {};

  const ordnerLink = cf[KUNDENORDNER_LINK_FIELD_KEY];
  if (!ordnerLink) {
    return { code: 'kein-ordnerlink',
             text: 'übersprungen (noch kein Ordner-Link -- Ordnererstellung-bei-Gewonnen ist noch nicht durch)' };
  }

  const partnerOptionId = cf[MONTAGEPARTNER_FIELD_KEY];
  const partner = MONTAGEPARTNER_ID_TO_NAME[partnerOptionId];
  if (!partner) {
    // Kein logRow hier: syncNeueZeilen() aggregiert das pro Lauf zu einer MANUELL_KLAEREN-Zeile.
    // Beim Einzelaufruf steht der Text im Execution-Log des Editors.
    return { code: 'kein-partner',
             text: `kein Montagepartner am Deal (Options-ID ${partnerOptionId}) -- Feld in Pipedrive setzen` };
  }

  let sheet;
  try {
    sheet = openPartnerSheet(partner);
  } catch (err) {
    return { code: 'sheet-fehler', text: `übersprungen (${err.message})` };
  }

  const dealIdCol = findColumnIndexByHeader(sheet, COL.dealId);
  if (!dealIdCol) {
    return { code: 'sheet-fehler',
             text: `übersprungen (Spalte "${COL.dealId}" fehlt im Sheet von "${partner}" -- einmalig anlegen)` };
  }

  const bestehendeZeile = findRowByDealId(sheet, dealIdCol, dealId);
  if (bestehendeZeile) {
    return { code: 'existiert', text: `übersprungen (Zeile ${bestehendeZeile} existiert bereits)` };
  }

  const person = deal.person_id ? fetchPipedrive(`persons/${deal.person_id}`) : null;
  const name = person?.name || deal.title || `Deal ${dealId}`;

  // Stufe 1 (IDEEN-Felder-und-Aktionen.md): Kontakt-/Auftragsdaten, ohne die der Partner mit dem
  // Sheet allein nirgends hinfahren/niemanden erreichen kann. Bewusst NUR HIER, einmalig bei
  // Zeilen-Erstellung geschrieben -- nicht Teil von SYNC_FIELD_CONFIG/des 15-Minuten-Loops, weil
  // sich Adresse/Telefon nach Gewinn praktisch nie mehr ändern und ein wiederkehrender
  // Person-Fetch pro Zeile pro Lauf denselben Kontingent-Fehler wie S1 (FIXES-2026-08-13.md)
  // reproduzieren würde, nur für Personendaten statt Dealdaten. person ist hier ohnehin schon
  // geladen (für "name"), kostet also keinen zusätzlichen Call.
  const personCf = person?.custom_fields || {};
  const adrObj = personCf[ADRESSE_FIELD_KEY];
  const adresse = adrObj?.formatted_address || adrObj?.value || '';
  const plz = personCf[PLZ_FIELD_KEY] || '';
  const telefon = person?.phones?.[0]?.value || '';
  const moduleAnzahl = cf[MODULE_ANZAHL_FIELD_KEY] || '';
  // Speicher (kWh) bleibt bewusst ungenutzt (Valentin, 25.08.) -- die Info steht schon im
  // Anlagendetails-Summary-Text (COL.module, siehe SYNC_FIELD_CONFIG unten), keine doppelte
  // Quelle für dieselbe Angabe.
  const erstellungsdatum = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy');

  // Komplette Liste aller Werte, die diese Zeile bekommen würde -- EINMAL aufgebaut, sowohl fürs
  // DRY-RUN-Log (Valentin, 25.08.: "ultra ungenau" -- vorher stand da nur der Name) als auch für
  // den echten Schreibvorgang unten. So können Log und tatsächliches Schreiben nie auseinanderlaufen.
  const geplanteWerte = {
    [COL.name]: name,
    [COL.ordnerLink]: ordnerLink,
    [COL.dealId]: dealId,
    [COL.adresse]: adresse,
    [COL.plz]: plz,
    [COL.telefon]: telefon,
    [COL.module]: moduleAnzahl,
    [COL.erstellungsdatum]: erstellungsdatum
  };
  // Alle pipedrive_to_sheet- UND bidirektionalen Felder (DC-/AC-/IB-Termin, Materiallieferung, ...)
  // gleich mit dem aktuellen Pipedrive-Wert befüllen, statt bis zum nächsten 15-Minuten-Sync zu warten.
  // combineFrom-Felder (z.B. "Sonstige Informationen") haben kein pipedriveFieldKey -- derselbe
  // Guard wie in FieldSync.gs syncPipedriveToSheetFields(), sonst crasht startsWith() auf undefined.
  SYNC_FIELD_CONFIG
    .filter(f => (f.direction === 'pipedrive_to_sheet' || f.direction === 'bidirektional')
      && (f.combineFrom || !f.pipedriveFieldKey.startsWith('TODO_')))
    .forEach(fieldConfig => {
      const wert = fieldConfig.combineFrom
        ? fieldConfig.combineFrom.map(key => cf[key]).filter(Boolean).join('\n---\n')
        : cf[fieldConfig.pipedriveFieldKey];
      // Nur überschreiben, wenn Pipedrive tatsächlich einen Wert liefert -- sonst würde z.B.
      // COL.module den oben schon berechneten moduleAnzahl-Fallback verlieren, nur weil das
      // neuere Anlagendetails-Summary-Feld bei diesem Deal (noch) nicht gesetzt ist.
      if (wert !== undefined) geplanteWerte[fieldConfig.sheetColumnHeader] = wert;
    });
  // Nur Header behalten, die wirklich einen Wert hätten -- sonst zeigt das Log lauter "" für
  // leere Termine/Felder und wird selbst wieder unübersichtlich.
  const befuellteWerte = Object.fromEntries(
    Object.entries(geplanteWerte).filter(([, wert]) => wert !== undefined && wert !== '' && wert !== null)
  );

  if (DRY_RUN) {
    logRow('zeile anlegen', dealId, partner, null, 'DRY-RUN', `würde Zeile anlegen: ${JSON.stringify(befuellteWerte)}`);
    return { code: 'dry-run',
             text: `DRY-RUN: würde Zeile für "${name}" im ${partner}-Sheet anlegen (${Object.keys(befuellteWerte).length} Felder)` };
  }

  // Zielzeile muss vor dem Schreiben als leer geprüft werden -- sonst besteht bei Sheets mit
  // Zusatzinhalt unterhalb der Datenzeilen (Summen, Notizen) das Risiko, dort hineinzuschreiben.
  const nameCol = findColumnIndexByHeader(sheet, COL.name);
  const checkCols = [dealIdCol, nameCol].filter(Boolean);
  const newRow = findNextEmptyRowFor(sheet, checkCols);

  // Deal-ID ZUERST schreiben und sofort per flush() festschreiben, dann der Rest. Sonst ist die
  // Zeile zwischen erstem Schreibvorgang und Ende der Schleife für findRowByDealId() noch
  // unsichtbar -- ein parallel laufender Lauf würde dieselbe Zielzeile berechnen. Zusammen mit
  // dem tryLock oben zweifach abgesichert; das flush() greift auch bei einem Abbruch mitten in
  // der Wertschleife (halb gefüllte Zeile bleibt dann wenigstens auffindbar statt anonym).
  sheet.getRange(newRow, dealIdCol).setValue(dealId);
  SpreadsheetApp.flush();

  Object.entries(befuellteWerte).forEach(([header, wert]) => {
    if (header === COL.dealId) return; // steht schon
    const col = findColumnIndexByHeader(sheet, header);
    if (col) sheet.getRange(newRow, col).setValue(wert);
  });

  // Beantwortet ein für alle Mal "woher kommt diese Zeile" -- und macht sichtbar, dass sie
  // nicht von Hand eingetragen wurde (also auch nicht von Hand gelöscht werden sollte).
  if (nameCol) {
    sheet.getRange(newRow, nameCol).setNote(
      `Automatisch angelegt am ${notizZeitstempel()}\naus Pipedrive-Deal ${dealId}`);
  }

  logRow('zeile anlegen', dealId, partner, null, 'angelegt', `Zeile ${newRow}`);
  return { code: 'angelegt', text: `angelegt: Zeile ${newRow} im ${partner}-Sheet` };
}
