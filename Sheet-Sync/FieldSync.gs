// ===== FELD-SYNC ENGINE =====
// Richtung pro Feld kommt aus SYNC_FIELD_CONFIG (Config.gs). Einfach dort umstellen/ergänzen,
// keine Logik hier anfassen müssen.

/**
 * Reagiert auf Zell-Änderungen in einem Partner-Sheet (Sheet -> Pipedrive).
 * WICHTIG: das ist KEIN einfacher onEdit()-Trigger (der feuert nur im Container-Script),
 * sondern muss als installierbarer Trigger pro Partner-Sheet eingerichtet werden
 * (siehe installTriggers() in SetupHelpers.gs).
 *
 * Behandelt auch Mehrfach-Zell-Edits (z.B. eine Spalte mit 10 ZPNs reinkopiert) -- e.range kann
 * mehrere Zeilen/Spalten umfassen, nicht nur eine einzelne Zelle.
 */
function handleSheetEdit(e) {
  const sheet = e.range.getSheet();
  const firstRow = e.range.getRow();
  const lastRow = e.range.getLastRow();
  const firstCol = e.range.getColumn();
  const lastCol = e.range.getLastColumn();

  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const dealIdCol = findColumnIndexByHeader(sheet, COL.dealId);

  // Deal-Objekte innerhalb dieses einen Edit-Durchlaufs pro Deal-ID cachen -- sonst würde z.B.
  // eine Spalte mit 30 reinkopierten Zählpunkten 30 zusätzliche fetchPipedrive()-Calls nur für
  // die "vorher"-Angabe der Notiz auslösen, obwohl derselbe Deal höchstens einmal pro Zeile
  // vorkommt.
  const dealCache = {};

  for (let col = firstCol; col <= lastCol; col++) {
    const header = String(headerRow[col - 1]).trim();
    const fieldConfig = SYNC_FIELD_CONFIG.find(
      f => f.direction === 'sheet_to_pipedrive' && f.sheetColumnHeader === header
    );
    if (!fieldConfig) continue; // diese Spalte ist nicht für Sync konfiguriert

    for (let row = Math.max(firstRow, 2); row <= lastRow; row++) {
      handleSingleCellEdit(sheet, row, col, dealIdCol, fieldConfig, dealCache);
    }
  }
}

