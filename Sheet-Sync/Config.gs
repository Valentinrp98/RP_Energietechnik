// ===== KONFIGURATION =====
// TODO-Marker unten sind Werte, die nur Valentin nachtragen kann (Sheet-IDs, neue Pipedrive-Feldcodes).

const PIPEDRIVE_DOMAIN = 'rp-energietechnik';

// Gleiche Felder wie im Projekt "Ordnererstellung-bei-Gewonnen" -- MUSS mit dessen Config.gs übereinstimmen.
const MONTAGEPARTNER_FIELD_KEY = '0190fd945adc86148657d2db36261ae9545e7bda';
const KUNDENORDNER_LINK_FIELD_KEY = '5c442fe317da26ed4f60504e2b912df7e3116c5b'; // wird von Projekt 1 gesetzt
const ADRESSE_FIELD_KEY = '432e4e165de7e9f474643c3d3a5552e2ec976f55'; // an der Person
const PLZ_FIELD_KEY = '5fef394025c936df4b58763b2b58c340fbb0d251'; // an der Person, eigenes Feld (keine Adresse-Subkomponente)
// Aus dem sevdesk-Pipedrive-Sync (Sevdesk-Pipdrive_sync/fieldkeysandmapping.js) -- werden dort
// bereits am Deal befüllt, hier nur gelesen, kein neues Feld nötig.
const MODULE_ANZAHL_FIELD_KEY = '46e74c317774c91ac843a431780ad24d2e59da03';
const SPEICHER_KWH_FIELD_KEY = 'd8e9435192bb719365e9bc3186dcba540dff26bd';

// Stufe 2 (IDEEN-Felder-und-Aktionen.md, R1+R2, die zwei "Anruf-Killer"): TODO, Feldcode erst
// eintragen nachdem listDealFieldsHelper() geprüft hat, ob unter den 33 Fulfillment-Feldern vom
// 10.08. schon ein passendes Datumsfeld existiert -- sonst neu in Pipedrive anlegen (Typ: Datum,
// KEIN Ja/Nein-Feld, siehe Begründung in IDEEN-Felder-und-Aktionen.md Abschnitt 1).
const MONTAGE_ABGESCHLOSSEN_AM_FIELD_KEY = '69dd6586f2a762a912b9131dee404acf711fc1a5'; // Pipedrive-Feld "Fertigmeldung am"

// AUFGERAEUMT 2026-08-17: Hier standen FORTSCHRITT_FIELD_KEY, FORTSCHRITT_LABELS und
// IB_ERLEDIGT_FIELD_KEY. Alle drei zeigten auf das Deal-Feld
// fa77cb3c2a12790f5de5879ccb7b076b5c98ab44 ("Fortschritt", Typ varchar_auto) -- dieses Feld ist in
// Pipedrive GELOESCHT.
//
// Vorgeschichte, damit der Fehler nicht nochmal gemacht wird: "IB erledigt" schrieb hier die
// Options-ID 231 in dieses Feld und bekam HTTP 400 ("Expected 'string' as autocomplete custom field
// value"). Daraus wurde geschlossen, das Feld sei ein getarntes enum -- das war eine Verwechslung.
// Der Feld-Dump vom 2026-08-17 zeigt: "Fortschritt" hatte GAR KEINE Optionen, die 11
// Meilenstein-Optionen (223-233) gehoeren zum Feld "Erledigt". Der 400er kam schlicht davon, dass
// eine Zahl in ein Textfeld geschrieben wurde. Merke: der field_type entscheidet, nicht die
// Anwesenheit einer Options-Liste.
//
// Ersatz: "IB erledigt" schreibt jetzt in das Datumsfeld "IB erledigt am" (siehe SYNC_FIELD_CONFIG
// weiter unten), und die Meilenstein-Anzeige macht das eigene Projekt "Fortschritt-Script" ueber die
// Felder "Erledigt" (set) und "Fortschritt" (neues Textfeld, dfa17bef...). Beide gehoeren
// AUSSCHLIESSLICH diesem Script -- aus Sheet-Sync nicht mehr beschreiben.

