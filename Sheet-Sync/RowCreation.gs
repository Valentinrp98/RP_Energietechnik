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
      // deal kommt schon vollständig aus der Liste (inkl. custom_fields) -- kein zusätzlicher
      // Einzelabruf pro Deal nötig, spart bei jedem 15-Minuten-Lauf viele API-Calls.
      const result = createSheetRowForDeal(deal);
      processed++;
      if (result.startsWith('angelegt')) summary.angelegt++;
      else if (result.startsWith('DRY-RUN')) summary.dryRun++;
      else summary.uebersprungen++;
    }
  } while (cursor);

  Logger.log(`Fertig. ${processed} gewonnene Deals geprüft. ${JSON.stringify(summary)}`);
}

/**
 * Für einen einzelnen Deal: legt bei Bedarf die Sheet-Zeile im passenden Partner-Sheet an.
 * deal: entweder ein volles Deal-Objekt (aus der Liste) oder eine Deal-ID (dann wird nachgeladen --
 * praktisch für Einzeltests, siehe testCreateSheetRow() in SetupHelpers.gs).
 */
function createSheetRowForDeal(deal) {
  if (typeof deal === 'number' || typeof deal === 'string') {
    deal = fetchPipedrive(`deals/${deal}`);
  }
  const dealId = deal.id;
  const cf = deal.custom_fields || {};

  const ordnerLink = cf[KUNDENORDNER_LINK_FIELD_KEY];
  if (!ordnerLink) {
    return 'übersprungen (noch kein Ordner-Link -- Ordnererstellung-bei-Gewonnen ist noch nicht durch)';
  }

  const partnerOptionId = cf[MONTAGEPARTNER_FIELD_KEY];
  const partner = MONTAGEPARTNER_ID_TO_NAME[partnerOptionId];
  if (!partner) {
    logRow('pipedrive_to_sheet', dealId, null, 'Zeile anlegen', 'FEHLER', `unbekannte Montagepartner-Options-ID ${partnerOptionId}`);
    return `FEHLER: unbekannte Montagepartner-Options-ID ${partnerOptionId}`;
  }

  let sheet;
  try {
    sheet = openPartnerSheet(partner);
  } catch (err) {
    logRow('pipedrive_to_sheet', dealId, partner, 'Zeile anlegen', 'übersprungen', err.message);
    return `übersprungen (${err.message})`;
  }

  const dealIdCol = findColumnIndexByHeader(sheet, COL.dealId);
  if (!dealIdCol) {
    logRow('pipedrive_to_sheet', dealId, partner, 'Zeile anlegen', 'übersprungen', `Spalte "${COL.dealId}" fehlt im Sheet -- einmalig anlegen`);
    return `übersprungen (Spalte "${COL.dealId}" fehlt im Partner-Sheet)`;
  }

  const bestehendeZeile = findRowByDealId(sheet, dealIdCol, dealId);
  if (bestehendeZeile) {
    logRow('pipedrive_to_sheet', dealId, partner, 'Zeile anlegen', 'übersprungen', `Zeile ${bestehendeZeile} existiert bereits`);
    return `übersprungen (Zeile ${bestehendeZeile} existiert bereits)`;
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
  const speicherKwh = cf[SPEICHER_KWH_FIELD_KEY] || '';

  if (DRY_RUN) {
    logRow('pipedrive_to_sheet', dealId, partner, 'Zeile anlegen', 'DRY-RUN', `würde Zeile für "${name}" anlegen`);
    return `DRY-RUN: würde Zeile für "${name}" im ${partner}-Sheet anlegen`;
  }

  const nameCol = findColumnIndexByHeader(sheet, COL.name);
  const ordnerLinkCol = findColumnIndexByHeader(sheet, COL.ordnerLink);

  // Zielzeile muss vor dem Schreiben als leer geprüft werden -- sonst besteht bei Sheets mit
  // Zusatzinhalt unterhalb der Datenzeilen (Summen, Notizen) das Risiko, dort hineinzuschreiben.
  const checkCols = [dealIdCol, nameCol].filter(Boolean);
  const newRow = findNextEmptyRowFor(sheet, checkCols);

  if (nameCol) sheet.getRange(newRow, nameCol).setValue(name);
  if (ordnerLinkCol) sheet.getRange(newRow, ordnerLinkCol).setValue(ordnerLink);
  sheet.getRange(newRow, dealIdCol).setValue(dealId);

  // Stufe-1-Felder, siehe Kommentar oben -- nur schreiben, wenn die Spalte existiert (Partner-
  // Sheet noch nicht auf die neue Struktur erweitert) und ein Wert da ist, sonst leer lassen.
  [
    [COL.adresse, adresse],
    [COL.plz, plz],
    [COL.telefon, telefon],
    [COL.module, moduleAnzahl],
    [COL.speicher, speicherKwh]
  ].forEach(([header, wert]) => {
    if (!wert) return;
    const col = findColumnIndexByHeader(sheet, header);
    if (col) sheet.getRange(newRow, col).setValue(wert);
  });

  // Alle pipedrive_to_sheet-Felder (DC-/AC-/IB-Termin, Materiallieferung, ...) gleich mit dem
  // aktuellen Pipedrive-Wert befüllen, statt bis zum nächsten 15-Minuten-Sync zu warten.
  SYNC_FIELD_CONFIG
    .filter(f => f.direction === 'pipedrive_to_sheet' && !f.pipedriveFieldKey.startsWith('TODO_'))
    .forEach(fieldConfig => {
      const col = findColumnIndexByHeader(sheet, fieldConfig.sheetColumnHeader);
      const wert = cf[fieldConfig.pipedriveFieldKey];
      if (col && wert !== undefined) sheet.getRange(newRow, col).setValue(wert);
    });

  logRow('pipedrive_to_sheet', dealId, partner, 'Zeile anlegen', 'angelegt', `Zeile ${newRow}`);
  return `angelegt: Zeile ${newRow} im ${partner}-Sheet`;
}
