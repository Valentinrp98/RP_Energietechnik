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

// Pipedrive-Feld "Dokumente erkannt" (Mehrfachauswahl/Set, 3 Optionen: Stromrechnung/Dachfoto/
// Zählerpunkt) -- gibt dem Team auf einen Blick, was schon erkannt wurde und was fehlt. Muss EINMAL
// manuell in Pipedrive angelegt werden (Einstellungen -> Datenfelder -> Deal -> Mehrfachauswahl),
// danach findeDokumenteFeldKonfiguration() in SetupHelpers.gs laufen lassen und die beiden Werte
// unten eintragen. Solange FIELD_KEY null ist, überspringt das Script die Rückschreibung
// ersatzlos (kein Fehler) -- die Kern-Klassifikation/Ablage läuft unabhängig davon.
const DOKUMENTE_ERKANNT_FIELD_KEY = null; // z.B. 'abc123...' -- aus findeDokumenteFeldKonfiguration()
const DOKUMENTE_ERKANNT_OPTION_IDS = {
  // stromrechnung: 123, dachfoto: 124, zaehlerpunkt: 125 -- aus findeDokumenteFeldKonfiguration()
};

// Claude-Modell für die Klassifikation. Vision-fähig, günstig genug für einen Piloten mit
// wenigen Dateien -- vor einem Rollout auf alle Deals nochmal gegen Preis/Genauigkeit prüfen.
// KORREKTUR 27.08.2026: hier stand, die datierte Schreibweise sei "bei aktuellen Claude-Modellen
// nicht die offizielle Model-ID". Das ist falsch und gefaehrlich als Merksatz -- fuer Haiku 4.5 sind
// BEIDE gueltig: 'claude-haiku-4-5' (mitwandernder Alias) und 'claude-haiku-4-5-20251001'
// (gepinnter Snapshot). Ohne Datums-Suffix sind nur die Modelle, die gar keine datierte Variante
// haben (Opus 5, Sonnet 5, Fable 5). Der Commit ebd. hat also funktional nichts reparieren muessen
// und dabei einen Pin gegen einen Alias getauscht.
// Zurueck auf den Pin: solange Genauigkeit UND Kosten pro Dokument hier kalibriert werden, darf das
// Modell nicht unter der Messung wegwandern. Vor einem Rollout bewusst neu entscheiden.
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_API_VERSION = '2023-06-01';

// Preis Claude Haiku 4.5 (Stand 2026-08-26, siehe platform.claude.com/docs -- vor einem
// Modellwechsel hier aktualisieren). USD/EUR ist ein fixer Näherungswert, keine Live-Kursabfrage --
// für den Piloten reicht eine Schätzung, für echte Kosten ist die Anthropic-Console-Abrechnung
// (in USD) die verbindliche Quelle.
const CLAUDE_PREIS_USD_PRO_1M_INPUT = 1.00;
const CLAUDE_PREIS_USD_PRO_1M_OUTPUT = 5.00;
const USD_ZU_EUR = 0.92;

// Wenn true: nichts wird in Drive geschrieben, nur klassifiziert und geloggt was passieren würde.
const DRY_RUN = true;

// Groessengrenze pro Datei, geprueft BEVOR heruntergeladen wird (v1-Metadaten liefern file_size).
// Verifiziert an der Vision-Doku (platform.claude.com/docs, Stand 16.09.2026): die direkte Claude
// API erlaubt 10 MB base64 pro Bild -- die verbreiteten "5 MB" gelten nur fuer Bedrock/Vertex.
// base64 blaeht 4/3 auf, also sind 7,5 MB Rohdatei die reale Grenze; mit Sicherheitsabstand 7 MB.
// Bewusst NICHT auf Claudes Auto-Downscaling verlassen: das greift bei zu grossen *Abmessungen*,
// die Byte-Grenze bleibt hart.
const MAX_DATEI_BYTES = 7 * 1024 * 1024;

// Apps Script bricht eine Ausfuehrung nach 6 Minuten hart ab -- mitten im Lauf, ohne finally.
// Bei einem harten Abbruch waere der gepufferte Log weg UND das Anthropic-Geld fuer die bereits
// klassifizierten Dateien trotzdem ausgegeben. Deshalb vor jeder neuen Datei pruefen und sauber
// aussteigen. 4,5 Min laesst Luft fuer eine laufende Klassifikation + flushLog().
const MAX_LAUFZEIT_MS = 4.5 * 60 * 1000;

// Obergrenze Anthropic-Calls pro Lauf -- Notbremse gegen einen Deal mit 300 Fotos. Bei Haiku 4.5
// und ~1500 Token/Seite sind 60 Calls grob 10 Cent; der Pilot soll nicht unbemerkt teurer werden.
const MAX_CLAUDE_CALLS_PRO_LAUF = 60;

