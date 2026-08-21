// ==========================================================================================
// PROJEKT: "Montagepartner-aus-Bundesland"  (scriptId 1syrD6zGu5gB0hKHZFUd9qHrM_8u7tSj89HGcNfkOZTcmaW2JSID3z9KN)
// DATEI IM EDITOR: Code.gs        --> kompletten Inhalt ersetzen
//
// Stand 2026-08-12, Fix-Version. Aenderungen ggue. der Live-Version:
//   FIX A  Stille Fehlschreibung: fehlende Montagepartner-Option-ID fuehrte zu einem PATCH mit
//          leerem custom_fields -> Pipedrive antwortet 200, Log sagte "gesetzt", gesetzt wurde
//          aber nichts. Jetzt eigener FEHLER-Fall vor dem Schreiben.
//   FIX B  Unbekannte Bundesland-Option-ID wurde als Fachfall "kein eindeutiger Partner"
//          geloggt statt als Konfigurationsfehler.
//   FIX C  SALZBURG steht jetzt auf manuell (siehe grosser Kommentar unten) -- ENTSCHEIDUNG
//          VON VALENTIN NOETIG, bevor DRY_RUN=false gesetzt wird.
//   FIX D  Log-Sheet wurde pro Zeile neu geoeffnet + einzeln beschrieben -> gecached, gebuendelt
//   FIX E  Vollauf ohne Resume -> Cursor + Zeitbudget in ScriptProperties
//   FIX F  Doppelter API-Call pro Deal -> Deal aus der Listenabfrage wird wiederverwendet
//          (dieses Script braucht nur den Deal selbst -> spart ~50% aller Calls)
//   FIX G  FORCE_OVERWRITE-Schalter
//   FIX H  Retry-Kommentar sagte 2s/4s/8s, tatsaechlich 2s/4s
//   NEU    pruefeKonfiguration() - gleicht Bundesland- und Montagepartner-Option-IDs mit
//          Pipedrive ab (faengt genau die Fehlerklasse aus FIX A + FIX B ab)
//
// REIHENFOLGE: Dieses Script liest das Bundesland-Feld am Deal. Es MUSS nach dem
// PLZ->Bundesland-Script laufen, sonst werden alle Deals als "kein Bundesland gesetzt"
// uebersprungen -- das sieht im Log wie ein sauberer Lauf aus, ist aber ein Nulllauf.
// ==========================================================================================


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
  'Kreuzeder (OÖ, SBG)': 161,
  'Tiroler Partner (T)': 243,
  'Vorarlberg Partner (V)': 244
};

// ------------------------------------------------------------------------------------------
// Bundesland -> Montagepartner. Seit 2026-08-20 (Valentins Entscheidung) ALLE 9 Bundesländer
// eindeutig zugeordnet: Oberoesterreich komplett zu Kreuzeder (Greensky/KOLLSTAR bleiben als
// Pipedrive-Optionen bestehen, sind aber kein automatisches Bundesland-Ziel mehr), Steiermark
// zu ALE, neue eigene Partner fuer Tirol und Vorarlberg angelegt.
//
// FIX C -- ENTSCHEIDUNG SALZBURG (Valentin, 2026-08-12): Greensky ist NICHT in Salzburg aktiv,
// nur Kreuzeder. Das Options-Label "Greensky (OÖ, SBG)" in Pipedrive ist irrefuehrend/falsch
// und sollte dort korrigiert werden -- im Script ist Salzburg damit wieder eindeutig.
// ------------------------------------------------------------------------------------------
const BUNDESLAND_TO_MONTAGEPARTNER = {
  'Wien': 'ALE-Engineering (NÖ, Wien, BGL)',
  'Niederösterreich': 'ALE-Engineering (NÖ, Wien, BGL)',
  'Burgenland': 'ALE-Engineering (NÖ, Wien, BGL)',
  'Steiermark': 'ALE-Engineering (NÖ, Wien, BGL)',
  'Kärnten': 'Berger Elektrotechnik (KTN)',
  'Oberösterreich': 'Kreuzeder (OÖ, SBG)',
  'Salzburg': 'Kreuzeder (OÖ, SBG)',
  'Tirol': 'Tiroler Partner (T)',
  'Vorarlberg': 'Vorarlberg Partner (V)'
};