// Aktivitäts-Typ für die IB-erledigt-Meldung -- 'task' ist ein Pipedrive-Standardtyp, funktioniert
// also ohne weitere Konfiguration. Falls RP einen eigenen Aktivitätstyp dafür anlegt (z.B. eigenes
// Icon/Filter), hier den passenden "key_string" eintragen -- siehe Aktivitätstyp-Einstellungen
// in Pipedrive oder GET /activityTypes.
const AKTIVITAET_TYP_IB_ERLEDIGT = 'task';

// ===== NETZANMELDUNG + ESKALATION (2026-08-17) =====
// Netzstatus-Feld + Options-IDs, per listDealFieldsHelper() ermittelt. ANDERS als "Fortschritt":
// Netzstatus ist ein ECHTES "single option"-Feld -- Pipedrive will hier die numerische Options-ID
// (Fehler war: "Expected 'number' as value for single option custom field"), NICHT den Text-Label
// wie bei Fortschritt. Beide sahen in listDealFieldsHelper() gleich aus (Options-Liste), sind aber
// unterschiedliche field_types -- deshalb hier zurück auf IDs, während Fortschritt bei Labels bleibt.
const NETZSTATUS_FIELD_KEY = 'df60049565c7aecc52febb2ef5ecb911a761c2c6';
const NETZSTATUS_OPTION_IDS = {
  offen: 182,
  uebergeben: 183,
  eingereicht: 184,
  zaehlpunktDa: 185,
  fertigmeldungRaus: 186
};
// Für lesbare Logs: Options-ID -> Klartext. Ohne das steht im Log "Netzstatus -> 186".
const NETZSTATUS_ID_TO_LABEL = Object.fromEntries(
  Object.entries(NETZSTATUS_OPTION_IDS).map(([name, id]) => [id, name])
);
// DC-/AC-Termin nochmal als eigene Konstanten (stehen sonst nur inline in SYNC_FIELD_CONFIG) --
// werden für den Kundentermin-Eskalations-Check gebraucht (NetzanmeldungEskalation.gs).
const DC_TERMIN_FIELD_KEY = '6e4dc4e9017957ddadebddac3dd622ca3afe8676';
const AC_TERMIN_FIELD_KEY = '0277ea7463b980044e0062e46467979ccc292127';

// Diese drei Felder gibt es in Pipedrive noch NICHT -- müssen als Datumsfelder neu angelegt
// werden, bevor NetzanmeldungEskalation.gs live laufen kann (siehe dortiger Kommentar für den
// Zweck jedes einzelnen). TODO-Codes hier eintragen, sobald angelegt.
const NETZSTATUS_UEBERGEBEN_AM_FIELD_KEY = 'TODO_NETZSTATUS_UEBERGEBEN_AM_FIELD_KEY';
const NETZANMELDUNG_ESKALATION_GEMELDET_AM_FIELD_KEY = 'TODO_NETZANMELDUNG_ESKALATION_GEMELDET_AM_FIELD_KEY';
const KUNDENTERMIN_ESKALATION_GEMELDET_AM_FIELD_KEY = 'TODO_KUNDENTERMIN_ESKALATION_GEMELDET_AM_FIELD_KEY';

// Wartefristen ab dem Tag, an dem Netzstatus="übergeben" zum ersten Mal gesehen wurde
// (Valentins Vorgabe 2026-08-17).
const NETZANMELDUNG_ESKALATION_WARTETAGE = 5;
const KUNDENTERMIN_ESKALATION_WARTETAGE = 3;
const AKTIVITAET_TYP_ESKALATION = 'task'; // wie AKTIVITAET_TYP_IB_ERLEDIGT, ggf. anpassen

// Ordner-Namen 1:1 wie im Projekt "Ordnererstellung-bei-Gewonnen" (dortige Config.gs) -- als
// reiner Text hier dupliziert, weil getrennte Apps-Script-Projekte keine Konstanten teilen können.
const MONTAGE_OFFEN_ORDNERNAME = 'Montage offen';
const MONTAGE_ABGESCHLOSSEN_ORDNERNAME = 'Montage abgeschlossen';
// Kundenordner wird NICHT sofort bei der Fertigmeldung verschoben, sondern erst so viele Tage
// danach (Valentins Vorgabe 2026-08-13) -- lässt Zeit für Nacharbeit/Korrekturen, bevor der
// Ordner als endgültig fertig einsortiert wird. Siehe OrdnerAbschluss.gs.
const ORDNER_VERSCHIEBEN_WARTETAGE = 7;

