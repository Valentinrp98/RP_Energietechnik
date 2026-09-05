// ============================================================
// KONFIGURATION — Telefon-Qualifizierung
// ============================================================
// Zweck: Vor dem Setter-Anruf Pipedrive-Personen-Telefonnummern prüfen:
//   1. Format-Check (kostenlos, offline) — erkennt/korrigiert AT-Formatfehler
//      (fehlendes +43, falsche führende Null, Länge).
//   2. Existenz-Check (AbstractAPI, 100/Monat kostenlos, kein Tages-Deckel) —
//      prüft ob die Nummer wirklich aktiv im Netz ist, plus Line-Type/Carrier.
//      Umgestiegen von IPQualityScore (05.09.2026): IPQS' eigener Freiplan zeigte
//      trotz aktivem $0-Plan "0 Remaining Credits" -- bestätigter Bug auf deren Seite
//      (auch andere Nutzer betroffen, siehe GitHub-Issue firecrawl/firecrawl#651),
//      Support-Ticket offen, aber nicht abgewartet.
// Ergebnis landet IMMER im eigenen Ergebnis-Sheet. Zusätzlich -- weil WRITE_TO_PIPEDRIVE
// seit 05.09.2026 auf true steht (von Valentin explizit freigegeben) -- auch auf der Person
// selbst (FIELD_LABEL_EXISTIERT + FIELD_LABEL_ORIGINAL + FIELD_LABEL_ZULETZT_GEPRUEFT,
// siehe PipedriveWriteBack.gs).
// ⚠️ Das Script schreibt NICHT die korrigierte Nummer ins Telefonfeld zurück, es vermerkt
// nur das Prüfergebnis. "ja +(+43) ergänzt" heißt "wir mussten für die Prüfung korrigieren",
// NICHT "die Nummer in Pipedrive ist jetzt korrigiert".
// Eine echte Auto-Korrektur ist nur für Formatfehler möglich (deterministisch).
// Echte Zifferndreher erkennt das nicht zuverlässig — dafür gibt's die Spalte
// "Verdacht" im Ergebnis-Sheet zur manuellen Prüfung.
//
// Ablauf:
//   1. pruefeKonfiguration() — legt bei Bedarf das Ergebnis-Sheet an, prüft Tokens + Felder
//   2. testEinzelneNummer('+43664...') — 1 echter Existenz-Check-Call, Rohantwort ins Log
//   3. richteTaeglichenTriggerEin() — einmalig, danach läuft taeglicherTelefonCheck() von selbst

const PIPEDRIVE_API_BASE = 'https://api.pipedrive.com/api/v2';
// Domain heißt "phoneintelligence", NICHT "phonevalidation" -- AbstractAPI hat das Produkt
// umbenannt/umgezogen, die ältere Doku-Seite nannte noch den alten Domainnamen (führte am
// 05.09.2026 zu einem irreführenden 401 "Invalid API key", obwohl der Key korrekt war).
// Verifiziert gegen die tatsächliche Beispiel-URL im AbstractAPI-Dashboard, nicht nur die Doku.
const ABSTRACT_API_BASE = 'https://phoneintelligence.abstractapi.com/v1/';

// Tokens liegen in Script Properties (Projekteinstellungen > Script-Properties),
// nicht hier im Code — siehe D4 im RP-Google-Scripts-CLAUDE.md (Klartext-Secrets).
function getPipedriveToken() {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  if (!token) {
    throw new Error('PIPEDRIVE_API_TOKEN fehlt in den Script Properties.');
  }
  return token;
}

function getAbstractApiKey() {
  const key = PropertiesService.getScriptProperties().getProperty('ABSTRACT_API_KEY');
  if (!key) {
    throw new Error('ABSTRACT_API_KEY fehlt in den Script Properties. Kostenlosen Key holen: https://www.abstractapi.com/api/phone-validation-api (kein Kreditkarten-Zwang, 100/Monat).');
  }
  return key;
}

// ---------- gemeinsamer HTTP-Helper mit Retry (4xx bricht sofort ab, 429/5xx mit Backoff) ----------
function fetchJsonWithRetry(url, options) {
  const opts = Object.assign({
    method: 'get',
    muteHttpExceptions: true
  }, options || {});

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = UrlFetchApp.fetch(url, opts);
    const code = response.getResponseCode();
    if (code === 429 || code >= 500) {
      if (attempt === 3) throw new Error('HTTP-Fehler ' + code + ' nach 3 Versuchen: ' + response.getContentText());
      Utilities.sleep(1000 * Math.pow(2, attempt)); // real 2s und 4s
      continue;
    }
    if (code >= 400) {
      throw new Error('HTTP-Fehler ' + code + ': ' + response.getContentText());
    }
    return JSON.parse(response.getContentText());
  }
}