// Nur fuers Logging: ALLE Partner, die in einem Bundesland infrage kommen -- seit 2026-08-20
// pro Bundesland nur noch genau einer, da alle eindeutig zugeordnet sind.
const BUNDESLAND_PARTNER_KANDIDATEN = {
  'Wien': ['ALE-Engineering (NÖ, Wien, BGL)'],
  'Niederösterreich': ['ALE-Engineering (NÖ, Wien, BGL)'],
  'Burgenland': ['ALE-Engineering (NÖ, Wien, BGL)'],
  'Steiermark': ['ALE-Engineering (NÖ, Wien, BGL)'],
  'Kärnten': ['Berger Elektrotechnik (KTN)'],
  'Oberösterreich': ['Kreuzeder (OÖ, SBG)'],
  'Salzburg': ['Kreuzeder (OÖ, SBG)'],
  'Tirol': ['Tiroler Partner (T)'],
  'Vorarlberg': ['Vorarlberg Partner (V)']
};

// Wenn true: nichts wird geschrieben, nur geloggt was passieren wuerde
const DRY_RUN = false;

// FIX G: Wenn true, wird ein bereits gesetzter Montagepartner ueberschrieben. Normalfall false.
const FORCE_OVERWRITE = false;

// FIX E: freiwilliger Abbruch vor dem harten Apps-Script-Limit
const MAX_LAUFZEIT_MS = 4.5 * 60 * 1000;

const PROP_RESUME_CURSOR = 'MONTAGEPARTNER_RESUME_CURSOR';
const PROP_LOG_SHEET_ID = 'MONTAGEPARTNER_LOG_SHEET_ID';


// ===== HAUPTFUNKTIONEN =====
// Im Apps-Script-Editor oben im Dropdown auswaehlen und ausfuehren (>-Button).

/**
 * Laeuft ueber alle bestehenden Deals und befuellt das Montagepartner-Feld aus dem bereits
 * gesetzten Bundesland-Feld. DRY_RUN oben auf false stellen, wenn die Testlaeufe passen.
 *
 * FIX E: Bricht nach MAX_LAUFZEIT_MS freiwillig ab und merkt sich den Cursor -- einfach
 * nochmal starten, bis "DURCHGELAUFEN" im Log steht. resetVollauf() startet von vorne.
 */