// Obergrenze Input-Token pro Datei -- die zweite Kostenbremse neben MAX_DATEI_BYTES, und die
// wichtigere. Bytes sagen bei PDFs fast nichts ueber den Preis: laut Doku (platform.claude.com,
// geprueft 17.09.2026) kostet EINE PDF-Seite 1.500-3.000 Text-Token PLUS die Bild-Token derselben
// Seite, weil jede Seite zusaetzlich als Bild gerendert wird. Ein 1-MB-PDF mit 40 Seiten ist damit
// ein Vielfaches teurer als ein 6-MB-Foto. Bilder brauchen diese Bremse nicht: die deckelt Claude
// selbst durch Auto-Downscaling (Groessenordnung 1.600 Token pro Bild bei Haiku 4.5), PDFs nicht --
// dort skaliert der Preis linear mit der Seitenzahl.
// 30.000 Token sind rund 3 US-Cent Input und entsprechen grob 7-10 Seiten. Eine Stromrechnung liegt
// normal bei 2-6 Seiten; was drueber liegt, ist selten das, wonach wir suchen.
const MAX_INPUT_TOKENS_PRO_DATEI = 30000;

// Ab welcher Konfidenz eine Datei automatisch abgelegt werden darf. 'niedrig' gemeldete Dateien
// wandern statt in den Zielordner als entscheidbare Zeile ins Log -- mit Kategorie, erkannten
// Merkmalen und Begruendung, damit ein Mensch in 30 Sekunden Ja/Nein sagen kann.
// Auf 'hoch' stellen, wenn der DRY-Vollauf zeigt, dass 'mittel' zu oft danebenliegt.
const KONFIDENZ_MINIMUM = 'mittel';

/**
 * true, sobald die 6-Minuten-Grenze von Apps Script bedrohlich nah ist.
 * _laufStart === 0 heisst "starteLauf() wurde nie aufgerufen" (z.B. checkConfiguration()).
 * Ohne diesen Sonderfall waere Date.now() - 0 immer groesser als jedes Limit -- die Funktion
 * wuerde dann "Zeit ist um" melden, bevor irgendetwas begonnen hat.
 */
function laufzeitFastAufgebraucht() {
  if (_laufStart === 0) return false;
  return (Date.now() - _laufStart) > MAX_LAUFZEIT_MS;
}

/** Wieviel vom selbstgesetzten Zeitbudget noch uebrig ist. Siehe Sonderfall oben. */
function verbleibendeLaufzeitMs() {
  if (_laufStart === 0) return MAX_LAUFZEIT_MS;
  return Math.max(0, MAX_LAUFZEIT_MS - (Date.now() - _laufStart));
}

/**
 * Schlafen, aber nie ueber das Laufzeitbudget hinaus.
 * Der Grund: ein retry-after-Header darf bis zu 30s fordern, und drei Retries in Folge koennen
 * damit fast eine Minute fressen. Wenn dafuer keine Zeit mehr ist, ist Abbrechen ehrlicher als
 * Warten -- beim harten 6-Minuten-Kill von Apps Script gaebe es kein finally und damit auch
 * keinen geschriebenen Log; so bleibt im Sheet stehen, woran es lag.
 */
function schlafeBegrenzt(wartezeitMs, kontext) {
  const rest = verbleibendeLaufzeitMs();
  if (rest < wartezeitMs + 5000) {
    throw new Error(`Abbruch bei ${kontext}: naechster Versuch braucht ${Math.round(wartezeitMs / 1000)}s Wartezeit, es sind aber nur noch ${Math.round(rest / 1000)}s Laufzeit uebrig`);
  }
  Utilities.sleep(wartezeitMs);
}

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

function callPipedriveWithRetry(doFetch, path, wiederholbar) {
  const maxAttempts = 3;
  const darfWiederholen = wiederholbar !== false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // NACHGEZOGEN 16.09.2026: Commit 556fb57 ("Alle Projekte: Retry auch bei Netzwerk-Timeouts")
    // hat 11 Projekte angefasst und AUSGERECHNET dieses uebersprungen -- es stand nicht in der
    // Liste. muteHttpExceptions faengt nur HTTP-Statuscodes, KEINE Netzwerkfehler: bei einer
    // Zeitueberschreitung wirft UrlFetchApp.fetch() selbst ("Exception: Timeout: <url>"), bevor
    // es eine Response gibt -- das lief an der Statuscode-Schleife unten vorbei.
    // wiederholbar=false fuer POST-Aufrufe, die etwas ANLEGEN (hier aktuell keiner).
    let response;
    try {
      response = doFetch();
    } catch (e) {
      if (!darfWiederholen || attempt === maxAttempts) {
        throw new Error(`Pipedrive-Netzwerkfehler bei "${path}": ${e.message}`);
      }
      schlafeBegrenzt(1000 * Math.pow(2, attempt), `Pipedrive "${path}"`);
      continue;
    }
    const code = response.getResponseCode();
    if (code === 200 || code === 201) return JSON.parse(response.getContentText()).data;
    if (code === 429 || code >= 500) {
      if (attempt === maxAttempts) {
        throw new Error(`Pipedrive API-Fehler ${code} bei "${path}" nach ${maxAttempts} Versuchen: ${response.getContentText()}`);
      }
      // KORREKTUR 16.09.2026: hier stand "2s, 4s, 8s". Real sind es 2s und 4s -- beim dritten
      // Versuch wird nicht mehr geschlafen, sondern geworfen. Befund D17 im Repo-CLAUDE.md.
      schlafeBegrenzt(1000 * Math.pow(2, attempt), `Pipedrive "${path}"`); // 2s, 4s (beim 3. Versuch: throw statt sleep)
      continue;
    }
    throw new Error(`Pipedrive API-Fehler ${code} bei "${path}": ${response.getContentText()}`);
  }
}