function fetchPipedrive(path) {
  const url = PIPEDRIVE_API_BASE + path;
  return fetchJsonWithRetry(url, { headers: { 'x-api-token': getPipedriveToken() } });
}

// PATCH -- nur benutzt, wenn WRITE_TO_PIPEDRIVE = true. Siehe PipedriveWriteBack.gs.
function patchPipedrive(path, payload) {
  const url = PIPEDRIVE_API_BASE + path;
  return fetchJsonWithRetry(url, {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { 'x-api-token': getPipedriveToken() }
  });
}

// ---------- Phase 2: Ergebnis zurück auf die Person schreiben ----------
// Freigegeben 05.09.2026 (Valentin, explizit bestätigt nach genauer Erklärung was geschrieben
// wird). Bei false würde nur geloggt/im Ergebnis-Sheet vermerkt, was geschrieben WÜRDE.
const WRITE_TO_PIPEDRIVE = true;

// Exakte Feldnamen aus Pipedrive (Feldgruppe "Automatisierung_felder_Valentin", 05.09.2026
// angelegt) -- werden zur Laufzeit über den Namen aufgelöst (siehe PipedriveWriteBack.gs),
// nicht hartcodierte field_codes. Bei Umbenennung hier nachziehen.
const FIELD_LABEL_EXISTIERT = 'Telefonnummer existiert?';
// Feld wurde neu angelegt (jetzt korrekt Feldtyp "varchar"/Text) -- der Name hat beim Neuanlegen
// einen Tippfehler abbekommen ("Origin-IN-inalnummer", nicht "Originalnummer"), 1:1 aus
// listePersonFields() vom 05.09.2026 übernommen. Falls Valentin das in Pipedrive noch umbenennt,
// hier nachziehen.
const FIELD_LABEL_ORIGINAL = 'Origininalnummer_vor_check';
// Datumsfeld, zeigt Setzern/Setup an wie alt eine "existiert?"-Prüfung ist (Nummern können
// über Monate wieder inaktiv werden). Angelegt 05.09.2026, Feldtyp korrekt "date".
const FIELD_LABEL_ZULETZT_GEPRUEFT = 'Zuletzt_geprüft';

// Options-Texte des Mehrfachoption-Felds FIELD_LABEL_EXISTIERT -- exakt wie in Pipedrive
// angelegt (inkl. der unrunden Klammer im mittleren Text, 1:1 übernommen, nicht korrigiert,
// damit der Laufzeit-Abgleich nicht lautlos ins Leere läuft).
const OPTION_JA = 'ja';
const OPTION_JA_KORRIGIERT = 'ja +(+43) oder ähnliches ergänzt)';
const OPTION_NEIN = 'nein';

// ---------- Ergebnis-Sheet ----------
// Leer lassen, bis pruefeKonfiguration() einmal gelaufen ist und die ID geloggt hat --
// dann hier eintragen (gleiches Muster wie TARGET_SHEET_ID in Montageplanung-Namensabgleich).
const ERGEBNIS_SHEET_ID = '1SGrdAYPzskIqzL-9eHD-rQdfTF6sdMh4bc1BAQd4H24';

const ERGEBNIS_TAB_NAME = 'Telefon-Check';
const ERGEBNIS_HEADER = [
  'Geprüft am', 'Person-ID', 'Name', 'Roh-Nummer', 'Normalisiert', 'Format-OK', 'Format-Grund',
  'Line-Type (Format-Guess)', 'Existenz-Check gelaufen', 'Aktiv (Existenz-Check)', 'Valide (Existenz-Check)',
  'Line-Type (Existenz-Check)', 'Carrier', 'Risk-Level', 'Verdacht', 'Pipedrive-Status'
];
const VERDACHT_SPALTE = ERGEBNIS_HEADER.indexOf('Verdacht') + 1; // 1-indiziert, für Conditional Formatting
// Spalte, aus der getBereitsErledigteIds() die schon geprüften Personen liest. Aus dem Header
// abgeleitet statt hartcodiert: die 1 stand hier bis 05.09.2026 fest verdrahtet und zeigte damit
// auf "Geprüft am" statt auf "Person-ID" -- der Doppel-Schutz war dadurch wirkungslos.
const PERSON_ID_SPALTE = ERGEBNIS_HEADER.indexOf('Person-ID') + 1;

const MAX_LAUFZEIT_MS = 4.5 * 60 * 1000; // weicher Ausstieg vor dem 6-Min-Limit, nächster Lauf macht weiter