function fillMontagepartnerForAllDeals() {
  const props = PropertiesService.getScriptProperties();
  const start = Date.now();
  let cursor = props.getProperty(PROP_RESUME_CURSOR) || null;
  let processed = 0;
  let abgebrochen = false;
  const summary = { gesetzt: 0, uebersprungen: 0, dryRun: 0, fehler: 0 };

  if (cursor) Logger.log(`Setze abgebrochenen Lauf fort (Cursor ${cursor}). Fuer Neustart von vorne: resetVollauf()`);

  try {
    do {
      // KEIN status-Parameter: v2 liefert ohne ihn laut Doku "all not deleted deals", also
      // offene UND gewonnene/verlorene -- genau was wir brauchen. Der v1-Wert "all_not_deleted"
      // ist in v2 ungueltig und quittiert mit 400 ERR_SCHEMA_VALIDATION_FAILED (v2 kennt nur
      // open | won | lost | deleted).
      const path = `deals?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const response = callPipedriveWithRetryRaw(`https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`);
      const deals = response.data || [];
      cursor = (response.additional_data && response.additional_data.next_cursor) || null;

      for (const deal of deals) {
        // FIX F: Deal-Objekt aus der Liste durchreichen -- dieses Script braucht sonst nichts,
        // damit faellt der komplette Einzelabruf pro Deal weg.
        const result = fillMontagepartnerForDeal(deal.id, deal);
        processed++;
        if (result.startsWith('gesetzt')) summary.gesetzt++;
        else if (result.startsWith('DRY-RUN')) summary.dryRun++;
        else if (result.startsWith('FEHLER')) summary.fehler++;
        else summary.uebersprungen++;
      }

      if (cursor) props.setProperty(PROP_RESUME_CURSOR, cursor);
      else props.deleteProperty(PROP_RESUME_CURSOR);

      if (cursor && Date.now() - start > MAX_LAUFZEIT_MS) {
        abgebrochen = true;
        break;
      }
    } while (cursor);
  } finally {
    flushLog(); // FIX D
  }

  if (processed === 0 && !abgebrochen) {
    Logger.log('WARNUNG: 0 Deals von der Pipedrive-API zurueckbekommen. Pruefe PIPEDRIVE_API_TOKEN und ob im Account ueberhaupt Deals existieren.');
  }
  Logger.log(`${abgebrochen ? 'PAUSIERT (Zeitbudget) -- nochmal starten, macht automatisch weiter.' : 'DURCHGELAUFEN.'} ` +
             `${processed} Deals in diesem Lauf. ${JSON.stringify(summary)}`);
  if (summary.fehler > 0) Logger.log(`ACHTUNG: ${summary.fehler} Konfigurationsfehler -- pruefeKonfiguration() ausfuehren.`);
  if (summary.gesetzt === 0 && summary.dryRun === 0 && processed > 0) {
    Logger.log('HINWEIS: kein einziger Deal zugeordnet. Haeufigste Ursache: das PLZ->Bundesland-Script ist noch nicht gelaufen (Reihenfolge!).');
  }
}

/** Vollauf bewusst von vorne starten (loescht den gemerkten Cursor). */
function resetVollauf() {
  PropertiesService.getScriptProperties().deleteProperty(PROP_RESUME_CURSOR);
  Logger.log('Resume-Cursor geloescht. Naechster fillMontagepartnerForAllDeals()-Lauf startet bei Deal 1.');
}

/** Wrapper ohne Parameter, fuer einen fixen Test-Deal. */
function testEinzelDeal() {
  try {
    Logger.log(fillMontagepartnerForDeal(7253)); // Test-Deal-ID aus dem sevdesk-Sync-Projekt
  } finally {
    flushLog();
  }
}

/**
 * Fuer kontrolliertes Testen: nur die hier eingetragenen Deal-IDs befuellen (statt alle Deals),
 * damit man die Ergebnisse im Sheet gezielt gegenchecken kann, bevor man auf alle Deals losläuft.
 */
function fillMontagepartnerForAusgewaehlteDeals() {
  // Aus dem ersten Projektdoku-Generator-Live-Batch (21.08.) als "kein Kundenordner-Link" aufgefallen,
  // dann hier als "kein Montagepartner gesetzt" haengengeblieben. Reihenfolge: ERST
  // fillBundeslandForAusgewaehlteDeals() (Bundesland-aus-PLZ) laufen lassen, dann diese Funktion --
  // sonst werden alle 14 wieder als "kein Bundesland gesetzt" uebersprungen.
  const dealIds = [
    4945, 5142, 5237, 5373, 5530, 5749, 5758, 5829, 5972, 6013, 6027, 6198, 6326, 6592
  ];
  try {
    dealIds.forEach(dealId => Logger.log(`Deal ${dealId}: ${fillMontagepartnerForDeal(dealId)}`));
  } finally {
    flushLog();
  }
}

/**
 * Befuellt das Montagepartner-Feld fuer EINEN Deal. Gibt einen Ergebnis-String zurueck.
 * @param {number} dealId
 * @param {Object} [dealVorab] Deal-Objekt aus der Listenabfrage (FIX F, spart einen API-Call).
 */
function fillMontagepartnerForDeal(dealId, dealVorab) {
  const deal = (dealVorab && dealVorab.custom_fields) ? dealVorab : fetchPipedrive(`deals/${dealId}`);
  const cf = deal.custom_fields || {};

  if (cf[MONTAGEPARTNER_FIELD_KEY] && !FORCE_OVERWRITE) {
    logRow(dealId, deal.title, null, 'übersprungen', null, 'Montagepartner bereits gesetzt');
    return 'übersprungen (bereits gesetzt)';
  }

  const bundeslandOptionId = cf[BUNDESLAND_FIELD_KEY];
  if (!bundeslandOptionId) {
    logRow(dealId, deal.title, null, 'übersprungen', null, 'kein Bundesland gesetzt (PLZ->Bundesland-Script zuerst laufen lassen)');
    return 'übersprungen (kein Bundesland)';
  }

  // FIX B: unbekannte Option-ID ist ein KONFIGURATIONSFEHLER, kein Fachfall. Vorher landete
  // der Fall stillschweigend im "kein eindeutiger Partner"-Bucket zwischen den OOE-Zeilen.
  const bundesland = BUNDESLAND_ID_TO_NAME[bundeslandOptionId];
  if (!bundesland) {
    logRow(dealId, deal.title, null, 'FEHLER', null,
      `KONFIG-FEHLER: Bundesland-Option-ID ${bundeslandOptionId} ist im Script nicht hinterlegt -- pruefeKonfiguration() ausfuehren`);
    return `FEHLER (unbekannte Bundesland-Option ${bundeslandOptionId})`;
  }

  const partner = BUNDESLAND_TO_MONTAGEPARTNER[bundesland];
  if (!partner) {
    // Fachlich gewollt: Oberoesterreich (3 Partner), Salzburg (2, siehe FIX C) sowie
    // Steiermark/Tirol/Vorarlberg (kein Partner definiert).
    logRow(dealId, deal.title, bundesland, 'übersprungen', null, 'kein eindeutiger Partner für dieses Bundesland (manuell zuordnen)');
    return `übersprungen (${bundesland}: kein eindeutiger Partner)`;
  }

  // FIX A: ohne diese Pruefung wirft JSON.stringify einen undefined-Wert raus, der PATCH geht
  // mit leerem custom_fields raus, Pipedrive antwortet 200 -- und der Log meldet faelschlich
  // "gesetzt", obwohl nichts geschrieben wurde.
  const optionId = MONTAGEPARTNER_OPTION_IDS[partner];
  if (!optionId) {
    logRow(dealId, deal.title, bundesland, 'FEHLER', partner,
      `KONFIG-FEHLER: keine Option-ID für "${partner}" hinterlegt -- pruefeKonfiguration() ausfuehren`);
    return `FEHLER (Option-ID für ${partner} fehlt)`;
  }

  if (DRY_RUN) {
    logRow(dealId, deal.title, bundesland, 'DRY-RUN', partner, 'würde gesetzt werden');
    return `DRY-RUN: würde ${partner} setzen (${bundesland})`;
  }

  patchPipedrive(`deals/${dealId}`, { custom_fields: { [MONTAGEPARTNER_FIELD_KEY]: optionId } });
  logRow(dealId, deal.title, bundesland, 'gesetzt', partner, '');
  return `gesetzt: ${partner} (${bundesland})`;
}


// ===== PRUEF- / DEBUG-FUNKTIONEN =====

/**
 * NEU: Gleicht Bundesland- UND Montagepartner-Option-IDs mit dem echten Pipedrive-Feld ab.
 * Einmal vor dem Vollauf laufen lassen -- faengt genau die Fehler aus FIX A und FIX B ab,
 * bevor sie im Vollauf als 500 unauffaellige Log-Zeilen untergehen.
 */
function pruefeKonfiguration() {
  const felder = fetchPipedrive('dealFields?limit=500');
  let fehler = 0;

  fehler += pruefeEnumFeld(felder, BUNDESLAND_FIELD_KEY, BUNDESLAND_OPTION_IDS, 'Bundesland');
  fehler += pruefeEnumFeld(felder, MONTAGEPARTNER_FIELD_KEY, MONTAGEPARTNER_OPTION_IDS, 'Montagepartner');

  // Zusaetzlich: zeigt jede Zuordnung ihren Ziel-Partner auch wirklich auf eine bekannte Option?
  Object.keys(BUNDESLAND_TO_MONTAGEPARTNER).forEach(bl => {
    const partner = BUNDESLAND_TO_MONTAGEPARTNER[bl];
    if (MONTAGEPARTNER_OPTION_IDS[partner] === undefined) {
      Logger.log(`FEHLER: Zuordnung "${bl}" -> "${partner}", aber dieses Label steht nicht in MONTAGEPARTNER_OPTION_IDS.`);
      fehler++;
    }
  });

  Logger.log(fehler === 0 ? 'Konfiguration OK.' : `${fehler} Abweichung(en) -- oben korrigieren, BEVOR DRY_RUN=false gesetzt wird.`);
}

/** Hilfsfunktion fuer pruefeKonfiguration(): vergleicht ein Enum-Feld mit den Script-Konstanten. */
function pruefeEnumFeld(felder, fieldKey, sollMap, bezeichnung) {
  const feld = felder.filter(f => f.field_code === fieldKey)[0];
  if (!feld) {
    Logger.log(`FEHLER: Deal-Feld "${bezeichnung}" (${fieldKey}) existiert nicht (mehr).`);
    return 1;
  }
  Logger.log(`${bezeichnung}: Feld "${feld.field_name}" (Typ ${feld.field_type})`);
  let fehler = 0;
  if (feld.field_type !== 'enum') {
    Logger.log(`WARNUNG: "${bezeichnung}" ist Typ "${feld.field_type}", erwartet wurde Einfachauswahl (enum). Das Script liest/schreibt eine einzelne Option-ID.`);
    fehler++;
  }
  const live = {};
  (feld.options || []).forEach(o => { live[o.label] = o.id; });
  Object.keys(sollMap).forEach(label => {
    if (live[label] === undefined) { Logger.log(`FEHLER [${bezeichnung}]: Option "${label}" existiert in Pipedrive nicht.`); fehler++; }
    else if (live[label] !== sollMap[label]) { Logger.log(`FEHLER [${bezeichnung}]: "${label}" -- Script sagt ${sollMap[label]}, Pipedrive sagt ${live[label]}.`); fehler++; }
  });
  Object.keys(live).forEach(label => {
    if (sollMap[label] === undefined) Logger.log(`Hinweis [${bezeichnung}]: Pipedrive kennt zusaetzlich "${label}" (id ${live[label]}), im Script nicht hinterlegt.`);
  });
  return fehler;
}


// ===== HILFSFUNKTIONEN =====

/** Holt den API-Token aus Script Properties, wirft klaren Fehler wenn er fehlt. */
function getApiToken() {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN fehlt in den Script Properties (Projekteinstellungen pruefen).');
  return token;
}

/** LIEST: Pipedrive-GET mit Token im Header, Statuspruefung + Retry bei 429/5xx. */
function fetchPipedrive(path) {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`;
  return callPipedriveWithRetry(() => UrlFetchApp.fetch(url, {
    headers: { 'x-api-token': getApiToken() },
    muteHttpExceptions: true
  }), path);
}

/** SCHREIBT: Pipedrive-PATCH mit Token im Header, Statuspruefung + Retry bei 429/5xx. */
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
      Utilities.sleep(1000 * Math.pow(2, attempt)); // FIX H: 2s, dann 4s (der 3. Fehlschlag wirft)
      continue;
    }
    throw new Error(`Pipedrive API-Fehler ${code} bei "${path}": ${response.getContentText()}`);
  }
}

