// ===== KONFIGURATION =====
// TODO-Marker unten sind Werte, die nur Valentin im Pipedrive-Admin nachschauen/anlegen kann.
// Ohne die TODOs ausgefüllt zu haben läuft das Script nicht (wirft beim Start einen klaren Fehler).

const PIPEDRIVE_DOMAIN = 'rp-energietechnik';

/** Dreht ein {Label: OptionsID}-Objekt um, Keys immer als String (Pipedrive liefert IDs mal als Zahl, mal als String). */
function invertOptionMap(map) {
  return Object.fromEntries(Object.entries(map).map(([name, id]) => [String(id), name]));
}

// ===== Wiederverwendete Felder aus Ordnererstellung-bei-Gewonnen =====
// Dasselbe Deal-Feld, das dort den fertig angelegten Kundenordner-Link zurückschreibt. Wird hier
// NUR gelesen, nie geschrieben -- dieses Script legt keine Kundenordner an, es erwartet, dass
// Ordnererstellung-bei-Gewonnen für den Deal schon gelaufen ist.
const KUNDENORDNER_LINK_FIELD_KEY = '5c442fe317da26ed4f60504e2b912df7e3116c5b';

// Name des Unterordners, in den das Doc rein soll -- muss exakt zu KUNDEN_UNTERORDNER_NAMEN in
// Ordnererstellung-bei-Gewonnen/Config.gs passen. Wird dort angelegt, hier nur erwartet (fehlt er,
// ist das ein Setup-Fehler/falsche Reihenfolge, kein Normalfall -- siehe processDeal).
const PROJEKTDOKU_UNTERORDNER_NAME = '2_Projektdokumentation';

// Montagepartner-Feld + Options-IDs, 1:1 aus Montagepartner-aus-Bundesland übernommen (gleiche
// Pipedrive-Optionen). Wird hier nur gelesen, für die optionale Sektion 8 im Doc.
const MONTAGEPARTNER_FIELD_KEY = '0190fd945adc86148657d2db36261ae9545e7bda';
const MONTAGEPARTNER_OPTION_IDS = {
  'ALE-Engineering (NÖ, Wien, BGL)': 157,
  'Berger Elektrotechnik (KTN)': 158,
  'Greensky (OÖ, SBG)': 159,
  'KOLLSTAR (OÖ)': 160,
  'Kreuzeder (OÖ, SBG)': 161,
  'Tiroler Partner (T)': 243,
  'Vorarlberg Partner (V)': 244
};
const MONTAGEPARTNER_ID_TO_NAME = invertOptionMap(MONTAGEPARTNER_OPTION_IDS);

// Person-Custom-Fields, aus Pipedrive-form-prefill-mail-trigger übernommen.
const ADRESSE_FIELD_KEY = '432e4e165de7e9f474643c3d3a5552e2ec976f55';
const PLZ_FIELD_KEY = '5fef394025c936df4b58763b2b58c340fbb0d251';

// ===== Trigger-/Status-Feld =====
// Bestehendes Feld "Projektdokumentation-Partner" wird zweckentfremdet: löst den täglichen Lauf
// aus UND dient als Idempotenz-Marker (kein Script-Property-State nötig -- siehe
// reference_apps_script_limits, 9-KB-Falle). Optionen werden gerade in Pipedrive neu angelegt
// ("Projektdoku rdy for creation" = Trigger, "Projektdoku erstellt und abgelegt" = fertig).
// Options-IDs bestätigt am 17.08.2026: die bestehenden Optionen wurden im Pipedrive-UI nur
// umbenannt, dabei behält Pipedrive die IDs. Vor jedem Massenlauf trotzdem checkConfiguration()
// laufen lassen -- die prüft beide IDs gegen die echten dealFields.
const DOKU_STATUS_FIELD_KEY = 'd33a358f840e5e1ccade4e1f88cd9109ae3e63f4'; // Feld "Projektdokumentation-Partner"
const DOKU_STATUS_OPTION_TRIGGER = 235; // "Projektdoku rdy for creation" -- Pipedrive will hier eine Zahl, kein String, bei single-option-Feldern
const DOKU_STATUS_OPTION_DONE = 234; // "Projektdoku erstellt und abgelegt"

