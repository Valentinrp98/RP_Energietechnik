// ===== KONFIGURATION =====
// Pilot: Pipedrive-Deal-Files (Stromrechnung/Dachfoto/Zählerpunkt) per Claude-Vision
// klassifizieren und in den passenden Unterordner des Kundenordners ablegen.
// Plan: C:\Users\valen\.claude\plans\happy-inventing-waterfall.md

const PIPEDRIVE_DOMAIN = 'rp-energietechnik';

// Feld "Kundenordner-Link" -- 1:1 aus Ordnererstellung-bei-Gewonnen/Config.gs übernommen,
// dort ist es die Quelle der Wahrheit für den Feld-Code.
const KUNDENORDNER_LINK_FIELD_KEY = '5c442fe317da26ed4f60504e2b912df7e3116c5b';

// Test-Deal für den Piloten (Valentins erster Agent, 2026-08-26). Bewusst hartcodiert statt
// Automatik/Trigger -- siehe "Explizit NICHT im Pilot-Scope" im Plan.
const PILOT_DEAL_IDS = [7253];

// Unterordner-Namen 1:1 aus Ordnererstellung-bei-Gewonnen/Config.gs (KUNDEN_UNTERORDNER_NAMEN) --
// dort ist die Quelle der Wahrheit für die tatsächliche Ordnerstruktur im Kundenordner.
const ZIEL_UNTERORDNER = {
  stromrechnung: '3_Stromrechnung',
  dachfoto: '4_Fotos',
  zaehlerpunkt: '4_Fotos'
};

// Claude-Modell für die Klassifikation. Vision-fähig, günstig genug für einen Piloten mit
// wenigen Dateien -- vor einem Rollout auf alle Deals nochmal gegen Preis/Genauigkeit prüfen.
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_API_VERSION = '2023-06-01';

// Wenn true: nichts wird in Drive geschrieben, nur klassifiziert und geloggt was passieren würde.
const DRY_RUN = true;

// ===== HILFSFUNKTIONEN (Pipedrive) =====
// fetchPipedrive/callPipedriveWithRetry 1:1 aus Ordnererstellung-bei-Gewonnen/Config.gs übernommen.

function getApiToken() {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN fehlt in den Script Properties (Projekteinstellungen prüfen).');
  return token;
}

function getAnthropicApiKey() {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY fehlt in den Script Properties (Projekteinstellungen prüfen).');
  return key;
}

/** LIEST: Pipedrive v2 GET mit Token im Header, Statusprüfung + Retry bei 429/5xx. */
function fetchPipedrive(path) {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`;
  return callPipedriveWithRetry(() => UrlFetchApp.fetch(url, {
    headers: { 'x-api-token': getApiToken() },
    muteHttpExceptions: true
  }), path);
}

/**
 * LIEST: Pipedrive v1 GET (Files-API existiert nur in v1, siehe Plan "Offene technische Punkte" --
 * kein anderer Header/Query-Auth-Unterschied zu v2, x-api-token funktioniert auch hier).
 */
function fetchPipedriveV1(path) {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v1/${path}`;
  return callPipedriveWithRetry(() => UrlFetchApp.fetch(url, {
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
      Utilities.sleep(1000 * Math.pow(2, attempt)); // 2s, 4s, 8s
      continue;
    }
    throw new Error(`Pipedrive API-Fehler ${code} bei "${path}": ${response.getContentText()}`);
  }
}

// ===== LOGGING =====
// Gepuffert statt appendRow pro Zeile, gleiches Schema wie Ordnererstellung-bei-Gewonnen/Config.gs.

const LOG_HEADER = ['Zeitstempel', 'Lauf-ID', 'Funktion', 'Modus', 'Deal-ID', 'Dateiname', 'Kategorie', 'Ergebnis', 'Detail'];
const PROP_LOG_SHEET_ID = 'KLASSIFIKATION_LOG_SHEET_ID';

let _logSheetCache = null;
let _logBuffer = [];
let _laufId = '-';
let _laufFunktion = '-';
let _laufStart = 0;

function starteLauf(funktionsName) {
  _laufId = Utilities.getUuid().slice(0, 8);
  _laufFunktion = funktionsName;
  _laufStart = Date.now();
  Logger.log(`[${_laufId}] ${funktionsName} gestartet (${DRY_RUN ? 'DRY' : 'LIVE'})`);
  return _laufId;
}

function getLogSheet() {
  if (_logSheetCache) return _logSheetCache;
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty(PROP_LOG_SHEET_ID);
  let ss = null;
  if (sheetId) {
    try { ss = SpreadsheetApp.openById(sheetId); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('LOG_Dateien-Klassifikation-Pilot');
    props.setProperty(PROP_LOG_SHEET_ID, ss.getId());
    ss.getActiveSheet().appendRow(LOG_HEADER);
    Logger.log(`Neues Log-Sheet angelegt: ${ss.getUrl()}`);
  }
  _logSheetCache = ss.getActiveSheet();
  return _logSheetCache;
}

function logRow(dealId, dateiname, kategorie, ergebnis, detail) {
  _logBuffer.push([
    new Date(), _laufId, _laufFunktion, DRY_RUN ? 'DRY' : 'LIVE',
    dealId || '', dateiname || '', kategorie || '', ergebnis, detail || ''
  ]);
}

function logLaufEnde(status, summary) {
  const dauer = Math.round((Date.now() - _laufStart) / 1000);
  logRow(null, null, null, status, `${JSON.stringify(summary)} -- ${dauer}s`);
  Logger.log(`[${_laufId}] ${_laufFunktion} ${status}: ${JSON.stringify(summary)} (${dauer}s)`);
}

function flushLog() {
  if (_logBuffer.length === 0) return;
  const sheet = getLogSheet();
  sheet.getRange(sheet.getLastRow() + 1, 1, _logBuffer.length, LOG_HEADER.length).setValues(_logBuffer);
  _logBuffer = [];
}