function handleSingleCellEdit(sheet, row, col, dealIdCol, fieldConfig, dealCache) {
  const cell = sheet.getRange(row, col);
  try {
    if (!dealIdCol) {
      throw new Error(`Spalte "${COL.dealId}" fehlt im Sheet "${sheet.getName()}" -- Sync nicht möglich.`);
    }
    const dealId = sheet.getRange(row, dealIdCol).getValue();
    if (!dealId) {
      throw new Error(`Zeile ${row} hat keine Deal-ID -- übersprungen.`);
    }

    const rohWert = cell.getValue();
    let neuerWert;
    if (fieldConfig.valueType === 'checkbox_to_date') {
      // Checkbox liefert true/false; Pipedrive bekommt ein DATUM (oder null), kein Boolean --
      // ein Datum beantwortet ob UND wann (wichtig für Abrechnung/Gewährleistung/Durchlaufzeit),
      // und Pipedrive hat ohnehin keinen echten Boolean-Typ (siehe IDEEN-Felder-und-Aktionen.md
      // Abschnitt 1). Haken raus = Datum wird wieder gelöscht (null), nicht auf leer stehen lassen.
      neuerWert = rohWert === true
        ? Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : null;
    } else if (fieldConfig.valueType === 'checkbox_to_option') {
      // Checkbox schreibt in ein bestehendes Auswahlfeld (z.B. "Fortschritt"/"Netzstatus"), das
      // auch manuell im Pipedrive-UI gepflegt wird -- bewusst ein einfacher Direkt-Schreiber ohne
      // Rückwärts-Sperre, kein Versuch, "weiter fortgeschrittene" Werte zu schützen (siehe Config.gs).
      // WICHTIG: checkedOptionValue ist ein TEXT-Label, keine numerische Options-ID -- diese Felder
      // sind trotz Options-Liste vom field_type "autocomplete", nicht echtes enum/set (per Fehler
      // am 2026-08-17 entdeckt: "Expected 'string' as autocomplete custom field value").
      neuerWert = rohWert === true ? fieldConfig.checkedOptionValue : null;
    } else {
      // Manche Custom-Field-Typen (z.B. "autocomplete" wie der ZPN) lehnen einen leeren String ab
      // und verlangen ausdrücklich null als "kein Wert" -- siehe ERR_SCHEMA_VALIDATION_FAILED weiter unten.
      neuerWert = rohWert === '' ? null : rohWert;
    }

    if (fieldConfig.pipedriveFieldKey.startsWith('TODO_')) {
      throw new Error('Pipedrive-Feldcode für dieses Feld noch nicht in Config.gs eingetragen.');
    }

    if (DRY_RUN) {
      logRow('sheet_to_pipedrive', dealId, sheet.getName(), fieldConfig.label, 'DRY-RUN', `würde "${neuerWert}" nach Pipedrive schreiben`);
      cell.clearNote();
      return;
    }

    // Alten Pipedrive-Wert VOR dem Schreiben holen, nur für die Notiz -- so funktioniert das
    // "vorher -> nachher" unabhängig davon, ob der echte onEdit-Trigger oder ein manueller Test
    // aufruft (e.oldValue wäre nur beim echten Trigger verfügbar und auch dann nicht immer korrekt,
    // z.B. bei Einfügen/Paste). Pro Deal-ID nur einmal abrufen (dealCache), siehe handleSheetEdit().
    if (!dealCache[dealId]) dealCache[dealId] = fetchPipedrive(`deals/${dealId}`);
    const dealVorher = dealCache[dealId]; // Referenz behalten -- dealCache[dealId] wird unten genullt
    const alterWert = dealVorher.custom_fields?.[fieldConfig.pipedriveFieldKey];

    // Manche Checkboxen setzen beim Anhaken ZWEI Felder in einem Rutsch (z.B. Fertigmeldung ->
    // Datum UND Netzstatus="Fertigmeldung raus") -- ein PATCH-Call statt zwei, und beide Werte
    // kommen atomar an oder keiner. Nur beim Anhaken (neuerWert !== null), nicht beim Entfernen.
    const customFieldsPayload = { [fieldConfig.pipedriveFieldKey]: neuerWert };
    if (fieldConfig.zusaetzlichesFeldBeimAnhaken && neuerWert !== null) {
      customFieldsPayload[fieldConfig.zusaetzlichesFeldBeimAnhaken.fieldKey] = fieldConfig.zusaetzlichesFeldBeimAnhaken.wert;
    }

    try {
      patchPipedrive(`deals/${dealId}`, { custom_fields: customFieldsPayload });
    } catch (patchErr) {
      // Bekannter Einzelfall: beim Schreiben direkt nach der Zell-Bearbeitung war der Wert manchmal
      // noch nicht final committed, Pipedrive antwortet dann mit ERR_SCHEMA_VALIDATION_FAILED. Ein
      // zweiter Versuch nach kurzer Pause hat das bisher immer gelöst. Der generische Retry-Wrapper
      // hilft hier nicht, weil er bei 4xx bewusst sofort abbricht.
      if (neuerWert !== null && /ERR_SCHEMA_VALIDATION_FAILED/.test(patchErr.message)) {
        Utilities.sleep(1500);
        patchPipedrive(`deals/${dealId}`, { custom_fields: customFieldsPayload });
      } else {
        throw patchErr;
      }
    }
    dealCache[dealId] = null; // Cache-Eintrag ist nach dem Schreiben veraltet -- nicht wiederverwenden
    logRow('sheet_to_pipedrive', dealId, sheet.getName(), fieldConfig.label, 'geschrieben', `${alterWert ?? '(leer)'} -> ${neuerWert}`);
    if (fieldConfig.zusaetzlichesFeldBeimAnhaken && neuerWert !== null) {
      logRow('sheet_to_pipedrive', dealId, sheet.getName(), fieldConfig.label, 'Zusatzfeld geschrieben', `Netzstatus -> ${fieldConfig.zusaetzlichesFeldBeimAnhaken.wert}`);
    }

    // Aktivität statt/zusätzlich zum stillen Feldwert -- der Sinn ist, dass RP es AKTIV bemerkt
    // (Aufgabenliste/Deal-Verlauf), nicht nur, dass irgendwo ein Feld einen neuen Wert hat.
    // Nur beim Anhaken (nicht beim Entfernen des Hakens), sonst würde jedes versehentliche
    // Wieder-Abwählen auch eine Aktivität erzeugen. Ein Fehler hier lässt den Feld-Schreibvorgang
    // oben unangetastet -- eigener try/catch, eigenes Logging.
    if (fieldConfig.erzeugtAktivitaetBeimAnhaken && neuerWert !== null) {
      try {
        const kundenNameCol = findColumnIndexByHeader(sheet, COL.name);
        const kundenName = kundenNameCol ? sheet.getRange(row, kundenNameCol).getValue() : `Deal ${dealId}`;
        const ownerIdRaw = dealVorher.owner_id;
        const ownerId = ownerIdRaw && typeof ownerIdRaw === 'object' ? ownerIdRaw.id : ownerIdRaw;
        erstellePipedriveAktivitaet(dealId, `${fieldConfig.label} gemeldet: ${kundenName}`, ownerId);
        logRow('sheet_to_pipedrive', dealId, sheet.getName(), fieldConfig.label, 'Aktivität angelegt', `für ${kundenName}`);
      } catch (aktErr) {
        logRow('sheet_to_pipedrive', dealId, sheet.getName(), fieldConfig.label, 'FEHLER (Aktivität)', aktErr.message);
        Logger.log(`FEHLER beim Anlegen der Aktivität für Deal ${dealId}: ${aktErr.message}`);
      }
    }

    // Erfolgs-Notiz mit Zeitstempel + vorher/nachher, damit der Montagepartner direkt an der Zelle
    // sieht, dass sein Eintrag angekommen ist -- nicht nur bei einem vorherigen Fehler.
    const zeitstempel = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm');
    cell.setNote(`✓ An Pipedrive übermittelt am ${zeitstempel}\nvorher: ${alterWert ?? '(leer)'} -> neu: ${neuerWert}`);
  } catch (err) {
    // Zwei getrennte Texte: an der Zelle nur eine für den Montagepartner verständliche
    // Handlungsanweisung (kein Debug-Kauderwelsch wie "Pipedrive API-Fehler 400 bei ..."),
    // die technische Meldung geht ausschließlich ins Log.
    cell.setNote('⚠ Konnte nicht an RP übermittelt werden. Bitte RP informieren.');
    logRow('sheet_to_pipedrive', null, sheet.getName(), fieldConfig.label, 'FEHLER', err.message);
    Logger.log(`FEHLER in handleSingleCellEdit (${sheet.getName()} Zeile ${row}): ${err.message}`);
  }
}

