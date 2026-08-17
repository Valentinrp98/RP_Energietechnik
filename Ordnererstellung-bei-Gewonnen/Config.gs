// ===== KONFIGURATION =====
// TODO-Marker unten sind Werte, die nur Valentin im Pipedrive-/Drive-Admin nachschauen kann.
// Ohne die TODOs ausgefüllt zu haben läuft das Script nicht (wirft beim Start einen klaren Fehler).

const PIPEDRIVE_DOMAIN = 'rp-energietechnik';

// Deal-Custom-Fields (bereits bekannt, aus Montagepartner-aus-Bundesland übernommen)
const MONTAGEPARTNER_FIELD_KEY = '0190fd945adc86148657d2db36261ae9545e7bda';

// TODO: Neues Deal-Custom-Field in Pipedrive anlegen ("Kundenordner-Link", Typ Text/URL),
// dann field_code hier eintragen. Mit listDealFieldsHelper() (siehe SetupHelpers.gs) auslesen.
const KUNDENORDNER_LINK_FIELD_KEY = '5c442fe317da26ed4f60504e2b912df7e3116c5b';

// Person-Custom-Field "Adresse" (bereits bekannt, aus Pipedrive-form-prefill-mail-trigger übernommen)
const ADRESSE_FIELD_KEY = '432e4e165de7e9f474643c3d3a5552e2ec976f55';

// Person-Custom-Field "Postleitzahl" -- eigenes Feld, NICHT Teil von ADRESSE_FIELD_KEY
// (gleicher Fund wie im Bundesland-aus-PLZ-Script). Wird für den Ordnernamen mit angehängt.
const PLZ_FIELD_KEY = '5fef394025c936df4b58763b2b58c340fbb0d251';

// Gleiche Options-IDs wie im Montagepartner-aus-Bundesland-Script (dieselben Pipedrive-Optionen)
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

// TODO: Für jeden Montagepartner die Drive-Ordner-ID des jeweiligen Partner-Hauptordners eintragen
// (Ordner-ID = der Teil der URL nach /folders/). Das ist der PARTNER-ROOT, NICHT "Montage offen"
// selbst -- der Kunden-Unterordner landet im Unterordner MONTAGE_OFFEN_ORDNERNAME (siehe unten),
// der in diesem Root-Ordner bereits existieren MUSS (wird nicht automatisch angelegt, siehe
// FolderCreation.gs -- fehlt er, ist das ein Setup-Fehler, kein Normalfall).
//
// Testumgebung (2026-08-12, Valentins Test-Setup): WIEN-Dummy-Partner und OÖ-Dummy-Partner haben
// je schon "Montage offen"/"Montage abgeschlossen" (WIEN) bzw. nur "Montage offen" (OÖ) angelegt.
const PARTNER_TO_DRIVE_FOLDER_ID = {
  'ALE-Engineering (NÖ, Wien, BGL)': '10BaT1-qjhlhBK0h9QYUki6wGQNUdGGcE', // Testumgebung: WIEN-Dummy-Partner
  'Berger Elektrotechnik (KTN)': 'TODO_DRIVE_FOLDER_ID_BERGER',
  'Greensky (OÖ, SBG)': 'TODO_DRIVE_FOLDER_ID_GREENSKY',
  'KOLLSTAR (OÖ)': '1Ej7Tl7fz5j2-zQGjpNiV2mQCG7ve0u_n', // Testumgebung: OÖ-Dummy-Partner
  'Kreuzeder (OÖ, SBG)': 'TODO_DRIVE_FOLDER_ID_KREUZEDER'
};

// Name des Unterordners im Partner-Root, in den neue Kundenordner rein sollen.
const MONTAGE_OFFEN_ORDNERNAME = 'Montage offen';

// Unterordner-Struktur pro Kunde (aus dem bestehenden Prototyp OrdnerfürKundenerstellen_hardcoded_names.js übernommen)
const KUNDEN_UNTERORDNER_NAMEN = [
  '1_AB',
  '2_Projektdokumentation',
  '3_Stromrechnung',
  '4_Fotos',
  '5_Abschlussdoks.-Zaehlern._Fertigm._Prüfprot.'
];

// TODO: Web-App-URL hier eintragen, NACHDEM einmal deployed wurde (Bereitstellen > Neue
// Bereitstellung > Web App). Bewusst als Konstante statt als Funktionsparameter -- der ▷-Button
// im Editor ruft Funktionen immer ohne Argumente auf, ein Parameter würde als "undefined" durchgehen
// und einen kaputten Webhook auf die URL "undefined" registrieren (siehe SetupHelpers.gs).
const WEB_APP_URL = 'TODO_WEB_APP_URL_NACH_DEPLOYMENT';

// Wenn true: nichts wird in Drive/Pipedrive geschrieben, nur geloggt was passieren würde
const DRY_RUN = true;

// ===== HILFSFUNKTIONEN =====

/** Holt den API-Token aus Script Properties, wirft klaren Fehler wenn er fehlt. */
function getApiToken() {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN fehlt in den Script Properties (Projekteinstellungen prüfen).');
  return token;
}

/** Shared Secret, mit dem der Webhook-Aufruf von Pipedrive geprüft wird (siehe WebhookHandler.gs). */
function getWebhookSecret() {
  const secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  if (!secret) throw new Error('WEBHOOK_SECRET fehlt in den Script Properties. Selbst einen zufälligen String vergeben und bei der Webhook-Registrierung (registerPipedriveWebhook) mitgeben.');
  return secret;
}

/** LIEST: Pipedrive-GET mit Token im Header, Statusprüfung + Retry bei 429/5xx. */
function fetchPipedrive(path) {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`;
  return callPipedriveWithRetry(() => UrlFetchApp.fetch(url, {
    headers: { 'x-api-token': getApiToken() },
    muteHttpExceptions: true
  }), path);
}

/** SCHREIBT: Pipedrive-PATCH mit Token im Header, Statusprüfung + Retry bei 429/5xx. */
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

/** Retry-Wrapper: bei 429/5xx bis zu 3x mit steigender Wartezeit, bei 4xx sofort abbrechen. */
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

/** Self-bootstrapping Log-Sheet, analog zu den anderen RP-Scripts. */
function getLogSheet() {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty('ORDNER_LOG_SHEET_ID');
  let ss;
  if (sheetId) {
    try { ss = SpreadsheetApp.openById(sheetId); } catch (e) { sheetId = null; }
  }
  if (!sheetId) {
    ss = SpreadsheetApp.create('LOG_Ordnererstellung bei Gewonnen');
    props.setProperty('ORDNER_LOG_SHEET_ID', ss.getId());
    const sheet = ss.getActiveSheet();
    sheet.appendRow(['Zeitstempel', 'Deal-ID', 'Deal-Titel', 'Montagepartner', 'Ergebnis', 'Ordner-Link', 'Detail']);
    Logger.log(`Neues Log-Sheet angelegt: ${ss.getUrl()}`);
  }
  return ss.getActiveSheet();
}

function logRow(dealId, dealTitle, partner, ergebnis, ordnerLink, detail) {
  getLogSheet().appendRow([new Date(), dealId, dealTitle || '', partner || '', ergebnis, ordnerLink || '', detail || '']);
}