// AbstractAPI-Freiplan hat NUR einen Monats-Deckel (100/Monat), keinen Tages-Deckel wie IPQS
// (nur eine Rate-Limit-Bremse von 1 Anfrage/Sekunde lt. offizieller Doku -- deshalb das
// Utilities.sleep(1100) in DryRun.gs). Zwei separate
// Grenzen: MAX_EXISTENZ_CHECKS_PRO_LAUF verhindert, dass ein einzelner Trigger-Lauf gleich das
// ganze Monat leerräumt (sonst könnten neue Leads vom 2. Tag des Monats bis zum nächsten Monat
// warten, weil Tag 1 schon alles verbraucht hat); MAX_EXISTENZ_CHECKS_PRO_MONAT ist die harte
// Obergrenze, Sicherheitsabstand zu den echten 100. Bei Upgrade auf einen bezahlten Plan beide hochsetzen.
// Einmalig auf 50 angehoben für den 50er-Batch vom 05.09.2026 (Valentins Wunsch) --
// danach bewusst wieder auf einen kleinen Wert zurückstellen (z.B. 5), damit der tägliche
// Trigger künftig nicht in einem Lauf das ganze Monatskontingent verbrennt.
const MAX_EXISTENZ_CHECKS_PRO_LAUF = 50;
const MAX_EXISTENZ_CHECKS_PRO_MONAT = 90;

// Kopfzeile fett+fixiert, Verdacht-Spalte rot hinterlegt wenn nicht leer -- macht aus dem
// Ergebnis-Sheet ein Log, das man auf einen Blick lesen kann statt nur eine Rohdatenhalde.
function formatiereErgebnisSheet(tab) {
  tab.setFrozenRows(1);
  tab.getRange(1, 1, 1, ERGEBNIS_HEADER.length).setFontWeight('bold');
  tab.autoResizeColumns(1, ERGEBNIS_HEADER.length);

  const bereich = tab.getRange(2, 1, Math.max(tab.getMaxRows() - 1, 1), ERGEBNIS_HEADER.length);
  const regel = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$' + columnLetter(VERDACHT_SPALTE) + '2<>""')
    .setBackground('#f4cccc')
    .setRanges([bereich])
    .build();
  tab.setConditionalFormatRules([regel]);
}

function columnLetter(spalte) {
  let buchstabe = '';
  while (spalte > 0) {
    const rest = (spalte - 1) % 26;
    buchstabe = String.fromCharCode(65 + rest) + buchstabe;
    spalte = Math.floor((spalte - 1) / 26);
  }
  return buchstabe;
}

// Vor jedem Lauf einmal ausführen — legt das Ergebnis-Sheet an (falls ERGEBNIS_SHEET_ID leer ist),
// prüft Tokens und (falls WRITE_TO_PIPEDRIVE irgendwann auf true steht) die beiden Pipedrive-Felder.
function pruefeKonfiguration() {
  getPipedriveToken();
  getAbstractApiKey();
  Logger.log('Pipedrive- und AbstractAPI-Token vorhanden.');

  if (!ERGEBNIS_SHEET_ID) {
    const sheet = SpreadsheetApp.create('Telefon-Qualifizierung — Ergebnis');
    const tab = sheet.getActiveSheet();
    tab.setName(ERGEBNIS_TAB_NAME);
    tab.getRange(1, 1, 1, ERGEBNIS_HEADER.length).setValues([ERGEBNIS_HEADER]);
    formatiereErgebnisSheet(tab);
    Logger.log('Neues Ergebnis-Sheet angelegt: %s', sheet.getUrl());
    Logger.log('>>> ERGEBNIS_SHEET_ID in Config.gs eintragen: %s', sheet.getId());
    return;
  }

  const spreadsheet = SpreadsheetApp.openById(ERGEBNIS_SHEET_ID);
  let tab = spreadsheet.getSheetByName(ERGEBNIS_TAB_NAME);
  if (!tab) {
    tab = spreadsheet.insertSheet(ERGEBNIS_TAB_NAME);
  }
  // Kopfzeile jedes Mal neu schreiben (idempotent) -- so kommen Spaltenumbenennungen im Code
  // (z.B. der Umstieg von IPQS- auf AbstractAPI-Spaltennamen) auch im bestehenden Sheet an,
  // ohne den Tab manuell löschen zu müssen. Datenzeilen darunter bleiben unangetastet.
  tab.getRange(1, 1, 1, ERGEBNIS_HEADER.length).setValues([ERGEBNIS_HEADER]);
  formatiereErgebnisSheet(tab);
  Logger.log('Ergebnis-Sheet: %s (%s)', spreadsheet.getName(), spreadsheet.getUrl());

  pruefePersonFelder(); // wirft klaren Fehler statt stillem Leerlauf, falls eines der beiden Felder fehlt
  Logger.log('OK — Konfiguration passt.');
}