// TODO: neue Option "Projektdoku neu erstellen" am Feld "Projektdokumentation-Partner" in
// Pipedrive anlegen (gleiches Enum wie DOKU_STATUS_OPTION_TRIGGER/_DONE), dann die ID hier eintragen.
// Eigener Options-Wert statt Wiederverwendung von DOKU_STATUS_OPTION_TRIGGER, damit ein Deal, der
// aus Versehen wieder auf "rdy for creation" steht (z.B. Tippfehler), NICHT das bestehende Doc
// löscht -- Regenerieren ist ein bewusster Akt, kein Nebeneffekt des normalen Trigger-Werts.
const DOKU_STATUS_OPTION_NEU_ERSTELLEN = 245; // "Projekdoku NEU -> Korrektur und überschreiben"

// Text-Feld am Deal für den Doc-Link -- analog KUNDENORDNER_LINK_FIELD_KEY.
const DOKU_LINK_FIELD_KEY = 'e08d635f1391e5735802dc066e61fac836c5a0d0'; // Feld "Projektdokumentation Link"

// ===== Netzstatus (geteiltes Feld mit Fortschritt-Script/Sheet-Sync) =====
// Fortschritts-Enum dort: offen(182) -> übergeben(183) -> eingereicht(184) -> Zählpunkt da(185) ->
// Fertigmeldung raus(186). Dieses Script schreibt NUR die eine Flanke offen/leer -> übergeben,
// sobald die Projektdoku mit Modul-Daten (Anlagendetails) UND Adresse fertig ist -- das ist der
// reale Übergabe-Zeitpunkt an den Montagepartner, den Sheet-Sync/NetzanmeldungEskalation.gs als
// Fristbeginn erwartet. Nie rückwärts: ein Deal, der schon weiter ist, darf durch ein späteres
// forceRegenerate nicht auf "übergeben" zurückfallen, siehe hebeNetzstatusAufUebergebenFallsNoetig().
const NETZSTATUS_FIELD_KEY = 'df60049565c7aecc52febb2ef5ecb911a761c2c6';
const NETZSTATUS_OFFEN = 182;
const NETZSTATUS_UEBERGEBEN = 183;

// Freitextfeld für interne Fulfillment-Notizen (z.B. "Heizstab mit Kunde abklären") -- bewusst
// GETRENNT von "Sonstige Mitteilung Kunde" (das ist, was der Kunde gesagt hat, nicht interne Hinweise).
const NOTIZEN_INTERN_FIELD_KEY = '2565f8005e57f0b6bad0a36560f9f3213beffe98'; // Feld "Projektdoku-Notizen"

// ===== Inhaltsfelder fürs Doc (Phase 1) -- aus listDealFieldsHelper()-Dump vom 17.08. übernommen =====
const NETZANSUCHEN_FIELD_KEY = 'a05dd4431ed0963d2f286db8ee2de46612024a3e'; // "Netzansuchen eigenständig gestellt", enum
const NETZANSUCHEN_OPTION_IDS = { 'Ja': 210, 'Nein': 211 };
const NETZANSUCHEN_ID_TO_NAME = invertOptionMap(NETZANSUCHEN_OPTION_IDS);

const DACHFORM_FIELD_KEY = '71ee37fc98c338877d435f4d77f409367c013451'; // enum
const DACHFORM_OPTION_IDS = { 'Satteldach': 88, 'Walmdach': 89, 'Pultdach': 90, 'Flachdach': 91 };
const DACHFORM_ID_TO_NAME = invertOptionMap(DACHFORM_OPTION_IDS);

const EINDECKUNG_FIELD_KEY = '2e8cc4c7d0592a418a58394a470e3386d125654a'; // enum
const EINDECKUNG_OPTION_IDS = {
  'Ziegeldach': 92, 'Blechdach Trapez': 93, 'Blechdach Falz': 94, 'Welleternit': 95,
  'Flachdach (Kies)': 96, 'Flachdach (Beton)': 97, 'Flachdach (begrünt)': 98
};
const EINDECKUNG_ID_TO_NAME = invertOptionMap(EINDECKUNG_OPTION_IDS);