// Nach so vielen Tagen werden Erfolgs-/Änderungs-Notizen im Partner-Sheet wieder entfernt,
// damit nicht jede Zelle dauerhaft ein Notiz-Eck trägt. Fehler-Notizen (⚠) bleiben IMMER
// stehen -- die sind ja das offene Problem. Siehe raeumeAlteNotizen() in SetupHelpers.gs.
const NOTIZ_AUFRAEUM_TAGE = 30;

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

// Sheet-ID + Ziel-Tab pro Partner (ID = der Teil der URL zwischen /d/ und /edit).
//
// KLARGESTELLT (2026-08-13): Das alte Sheet "Montageplanung Ale" (mit Abschnitten "WIEN NÖ"/
// "STMK"/"ALT") ist NICHT die Zielstruktur und wird nicht mehr verwendet -- das waren keine
// Tabs in einem produktiven Multi-Tab-Sheet, sondern Reste einer alten, nicht mehr genutzten
// Struktur. Die echte Vorgehensweise: pro Montagepartner ein eigener Drive-Ordner mit "Montage
// offen"/"Montage abgeschlossen"-Unterordnern (das macht Projekt 1, "Ordnererstellung-bei-
// Gewonnen"). Für die Sheets hier gilt: Valentin/RP legen pro Partner ein NEUES, flaches Sheet
// mit der getesteten Dummy-Struktur an (Kunden/Zählpunkt/DC Termin/AC Termin/Materiallieferung/
// IB Termin/Link zum Kundenordner/Deal-ID) und kopieren die Daten händisch rein -- sobald die
// echten Sheets stehen, hier deren Sheet-ID + Tab-Name eintragen (Format wie bei der Testumgebung
// unten). Bis dahin zeigen ALE und KOLLSTAR bewusst auf die Dummy-Test-Sheets, NICHT auf
// "Montageplanung Ale".
const PARTNER_SHEET_CONFIG = {
  'ALE-Engineering (NÖ, Wien, BGL)': { sheetId: '1wpv9OMBGHDMinbhiM1IROcyCoPkdNPOamdwUkvqw8OA', tabName: 'Tabellenblatt1' }, // Testumgebung
  'Berger Elektrotechnik (KTN)': { sheetId: 'TODO_SHEET_ID_BERGER', tabName: 'TODO_TABNAME_BERGER' },
  'Greensky (OÖ, SBG)': { sheetId: 'TODO_SHEET_ID_GREENSKY', tabName: 'TODO_TABNAME_GREENSKY' },
  'KOLLSTAR (OÖ)': { sheetId: '1KPYBeVzsj0izYI6ZzUza4Bl5JcUIzWI1m5oojTOJ47E', tabName: 'Tabellenblatt1' }, // Testumgebung
  'Kreuzeder (OÖ, SBG)': { sheetId: 'TODO_SHEET_ID_KREUZEDER', tabName: 'TODO_TABNAME_KREUZEDER' }
};

/** Öffnet den konfigurierten Ziel-Tab für einen Partner, wirft klaren Fehler wenn Config/Tab fehlt. */
function openPartnerSheet(partner) {
  const config = PARTNER_SHEET_CONFIG[partner];
  if (!config || config.sheetId.startsWith('TODO_')) {
    throw new Error(`Keine Sheet-ID für Partner "${partner}" konfiguriert (Config.gs).`);
  }
  if (config.tabName.startsWith('TODO_')) {
    throw new Error(`Kein Ziel-Tab für Partner "${partner}" konfiguriert (Config.gs).`);
  }
  const sheet = SpreadsheetApp.openById(config.sheetId).getSheetByName(config.tabName);
  if (!sheet) {
    throw new Error(`Tab "${config.tabName}" existiert nicht im Sheet von "${partner}" (umbenannt?).`);
  }
  return sheet;
}

