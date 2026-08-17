// ==========================================================================================
// PROJEKT: "Fortschritt-Script"
// DATEI IM EDITOR: Config.gs
//
// Befuellt zwei Pipedrive-Deal-Felder automatisch:
//   Erledigt    (set / Mehrfachauswahl) -- die tatsaechlich erreichten Meilensteine
//   Fortschritt (Text)                  -- eine lesbare Kartenzeile fuer die Listenansicht
//
// Gebaut nach PLAN-Fortschritt-Script.md (2026-08-13). Alle TODO_-Werte unten muss Valentin
// nachtragen -- pruefeKonfiguration() bricht ab, solange welche offen sind.
// ==========================================================================================


// ===== SCHALTER =====

// Wenn true: nichts wird geschrieben, nur berechnet und geloggt.
const DRY_RUN = true;

// Schreibt zusaetzlich eine Zusammenfassungszeile ins zentrale Automations-Dashboard.
// Bleibt false, bis das Dashboard-Sheet existiert -- das Script laeuft ohne Dashboard.
const DASHBOARD_ENABLED = false;
const DASHBOARD_SHEET_ID = 'TODO_DASHBOARD_SHEET_ID';
const DASHBOARD_TAB_NAME = 'Log';

// Name, unter dem dieses Script im Dashboard auftaucht.
const SCRIPT_NAME = 'Fortschritt-Script';

// Freiwilliger Abbruch vor dem harten Apps-Script-Limit (6 Min Consumer / 30 Min Workspace).
// Greift im 15-Min-Dauerbetrieb ueber ~440 gewonnene Deals nicht, existiert fuer den
// einmaligen Vollauf und fuer den Fall, dass der Bestand deutlich waechst.
const MAX_LAUFZEIT_MS = 4.5 * 60 * 1000;

// Notbremse gegen einen ausufernden Aktivitaeten-Vorabzug (siehe ladeAktivitaetenIndex()).
const MAX_AKTIVITAETEN_SEITEN = 200;


// ===== PIPEDRIVE =====

const PIPEDRIVE_DOMAIN = 'rp-energietechnik';

// --- Zielfelder (werden geschrieben) ---------------------------------------------------
// AUSSCHLIESSLICH script-beschrieben. Niemand setzt sie manuell, sie sind nie Pflichtfeld.
const ERLEDIGT_FIELD_KEY = '8f3f8e44c657ad9fdd2e171f2d5ed6ac8c565ac7';    // Typ: set
const FORTSCHRITT_FIELD_KEY = 'fa77cb3c2a12790f5de5879ccb7b076b5c98ab44'; // Typ: varchar (siehe unten)

// --- Quellfelder (werden nur gelesen) --------------------------------------------------
const NETZSTATUS_FIELD_KEY = 'df60049565c7aecc52febb2ef5ecb911a761c2c6';
const ZPN_FIELD_KEY = '86f6ce58bb7129c5c4e312038342f601713c7742';          // Einspeisezählpunkt
const AR_VERSENDET_FIELD_KEY = 'd54cfede7b837b9f1f135a24f14e6c1c5fe7d85a';
const ZAHLUNGSEINGANG_FIELD_KEY = 'ddbfed2a1cdc25c2be460b9a825e056cca2d0284';
const LIEFERTERMIN_FIELD_KEY = 'c0a676d8db66f0cb6300e8160e1401355a226990';
const AC_TERMIN_FIELD_KEY = '0277ea7463b980044e0062e46467979ccc292127';
const IB_TERMIN_FIELD_KEY = 'ba820255728739b29c451287808fbe18f1c94b8e';
const FOERDERZUSAGE_FIELD_KEY = '574d9469760b0e993af058654a7c827a81150cb4';
const FOERDERSTATUS_FIELD_KEY = 'fe61797bd9d9e4990a2f5735b8c4de1919c7fa11';
const FERTIGMELDUNG_AM_FIELD_KEY = '69dd6586f2a762a912b9131dee404acf711fc1a5';
const WARTET_AUF_FIELD_KEY = 'b7342c374d4e7d76f9ec3772d95efd5944c97e29';

// Nur fuer die Auswertung im DRY-Vollauf (Testplan Schritt 4): "Montiert" haengt am AC-Termin,
// den es bei Selbstmontage evtl. gar nicht gibt -- die Verteilung wird deshalb zusaetzlich nach
// Ausfuehrungsart aufgeschluesselt. Ohne diesen Feldcode laeuft alles normal, die Aufschluesselung
// entfaellt dann nur. Code mit listDealFieldsHelper() ermitteln.
const AUSFUEHRUNGSART_FIELD_KEY = 'TODO_AUSFUEHRUNGSART_FIELD_KEY';


// ===== OPTION-IDs =====
// Alle hier hartcodierten IDs werden von pruefeKonfiguration() gegen die echte API abgeglichen.

// Zielfeld "Erledigt" -- die 11 Meilensteine in der fachlichen Reihenfolge (siehe Regeln.gs).
const ERLEDIGT_OPTION_IDS = {
  Erstgespraech: 223,
  NetzUebergeben: 224,
  ZaehlpunktDa: 225,
  ArRaus: 226,
  AnzahlungDa: 227,
  Geliefert: 228,
  Zweitgespraech: 229,
  Montiert: 230,
  IbErfolgt: 231,
  Foerderzusage: 232,
  Fertigmeldung: 233
};

