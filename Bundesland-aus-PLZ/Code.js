// ===== HAUPTFUNKTION =====
// Im Apps-Script-Editor oben im Dropdown auswählen und ausführen (▷-Button).

/**
 * Läuft einmalig über alle bestehenden Deals und befüllt das Bundesland-Feld aus der PLZ.
 * DRY_RUN unten auf false stellen, wenn die Testläufe im Log-Sheet passen.
 */
function fillBundeslandForAllDeals() {
  let cursor = null;
  let processed = 0;
  const summary = { gesetzt: 0, uebersprungen: 0, dryRun: 0 };

  do {
    // status=all_not_deleted: ohne das liefert /deals standardmäßig nur offene Deals,
    // "Gewonnen"-Deals (wo Bundesland gepflegt wird) würden sonst nie zurückkommen.
    const path = `deals?limit=100&status=all_not_deleted${cursor ? `&cursor=${cursor}` : ''}`;
    const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`;
    const response = callPipedriveWithRetryRaw(url);
    const deals = response.data || [];
    cursor = response.additional_data?.next_cursor || null;

    for (const deal of deals) {
      const result = fillBundeslandForDeal(deal.id);
      processed++;
      if (result.startsWith('gesetzt')) summary.gesetzt++;
      else if (result.startsWith('DRY-RUN')) summary.dryRun++;
      else summary.uebersprungen++;
    }
  } while (cursor);

  if (processed === 0) {
    Logger.log('WARNUNG: 0 Deals von der Pipedrive-API zurückbekommen. Kein Sheet wurde angelegt, weil nie geloggt wurde. Prüfe PIPEDRIVE_API_TOKEN und ob im Account überhaupt Deals existieren.');
  }
  Logger.log(`Fertig. ${processed} Deals geprüft. ${JSON.stringify(summary)}`);
}

/** Wrapper ohne Parameter, damit man im Apps-Script-Dropdown direkt einen Einzeldeal testen kann. */
function testEinzelDeal() {
  const result = fillBundeslandForDeal(7253); // Test-Deal-ID aus dem sevdesk-Sync-Projekt
  Logger.log(result);
}

/**
 * Für kontrolliertes Testen: nur die hier eingetragenen Deal-IDs befüllen (statt alle Deals),
 * damit man die Ergebnisse im Sheet gezielt gegenchecken kann, bevor man auf alle Deals losläuft.
 * IDs einfach in der Liste unten eintragen/ändern und Funktion ausführen.
 */
function fillBundeslandForAusgewaehlteDeals() {
  const dealIds = [7253,7255]; // hier eigene Deal-IDs eintragen, z.B. [7253, 7301, 7455]
  dealIds.forEach(dealId => {
    const result = fillBundeslandForDeal(dealId);
    Logger.log(`Deal ${dealId}: ${result}`);
  });
}

/** EINMALIG ausführen: listet alle Person-Custom-Fields mit Name + field_key im Log.
 *  Damit den field_key von "Postleitzahl" finden und unten in PLZ_FIELD_KEY eintragen. */
function logPersonFields() {
  const fields = fetchPipedrive('personFields?limit=200');
  // Volle Struktur des ersten Feldes zeigen, um die richtige Property fürs Klartext-Label zu finden.
  Logger.log('Beispiel-Feld komplett: ' + JSON.stringify(fields[0]));
  // Nur Custom Fields (keine Standard-Properties wie id/name/add_time) zeigen -- das sind die,
  // deren field_code ein langer Hash ist statt ein Wort wie "id" oder "org_id".
  fields
    .filter(f => f.field_code && f.field_code.length > 20)
    .forEach(f => Logger.log(JSON.stringify(f)));
}

/** Für Einzeltests: befüllt das Bundesland-Feld nur für einen Deal. Gibt einen Ergebnis-String zurück. */
function fillBundeslandForDeal(dealId) {
  const deal = fetchPipedrive(`deals/${dealId}`);
  const cf = deal.custom_fields || {};

  if (cf[BUNDESLAND_FIELD_KEY]) {
    logRow(dealId, deal.title, null, 'übersprungen', null, 'Bundesland bereits gesetzt');
    return 'übersprungen (bereits gesetzt)';
  }
  if (!deal.person_id) {
    logRow(dealId, deal.title, null, 'übersprungen', null, 'keine verknüpfte Person');
    return 'übersprungen (keine Person)';
  }

  const person = fetchPipedrive(`persons/${deal.person_id.value || deal.person_id}`);
  const plz = extractPlz(person.custom_fields?.[PLZ_FIELD_KEY]);

  if (!plz) {
    logRow(dealId, deal.title, null, 'übersprungen', null, 'keine gültige PLZ im Postleitzahl-Feld');
    return 'übersprungen (keine PLZ)';
  }
  const optionId = bundeslandOptionIdForPlz(plz);
  if (!optionId) {
    logRow(dealId, deal.title, plz, 'übersprungen', null, 'PLZ nicht im Verzeichnis gefunden');
    return `übersprungen (PLZ ${plz} unbekannt)`;
  }
  const bundesland = PLZ_BUNDESLAND[plz];

  if (DRY_RUN) {
    logRow(dealId, deal.title, plz, 'DRY-RUN', bundesland, 'würde gesetzt werden');
    return `DRY-RUN: würde ${bundesland} setzen (PLZ ${plz})`;
  }

  patchPipedrive(`deals/${dealId}`, { custom_fields: { [BUNDESLAND_FIELD_KEY]: optionId } });
  logRow(dealId, deal.title, plz, 'gesetzt', bundesland, '');
  return `gesetzt: ${bundesland} (PLZ ${plz})`;
}

// ===== KONFIGURATION =====

const PIPEDRIVE_DOMAIN = 'rp-energietechnik';

// Deal-Custom-Field "Bundesland" (siehe Feldkatalog-Doku)
const BUNDESLAND_FIELD_KEY = '43a5e2fa23f0659ac07ca499a629d5c391cfc440';
const BUNDESLAND_OPTION_IDS = {
  'Wien': 162, 'Niederösterreich': 163, 'Oberösterreich': 164, 'Salzburg': 165,
  'Kärnten': 166, 'Steiermark': 167, 'Tirol': 168, 'Vorarlberg': 169, 'Burgenland': 170
};

// "Postleitzahl" ist bei RP ein EIGENES varchar-Feld an der PERSON, kein Subfeld von "Adresse"
// (per logPersonFields()-Debug am 2026-08-12 bestätigt).
const PLZ_FIELD_KEY = '5fef394025c936df4b58763b2b58c340fbb0d251';

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

/** Validiert/normalisiert den Rohwert des "Postleitzahl"-Felds (varchar) auf eine 4-stellige AT-PLZ. */
function extractPlz(plzRaw) {
  if (!plzRaw) return null;
  const trimmed = String(plzRaw).trim();
  return /^\d{4}$/.test(trimmed) ? trimmed : null;
}

/** PLZ -> Bundesland-Enum-Options-ID. Gibt null zurück bei unbekannter PLZ. */
function bundeslandOptionIdForPlz(plz) {
  const bundesland = PLZ_BUNDESLAND[plz];
  if (!bundesland) return null;
  return BUNDESLAND_OPTION_IDS[bundesland];
}

/** Self-bootstrapping Log-Sheet, analog zum Fulfillment-Field-Setup-Script. */
function getLogSheet() {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty('BUNDESLAND_LOG_SHEET_ID');
  let ss;
  if (sheetId) {
    try { ss = SpreadsheetApp.openById(sheetId); } catch (e) { sheetId = null; }
  }
  if (!sheetId) {
    ss = SpreadsheetApp.create('LOG_Bundesland aus PLZ');
    props.setProperty('BUNDESLAND_LOG_SHEET_ID', ss.getId());
    const sheet = ss.getActiveSheet();
    sheet.appendRow([
      'Zeitstempel', 'Deal-ID', 'Deal-Titel', 'PLZ', 'Ergebnis', 'Bundesland',
      'Zuordnungs-Methode', 'Quell-Gemeinde', 'GKZ', 'Grenzfall-Detail', 'Detail'
    ]);
    Logger.log(`Neues Log-Sheet angelegt: ${ss.getUrl()}`);
  }
  return ss.getActiveSheet();
}

/**
 * Loggt eine Zeile inkl. Nachvollziehbarkeit: welche Gemeinde/GKZ/Methode aus PlzBundeslandMap.js
 * zur Bundesland-Zuordnung geführt hat (PLZ_QUELLE), damit man im Sheet direkt sieht WARUM,
 * nicht nur WAS. Bei Grenzfall-PLZ steht zusätzlich, welche Gemeinden/Bundesländer zur Auswahl standen.
 */
function logRow(dealId, dealTitle, plz, ergebnis, bundesland, detail) {
  const quelle = plz ? PLZ_QUELLE[plz] : null;
  getLogSheet().appendRow([
    new Date(), dealId, dealTitle, plz || '', ergebnis, bundesland || '',
    quelle ? quelle.methode : '',
    quelle ? quelle.gemeinde : '',
    quelle ? quelle.gkz : '',
    quelle && quelle.grenzfallDetail ? quelle.grenzfallDetail : '',
    detail || ''
  ]);
}