// Spaltenüberschriften in den Partner-Sheets (müssen exakt so in Zeile 1 stehen).
// Stand 2026-08-13, an die echte Struktur der "AI Test Montageplanung"-Dummy-Sheets angepasst
// (weicht von der ursprünglichen Annahme "Name"/"Einspeisezählpunkt"/"Abgeschlossen" ab).
// "Deal-ID" ist NEU -- muss einmalig als zusätzliche Spalte in jedes Partner-Sheet eingefügt werden,
// das ist der stabile Schlüssel für den Sync (Name allein ist nicht eindeutig, siehe Analyse).
// Wird künftig schreibgeschützt für Partner (siehe protectDealIdColumn() in SetupHelpers.gs) --
// nur das Script darf reinschreiben, Partner sollen die Spalte nicht selbst bearbeiten können.
// Stand 2026-08-13, zweite Anpassung: "Geplante Montage" wurde durch die drei echten
// Pipedrive-Termine ersetzt (DC-Termin, AC-Termin, IB-Termin aus der "Terminübersicht" am Deal).
// Stand 2026-08-13, dritte Anpassung: Stufe 1 aus IDEEN-Felder-und-Aktionen.md -- Adresse/PLZ/
// Telefon/Anlagengröße/Speicher NEU. Werden einmalig bei Zeilen-Erstellung geschrieben (siehe
// RowCreation.gs), nicht Teil des 15-Minuten-Sync-Loops (Begründung dort). Müssen wie "Deal-ID"
// einmalig manuell als Spalten in jedes Partner-Sheet eingefügt werden, danach protectDealIdColumn()
// erneut ausführen, damit sie mitgeschützt werden.
const COL = {
  name: 'Kunden',
  adresse: 'Adresse',
  plz: 'PLZ',
  telefon: 'Telefon Kunde',
  module: 'Anlagengröße (Module)',
  speicher: 'Speicher (kWh)',
  zpn: 'Zählpunkt',
  dcTermin: 'DC Termin',
  acTermin: 'AC Termin',
  materiallieferung: 'Materiallieferung',
  ibTermin: 'IB Termin',
  fertigmeldung: 'Fertigmeldung',
  netzanmeldung: 'Netzanmeldung eingereicht',
  ibErledigt: 'IB erledigt',
  wunschtermin: 'Wunschtermin Partner',
  ordnerLink: 'Link zum Kundenordner',
  dealId: 'Deal-ID'
};

/**
 * Feld-Sync-Konfiguration: eine Zeile pro Feld, das zwischen Sheet und Pipedrive synct.
 * direction: 'sheet_to_pipedrive' | 'pipedrive_to_sheet' | 'off'
 * Neue Felder einfach als weiteren Eintrag hinzufügen -- z.B. später die Finance-Sheet-Häkchen
 * (Anzahlungsrechnung etc.), sobald das Finance-Sheet eine Deal-ID-Spalte hat und die
 * Pipedrive-Feldcodes dafür angelegt sind (siehe listDealFieldsHelper() in SetupHelpers.gs).
 */