const AUSRICHTUNG_FIELD_KEY = '7ba65cad11182422467e4923292422b601f6da80'; // set (Mehrfachauswahl!)
const AUSRICHTUNG_OPTION_IDS = { 'Nord': 142, 'Ost': 143, 'Süd': 144, 'West': 145 };
const AUSRICHTUNG_ID_TO_NAME = invertOptionMap(AUSRICHTUNG_OPTION_IDS);

// Kein einzelnes "Gewünschter Montagetermin"-Feld -- stattdessen 3 bereits terminierte Einzeldaten.
const DC_TERMIN_FIELD_KEY = '6e4dc4e9017957ddadebddac3dd622ca3afe8676'; // date
const AC_TERMIN_FIELD_KEY = '0277ea7463b980044e0062e46467979ccc292127'; // date
const IB_TERMIN_FIELD_KEY = 'ba820255728739b29c451287808fbe18f1c94b8e'; // date, Inbetriebnahme

const DC_KABELWEG_FIELD_KEY = 'b5d425d088a42afdaa8ba6817acffa28b4156ae1'; // double, Meter
const AC_KABELWEG_FIELD_KEY = 'd429d11f249a664a3fa6c270620c0f4c2c4bbc49'; // double, Meter
const ORT_VERTEILER_FIELD_KEY = '9002ca97ad5f8d88ee8e3aa55d9d3b73a42d7791'; // varchar_auto

// Phase 1: bereits vom sevdesk-Sync befüllter Freitext-Summary, siehe project_pv_doku_generator.
const ANLAGENDETAILS_FIELD_KEY = 'a38455087829e67f22cb5217a44c3cf31f39bcbc'; // "Verkaufte_Artikel_Summary"

const LIEFERTERMIN_FIELD_KEY = 'c0a676d8db66f0cb6300e8160e1401355a226990'; // "Material-Liefertermin", date
const NOTIZEN_KUNDE_FIELD_KEY = '0aff5c6f5bd4d7990c171cbe62a670bfabd5c0fd'; // "Sonstige Mitteilung Kunde"

// Alle Inhaltsfelder, die im Doc landen -- für den Vollständigkeits-Check im Log (siehe
// checkFieldCompleteness). Reihenfolge/Label muss NICHT zur Doc-Reihenfolge passen, nur zur
// Lesbarkeit im Log-Sheet.
const CONTENT_FIELDS = [
  { key: NETZANSUCHEN_FIELD_KEY, label: 'Netzansuchen' },
  { key: DACHFORM_FIELD_KEY, label: 'Dachform' },
  { key: EINDECKUNG_FIELD_KEY, label: 'Eindeckung' },
  { key: AUSRICHTUNG_FIELD_KEY, label: 'Ausrichtung' },
  { key: DC_KABELWEG_FIELD_KEY, label: 'DC-Kabelweg' },
  { key: AC_KABELWEG_FIELD_KEY, label: 'AC-Kabelweg' },
  { key: ORT_VERTEILER_FIELD_KEY, label: 'Verteilerkasten Standort' },
  { key: DC_TERMIN_FIELD_KEY, label: 'DC-Montagetermin' },
  { key: AC_TERMIN_FIELD_KEY, label: 'AC-Montagetermin' },
  { key: IB_TERMIN_FIELD_KEY, label: 'Inbetriebnahme-Termin' },
  { key: ANLAGENDETAILS_FIELD_KEY, label: 'Anlagendetails' },
  { key: LIEFERTERMIN_FIELD_KEY, label: 'Material-Liefertermin' },
  // Freitextfelder, die im Normalfall leer sind -- zählen NICHT in "Befüllt"/"Leere Felder" mit,
  // sonst zeigt die Log-Spalte dauerhaft dieselben zwei harmlosen Einträge und verliert ihren
  // Signalwert (genau die Spalte, die man beim Durchsehen des Log-Sheets zuerst anschaut).
  { key: NOTIZEN_INTERN_FIELD_KEY, label: 'Interne Notizen', optional: true },
  { key: NOTIZEN_KUNDE_FIELD_KEY, label: 'Sonstige Mitteilung Kunde', optional: true }
];