/** Wie callPipedriveWithRetry, aber gibt die volle Response (inkl. additional_data) zurueck, nicht nur .data. */
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


// ===== LOGGING (FIX D: gecached + gebuendelt) =====

const LOG_HEADER = [
  'Zeitstempel', 'Deal-ID', 'Deal-Titel', 'Bundesland', 'Ergebnis',
  'Montagepartner', 'Partner-Kandidaten für dieses Bundesland', 'Detail'
];

let _logSheet = null;
let _logBuffer = [];

/** Self-bootstrapping Log-Sheet, analog zum Bundesland-aus-PLZ-Script. */
function getLogSheet() {
  if (_logSheet) return _logSheet;
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty(PROP_LOG_SHEET_ID);
  let ss = null;
  if (sheetId) {
    try { ss = SpreadsheetApp.openById(sheetId); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('LOG_Montagepartner aus Bundesland');
    props.setProperty(PROP_LOG_SHEET_ID, ss.getId());
    ss.getActiveSheet().appendRow(LOG_HEADER);
    Logger.log(`Neues Log-Sheet angelegt: ${ss.getUrl()}`);
  }
  _logSheet = ss.getActiveSheet();
  return _logSheet;
}

/**
 * Puffert eine Log-Zeile. In "Partner-Kandidaten" stehen IMMER alle laut
 * BUNDESLAND_PARTNER_KANDIDATEN infrage kommenden Partner (auch bei eindeutigen Faellen),
 * damit man bei uebersprungenen Zeilen direkt im Sheet sieht WARUM keine Wahl moeglich war.
 * Geschrieben wird erst in flushLog().
 */
function logRow(dealId, dealTitle, bundesland, ergebnis, partner, detail) {
  const kandidaten = bundesland ? (BUNDESLAND_PARTNER_KANDIDATEN[bundesland] || []) : [];
  _logBuffer.push([
    new Date(), dealId, dealTitle || '', bundesland || '', ergebnis,
    partner || '', kandidaten.join(' / '), detail || ''
  ]);
}

/** Schreibt alle gepufferten Zeilen in einem einzigen Range-Write ins Sheet. */
function flushLog() {
  if (_logBuffer.length === 0) return;
  const sheet = getLogSheet();
  sheet.getRange(sheet.getLastRow() + 1, 1, _logBuffer.length, LOG_HEADER.length).setValues(_logBuffer);
  SpreadsheetApp.flush();
  Logger.log(`${_logBuffer.length} Log-Zeilen geschrieben: ${sheet.getParent().getUrl()}`);
  _logBuffer = [];
}
