// ===== KONFIGURATION =====
// TODO-Marker unten sind Werte, die nur Valentin nachtragen kann (Sheet-IDs, neue Pipedrive-Feldcodes).

const PIPEDRIVE_DOMAIN = 'rp-energietechnik';

// Gleiche Felder wie im Projekt "Ordnererstellung-bei-Gewonnen" -- MUSS mit dessen Config.gs übereinstimmen.
const MONTAGEPARTNER_FIELD_KEY = '0190fd945adc86148657d2db36261ae9545e7bda';
const KUNDENORDNER_LINK_FIELD_KEY = 'TODO_FIELD_CODE_KUNDENORDNER_LINK'; // wird von Projekt 1 gesetzt
const ADRESSE_FIELD_KEY = '432e4e165de7e9f474643c3d3a5552e2ec976f55'; // an der Person

const MONTAGEPARTNER_OPTION_IDS = {
  'ALE-Engineering (NÖ, Wien, BGL)': 157,
  'Berger Elektrotechnik (KTN)': 158,
  'Greensky (OÖ, SBG)': 159,
  'KOLLSTAR (OÖ)': 160,
  'Kreuzeder (OÖ, SBG)': 161
};
const MONTAGEPARTNER_ID_TO_NAME = Object.fromEntries(
  Object.entries(MONTAGEPARTNER_OPTION_IDS).map(([name, id]) => [id, name])
);

// TODO: Sheet-ID pro Partner eintragen (ID = der Teil der URL zwischen /d/ und /edit).
// Beispiel-Sheet von Valentin (Zuordnung zu welchem Partner noch offen): 1yPcgiDJD0Gua7dEBmPaPMbkhSPg7Namc
const PARTNER_TO_SHEET_ID = {
  'ALE-Engineering (NÖ, Wien, BGL)': 'TODO_SHEET_ID_ALE',
  'Berger Elektrotechnik (KTN)': 'TODO_SHEET_ID_BERGER',
  'Greensky (OÖ, SBG)': 'TODO_SHEET_ID_GREENSKY',
  'KOLLSTAR (OÖ)': 'TODO_SHEET_ID_KOLLSTAR',
  'Kreuzeder (OÖ, SBG)': 'TODO_SHEET_ID_KREUZEDER'
};

// Spaltenüberschriften in den Partner-Sheets (müssen exakt so in Zeile 1 stehen).
// "Deal-ID" ist NEU -- muss einmalig als zusätzliche Spalte in jedes Partner-Sheet eingefügt werden,
// das ist der stabile Schlüssel für den Sync (Name allein ist nicht eindeutig, siehe Analyse).
const COL = {
  name: 'Name',
  zpn: 'Einspeisezählpunkt',
  ordnerLink: 'Link zum Kundenordner',
  abgeschlossen: 'Abgeschlossen',
  dealId: 'Deal-ID'
};

/**
 * Feld-Sync-Konfiguration: eine Zeile pro Feld, das zwischen Sheet und Pipedrive synct.
 * direction: 'sheet_to_pipedrive' | 'pipedrive_to_sheet' | 'off'
 * Neue Felder einfach als weiteren Eintrag hinzufügen -- z.B. später die Finance-Sheet-Häkchen
 * (Anzahlungsrechnung etc.), sobald das Finance-Sheet eine Deal-ID-Spalte hat und die
 * Pipedrive-Feldcodes dafür angelegt sind (siehe listDealFieldsHelper() in SetupHelpers.gs).
 */
const SYNC_FIELD_CONFIG = [
  {
    label: 'Einspeisezählpunkt (ZPN)',
    sheetColumnHeader: COL.zpn,
    pipedriveFieldKey: 'TODO_FIELD_CODE_ZPN', // Feld existiert evtl. noch nicht in Pipedrive -- anlegen, dann Code eintragen
    direction: 'sheet_to_pipedrive'
  }
  // Weitere Felder hier ergänzen, sobald gebraucht (z.B. Finance-Sheet-Häkchen).
];

// Wenn true: nichts wird geschrieben, nur geloggt was passieren würde
const DRY_RUN = true;

// ===== HILFSFUNKTIONEN (Pipedrive) =====

function getApiToken() {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN fehlt in den Script Properties (Projekteinstellungen prüfen).');
  return token;
}

function fetchPipedrive(path) {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`;
  return callPipedriveWithRetry(() => UrlFetchApp.fetch(url, {
    headers: { 'x-api-token': getApiToken() },
    muteHttpExceptions: true
  }), path);
}

function callPipedriveWithRetryRaw(url) {
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
        throw new Error(`Pipedrive API-Fehler ${code} bei "${url}" nach ${maxAttempts} Versuchen: ${response.getContentText()}`);
      }
      Utilities.sleep(1000 * Math.pow(2, attempt));
      continue;
    }
    throw new Error(`Pipedrive API-Fehler ${code} bei "${url}": ${response.getContentText()}`);
  }
}

function patchPipedrive(path, payload) {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`;
  return callPipedriveWithRetry(() => UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { 'x-api-token': getApiToken() },
    muteHttpExceptions: true
  }), path);
}

function callPipedriveWithRetry(doFetch, path) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = doFetch();
    const code = response.getResponseCode();
    if (code === 200) return JSON.parse(response.getContentText()).data;
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

// ===== HILFSFUNKTIONEN (Sheet) =====

/** Findet die Spaltennummer (1-basiert) einer Überschrift in Zeile 1. null wenn nicht gefunden. */
function findColumnIndexByHeader(sheet, headerText) {
  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = headerRow.findIndex(h => String(h).trim() === headerText);
  return idx === -1 ? null : idx + 1;
}

/** Findet die Zeilennummer (1-basiert) für eine gegebene Deal-ID. null wenn nicht gefunden. */
function findRowByDealId(sheet, dealIdColIndex, dealId) {
  const values = sheet.getRange(2, dealIdColIndex, Math.max(sheet.getLastRow() - 1, 0), 1).getValues();
  const rowOffset = values.findIndex(r => String(r[0]) === String(dealId));
  return rowOffset === -1 ? null : rowOffset + 2;
}

// ===== LOGGING =====

function getLogSheet() {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty('SHEETSYNC_LOG_SHEET_ID');
  let ss;
  if (sheetId) {
    try { ss = SpreadsheetApp.openById(sheetId); } catch (e) { sheetId = null; }
  }
  if (!sheetId) {
    ss = SpreadsheetApp.create('LOG_Sheet-Sync');
    props.setProperty('SHEETSYNC_LOG_SHEET_ID', ss.getId());
    const sheet = ss.getActiveSheet();
    sheet.appendRow(['Zeitstempel', 'Richtung', 'Deal-ID', 'Partner/Sheet', 'Feld', 'Ergebnis', 'Detail']);
    Logger.log(`Neues Log-Sheet angelegt: ${ss.getUrl()}`);
  }
  return ss.getActiveSheet();
}

function logRow(richtung, dealId, partnerOderSheet, feld, ergebnis, detail) {
  getLogSheet().appendRow([new Date(), richtung, dealId || '', partnerOderSheet || '', feld || '', ergebnis, detail || '']);
}
