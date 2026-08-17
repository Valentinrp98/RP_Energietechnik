// ==========================================================================================
// PROJEKT: "Fortschritt-Script"  (scriptId noch nicht vergeben -- Projekt im Editor anlegen,
//                                 dann hier und in .clasp.json nachtragen)
// DATEI IM EDITOR: Config.gs      --> kompletten Inhalt ersetzen
//
// Stand 2026-08-17, erste Version. Gebaut nach PLAN-Fortschritt-Script.md, danach gegen die
// bestehenden RP-Scripts abgeglichen. Uebernommen von dort:
//   - CUTOFF_ENABLED/CUTOFF_DATE       (Muster aus Bundesland-aus-PLZ)
//   - Option-Registry fuer autocomplete-Felder (Lehre aus Sheet-Sync, 2026-08-17 -- siehe unten
//     bei ERLEDIGT_FIELD_KEY und ausfuehrlich in Regeln.gs bei setzeOptionRegistry())
//   - dumpLiveState()                  (R7 aus FIXES-INDEX-2026-08-13.md)
//   - begrenzter Log-Puffer            (B7 aus FIXES-INDEX-2026-08-13.md)
//
// Befuellt zwei Pipedrive-Deal-Felder automatisch, damit niemand mehr haendisch Fortschritt klickt:
//   Erledigt    (Typ set / Mehrfachauswahl) -- die tatsaechlich erreichten Meilensteine
//   Fortschritt (Typ Text)                  -- eine lesbare Kartenzeile fuer die Listenansicht
//
// Beide Felder sind AUSSCHLIESSLICH script-beschrieben. Das Script liest sonst nur -- es setzt
// keine Stages um, legt keine Aktivitaeten an, schickt keine Mails, schreibt kein "Wartet auf".
//
// Gebaut nach PLAN-Fortschritt-Script.md (2026-08-13).
// Alle TODO_-Werte muss Valentin nachtragen; pruefeKonfiguration() bricht ab, solange welche offen
// sind, und der Hauptlauf startet gar nicht erst.
// ==========================================================================================


// ===== SCHALTER =====

// Wenn true: es wird NICHTS geschrieben, nur berechnet und geloggt. Default true.
const DRY_RUN = true;

// KEIN FORCE_OVERWRITE hier -- bewusst, damit die Abweichung von den anderen Scripts nicht wie
// ein Versehen aussieht. Dort heisst FORCE_OVERWRITE "ein bereits gefuelltes Feld trotzdem
// ueberschreiben". Dieses Script arbeitet im SPIEGEL-Modus: es berechnet die komplette Menge bei
// jedem Lauf neu und ueberschreibt grundsaetzlich, auch nach unten. Ein Schalter dafuer waere
// entweder wirkungslos oder wuerde die Selbstheilung abschalten.
// Die Bremse ist hier stattdessen die Diff-Pflicht (nur schreiben, wenn sich etwas aendert).

// Deals, die vor CUTOFF_DATE angelegt wurden (deal.add_time), werden uebersprungen und nicht
// angefasst -- gleiches Muster wie in Bundesland-aus-PLZ.
//
// ENTSCHEIDUNG nach dem DRY-Vollauf vom 2026-08-17 (Valentin): eingeschaltet, ab 01.07.2026.
// Begruendung aus den Messwerten: von 437 gewonnenen Deals standen 436 auf 0/11, weil die
// Fulfillment-Felder erst am 10.08. angelegt wurden und die Termine bis heute in den Partner-Sheets
// bzw. im Finance-Sheet leben. Ohne CUTOFF bekaeme der komplette Altbestand dauerhaft ein
// irrefuehrendes "▱▱▱▱▱▱▱▱▱▱▱ 0/11" in die Listenansicht.
const CUTOFF_ENABLED = true;
const CUTOFF_DATE = new Date('2026-07-01');

// Deal-IDs, die IMMER mitlaufen -- auch wenn sie vor CUTOFF_DATE angelegt wurden.
// Dafuer gedacht, einzelne Altdeals bewusst dazuzunehmen (laufende Projekte, die vor dem Cutoff
// gestartet sind, oder ein Testdeal). Einfach die ID in die Liste schreiben, der naechste Lauf
// nimmt sie mit; im Protokoll steht dann, wie viele ueber die Ausnahmeliste reinkamen.
const CUTOFF_AUSNAHMEN = [
  7253 // AI TEST -- Testdeal, damit er trotz Cutoff weiter mitlaeuft
];

