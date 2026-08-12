// ===== FELD-SYNC ENGINE =====
// Richtung pro Feld kommt aus SYNC_FIELD_CONFIG (Config.gs). Einfach dort umstellen/ergänzen,
// keine Logik hier anfassen müssen.

/**
 * Reagiert auf Zell-Änderungen in einem Partner-Sheet (Sheet -> Pipedrive).
 * WICHTIG: das ist KEIN einfacher onEdit()-Trigger (der feuert nur im Container-Script),
 * sondern muss als installierbarer Trigger pro Partner-Sheet eingerichtet werden
 * (siehe installSheetEditTriggers() in SetupHelpers.gs).
 */
function handleSheetEdit(e) {
  try {
    const sheet = e.range.getSheet();
    const editedCol = e.range.getColumn();
    const editedRow = e.range.getRow();
    if (editedRow === 1) return; // Header-Zeile, nicht relevant

    const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const editedHeader = String(headerRow[editedCol - 1]).trim();

    const fieldConfig = SYNC_FIELD_CONFIG.find(
      f => f.direction === 'sheet_to_pipedrive' && f.sheetColumnHeader === editedHeader
    );
    if (!fieldConfig) return; // diese Spalte ist nicht für Sync konfiguriert

    const dealIdCol = findColumnIndexByHeader(sheet, COL.dealId);
    if (!dealIdCol) {
      Logger.log(`Spalte "${COL.dealId}" fehlt im Sheet "${sheet.getName()}" -- Sync nicht möglich.`);
      return;
    }
    const dealId = sheet.getRange(editedRow, dealIdCol).getValue();
    if (!dealId) {
      Logger.log(`Zeile ${editedRow} in "${sheet.getName()}" hat keine Deal-ID -- übersprungen.`);
      return;
    }

    const neuerWert = e.range.getValue();

    if (fieldConfig.pipedriveFieldKey.startsWith('TODO_')) {
      logRow('sheet_to_pipedrive', dealId, sheet.getName(), fieldConfig.label, 'übersprungen', 'Pipedrive-Feldcode noch nicht in Config.gs eingetragen');
      return;
    }

    if (DRY_RUN) {
      logRow('sheet_to_pipedrive', dealId, sheet.getName(), fieldConfig.label, 'DRY-RUN', `würde "${neuerWert}" nach Pipedrive schreiben`);
      return;
    }

    patchPipedrive(`deals/${dealId}`, { custom_fields: { [fieldConfig.pipedriveFieldKey]: neuerWert } });
    logRow('sheet_to_pipedrive', dealId, sheet.getName(), fieldConfig.label, 'geschrieben', `neuer Wert: ${neuerWert}`);
  } catch (err) {
    Logger.log(`FEHLER in handleSheetEdit: ${err.message}`);
  }
}

/**
 * Holt für alle pipedrive_to_sheet-Felder den aktuellen Pipedrive-Wert und schreibt ihn in die
 * Sheets, für alle Zeilen mit Deal-ID. Für den zeitgesteuerten Trigger gedacht.
 */
function syncPipedriveToSheetFields() {
  const relevanteFelder = SYNC_FIELD_CONFIG.filter(f => f.direction === 'pipedrive_to_sheet');
  if (relevanteFelder.length === 0) {
    Logger.log('Keine Felder mit Richtung "pipedrive_to_sheet" konfiguriert -- nichts zu tun.');
    return;
  }

  Object.entries(PARTNER_TO_SHEET_ID).forEach(([partner, sheetId]) => {
    if (sheetId.startsWith('TODO_')) return;
    const sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    const dealIdCol = findColumnIndexByHeader(sheet, COL.dealId);
    if (!dealIdCol) return;

    const dealIds = sheet.getRange(2, dealIdCol, Math.max(sheet.getLastRow() - 1, 0), 1).getValues().flat().filter(Boolean);

    dealIds.forEach(dealId => {
      const deal = fetchPipedrive(`deals/${dealId}`);
      const cf = deal.custom_fields || {};
      const row = findRowByDealId(sheet, dealIdCol, dealId);

      relevanteFelder.forEach(fieldConfig => {
        if (fieldConfig.pipedriveFieldKey.startsWith('TODO_')) return;
        const col = findColumnIndexByHeader(sheet, fieldConfig.sheetColumnHeader);
        if (!col) return;
        const pipedriveWert = cf[fieldConfig.pipedriveFieldKey];
        const aktuellerWert = sheet.getRange(row, col).getValue();
        if (pipedriveWert === aktuellerWert || pipedriveWert === undefined) return;

        if (DRY_RUN) {
          logRow('pipedrive_to_sheet', dealId, partner, fieldConfig.label, 'DRY-RUN', `würde "${pipedriveWert}" ins Sheet schreiben`);
          return;
        }
        sheet.getRange(row, col).setValue(pipedriveWert);
        logRow('pipedrive_to_sheet', dealId, partner, fieldConfig.label, 'geschrieben', `neuer Wert: ${pipedriveWert}`);
      });
    });
  });
}