const SYNC_FIELD_CONFIG = [
  {
    label: 'Einspeisezählpunkt (ZPN)',
    sheetColumnHeader: COL.zpn,
    pipedriveFieldKey: '86f6ce58bb7129c5c4e312038342f601713c7742',
    direction: 'sheet_to_pipedrive'
  },
  // DC-/AC-/IB-Termin: ECHTE Zwei-Wege-Synchronisierung (Valentins Vorgabe 2026-08-17) -- sowohl
  // RP (direkt in Pipedrive) als auch der Montagepartner (im Sheet) dürfen diese Termine setzen/
  // ändern, letzter Schreibvorgang gewinnt. Bewusst akzeptiertes Risiko: ändern beide fast
  // gleichzeitig, überschreibt der später laufende 15-Minuten-Sync die andere Änderung -- dagegen
  // gibt es hier keine Sperre. Deshalb NICHT mehr in protectDealIdColumn() geschützt (die schützt
  // nur noch echte pipedrive_to_sheet-Felder) und der onEdit-Trigger reagiert jetzt auch auf diese
  // drei Spalten.
  {
    label: 'DC-Termin',
    sheetColumnHeader: COL.dcTermin,
    pipedriveFieldKey: '6e4dc4e9017957ddadebddac3dd622ca3afe8676',
    direction: 'bidirektional'
  },
  {
    label: 'AC-Termin',
    sheetColumnHeader: COL.acTermin,
    pipedriveFieldKey: '0277ea7463b980044e0062e46467979ccc292127',
    direction: 'bidirektional'
  },
  {
    label: 'IB-Termin',
    sheetColumnHeader: COL.ibTermin,
    pipedriveFieldKey: 'ba820255728739b29c451287808fbe18f1c94b8e',
    direction: 'bidirektional'
  },
  {
    label: 'Materiallieferung',
    sheetColumnHeader: COL.materiallieferung,
    pipedriveFieldKey: 'c0a676d8db66f0cb6300e8160e1401355a226990', // Pipedrive-Feld heißt "Liefertermin"
    direction: 'pipedrive_to_sheet'
  },
  // R1+R2 aus IDEEN-Felder-und-Aktionen.md, die zwei "Anruf-Killer": Checkbox im Sheet, aber in
  // Pipedrive wird ein DATUM gespeichert statt true/false (siehe Abschnitt 1 dort) -- ein Datum
  // beantwortet ob UND wann, Pipedrive hat ohnehin keinen echten Boolean-Typ. valueType steuert
  // die Umwandlung in handleSingleCellEdit() (FieldSync.gs). Die Ordner-Verschiebung bei "Montage
  // abgeschlossen" passiert NICHT sofort hier, sondern verzögert über OrdnerAbschluss.gs.
  // Fertigmeldung setzt ZWEI Felder gleichzeitig (2026-08-17, Valentins Korrektur): das Datum
  // "Fertigmeldung am" UND Netzstatus="Fertigmeldung raus" -- beide in einem PATCH-Call, siehe
  // zusaetzlichesFeldBeimAnhaken-Handling in FieldSync.gs. Nur beim Anhaken, nicht beim Entfernen
  // (kein Zurücksetzen von Netzstatus, gleiche Regressions-Logik wie bei "Fortschritt").
  {
    label: 'Fertigmeldung',
    sheetColumnHeader: COL.fertigmeldung,
    pipedriveFieldKey: MONTAGE_ABGESCHLOSSEN_AM_FIELD_KEY,
    direction: 'sheet_to_pipedrive',
    valueType: 'checkbox_to_date',
    zusaetzlichesFeldBeimAnhaken: { fieldKey: NETZSTATUS_FIELD_KEY, wert: NETZSTATUS_OPTION_IDS.fertigmeldungRaus }
  },
  // Netzanmeldung eingereicht (2026-08-17, Valentins Übersichts-Spalte): Monteur hakt ab, sobald
  // er die Netzanmeldung eingereicht hat -- schreibt Netzstatus="eingereicht". BEWUSST OHNE
  // Aktivität beim Anhaken (anders als IB erledigt) -- Valentin sieht es direkt im Sheet, eine
  // Aktivität braucht es nur, wenn es NICHT rechtzeitig passiert (siehe NetzanmeldungEskalation.gs).
  {
    label: 'Netzanmeldung eingereicht',
    sheetColumnHeader: COL.netzanmeldung,
    pipedriveFieldKey: NETZSTATUS_FIELD_KEY,
    direction: 'sheet_to_pipedrive',
    valueType: 'checkbox_to_option',
    checkedOptionValue: NETZSTATUS_OPTION_IDS.eingereicht
  },
  // GEAENDERT 2026-08-17: schreibt NICHT mehr in "Fortschritt". Grund: das neue Projekt
  // "Fortschritt-Script" berechnet dort alle 15 Minuten eine Balken-Zeile
  // ("▰▰▰▰▱▱▱▱▱▱▱ 4/11 · Anzahlung da · wa:Kunde"). Zwei Schreiber auf einem Feld haetten sich
  // gegenseitig ueberschrieben -- "Fortschritt" gehoert ab jetzt allein dem Fortschritt-Script.
  //
  // Stattdessen ein eigenes Datumsfeld "IB erledigt am", genau nach dem Muster von "Fertigmeldung":
  //   - valueType checkbox_to_date existiert bereits, es ist KEIN Code-Fix in FieldSync.gs noetig
  //   - der Duplikat-Aktivitaets-Schutz weiter unten vergleicht den Pipedrive-Wert und funktioniert
  //     damit weiter. Haette man den Feld-Write einfach ganz entfernt, waere dieser Schutz
  //     weggefallen und jeder wiederholte Trigger haette eine neue Aktivitaet angelegt.
  //   - ein Datum beantwortet ob UND wann; das Fortschritt-Script leitet "IB erfolgt" daraus ab und
  //     zwar genauer als aus dem nur GEPLANTEN IB-Termin
  // Feld "IB erledigt am" (Typ Datum) am 2026-08-17 in Pipedrive angelegt. Derselbe field_code
  // steht in Fortschritt-Script/Config.gs als IB_ERLEDIGT_AM_FIELD_KEY -- beide muessen
  // uebereinstimmen, sonst schreibt der Partner in ein Feld, das dort niemand liest.
  {
    label: 'IB erledigt',
    sheetColumnHeader: COL.ibErledigt,
    pipedriveFieldKey: '6625e4db471a6601a70766facc04d2d421f89810',
    direction: 'sheet_to_pipedrive',
    valueType: 'checkbox_to_date',
    // Zusätzlich zum Feldwert eine Aktivität anlegen -- der eigentliche Anruf-Ersatz, weil RP es
    // aktiv im Deal-Verlauf/der Aufgabenliste sieht statt nur einen still geänderten Feldwert.
    // Valentins Vorgabe 2026-08-13: "Aktivität müssen wir machen!"
    erzeugtAktivitaetBeimAnhaken: true
  },
  // R6 aus IDEEN-Felder-und-Aktionen.md: reine Partner<->RP-Terminabstimmung (der Kunde bestätigt
  // weiterhin manuell per Mail/Telefon wie heute -- das automatisieren ist eine eigene, spätere
  // Entscheidung Richtung Terminfindung-Projekt, siehe [[project_rp_terminfindung]]). Partner trägt
  // hier nur seinen Terminvorschlag ein, RP bestätigt/ändert das dann direkt in Pipedrive.
  // TODO: Pipedrive-Feldcode eintragen -- erst listDealFieldsHelper() laufen lassen (evtl. schon
  // unter den 33 Fulfillment-Feldern vom 10.08. dabei), sonst neues Datumsfeld in Pipedrive anlegen.
  {
    label: 'Wunschtermin Partner',
    sheetColumnHeader: COL.wunschtermin,
    pipedriveFieldKey: 'TODO_WUNSCHTERMIN_FIELD_KEY',
    direction: 'sheet_to_pipedrive'
  }
  // Weitere Felder hier ergänzen, sobald gebraucht (z.B. Finance-Sheet-Häkchen).
];