// Zusammenfassungszeile ins zentrale Automations-Dashboard schreiben. Bleibt false, bis das
// Dashboard-Sheet existiert -- das Script ist ohne Dashboard voll lauffaehig.
const DASHBOARD_ENABLED = false;
const DASHBOARD_SHEET_ID = 'TODO_DASHBOARD_SHEET_ID';
const DASHBOARD_TAB_NAME = 'Log';

// Name, unter dem dieses Script im Dashboard auftaucht.
const SCRIPT_NAME = 'Fortschritt-Script';


// ===== KONTINGENTE / LAUFZEIT =====

// Freiwilliger Abbruch vor dem harten Apps-Script-Limit (6 Min Consumer / 30 Min Workspace).
// Greift im 15-Min-Dauerbetrieb ueber ~440 gewonnene Deals nicht, existiert fuer den einmaligen
// Vollauf und fuer den Fall, dass der Bestand deutlich waechst.
const MAX_LAUFZEIT_MS = 4.5 * 60 * 1000;

// Seitengroessen. Deals bewusst 100 (bewaehrt in den anderen RP-Scripts). Aktivitaeten 500 --
// das ist der laut v2-Doku erlaubte Maximalwert ("Please note that a maximum value of 500 is
// allowed") und senkt die Callzahl des Vorabzugs um Faktor 5.
const DEALS_PRO_SEITE = 100;
const AKTIVITAETEN_PRO_SEITE = 500;

// Notbremse gegen einen ausufernden Aktivitaeten-Vorabzug (siehe ladeAktivitaetenIndex()).
const MAX_AKTIVITAETEN_SEITEN = 200;

// Ab so vielen Zeilen wird das Detail-Log in einen Archiv-Tab ausgelagert. Ohne das laeuft jedes
// Log-Sheet irgendwann in die 10-Mio.-Zellen-Grenze und stirbt mitten in einem Lauf.
const LOG_MAX_ZEILEN = 20000;
const LOG_ARCHIV_BLOCK = 5000;

// Der Log-Puffer wird zwischendurch geschrieben, sobald er so gross ist (B7 aus dem Fix-Index:
// in Bundesland-aus-PLZ wuchs der Puffer unbegrenzt und hielt 6570 Zeilen im Speicher). Im
// Dauerbetrieb greift das nie -- relevant ist der erste Vollauf, bei dem jeder Deal eine Zeile
// bekommt.
const LOG_PUFFER_MAX = 500;

// Anteil der Deals auf 0/11, ab dem der Lauf als KETTE_BLOCKIERT gemeldet wird statt als OK.
// Hintergrund: zwei reale Nulllaeufe (Montagepartner, Sheet-Sync) waren fehlerfrei und trotzdem
// wirkungslos, weil ein Vorgaenger nichts geliefert hatte. Eine Ampel, die nur Fehler zaehlt,
// haette beide gruen gemeldet.
const SCHWELLE_KETTE_BLOCKIERT = 0.9;


// ===== PIPEDRIVE =====

const PIPEDRIVE_DOMAIN = 'rp-energietechnik';

// --- Zielfelder (werden geschrieben) ---------------------------------------------------
const ERLEDIGT_FIELD_KEY = '8f3f8e44c657ad9fdd2e171f2d5ed6ac8c565ac7'; // erwartet: set

// NEU angelegtes Textfeld (2026-08-17). Das alte "Fortschritt" war varchar_auto (Autocomplete),
// und Pipedrive laesst Feldtypen nachtraeglich NICHT aendern -- deshalb ein neues Feld.
// pruefeKonfiguration() gibt Name und field_type dieses Feldes aus: dort muss "Fortschritt" mit
// Typ "varchar" (oder "text") stehen. Steht dort etwas anderes, ist der Code unten falsch.
const FORTSCHRITT_FIELD_KEY = 'dfa17befc9285d9641c2c92f3c001fe36a77a448'; // erwartet: varchar

