// ===== KONFIGURATION =====
// TODO-Marker unten sind Werte, die nur Valentin im Pipedrive-Admin nachschauen/anlegen kann.
// Ohne die TODOs ausgefüllt zu haben läuft das Script nicht (wirft beim Start einen klaren Fehler).

const PIPEDRIVE_DOMAIN = 'rp-energietechnik';

/** Dreht ein {Label: OptionsID}-Objekt um, Keys immer als String (Pipedrive liefert IDs mal als Zahl, mal als String). */
function invertOptionMap(map) {
  return Object.fromEntries(Object.entries(map).map(([name, id]) => [String(id), name]));
}

/** Wie invertOptionMap, aber für ein verschachteltes {Feldname: {Label: OptionsID}}-Objekt (siehe DACH2_OPTION_IDS/DACH3_OPTION_IDS). */
function invertNestedOptionMap(nestedMap) {
  return Object.fromEntries(Object.entries(nestedMap).map(([key, map]) => [key, invertOptionMap(map)]));
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

const AUSFUEHRUNGSART_FIELD_KEY = 'cc80ad5daf0788dba60b3da3931681edd3dd2c87'; // enum
const AUSFUEHRUNGSART_OPTION_IDS = { 'Full Service': 154, 'Selbstmontage': 155, 'Hybrid': 156 };
const AUSFUEHRUNGSART_ID_TO_NAME = invertOptionMap(AUSFUEHRUNGSART_OPTION_IDS);

const DACHFORM_FIELD_KEY = '71ee37fc98c338877d435f4d77f409367c013451'; // enum
const DACHFORM_OPTION_IDS = { 'Satteldach': 88, 'Walmdach': 89, 'Pultdach': 90, 'Flachdach': 91 };
const DACHFORM_ID_TO_NAME = invertOptionMap(DACHFORM_OPTION_IDS);

const EINDECKUNG_FIELD_KEY = '2e8cc4c7d0592a418a58394a470e3386d125654a'; // enum
const EINDECKUNG_OPTION_IDS = {
  'Ziegeldach': 92, 'Blechdach Trapez': 93, 'Blechdach Falz': 94, 'Welleternit': 95,
  'Flachdach (Kies)': 96, 'Flachdach (Beton)': 97, 'Flachdach (begrünt)': 98,
  'Zaun': 251, 'Fassade': 252, 'Rhombus Eternit': 253, 'Prefa': 254, 'Sandwichpaneele': 255
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

// Neue Felder (25.08.2026): wer hat das Elektro-/Kleinmaterial bezahlt bzw. organisiert. Beide enum,
// aber mit EIGENEN Options-IDs pro Feld (per zeigeElektromaterialFelder() verifiziert -- die IDs sind
// trotz gleicher 4 Labels NICHT zwischen den beiden Feldern geteilt).
const ELEKTROMATERIAL_GEZAHLT_FIELD_KEY = '1a352d7b69ffb99c05960d51b225c8bfaa422d82'; // "Elektromaterial gezahlt von"
const ELEKTROMATERIAL_GEZAHLT_OPTION_IDS = { 'RP': 178, 'Montagepartner': 179, 'Kunde': 180, 'noch offen': 181 };
const ELEKTROMATERIAL_GEZAHLT_ID_TO_NAME = invertOptionMap(ELEKTROMATERIAL_GEZAHLT_OPTION_IDS);

const ELEKTROMATERIAL_ORGANISIERT_FIELD_KEY = '767eb0f43cd9f52d8a06c113294adb2cc521e234'; // "Elektromaterial organisiert von"
const ELEKTROMATERIAL_ORGANISIERT_OPTION_IDS = { 'RP': 256, 'Montagepartner': 257, 'Kunde': 258, 'noch offen': 259 };
const ELEKTROMATERIAL_ORGANISIERT_ID_TO_NAME = invertOptionMap(ELEKTROMATERIAL_ORGANISIERT_OPTION_IDS);

// ===== Netzanmeldung-Baustein (07.09.2026, siehe project_pv_netzanmeldung_formular) =====
// Noch nirgends im Code verwendet -- das Doc-Template/die Generierungsfunktion für die
// Netzanmeldung ist noch nicht gebaut, das hier sind nur die per SETUP_EINMALIG_
// createNetzanmeldungFields() (SetupHelper.js) frisch angelegten field_codes.
const NEUANLAGE_ERWEITERUNG_FIELD_KEY = '8bc19dfdb1f3135f1babe069f2f9bfba1b347c40'; // enum
const NEUANLAGE_ERWEITERUNG_OPTION_IDS = { 'Neuanlage (Einspeisung)': 330, 'Erweiterung': 331 };
const NEUANLAGE_ERWEITERUNG_ID_TO_NAME = invertOptionMap(NEUANLAGE_ERWEITERUNG_OPTION_IDS);

const ALTANLAGE_PHOTOVOLTAIK_FIELD_KEY = '37024fdad766c10171daa9c1076098e40f4a322e'; // varchar, Freitext
const ALTANLAGE_WECHSELRICHTER_FIELD_KEY = '8f5e870d01746e8a68812de2ed3993f57fffafce'; // varchar, Freitext
const ALTANLAGE_SPEICHER_FIELD_KEY = '0b6f2e9dd10869ff362f6394bd0f31da20a8ed33'; // varchar, Freitext

// ===== Zusätzliches Dach 2 / Dach 3 (27.08.2026, siehe FieldSetup2_3.js) =====
// Eigene Custom Fields pro Zusatzdach (Präfix 2_/3_), NICHT in CONTENT_FIELDS aufgenommen -- die
// meisten Deals haben nur ein Dach, als Pflicht-/optionale Felder würden sie die "Leere Felder"-
// Log-Spalte bei praktisch jedem Deal mit denselben 11 harmlosen Einträgen fluten (gleiches
// Signalverlust-Problem wie bei den Elektromaterial-Feldern oben, nur ~10x größer). Werden nur in
// buildProjectDoc() gelesen, dort steuert appendZusatzDachSection() selbst, ob die Sektion überhaupt
// erscheint (nur wenn mindestens eines der 11 Felder befüllt ist).
const DACH2_FIELD_KEYS = {
  Dachform: 'c8303d94b203ad1e69d14e1340dd0905b0945527',
  Eindeckung: 'fd0496d6545d8df09178db81c0d0d5c6dff1e153',
  Dachneigung: '31fffade4a6027dac532268ef8a8aad95c31a1d3',
  Gebaeudehoehe: '6570fddca1f813462310ccbb9a0873cf69cd5039',
  Unterkonstruktion: '5b85ab937d77d0f7aa169c4ec6c08019d117a722',
  HoeheSparren: '46824bcf0877083c2eb0bdfa9988f21685950a29',
  BreiteSparren: '314e28a58bc3ccfbb57dba335e545161b2f3a926',
  KabelwegDC: '047a48b926c41cb7a3db9e115f9a44c9c4795e7a',
  KabelwegAC: 'e7aa71d41c5e4991443238894a14dc9c911bfafb',
  Stoerflaechen: '0b8f6c91b386f2887f98d230a7c4d6baa4125a6b',
  Blitzschutz: '35b6f35f87e2597e00b1b635782cfef69d843c69'
};
const DACH2_OPTION_IDS = {
  Dachform: { 'Satteldach': 260, 'Walmdach': 261, 'Pultdach': 262, 'Flachdach': 263 },
  Eindeckung: {
    'Ziegeldach': 268, 'Blechdach Trapez': 269, 'Blechdach Falz': 270, 'Welleternit': 271,
    'Flachdach (Kies)': 272, 'Flachdach (Beton)': 273, 'Flachdach (begrünt)': 274, 'Flachdach (Folie)': 312,
    'Zaun': 275, 'Fassade': 276, 'Rhombus Eternit': 277, 'Prefa': 278, 'Sandwichpaneele': 279
  },
  Unterkonstruktion: { 'Sparren': 292, 'Pfetten': 293 },
  Stoerflaechen: { 'Ja': 296, 'Nein': 297 },
  Blitzschutz: { 'Ja': 300, 'Nein': 301 }
};
const DACH2_ID_TO_NAME = invertNestedOptionMap(DACH2_OPTION_IDS);

const DACH3_FIELD_KEYS = {
  Dachform: '8cb292554b13f9c215c9f88a270ae3557c4888c7',
  Eindeckung: 'e3a93ba369b28ec74975d39d1ebba07c31a41ef4',
  Dachneigung: 'a47295a2e9d5c7d123411805b95c043a9f3df410',
  Gebaeudehoehe: '79b612b911d8adf6e1aee84dea618e863602d4ae',
  Unterkonstruktion: 'a2f9b2c4116b3c747cdfa7281e83c175dce05ee3',
  HoeheSparren: '9f2ed5f968541aa09b72d5f70cb3e7dce810431c',
  BreiteSparren: '1bfd2e69b7eb773b5c1a24d3bc04ab0ffee2c861',
  KabelwegDC: 'be74cec3f51bb26ef00b18398d01811f316722bc',
  KabelwegAC: '9fe5d28e685a7419452854a1180acb88147e0567',
  Stoerflaechen: '6310ac31f713741159d35178ce35ca21f05221a0',
  Blitzschutz: '0358b3582b05663751d6db40d5261592c80dcc8e'
};
const DACH3_OPTION_IDS = {
  Dachform: { 'Satteldach': 264, 'Walmdach': 265, 'Pultdach': 266, 'Flachdach': 267 },
  Eindeckung: {
    'Ziegeldach': 280, 'Blechdach Trapez': 281, 'Blechdach Falz': 282, 'Welleternit': 283,
    'Flachdach (Kies)': 284, 'Flachdach (Beton)': 285, 'Flachdach (begrünt)': 286, 'Flachdach (Folie)': 313,
    'Zaun': 287, 'Fassade': 288, 'Rhombus Eternit': 289, 'Prefa': 290, 'Sandwichpaneele': 291
  },
  Unterkonstruktion: { 'Sparren': 294, 'Pfetten': 295 },
  Stoerflaechen: { 'Ja': 298, 'Nein': 299 },
  Blitzschutz: { 'Ja': 302, 'Nein': 303 }
};
const DACH3_ID_TO_NAME = invertNestedOptionMap(DACH3_OPTION_IDS);

// Alle Inhaltsfelder, die im Doc landen -- für den Vollständigkeits-Check im Log (siehe
// checkFieldCompleteness). Reihenfolge/Label muss NICHT zur Doc-Reihenfolge passen, nur zur
// Lesbarkeit im Log-Sheet.
const CONTENT_FIELDS = [
  { key: NETZANSUCHEN_FIELD_KEY, label: 'Netzansuchen' },
  { key: AUSFUEHRUNGSART_FIELD_KEY, label: 'Ausführungsart', optional: true },
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
  { key: NOTIZEN_KUNDE_FIELD_KEY, label: 'Sonstige Mitteilung Kunde', optional: true },
  // Neue Felder, bei bereits laufenden Deals im Regelfall noch leer -- zählen deshalb NICHT als
  // Pflichtfeld mit, sonst zeigt "Leere Felder" im Log-Sheet ab sofort dauerhaft diese zwei.
  { key: ELEKTROMATERIAL_GEZAHLT_FIELD_KEY, label: 'Elektromaterial gezahlt von', optional: true },
  { key: ELEKTROMATERIAL_ORGANISIERT_FIELD_KEY, label: 'Elektromaterial organisiert von', optional: true },
  // Netzanmeldung-Baustein (07.09.2026): bei bestehenden Deals noch nicht befüllt, gleiches Prinzip
  // wie bei den Elektromaterial-Feldern oben -- optional, sonst Log-Rauschen ab sofort für alle Altdeals.
  { key: NEUANLAGE_ERWEITERUNG_FIELD_KEY, label: 'Neuanlage oder Erweiterung', optional: true },
  { key: ALTANLAGE_PHOTOVOLTAIK_FIELD_KEY, label: 'Altanlage Photovoltaik', optional: true },
  { key: ALTANLAGE_WECHSELRICHTER_FIELD_KEY, label: 'Altanlage Wechselrichter', optional: true },
  { key: ALTANLAGE_SPEICHER_FIELD_KEY, label: 'Altanlage Speicher', optional: true }
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
    // NETZWERKFEHLER-RETRY (15.09.2026): muteHttpExceptions faengt nur HTTP-Statuscodes ab,
    // KEINE Netzwerkfehler. Bei Zeitueberschreitung wirft UrlFetchApp.fetch() selbst
    // ("Exception: Timeout: <url>"), noch bevor es eine Response gibt -- das lief an der
    // Statuscode-Schleife unten vorbei und riss den ganzen Lauf ab. Zuerst am 11.09.2026 in
    // Sheet-Sync/syncNeueZeilen() aufgeschlagen, das Muster steckte in allen Projekten.
    // Ueber diesen Helfer laufen nur GET und PATCH (fetchPipedrive, fetchPipedriveRaw,
    // patchPipedrive) -- beide gefahrlos wiederholbar. Die POST-Aufrufe des Projekts
    // (Webhook-Registrierung, Feld-Setup) sind Einmal-Funktionen und gehen direkt an
    // UrlFetchApp, nicht hier durch. Kommt hier je ein anlegender POST dazu, braucht er ein
    // wiederholbar=false wie in Ordnererstellung/SetterInfoNotiz.gs -- sonst Duplikate.
    let response;
    try {
      response = doFetch();
    } catch (e) {
      if (attempt === maxAttempts) {
        throw new Error(`Pipedrive-Netzwerkfehler bei "${path}": ${e.message}`);
      }
      Utilities.sleep(1000 * Math.pow(2, attempt));
      continue;
    }
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