// Wenn true: nichts wird geschrieben, nur geloggt was passieren würde
const DRY_RUN = true;

// ===== HILFSFUNKTIONEN (Pipedrive) =====

function getApiToken() {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN fehlt in den Script Properties (Projekteinstellungen prüfen).');
  return token;
}

function fetchPipedrive(path) {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`;
  return callPipedriveWithRetry(() => UrlFetchApp.fetch(url, {
    headers: { 'x-api-token': getApiToken() },
    muteHttpExceptions: true
  }), path);
}

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
 * Legt eine Pipedrive-Aktivität am Deal an -- der eigentliche Anruf-Ersatz für Meldungen wie
 * "IB erledigt": statt nur einen Feldwert still zu ändern, taucht das im Deal-Verlauf und in
 * RPs Aufgabenliste auf. ownerId optional -- wenn gesetzt, wird die Aktivität dem Deal-Owner
 * zugewiesen, sonst legt Pipedrive sie beim API-Token-Owner an.
 */
function erstellePipedriveAktivitaet(dealId, subject, ownerId, typ) {
  const payload = {
    subject,
    deal_id: dealId,
    type: typ || AKTIVITAET_TYP_IB_ERLEDIGT,
    done: false,
    due_date: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
  };
  if (ownerId) payload.owner_id = ownerId;
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/activities`;
  return callPipedriveWithRetry(() => UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { 'x-api-token': getApiToken() },
    muteHttpExceptions: true
  }), 'activities');
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
      Utilities.sleep(1000 * Math.pow(2, attempt));
      continue;
    }
    throw new Error(`Pipedrive API-Fehler ${code} bei "${path}": ${response.getContentText()}`);
  }
}