// Das alte Autocomplete-Feld "Fortschritt" (fa77cb3c2a12790f5de5879ccb7b076b5c98ab44) wurde am
// 2026-08-17 von Valentin in Pipedrive GELOESCHT. Nur noch hier als Notiz, absichtlich NICHT als
// Konstante -- sonst sieht es aus, als wuerde noch etwas darauf zeigen.
//
// FOLGE FUER SHEET-SYNC: dort steht der Code noch in FORTSCHRITT_FIELD_KEY und wird in
// NetzanmeldungEskalation.gs gelesen (`cf[FORTSCHRITT_FIELD_KEY] === FORTSCHRITT_LABELS.NetzUebergeben`).
// Das stuerzt nicht ab -- ein geloeschtes Feld liefert einfach undefined --, die Bedingung kann aber
// nie mehr wahr werden. Der Netzstatus-Check daneben traegt die Eskalation weiter. Aufraeumen:
// diese ODER-Bedingung und die verwaisten Konstanten in Sheet-Sync entfernen.

// --- Quellfelder (werden nur gelesen) --------------------------------------------------
const NETZSTATUS_FIELD_KEY = 'df60049565c7aecc52febb2ef5ecb911a761c2c6';
const ZPN_FIELD_KEY = '86f6ce58bb7129c5c4e312038342f601713c7742';          // Einspeisezählpunkt (ZPN)
const AR_VERSENDET_FIELD_KEY = 'd54cfede7b837b9f1f135a24f14e6c1c5fe7d85a';
const ZAHLUNGSEINGANG_FIELD_KEY = 'ddbfed2a1cdc25c2be460b9a825e056cca2d0284';
const LIEFERTERMIN_FIELD_KEY = 'c0a676d8db66f0cb6300e8160e1401355a226990';
const AC_TERMIN_FIELD_KEY = '0277ea7463b980044e0062e46467979ccc292127';
const IB_TERMIN_FIELD_KEY = 'ba820255728739b29c451287808fbe18f1c94b8e';

// NEU anzulegendes Datumsfeld "IB erledigt am" -- das Gegenstueck zu "Fertigmeldung am" und die
// Ausloesung des Zwei-Schreiber-Konflikts auf "Fortschritt" (siehe README):
// Der Montagepartner hakt im Sheet "IB erledigt" an, Sheet-Sync schreibt HIER das Datum hinein
// statt in "Fortschritt". Damit gehoert "Fortschritt" allein diesem Script.
//
// Fachlich ist das zugleich die BESSERE Quelle fuer Regel 9: "IB-Termin" ist der GEPLANTE Termin --
// war die Inbetriebnahme fuer heute geplant und ist nicht passiert, wuerde die Regel trotzdem
// greifen. Das Haken des Partners ist die tatsaechliche Bestaetigung.
// Angelegt 2026-08-17 (Typ Datum, Pipeline Fulfillment). MUSS mit dem pipedriveFieldKey im
// "IB erledigt"-Eintrag von Sheet-Sync/Config.gs identisch sein -- weicht es ab, schreibt der
// Partner in ein Feld, das hier niemand liest, und Regel 9 faellt still auf den geplanten
// IB-Termin zurueck.
const IB_ERLEDIGT_AM_FIELD_KEY = '6625e4db471a6601a70766facc04d2d421f89810';
const FOERDERZUSAGE_FIELD_KEY = '574d9469760b0e993af058654a7c827a81150cb4';
const FOERDERSTATUS_FIELD_KEY = 'fe61797bd9d9e4990a2f5735b8c4de1919c7fa11';
const FERTIGMELDUNG_AM_FIELD_KEY = '69dd6586f2a762a912b9131dee404acf711fc1a5';
const WARTET_AUF_FIELD_KEY = 'b7342c374d4e7d76f9ec3772d95efd5944c97e29';

// Nur fuer die Auswertung im DRY-Vollauf (Testplan Schritt 4): "Montiert" haengt am AC-Termin,
// den es bei Selbstmontage evtl. gar nicht gibt -- die Verteilung wird deshalb zusaetzlich nach
// Ausfuehrungsart aufgeschluesselt (154 Full Service / 155 Selbstmontage / 156 Hybrid).
const AUSFUEHRUNGSART_FIELD_KEY = 'cc80ad5daf0788dba60b3da3931681edd3dd2c87';


// ===== OPTION-IDs =====
// Alle hier hartcodierten IDs gleicht pruefeKonfiguration() gegen die echte API ab.
// Option-IDs sind hartcodiert fragil -- vor jedem Massenlauf abgleichen.