// ===== LOGGING =====
// Gepuffert statt appendRow pro Zeile, gleiches Schema wie Ordnererstellung-bei-Gewonnen/Config.gs.

const LOG_HEADER = ['Zeitstempel', 'Lauf-ID', 'Funktion', 'Modus', 'Deal-ID', 'Dateiname', 'Kategorie', 'Ergebnis', 'Tokens-In', 'Tokens-Out', 'Kosten-USD', 'Kosten-EUR', 'Detail'];
const PROP_LOG_SHEET_ID = 'KLASSIFIKATION_LOG_SHEET_ID';

let _logSheetCache = null;
let _logBuffer = [];
let _laufId = '-';
let _laufFunktion = '-';
let _laufStart = 0;

// Laufende Summen fuer die Schlusszeile. Bisher stand am Ende eines Laufs nur, WIEVIELE Dateien
// verarbeitet wurden -- was er gekostet hat, musste man aus den Einzelzeilen zusammenaddieren.
// Genau diese Zahl entscheidet aber, ob der Pilot auf alle Deals ausgerollt wird.
let _laufTokensIn = 0;
let _laufTokensOut = 0;
let _laufKostenUsd = 0;

function starteLauf(funktionsName) {
  _laufId = Utilities.getUuid().slice(0, 8);
  _laufFunktion = funktionsName;
  _laufStart = Date.now();
  // Zuruecksetzen ist noetig, weil Apps Script den globalen Zustand innerhalb einer Ausfuehrung
  // behaelt: ohne das haette ein zweiter Aufruf im selben Durchlauf (z.B. testEinzelDeal nach
  // pilotLauf) das Call-Limit schon aufgebraucht vorgefunden.
  _claudeCallsDieserLauf = 0;
  _laufTokensIn = 0;
  _laufTokensOut = 0;
  _laufKostenUsd = 0;
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

/** usage: optionales {input_tokens, output_tokens} aus der Claude-Antwort. */
function logRow(dealId, dateiname, kategorie, ergebnis, detail, usage) {
  const kosten = usage ? berechneKosten(usage) : null;
  if (kosten) {
    _laufTokensIn += usage.input_tokens || 0;
    _laufTokensOut += usage.output_tokens || 0;
    _laufKostenUsd += kosten.usd;
  }
  _logBuffer.push([
    new Date(), _laufId, _laufFunktion, DRY_RUN ? 'DRY' : 'LIVE',
    dealId || '', dateiname || '', kategorie || '', ergebnis,
    usage ? usage.input_tokens : '', usage ? usage.output_tokens : '',
    kosten ? kosten.usd.toFixed(4) : '', kosten ? kosten.eur.toFixed(4) : '',
    detail || ''
  ]);
}

/** Kosten aus Claude-Token-Usage nach den Preiskonstanten oben in diesem File. */
function berechneKosten(usage) {
  return berechneKostenAusTokens(usage.input_tokens || 0, usage.output_tokens || 0);
}

/**
 * Wie berechneKosten(), aber mit freien Token-Zahlen -- gebraucht fuer den Kostenvoranschlag,
 * bei dem es noch gar keine usage gibt, weil bewusst nichts bezahlt wurde.
 */
function berechneKostenAusTokens(inputTokens, outputTokens) {
  const usd = (inputTokens / 1e6) * CLAUDE_PREIS_USD_PRO_1M_INPUT
    + (outputTokens / 1e6) * CLAUDE_PREIS_USD_PRO_1M_OUTPUT;
  return { usd, eur: usd * USD_ZU_EUR };
}

function logLaufEnde(status, summary) {
  const dauer = Math.round((Date.now() - _laufStart) / 1000);
  const eur = _laufKostenUsd * USD_ZU_EUR;
  const kostenText = `${_claudeCallsDieserLauf} Claude-Calls, ${_laufTokensIn} In-/${_laufTokensOut} Out-Token, ${eur.toFixed(4)} EUR`;
  logRow(null, null, null, status, `${JSON.stringify(summary)} -- ${kostenText} -- ${dauer}s`);
  Logger.log(`[${_laufId}] ${_laufFunktion} ${status}: ${JSON.stringify(summary)}`);
  Logger.log(`[${_laufId}] Kosten: ${kostenText} (${dauer}s Laufzeit)`);
}

function flushLog() {
  if (_logBuffer.length === 0) return;
  const sheet = getLogSheet();
  sheet.getRange(sheet.getLastRow() + 1, 1, _logBuffer.length, LOG_HEADER.length).setValues(_logBuffer);
  _logBuffer = [];
}