// ===== HILFSFUNKTIONEN (Sheet) =====

/** Findet die Spaltennummer (1-basiert) einer Überschrift in Zeile 1. null wenn nicht gefunden. */
function findColumnIndexByHeader(sheet, headerText) {
  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = headerRow.findIndex(h => String(h).trim() === headerText);
  return idx === -1 ? null : idx + 1;
}

/** Findet die Zeilennummer (1-basiert) für eine gegebene Deal-ID. null wenn nicht gefunden. */
function findRowByDealId(sheet, dealIdColIndex, dealId) {
  const values = sheet.getRange(2, dealIdColIndex, Math.max(sheet.getLastRow() - 1, 0), 1).getValues();
  const rowOffset = values.findIndex(r => String(r[0]) === String(dealId));
  return rowOffset === -1 ? null : rowOffset + 2;
}

/**
 * Findet die nächste Zeile, in der die angegebenen Spalten alle leer sind -- damit neue Zeilen
 * nicht versehentlich in fremden Inhalt geschrieben werden (z.B. wenn unter den Datenzeilen noch
 * eine Summen-/Notizzeile steht, die getLastRow() mitzählen würde). Bricht mit Fehler ab statt
 * unendlich zu suchen, falls im Sheet etwas grundlegend anders aussieht als erwartet.
 */
function findNextEmptyRowFor(sheet, colIndexes) {
  const maxScan = sheet.getMaxRows();
  for (let row = 2; row <= maxScan + 1; row++) {
    const istLeer = colIndexes.every(col => {
      if (row > sheet.getMaxRows()) return true; // jenseits der aktuellen Sheet-Grenze = definitiv leer
      return sheet.getRange(row, col).getValue() === '';
    });
    if (istLeer) return row;
  }
  throw new Error(`Keine leere Zeile in "${sheet.getName()}" gefunden (bis Zeile ${maxScan}) -- Sheet-Struktur manuell prüfen.`);
}

// ===== LOGGING =====
// Gepuffert statt appendRow pro Zeile: ein appendRow ist ein einzelner Sheets-Schreibvorgang,
// und syncPipedriveToSheetFields() kann pro Lauf vierstellig viele Zeilen erzeugen (im DRY-Lauf
// jedes Mal aufs Neue, weil ja nichts geschrieben wird). Gepuffert ist es EIN setValues().

const LOG_HEADER = [
  'Zeitstempel', 'Lauf-ID', 'Funktion', 'Modus', 'Aktion',
  'Deal-ID', 'Partner/Sheet', 'Feld', 'Ergebnis', 'Detail'
];

// Neue Property (V2), weil das bestehende Log-Sheet die alte 7-Spalten-Kopfzeile hat.
// Das alte Sheet bleibt erhalten, es wird nur nicht mehr beschrieben.
const PROP_LOG_SHEET_ID = 'SHEETSYNC_LOG_SHEET_ID_V2';

let _logSheetCache = null;
let _logBuffer = [];
let _laufId = '-';
let _laufFunktion = '-';
let _laufStart = 0;