// Zielfeld "Erledigt": die 11 Meilensteine. Reihenfolge/Fachlogik steht in Regeln.gs.
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

// Erwartete Klartext-Labels der Erledigt-Optionen, fuer den Abgleich in pruefeKonfiguration().
// Ohne Labels koennte das Script nur pruefen, DASS die ID existiert -- nicht, dass sie noch
// dasselbe bedeutet. Genau das ist der Fehler, der sonst als stille Falschbefuellung durchgeht.
const ERLEDIGT_OPTION_LABELS = {
  223: 'Erstgespräch',
  224: 'Netz übergeben',
  225: 'Zählpunkt da',
  226: 'AR raus',
  227: 'Anzahlung da',
  228: 'Geliefert',
  229: 'Zweitgespräch',
  230: 'Montiert',
  231: 'IB erfolgt',
  232: 'Förderzusage',
  233: 'Fertigmeldung'
};

// Quellfeld "Netzstatus"
const NETZSTATUS_UEBERGEBEN = 183;
const NETZSTATUS_EINGEREICHT = 184;
const NETZSTATUS_ZAEHLPUNKT_DA = 185;
const NETZSTATUS_FERTIGMELDUNG_RAUS = 186;

// Quellfeld "Förderstatus"
const FOERDERSTATUS_ZUGESAGT = 191;
const FOERDERSTATUS_ABGERECHNET = 193;

// Ja-Optionen der drei Haken-Felder (Einfachauswahl mit einer "Ja"-Option -- Pipedrive hat
// keinen echten Boolean-Typ).
const AR_VERSENDET_JA = 206;
const ZAHLUNGSEINGANG_JA = 207;
const FOERDERZUSAGE_JA = 209;

// Quellfeld "Wartet auf": die Kuerzel-Zuordnung (WARTET_AUF_KURZ) steht in Regeln.gs, weil sie
// zur Textbildung gehoert und nicht zur Verdrahtung.


// ===== STAGES / SONDERZUSTAENDE =====
// Sonderzustaende ERSETZEN den Fortschritt-Balken komplett, damit tote Deals in der Listenansicht
// sofort auffallen.
//
// KORREKTUR ZUM PLAN (2026-08-17, per GET /api/v2/stages verifiziert): Es gibt KEINE zwei getrennten
// Stages "Storniert" und "Verschoben". Es gibt genau EINEN gemeinsamen Stage:
//     Stage 24 "Verschoben/storniert" (pipeline_id 2)
// Der Plan ging von zwei Stages aus -- haette man das geraten, waere einer der beiden Sonderzustaende
// stillschweigend nie gegriffen.
//
// Unterschieden wird deshalb NICHT ueber die Stage, sondern ueber die Grund-Felder: ein gesetzter
// Stornogrund heisst storniert, ein Verschiebegrund bzw. ein Datum in "Verschoben auf" heisst
// verschoben. Ist keines von beiden gesetzt, bleibt es beim neutralen Sammelzustand -- lieber
// "Verschoben/storniert" anzeigen als eine Halbwahrheit raten.
const STAGE_ID_VERSCHOBEN_STORNIERT = 24;
const STAGE_NAME_VERSCHOBEN_STORNIERT = 'Verschoben/storniert';

const STORNOGRUND_FIELD_KEY = '78f141d32919d24cc9e45f070f260bd421b984e3';    // enum 212-217
const VERSCHIEBEGRUND_FIELD_KEY = 'ef68d654014dd173df185b4bb1fbf08bbc4d6c0d'; // enum 218-222
const VERSCHOBEN_AUF_FIELD_KEY = 'a6dc892da6e8a16eeef6e57e3530b903e0cf2f42';  // date


