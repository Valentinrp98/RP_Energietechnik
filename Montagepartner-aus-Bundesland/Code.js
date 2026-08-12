// ===== HAUPTFUNKTION =====
// Im Apps-Script-Editor oben im Dropdown auswählen und ausführen (▷-Button).

/**
 * Läuft einmalig über alle bestehenden Deals und befüllt das Montagepartner-Feld
 * aus dem bereits gesetzten Bundesland-Feld. DRY_RUN unten auf false stellen,
 * wenn die Testläufe im Log-Sheet passen.
 */
function fillMontagepartnerForAllDeals() {
  let cursor = null;
  let processed = 0;
  const summary = { gesetzt: 0, uebersprungen: 0, dryRun: 0 };

  do {
    // status=all_not_deleted: ohne das liefert /deals standardmäßig nur offene Deals,
    // "Gewonnen"-Deals (wo Bundesland/Montagepartner gepflegt werden) würden sonst fehlen.
    const path = `deals?limit=100&status=all_not_deleted${cursor ? `&cursor=${cursor}` : ''}`;
    const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`;
    const response = callPipedriveWithRetryRaw(url);
    const deals = response.data || [];
    cursor = response.additional_data?.next_cursor || null;

    for (const deal of deals) {
      const result = fillMontagepartnerForDeal(deal.id);
      processed++;
      if (result.startsWith('gesetzt')) summary.gesetzt++;
      else if (result.startsWith('DRY-RUN')) summary.dryRun++;
      else summary.uebersprungen++;
    }
  } while (cursor);

  if (processed === 0) {
    Logger.log('WARNUNG: 0 Deals von der Pipedrive-API zurückbekommen. Prüfe PIPEDRIVE_API_TOKEN und ob im Account überhaupt Deals existieren.');
  }
  Logger.log(`Fertig. ${processed} Deals geprüft. ${JSON.stringify(summary)}`);
}

/** Wrapper ohne Parameter, für einen fixen Test-Deal. */
function testEinzelDeal() {
  const result = fillMontagepartnerForDeal(7253); // Test-Deal-ID aus dem sevdesk-Sync-Projekt
  Logger.log(result);
}

/**
 * Für kontrolliertes Testen: nur die hier eingetragenen Deal-IDs befüllen (statt alle Deals),
 * damit man die Ergebnisse im Sheet gezielt gegenchecken kann, bevor man auf alle Deals losläuft.
 */
function fillMontagepartnerForAusgewaehlteDeals() {
  const dealIds = [7266,7255]; // hier eigene Deal-IDs eintragen, z.B. [7253, 7301, 7455]
  dealIds.forEach(dealId => {
    const result = fillMontagepartnerForDeal(dealId);
    Logger.log(`Deal ${dealId}: ${result}`);
  });
}

/** Für Einzeltests: befüllt das Montagepartner-Feld nur für einen Deal. Gibt einen Ergebnis-String zurück. */
function fillMontagepartnerForDeal(dealId) {
  const deal = fetchPipedrive(`deals/${dealId}`);
  const cf = deal.custom_fields || {};

  if (cf[MONTAGEPARTNER_FIELD_KEY]) {
    logRow(dealId, deal.title, null, 'übersprungen', null, 'Montagepartner bereits gesetzt');
    return 'übersprungen (bereits gesetzt)';
  }

  const bundeslandOptionId = cf[BUNDESLAND_FIELD_KEY];
  if (!bundeslandOptionId) {
    logRow(dealId, deal.title, null, 'übersprungen', null, 'kein Bundesland gesetzt');
    return 'übersprungen (kein Bundesland)';
  }

  const bundesland = BUNDESLAND_ID_TO_NAME[bundeslandOptionId];
  const partner = BUNDESLAND_TO_MONTAGEPARTNER[bundesland];
  if (!partner) {
    // Trifft aktuell v.a. auf Oberösterreich zu (2 Partner, Kreuzeder + Greensky -> nicht automatisch
    // entscheidbar), sowie Bundesländer ohne definierten Partner (Steiermark, Tirol, Vorarlberg).
    logRow(dealId, deal.title, bundesland, 'übersprungen', null, 'kein eindeutiger Partner für dieses Bundesland (manuell zuordnen)');
    return `übersprungen (${bundesland}: kein eindeutiger Partner)`;
  }

  const optionId = MONTAGEPARTNER_OPTION_IDS[partner];

  if (DRY_RUN) {
    logRow(dealId, deal.title, bundesland, 'DRY-RUN', partner, 'würde gesetzt werden');
    return `DRY-RUN: würde ${partner} setzen (${bundesland})`;
  }

  patchPipedrive(`deals/${dealId}`, { custom_fields: { [MONTAGEPARTNER_FIELD_KEY]: optionId } });
  logRow(dealId, deal.title, bundesland, 'gesetzt', partner, '');
  return `gesetzt: ${partner} (${bundesland})`;
}

// ===== KONFIGURATION =====

const PIPEDRIVE_DOMAIN = 'rp-energietechnik';

// Deal-Custom-Fields (siehe Feldkatalog-Doku)
const BUNDESLAND_FIELD_KEY = '43a5e2fa23f0659ac07ca499a629d5c391cfc440';
const MONTAGEPARTNER_FIELD_KEY = '0190fd945adc86148657d2db36261ae9545e7bda';

const BUNDESLAND_OPTION_IDS = {
  'Wien': 162, 'Niederösterreich': 163, 'Oberösterreich': 164, 'Salzburg': 165,
  'Kärnten': 166, 'Steiermark': 167, 'Tirol': 168, 'Vorarlberg': 169, 'Burgenland': 170
};
// Umgekehrte Zuordnung: Bundesland-Options-ID (aus dem Deal-Feld) -> Klartext-Name
const BUNDESLAND_ID_TO_NAME = Object.fromEntries(
  Object.entries(BUNDESLAND_OPTION_IDS).map(([name, id]) => [id, name])
);

const MONTAGEPARTNER_OPTION_IDS = {
  'ALE-Engineering (NÖ, Wien, BGL)': 157,
  'Berger Elektrotechnik (KTN)': 158,
  'Greensky (OÖ, SBG)': 159,
  'KOLLSTAR (OÖ)': 160,
  'Kreuzeder (OÖ, SBG)': 161
};

// Bundesland -> Montagepartner. Nur eindeutige Zuordnungen -- Oberösterreich bewusst NICHT drin,
// weil dort zwei Partner (Kreuzeder + Greensky, siehe MONTAGEPARTNER_OPTION_IDS) im Einsatz sind
// und die Wahl zwischen den beiden nicht automatisch entscheidbar ist (Valentins Vorgabe 2026-08-12).
// Steiermark, Tirol, Vorarlberg: aktuell kein Partner definiert, ebenfalls nicht drin.
const BUNDESLAND_TO_MONTAGEPARTNER = {
  'Salzburg': 'Kreuzeder (OÖ, SBG)',
  'Wien': 'ALE-Engineering (NÖ, Wien, BGL)',
  'Niederösterreich': 'ALE-Engineering (NÖ, Wien, BGL)',
  'Burgenland': 'ALE-Engineering (NÖ, Wien, BGL)',
  'Kärnten': 'Berger Elektrotechnik (KTN)'
};

// Nur fürs Logging: ALLE Partner, die laut Valentin in einem Bundesland aktiv sind (auch die
// mehrdeutigen), damit im Sheet nachvollziehbar ist, welche Kandidaten zur Wahl standen --
// nicht nur bei eindeutigen Fällen, sondern gerade auch bei übersprungenen wie Oberösterreich.
const BUNDESLAND_PARTNER_KANDIDATEN = {
  'Salzburg': ['Kreuzeder (OÖ, SBG)'],
  'Wien': ['ALE-Engineering (NÖ, Wien, BGL)'],
  'Niederösterreich': ['ALE-Engineering (NÖ, Wien, BGL)'],
  'Burgenland': ['ALE-Engineering (NÖ, Wien, BGL)'],
  'Kärnten': ['Berger Elektrotechnik (KTN)'],
  'Oberösterreich': ['Kreuzeder (OÖ, SBG)', 'Greensky (OÖ, SBG)', 'KOLLSTAR (OÖ)']
  // Steiermark, Tirol, Vorarlberg: keine Kandidaten hinterlegt, kein Partner definiert.
};

// Wenn true: nichts wird geschrieben, nur geloggt was passieren würde
const DRY_RUN = true;

// ===== HILFSFUNKTIONEN =====

/** Holt den API-Token aus Script Properties, wirft klaren Fehler wenn er fehlt. */
function getApiToken() {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN fehlt in den Script Properties (Projekteinstellungen prüfen).');
  return token;
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

/** Wie callPipedriveWithRetry, aber gibt die volle Response (inkl. additional_data) zurück, nicht nur .data. */
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

/** Self-bootstrapping Log-Sheet, analog zum Bundesland-aus-PLZ-Script. */
function getLogSheet() {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty('MONTAGEPARTNER_LOG_SHEET_ID');
  let ss;
  if (sheetId) {
    try { ss = SpreadsheetApp.openById(sheetId); } catch (e) { sheetId = null; }
  }
  if (!sheetId) {
    ss = SpreadsheetApp.create('LOG_Montagepartner aus Bundesland');
    props.setProperty('MONTAGEPARTNER_LOG_SHEET_ID', ss.getId());
    const sheet = ss.getActiveSheet();
    sheet.appendRow([
      'Zeitstempel', 'Deal-ID', 'Deal-Titel', 'Bundesland', 'Ergebnis',
      'Montagepartner', 'Partner-Kandidaten für dieses Bundesland', 'Detail'
    ]);
    Logger.log(`Neues Log-Sheet angelegt: ${ss.getUrl()}`);
  }
  return ss.getActiveSheet();
}

/**
 * Loggt eine Zeile inkl. Nachvollziehbarkeit: zeigt in "Partner-Kandidaten" IMMER alle laut
 * BUNDESLAND_PARTNER_KANDIDATEN für dieses Bundesland aktiven Partner (auch bei eindeutigen
 * Fällen mit nur einem Kandidaten), damit man bei übersprungenen Zeilen (z.B. Oberösterreich)
 * direkt im Sheet sieht WARUM keine automatische Wahl möglich war.
 */
function logRow(dealId, dealTitle, bundesland, ergebnis, partner, detail) {
  const kandidaten = bundesland ? (BUNDESLAND_PARTNER_KANDIDATEN[bundesland] || []) : [];
  getLogSheet().appendRow([
    new Date(), dealId, dealTitle, bundesland || '', ergebnis,
    partner || '', kandidaten.join(' / '), detail || ''
  ]);
}