/**
 * Am Anfang JEDER Einstiegsfunktion aufrufen. Vergibt eine kurze Lauf-ID, die in jeder Zeile
 * dieses Laufs steht -- damit lässt sich aus einer FEHLER-Zeile heraus per Filter der komplette
 * Lauf ansehen. Nötig, weil fünf verschiedene Funktionen (zwei davon zeitgleich) in dasselbe
 * Log-Sheet schreiben.
 */
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
    ss = SpreadsheetApp.create('LOG_Sheet-Sync (V2)');
    props.setProperty(PROP_LOG_SHEET_ID, ss.getId());
    ss.getActiveSheet().appendRow(LOG_HEADER);
    Logger.log(`Neues Log-Sheet angelegt: ${ss.getUrl()}`);
  }
  _logSheetCache = ss.getActiveSheet();
  return _logSheetCache;
}

/**
 * aktion: 'sheet→pipedrive' | 'pipedrive→sheet' | 'zeile anlegen' | 'drive' | 'aktivität' | 'lauf'
 * Bewusst NICHT mehr "Richtung": OrdnerAbschluss und NetzanmeldungEskalation schreiben gar nichts
 * ins Sheet, standen aber trotzdem auf 'pipedrive_to_sheet'.
 */
function logRow(aktion, dealId, partnerOderSheet, feld, ergebnis, detail) {
  _logBuffer.push([
    new Date(), _laufId, _laufFunktion, DRY_RUN ? 'DRY' : 'LIVE', aktion,
    dealId || '', partnerOderSheet || '', feld || '', ergebnis, detail || ''
  ]);
}

/**
 * Eine Zeile pro Lauf -- die einzige, die man täglich anschauen muss, und die spätere
 * Dashboard-Zeile. status: 'OK' | 'KETTE_BLOCKIERT' | 'FEHLER'
 */
function logLaufEnde(status, summary) {
  const dauer = Math.round((Date.now() - _laufStart) / 1000);
  logRow('lauf', null, null, null, status, `${JSON.stringify(summary)} -- ${dauer}s`);
  Logger.log(`[${_laufId}] ${_laufFunktion} ${status}: ${JSON.stringify(summary)} (${dauer}s)`);
}

function flushLog() {
  if (_logBuffer.length === 0) return;
  const sheet = getLogSheet();
  sheet.getRange(sheet.getLastRow() + 1, 1, _logBuffer.length, LOG_HEADER.length).setValues(_logBuffer);
  _logBuffer = [];
}

/** Werte für Notizen/Logs lesbar machen -- niemals "null" oder "undefined" an eine Zelle. */
function zeigeWert(w) {
  if (w === null || w === undefined || w === '') return '(leer)';
  // Sheets liefert Datumszellen als echtes Date-Objekt -- ungefiltert würde String(w) den vollen
  // JS-Zeitstempel inkl. Wochentag/Uhrzeit/Zeitzone ausgeben ("Tue Aug 18 2026 00:00:00 GMT+0200
  // (Central European Summer Time)"), was in einer Notiz/einem Log niemand lesen will.
  if (w instanceof Date) return Utilities.formatDate(w, Session.getScriptTimeZone(), 'dd.MM.yyyy');
  return String(w);
}

/** Einheitlicher Zeitstempel für alle Zell-Notizen. */
function notizZeitstempel() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm');
}

/**
 * Setzt eine Notiz an einer bestimmten Spalte in der Sheet-Zeile eines Deals. Für Vorgänge, die
 * NICHT vom Sheet ausgehen (Ordner-Archivierung, Eskalation) -- der Partner soll trotzdem im
 * Sheet sehen, dass etwas passiert ist, statt es per Anruf zu erfahren. Schluckt Fehler bewusst:
 * eine fehlende Notiz darf den eigentlichen Vorgang nie scheitern lassen.
 */
function setzeNotizAmDeal(deal, partner, spaltenHeader, text) {
  if (DRY_RUN || !partner) return;
  try {
    const sheet = openPartnerSheet(partner);
    const dealIdCol = findColumnIndexByHeader(sheet, COL.dealId);
    const col = findColumnIndexByHeader(sheet, spaltenHeader);
    if (!dealIdCol || !col) return;
    const row = findRowByDealId(sheet, dealIdCol, deal.id);
    if (!row) return;
    sheet.getRange(row, col).setNote(text);
  } catch (e) {
    Logger.log(`Notiz für Deal ${deal.id} konnte nicht gesetzt werden: ${e.message}`);
  }
}