// ===== LEERER "set"-WERT -- EMPIRISCH GEKLAERT 2026-08-17 =====
//
// Greift an einem Deal keine einzige Regel, muss "Erledigt" geleert werden (Spiegel-Modus).
// Womit -- [] oder null -- steht NICHT in der Pipedrive-v2-Doku: die beschreibt fuers Schreiben von
// Mehrfachauswahl-Feldern nur "new value is an array of ids (e.g. [3, 7])" und schweigt zum Leeren.
//
// Deshalb mit testLeerenSetWert() an einem echten Deal gemessen. Ergebnis, verifiziert:
//   []    -> HTTP 400 ERR_SCHEMA_VALIDATION_FAILED
//            "Expected non-empty 'array' as value for multi options custom field '...'.
//             Use null to clear the field."
//   null  -> funktioniert, Feld ist danach leer
//
// Also null. Die API sagt es in der Fehlermeldung sogar selbst -- nur eben nirgends in der Doku.
// Gilt fuer alle Pipedrive-Felder vom Typ "set", nicht nur fuer dieses.
const LEERWERT_FUER_SET = null; // gemessen: null leert, [] wird mit 400 abgelehnt

// Schutzschalter fuer testLeerenSetWert(): diese Testfunktion MUSS echt schreiben, um die Frage
// oben zu beantworten -- sie ignoriert DRY_RUN also bewusst (stellt den Ausgangswert danach wieder
// her). Damit das kein Versehen sein kann, laeuft sie nur, wenn dieser Schalter auf true steht.
const TEST_LEERER_SET_ERLAUBT = false;


// ===== FELDTYP "Fortschritt" -- VORBEDINGUNG FUER DEN LIVE-BETRIEB =====
//
// Das Feld ist aktuell varchar_auto (Autocomplete). Jeder je geschriebene Wert landet dauerhaft in
// der Vorschlagsliste des Feldes; das gewaehlte Format erzeugt grob 400+ distinkte Werte und muellt
// die Liste damit unbrauchbar zu. Derselbe Feldtyp hat beim ZPN-Feld schon einen 400er beschert.
//
// Empfehlung: Feldtyp in Pipedrive auf varchar (einfacher Text) umstellen, BEVOR das Script scharf
// geht. Das Feld ist noch leer, es geht dabei nichts verloren.
//
// Solange der Typ varchar_auto ist, laesst pruefeKonfiguration() DRY-Laeufe durch (damit man testen
// kann), verweigert aber den LIVE-Betrieb. Wer bewusst trotzdem live gehen will, setzt diesen
// Schalter auf true -- dann muss aber der ZPN-Retry-Workaround aus Sheet-Sync/FieldSync.gs
// uebernommen werden.
const FORTSCHRITT_AUTOCOMPLETE_AKZEPTIERT = false;


// ===== TEST-DEALS =====
// Konstanten statt Funktionsparameter: der Play-Button im Editor ruft jede Funktion ohne
// Argumente auf -- ein Parameter waere dort immer undefined.
const TEST_DEAL_ID = 7253;
const TEST_DEAL_IDS_RANDFAELLE = [7253, 7255, 7266]; // Testplan Schritt 3+7: eigene IDs eintragen
const TEST_DEAL_ID_LEERER_SET = 7253;                // fuer testLeerenSetWert()


// ===== SCRIPT-PROPERTY-SCHLUESSEL =====
const PROP_RESUME_CURSOR = 'FORTSCHRITT_RESUME_CURSOR';
// Wird LOG_HEADER (Code.gs) jemals um Spalten erweitert, diesen Schluessel mit-versionieren
// (..._V2). Dann legt das Script ein frisches Sheet mit passender Kopfzeile an, statt neue Werte
// in die alten Spalten zu schreiben -- gleiches Vorgehen wie bei BUNDESLAND_LOG_SHEET_ID_V3.
const PROP_LOG_SHEET_ID = 'FORTSCHRITT_LOG_SHEET_ID';


// ===== PIPEDRIVE-HILFSFUNKTIONEN =====

/** Holt den API-Token aus den Script Properties, wirft klaren Fehler wenn er fehlt. */
function getApiToken() {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN fehlt in den Script Properties (Projekteinstellungen pruefen).');
  return token;
}

/**
 * LIEST, gibt nur .data zurueck.
 * Auth ueber Header x-api-token -- NICHT ?api_token= (das ist v1) und kein Bearer.
 */
function fetchPipedrive(path) {
  return callPipedriveWithRetry(() => UrlFetchApp.fetch(`https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`, {
    headers: { 'x-api-token': getApiToken() },
    muteHttpExceptions: true
  }), path).data;
}

/** LIEST, gibt die volle Response zurueck -- inklusive additional_data.next_cursor fuer Pagination. */
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
 * SOFORT abbrechen -- ein 4xx wird durchs Warten nicht besser.
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
