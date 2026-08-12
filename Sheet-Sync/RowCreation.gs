// ===== ZEILEN-ERSTELLUNG (Pipedrive → Sheet, einmalig pro Deal) =====

/**
 * Läuft über alle gewonnenen Deals und legt im passenden Partner-Sheet eine Zeile an,
 * falls noch keine existiert. Erkennungslogik: Ordner-Link ist gesetzt (= Projekt
 * "Ordnererstellung-bei-Gewonnen" ist fertig) UND es gibt noch keine Zeile mit dieser Deal-ID.
 * Für den zeitgesteuerten Trigger gedacht (siehe SetupHelpers.gs).
 */
function syncNeueZeilen() {
  let cursor = null;
  let processed = 0;
  const summary = { angelegt: 0, uebersprungen: 0, dryRun: 0 };

  do {
    const path = `deals?status=won&limit=100${cursor ? `&cursor=${cursor}` : ''}`;
    const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`;
    const response = callPipedriveWithRetryRaw(url);
    const deals = response.data || [];
    cursor = response.additional_data?.next_cursor || null;

    for (const deal of deals) {
      const result = createSheetRowForDeal(deal.id);
      processed++;
      if (result.startsWith('angelegt')) summary.angelegt++;
      else if (result.startsWith('DRY-RUN')) summary.dryRun++;
      else summary.uebersprungen++;
    }
  } while (cursor);

  Logger.log(`Fertig. ${processed} gewonnene Deals geprüft. ${JSON.stringify(summary)}`);
}

/** Für einen einzelnen Deal: legt bei Bedarf die Sheet-Zeile im passenden Partner-Sheet an. */
function createSheetRowForDeal(dealId) {
  const deal = fetchPipedrive(`deals/${dealId}`);
  const cf = deal.custom_fields || {};

  const ordnerLink = cf[KUNDENORDNER_LINK_FIELD_KEY];
  if (!ordnerLink) {
    return 'übersprungen (noch kein Ordner-Link -- Ordnererstellung-bei-Gewonnen ist noch nicht durch)';
  }

  const partnerOptionId = cf[MONTAGEPARTNER_FIELD_KEY];
  const partner = MONTAGEPARTNER_ID_TO_NAME[partnerOptionId];
  const sheetId = PARTNER_TO_SHEET_ID[partner];
  if (!sheetId || sheetId.startsWith('TODO_')) {
    logRow('pipedrive_to_sheet', dealId, partner, 'Zeile anlegen', 'übersprungen', 'keine Sheet-ID für diesen Partner konfiguriert (Config.gs)');
    return `übersprungen (Sheet-ID für "${partner}" fehlt in Config.gs)`;
  }

  const sheet = SpreadsheetApp.openById(sheetId).getSheets()[0]; // erstes Tab -- ggf. anpassen falls mehrere Tabs pro Datei
  const dealIdCol = findColumnIndexByHeader(sheet, COL.dealId);
  if (!dealIdCol) {
    logRow('pipedrive_to_sheet', dealId, partner, 'Zeile anlegen', 'übersprungen', `Spalte "${COL.dealId}" fehlt im Sheet -- einmalig anlegen`);
    return `übersprungen (Spalte "${COL.dealId}" fehlt im Partner-Sheet)`;
  }

  if (findRowByDealId(sheet, dealIdCol, dealId)) {
    return 'übersprungen (Zeile existiert bereits)';
  }

  const person = deal.person_id ? fetchPipedrive(`persons/${deal.person_id}`) : null;
  const name = person?.name || deal.title || `Deal ${dealId}`;

  if (DRY_RUN) {
    logRow('pipedrive_to_sheet', dealId, partner, 'Zeile anlegen', 'DRY-RUN', `würde Zeile für "${name}" anlegen`);
    return `DRY-RUN: würde Zeile für "${name}" im ${partner}-Sheet anlegen`;
  }

  const nameCol = findColumnIndexByHeader(sheet, COL.name);
  const ordnerLinkCol = findColumnIndexByHeader(sheet, COL.ordnerLink);
  const newRow = sheet.getLastRow() + 1;
  if (nameCol) sheet.getRange(newRow, nameCol).setValue(name);
  if (ordnerLinkCol) sheet.getRange(newRow, ordnerLinkCol).setValue(ordnerLink);
  sheet.getRange(newRow, dealIdCol).setValue(dealId);

  logRow('pipedrive_to_sheet', dealId, partner, 'Zeile anlegen', 'angelegt', `Zeile ${newRow}`);
  return `angelegt: Zeile ${newRow} im ${partner}-Sheet`;
}