/**
 * Holt für alle pipedrive_to_sheet-Felder den aktuellen Pipedrive-Wert und schreibt ihn in die
 * Sheets, für alle Zeilen mit Deal-ID. Für den zeitgesteuerten Trigger gedacht.
 */
function syncPipedriveToSheetFields() {
  const relevanteFelder = SYNC_FIELD_CONFIG.filter(
    f => f.direction === 'pipedrive_to_sheet' && !f.pipedriveFieldKey.startsWith('TODO_')
  );
  if (relevanteFelder.length === 0) {
    Logger.log('Keine Felder mit Richtung "pipedrive_to_sheet" konfiguriert -- nichts zu tun.');
    return;
  }

  // Alle gewonnenen Deals EINMAL paginiert holen statt pro Sheet-Zeile einzeln abzurufen (N+1-Falle,
  // siehe RowCreation.gs syncNeueZeilen -- macht es schon richtig). Bei ~440 Zeilen und einem
  // 15-Minuten-Trigger wären es sonst >40.000 UrlFetch-Calls/Tag, weit über dem Gratis-Kontingent
  // (~20.000/Tag). Mit der Map sind es ~5 Calls statt 440.
  const dealMap = {};
  let cursor = null;
  do {
    const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/deals?status=won&limit=100`
      + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const response = callPipedriveWithRetryRaw(url);
    (response.data || []).forEach(d => { dealMap[d.id] = d; });
    cursor = response.additional_data?.next_cursor || null;
  } while (cursor);

  Object.keys(PARTNER_SHEET_CONFIG).forEach(partner => {
    let sheet;
    try {
      sheet = openPartnerSheet(partner);
    } catch (err) {
      return; // TODO noch nicht konfiguriert -- kein Fehler, einfach überspringen
    }
    const dealIdCol = findColumnIndexByHeader(sheet, COL.dealId);
    if (!dealIdCol) return;

    // Spaltenindizes EINMAL pro Sheet auflösen statt pro Zeile/Feld erneut die Kopfzeile zu lesen
    // (bei 4 Feldern x 440 Zeilen sonst >1700 zusätzliche Sheets-Calls pro Lauf).
    const feldSpalten = relevanteFelder
      .map(fieldConfig => ({ fieldConfig, col: findColumnIndexByHeader(sheet, fieldConfig.sheetColumnHeader) }))
      .filter(x => x.col);
    if (feldSpalten.length === 0) return;

    const anzahlZeilen = Math.max(sheet.getLastRow() - 1, 0);
    if (anzahlZeilen === 0) return;

    // Gesamten Datenbereich mit EINEM getValues() lesen, im Speicher vergleichen/ändern, am Ende
    // mit EINEM setValues() zurückschreiben -- statt pro geänderter Zelle einzeln zu lesen/schreiben.
    const lastCol = sheet.getLastColumn();
    const dataRange = sheet.getRange(2, 1, anzahlZeilen, lastCol);
    const werte = dataRange.getValues();
    let geaendert = false;

    for (let i = 0; i < werte.length; i++) {
      const dealId = werte[i][dealIdCol - 1];
      if (!dealId) continue;
      const deal = dealMap[dealId];
      if (!deal) continue; // Deal aktuell nicht unter den gewonnenen -- nichts zu syncen

      const cf = deal.custom_fields || {};
      feldSpalten.forEach(({ fieldConfig, col }) => {
        const pipedriveWert = cf[fieldConfig.pipedriveFieldKey];
        if (pipedriveWert === undefined) return;
        const aktuellerWert = werte[i][col - 1];
        // String-Vergleich: Sheets liefert Zahlen/Daten typisiert (Number/Date), Pipedrive liefert
        // meist Strings -- ein typstrenger Vergleich würde fast immer fehlschlagen und bei jedem
        // Lauf unnötig neu schreiben/loggen.
        if (String(pipedriveWert) === String(aktuellerWert)) return;

        if (DRY_RUN) {
          logRow('pipedrive_to_sheet', dealId, partner, fieldConfig.label, 'DRY-RUN', `würde "${pipedriveWert}" ins Sheet schreiben`);
          return;
        }
        werte[i][col - 1] = pipedriveWert;
        geaendert = true;
        logRow('pipedrive_to_sheet', dealId, partner, fieldConfig.label, 'geschrieben', `neuer Wert: ${pipedriveWert}`);
      });
    }

    if (geaendert) dataRange.setValues(werte);
  });
}