// Quellfeld "Netzstatus"
const NETZSTATUS_UEBERGEBEN = 183;
const NETZSTATUS_EINGEREICHT = 184;
const NETZSTATUS_ZAEHLPUNKT_DA = 185;
const NETZSTATUS_FERTIGMELDUNG_RAUS = 186;

// Quellfeld "Förderstatus"
const FOERDERSTATUS_ZUGESAGT = 191;
const FOERDERSTATUS_ABGERECHNET = 193;

// Ja-Optionen der drei Haken-Felder (Einfachauswahl mit einer "Ja"-Option, kein echter Boolean).
const AR_VERSENDET_JA = 206;
const ZAHLUNGSEINGANG_JA = 207;
const FOERDERZUSAGE_JA = 209;

// Quellfeld "Wartet auf": die Kuerzel-Zuordnung steht in Regeln.gs (WARTET_AUF_KURZ),
// weil sie zur Textbildung gehoert und nicht zur Verdrahtung.


// ===== STAGES =====
// Sonderzustaende, die den Fortschritt-Balken komplett ersetzen, damit tote Deals in der
// Listenansicht sofort auffallen.
//
// TODO: beide IDs mit listStagesHelper() ermitteln und hier eintragen. pruefeKonfiguration()
// gleicht sie danach gegen GET /api/v2/stages ab und BRICHT AB, solange hier TODO_ steht.
const STAGE_ID_STORNIERT = 'TODO_STAGE_ID_STORNIERT';
const STAGE_ID_VERSCHOBEN = 'TODO_STAGE_ID_VERSCHOBEN';


// ===== LEERER "set"-WERT -- BEWUSST OFFEN, NICHT GERATEN =====
//
// Wenn an einem Deal keine einzige Regel greift, muss "Erledigt" geleert werden (Spiegel-Modus).
// Womit -- mit [] oder mit null -- ist aus der Pipedrive-v2-Doku NICHT eindeutig zu beantworten:
// die Doku beschreibt fuer Mehrfachauswahl-Felder nur das Schreiben ("new value is an array of
// ids, e.g. [3, 7]") und sagt zum Leeren gar nichts. Im Netz kursiert die Aussage, [] werfe einen
// Validierungsfehler und man muesse null nehmen -- das steht so aber in keiner Primaerquelle und
// wird hier deshalb NICHT als Tatsache uebernommen.
//
// Deshalb: einmal empirisch klaeren statt raten. testLeerenSetWert() in SetupHelpers.gs probiert
// beide Varianten an einem echten Deal durch und schreibt ins Log, welche funktioniert. Ergebnis
// hier eintragen. Bis dahin steht null, weil das die Variante ist, die Sheet-Sync fuer leere
// Werte bereits erfolgreich verwendet.
const LEERWERT_FUER_SET = null; // erlaubt: null oder []


// ===== TEST-DEALS =====
// Konstanten statt Funktionsparameter: der Play-Button im Editor ruft jede Funktion ohne
// Argumente auf -- ein Parameter waere dort immer undefined.
const TEST_DEAL_ID = 7253;
const TEST_DEAL_IDS_RANDFAELLE = [7253, 7255, 7266]; // Testplan Schritt 3+7: hier eigene IDs eintragen
const TEST_DEAL_ID_LEERER_SET = 7253;                // fuer testLeerenSetWert()


// ===== SCRIPT-PROPERTY-SCHLUESSEL =====
const PROP_RESUME_CURSOR = 'FORTSCHRITT_RESUME_CURSOR';
const PROP_LOG_SHEET_ID = 'FORTSCHRITT_LOG_SHEET_ID';


// ===== PIPEDRIVE-HILFSFUNKTIONEN =====

/** Holt den API-Token aus den Script Properties, wirft klaren Fehler wenn er fehlt. */
function getApiToken() {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN fehlt in den Script Properties (Projekteinstellungen pruefen).');
  return token;
}

/** LIEST: gibt nur .data zurueck. Auth ueber Header x-api-token (nicht ?api_token=, das ist v1). */
function fetchPipedrive(path) {
  return callPipedriveWithRetry(() => UrlFetchApp.fetch(`https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`, {
    headers: { 'x-api-token': getApiToken() },
    muteHttpExceptions: true
  }), path).data;
}

/** LIEST: gibt die volle Response zurueck, inklusive additional_data.next_cursor fuer Pagination. */
function fetchPipedriveRaw(path) {
  return callPipedriveWithRetry(() => UrlFetchApp.fetch(`https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`, {
    headers: { 'x-api-token': getApiToken() },
    muteHttpExceptions: true
  }), path);
}

/** SCHREIBT. */
function patchPipedrive(path, payload) {
  return callPipedriveWithRetry(() => UrlFetchApp.fetch(`https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`, {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { 'x-api-token': getApiToken() },
    muteHttpExceptions: true
  }), path).data;
}

/**
 * Retry-Wrapper: bei 429/5xx bis zu 3 Versuche mit steigender Wartezeit (2s, dann 4s), bei 4xx
 * sofort abbrechen -- ein 4xx wird durchs Warten nicht besser.
 */
function callPipedriveWithRetry(doFetch, path) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = doFetch();
    const code = response.getResponseCode();
    if (code === 200) return JSON.parse(response.getContentText());
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