/** Zählt befüllte/leere PFLICHT-Inhaltsfelder eines Deals -- Grundlage für die Log-Spalten "Befüllt" und "Leere Felder". */
function checkFieldCompleteness(cf) {
  const istLeer = f => {
    const v = cf[f.key];
    return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
  };
  const pflicht = CONTENT_FIELDS.filter(f => !f.optional);
  const leereFelder = pflicht.filter(istLeer).map(f => f.label);
  return { befuellt: pflicht.length - leereFelder.length, gesamt: pflicht.length, leereFelder };
}

// Wenn true: nichts wird in Drive/Pipedrive geschrieben, nur geloggt was passieren würde
const DRY_RUN = false;

// Freiwilliger Abbruch vor dem 6-Minuten-Laufzeitlimit (Consumer-Konto). Da der Status pro Deal
// sofort nach dem Doc-Bau geschrieben wird, ist ein Abbruch fachlich unkritisch -- der nächste
// Lauf macht bei den übrigen Deals weiter.
const MAX_LAUFZEIT_MS = 4.5 * 60 * 1000;

// ===== HILFSFUNKTIONEN (1:1 Pattern aus Ordnererstellung-bei-Gewonnen/Sheet-Sync) =====

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

/** Wie fetchPipedrive, gibt aber die volle Antwort zurück (inkl. additional_data für Pagination). */
function fetchPipedriveRaw(path) {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`;
  return callPipedriveWithRetry(() => UrlFetchApp.fetch(url, {
    headers: { 'x-api-token': getApiToken() },
    muteHttpExceptions: true
  }), path, true);
}

/**
 * SCHREIBT: Pipedrive-PATCH mit Token im Header, Statusprüfung + Retry bei 429/5xx.
 * Gotcha aus Sheet-Sync: manche Auswahlfelder sind trotz Options-Liste field_type "autocomplete"
 * und wollen den Text-Label als String, andere sind echte "single option"-Felder und wollen die
 * numerische ID. Vor dem ersten Schreiben mit checkConfiguration() bzw. live gegen dealFields
 * prüfen, nicht aus der Feldstruktur raten.
 */
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

/**
 * Wie patchPipedrive, prüft aber an der API-Antwort nach, dass die Werte wirklich angekommen sind.
 * Pipedrive antwortet auch dann mit 200, wenn ein Feld den Wert im falschen Typ bekommt (z.B.
 * Options-ID statt Label bei einem autocomplete-Feld) und ihn stillschweigend verwirft -- die
 * "stille Nicht-Schreibung" aus den CLAUDE.md-Learnings. Ohne diese Verifikation sieht ein Lauf,
 * der nichts geschrieben hat, im Log wie ein Erfolg aus.
 */
function patchCustomFieldsVerified(dealId, customFields) {
  const data = patchPipedrive(`deals/${dealId}`, { custom_fields: customFields });
  const zurueck = (data && data.custom_fields) || {};
  const nichtAngekommen = Object.keys(customFields).filter(
    key => String(zurueck[key]) !== String(customFields[key])
  );
  if (nichtAngekommen.length > 0) {
    throw new Error(
      `Pipedrive hat ${nichtAngekommen.length} Feld(er) nicht übernommen (200, aber Wert nicht gesetzt): ` +
      nichtAngekommen.map(k => `${k} (gesendet: ${customFields[k]}, zurück: ${zurueck[k]})`).join('; ')
    );
  }
  return data;
}

/**
 * Retry-Wrapper: bei 429/5xx bis zu 3x mit steigender Wartezeit, bei 4xx sofort abbrechen.
 * rohAntwort=true gibt die komplette JSON-Antwort zurück (z.B. additional_data für Pagination)
 * statt nur .data -- einzige Retry-Logik im ganzen Projekt, keine zweite Kopie mehr (siehe
 * fetchPipedriveRaw).
 */
function callPipedriveWithRetry(doFetch, path, rohAntwort) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = doFetch();
    const code = response.getResponseCode();
    if (code === 200) {
      const json = JSON.parse(response.getContentText());
      return rohAntwort ? json : json.data;
    }
    if (code === 429 || code >= 500) {
      if (attempt === maxAttempts) {
        throw new Error(`Pipedrive API-Fehler ${code} bei "${path}" nach ${maxAttempts} Versuchen: ${response.getContentText()}`);
      }
      Utilities.sleep(1000 * Math.pow(2, attempt)); // 2s, dann 4s -- nach dem 3. Versuch wird geworfen
      continue;
    }
    throw new Error(`Pipedrive API-Fehler ${code} bei "${path}": ${response.getContentText()}`);
  }
}

// ===== LOGGING =====
// Gepuffert statt appendRow pro Zeile, mit Lauf-ID -- gleiches Muster wie in
// Ordnererstellung-bei-Gewonnen/Sheet-Sync. Schema kompatibel zum geplanten zentralen
// Automations-Dashboard (project_automations_dashboard) -- späterer Umzug ist nur ein ID-Wechsel.

const LOG_HEADER = ['Zeitstempel', 'Lauf-ID', 'Modus', 'Deal-ID', 'Deal-Titel', 'Kunde', 'Status', 'Doc-Link', 'Befüllt', 'Leere Felder', 'Detail'];
const PROP_LOG_SHEET_ID = 'PROJEKTDOKU_LOG_SHEET_ID';

let _logSheetCache = null;
let _logBuffer = [];
let _laufId = '-';
let _laufStart = 0;

/** Am Anfang jedes Einstiegspunkts aufrufen (generateDailyProjectDocumentation, testEinzelDeal). */
function starteLauf(funktionsName) {
  _laufId = Utilities.getUuid().slice(0, 8);
  _laufStart = Date.now();
  Logger.log(`[${_laufId}] ${funktionsName} gestartet (${DRY_RUN ? 'DRY' : 'LIVE'})`);
  return _laufId;
}

/**
 * Self-bootstrapping Log-Sheet, analog zu den anderen RP-Scripts.
 * Wichtig: ein gespeicherter, aber gerade nicht öffenbarer Sheet-Link führt NICHT dazu, dass ein
 * zweites Sheet angelegt wird. Vorher fiel ein transienter Drive-/Quota-Fehler in denselben
 * Zweig wie "noch kein Sheet vorhanden" -- das überschrieb die Property mit einer neuen ID und die
 * gesamte bisherige Log-Historie war verwaist, ohne dass es irgendwo aufgefallen wäre.
 */
function getLogSheet() {
  if (_logSheetCache) return _logSheetCache;
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty(PROP_LOG_SHEET_ID);
  let ss;
  if (sheetId) {
    try {
      ss = SpreadsheetApp.openById(sheetId);
    } catch (e) {
      throw new Error(
        `Log-Sheet ${sheetId} nicht öffenbar (${e.message}). Wenn es wirklich gelöscht wurde: ` +
        `Script-Property "${PROP_LOG_SHEET_ID}" löschen, dann legt der nächste Lauf ein neues an.`
      );
    }
  } else {
    ss = SpreadsheetApp.create('LOG_Projektdoku-Generator');
    props.setProperty(PROP_LOG_SHEET_ID, ss.getId());
    ss.getActiveSheet().appendRow(LOG_HEADER);
    Logger.log(`Neues Log-Sheet angelegt: ${ss.getUrl()}`);
  }
  _logSheetCache = ss.getActiveSheet();
  return _logSheetCache;
}

// Status-Werte, kompatibel zum Dashboard-Schema: OK / SOFT_ERROR (fachlicher Grenzfall, bewusst
// übersprungen) / HARD_ERROR (technisches Versagen). completeness kommt aus checkFieldCompleteness(),
// ist null bei Läufen, die vor dem Feld-Check abbrechen (z.B. kein Kundenordner).
function logRow(dealId, dealTitle, kunde, status, docLink, completeness, detail) {
  _logBuffer.push([
    new Date(), _laufId, DRY_RUN ? 'DRY' : 'LIVE',
    dealId || '', dealTitle || '', kunde || '', status, docLink || '',
    completeness ? `${completeness.befuellt}/${completeness.gesamt}` : '',
    completeness ? completeness.leereFelder.join(', ') : '',
    detail || ''
  ]);
}

/**
 * Ein Puffer-Write am Ende statt appendRow pro Zeile.
 * Der try/catch ist kein Verstecken: flushLog() läuft im finally des Laufs, also auch auf dem
 * Fehlerpfad. Würde es dort selbst werfen (Sheet weg, Quota), ersetzte dieser Fehler die
 * eigentliche Ursache im Stacktrace -- man sähe "Log-Sheet nicht öffenbar" statt des echten
 * Problems. Deshalb: Zeilen in den Stackdriver-Log retten und den Originalfehler durchlassen.
 */
function flushLog() {
  if (_logBuffer.length === 0) return;
  try {
    const sheet = getLogSheet();
    sheet.getRange(sheet.getLastRow() + 1, 1, _logBuffer.length, LOG_HEADER.length).setValues(_logBuffer);
  } catch (e) {
    Logger.log(`flushLog fehlgeschlagen (${e.message}). Ungeschriebene Zeilen:\n` +
               _logBuffer.map(r => r.join(' | ')).join('\n'));
  }
  _logBuffer = [];
}

/** Werte für Log/Doc lesbar machen -- niemals "null"/"undefined" ausgeben. */
function zeigeWert(w) {
  if (w === null || w === undefined || w === '') return '(leer)';
  if (w instanceof Date) return Utilities.formatDate(w, Session.getScriptTimeZone(), 'dd.MM.yyyy');
  return String(w);
}

/**
 * enum-Feld über Options-ID lesen, NICHT über Label -- siehe CLAUDE.md-Learning "enum-Felder
 * werden über numerische Option-IDs gelesen und geschrieben". Ohne diese Auflösung würde im Doc
 * die rohe ID stehen (z.B. "88" statt "Satteldach").
 */
function resolveEnumLabel(value, idToName) {
  if (value === null || value === undefined || value === '') return '(leer)';
  return idToName[String(value)] || String(value);
}

/** set-Feld (Mehrfachauswahl, z.B. Ausrichtung) -- Wert kommt als Array von Options-IDs. */
function resolveSetLabels(value, idToName) {
  if (!value || (Array.isArray(value) && value.length === 0)) return '(leer)';
  const arr = Array.isArray(value) ? value : String(value).split(',');
  return arr.map(id => idToName[String(id)] || String(id)).join('/');
}

/**
 * Pipedrive-Datumsfelder liefern "YYYY-MM-DD" (teils mit Zeitanteil) als String, kein Date-Objekt.
 * Wird bewusst per String umsortiert statt über new Date(): "2026-08-21" parst V8 als UTC-Mitternacht,
 * formatiert wird danach in der Script-Zeitzone. Für Europe/Vienna (UTC+1/+2) geht das gut aus, bei
 * einer Zone westlich von UTC stünde jeder Montagetermin einen Tag zu früh im Doc -- ein falsches
 * Montagedatum in der Partner-Doku ist teuer, und der Fehler wäre am Code nicht zu sehen.
 */
function formatPipedriveDate(value) {
  if (!value) return '(leer)';
  const datePart = String(value).trim().split(/[ T]/)[0];
  const m = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return zeigeWert(value); // unerwartetes Format -- Rohwert zeigen, nicht raten
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** double-Felder (Kabelweg in Metern) mit Einheit anzeigen, z.B. "7m" wie im Mockup. */
function formatMeterWert(value) {
  if (value === null || value === undefined || value === '') return '(leer)';
  return `${value}m`;
}
