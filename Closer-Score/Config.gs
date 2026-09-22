// ============================================================
// KONFIGURATION — Closer-Score
// ============================================================
// Zweck: Wer einen Deal ins Fulfillment uebergibt, bekommt 48 h spaeter eine
// Slack-DM mit Ampel, Punktzahl und der Liste dessen, was gefehlt hat.
// Rein informativ. Es haengt nichts daran — der Effekt ist Erziehung.
//
// Bewertet wird der Presale/Closer. ⚠️ Hier stand bis 17.09.2026 "der
// Deal-BESITZER (owner_id)" — das war falsch: die Fulfillment-Übernahme haengt
// owner_id auf Valentin um (85 von 86 Deals). Massgeblich ist jetzt
// CLOSER_FELD, siehe unten.
//
// Das Script schreibt NIE nach Pipedrive. Ausschliesslich GET. Die einzige
// Schreiboperation ueberhaupt ist die Slack-DM.
//
// Spec: docs/SPEC-Closer-Score.md
// Feldwahrheit: docs/DUMP-dealFields-2026-09-15.md (bei Widerspruch gilt der Dump)

// ---------- Betrieb ----------

// true = Simulation. Es wird gelesen, gescored und geloggt, aber KEINE DM
// verschickt und der Zustand NICHT fortgeschrieben. Der DRY-Vollauf ist das
// Messinstrument: erst messen, dann scharf schalten.
const DRY_RUN = false;

// TESTWOCHE ab 22.09.2026. Solange das true ist, geht JEDE DM an Valentin —
// egal was in CLOSER_SLACK_IDS steht. Der Text nennt im Fuss, an wen sie im
// Echtbetrieb gegangen waere. Damit laeuft das Script eine Woche scharf mit,
// ohne dass ein Closer etwas sieht.
// Zum Scharfschalten: auf false setzen. Vorher CLOSER_SLACK_IDS befuellen,
// sonst landet weiterhin alles bei Valentin (dann aber mit Mapping-Warnung).
const TEST_ALLES_AN_MICH = true;

// Reifezeit: so lange nach der Erst-Sichtung wird gewartet, bevor gescored
// wird. Fotos und Notizen kommen oft am Tag danach nach — sofort messen
// erzeugt ungerechte Rotmeldungen.
const REIFEZEIT_MS = 48 * 60 * 60 * 1000;

// Weicher Ausstieg vor dem 6-Min-Limit, gleiches Muster wie Lieferkalender-Slack.
const MAX_LAUFZEIT_MS = 4.5 * 60 * 1000;

// ---------- Pipedrive ----------

const PIPEDRIVE_BASE = 'https://rp-energietechnik.pipedrive.com/api/v2';
const PIPEDRIVE_BASE_V1 = 'https://rp-energietechnik.pipedrive.com/v1';
const DEAL_URL_BASE = 'https://rp-energietechnik.pipedrive.com/deal/';
const PIPELINE_ID = 2; // Fulfillment

function getPipedriveToken() {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN fehlt in den Script Properties.');
  return token;
}

// ---------- Slack ----------

const SLACK_API_BASE = 'https://slack.com/api';

// Bot "Ernst", Scopes chat:write + chat:write.public.
// DM-Trick (aus Lieferkalender-Slack/Config.gs): eine USER-ID (U...) direkt als
// `channel` uebergeben. Kein conversations.open, kein Zusatz-Scope noetig.
function getSlackToken() {
  const token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  if (!token) throw new Error('SLACK_BOT_TOKEN fehlt in den Script Properties.');
  return token;
}

const VALENTIN_USER_ID = 'U0BM9J0KPQT';

// ---------- Wer ist der Closer? ----------

// Das Top-Level-Deal-Feld, aus dem der Empfaenger gelesen wird.
//
// Belegt durch diagnoseCloserFelder() am 17.09.2026 ueber alle 86
// qualifizierten Deals — nur zwei Felder am Deal enthalten ueberhaupt
// Menschen, und nur eines unterscheidet sie:
//
//   owner_id         2 verschiedene: Valentin 85x, Marco 1x
//                    -> die Fulfillment-Uebernahme haengt den Deal um.
//                       Als Empfaenger unbrauchbar.
//   creator_user_id  5 verschiedene: Marco 74x, André 8x, Manuel 2x,
//                    Sean 1x, Sergen 1x — bei 0 von 86 Deals leer.
//
// ⚠️ OFFEN: creator_user_id ist streng genommen "wer den Deal ANGELEGT hat",
// nicht "wer verkauft hat". Dass Marco auf 74 von 86 kommt, passt zu einem
// Anlage-Account, nicht zu einer Verkaufsverteilung. Solange das nicht geklaert
// ist, ist dieses Feld die beste verfuegbare Naeherung — nicht die Wahrheit.
const CLOSER_FELD = 'creator_user_id';

// Pipedrive-User-ID (Wert aus CLOSER_FELD) -> Slack-User-ID.
// NOCH LEER. Befuellen ueber:
//   1. listePipedriveUser()  -> loggt ID, Name, E-Mail aller Pipedrive-User
//   2. Slack-Profil des Kollegen -> "Mitglieds-ID kopieren"
// Bewusst hart hinterlegt statt ueber users:read.email aufgeloest — das waere
// ein zusaetzlicher Scope fuer eine Handvoll Leute.
// Ein Closer OHNE Eintrag bekommt keine DM ins Leere: die Nachricht geht mit
// einem Hinweis an Valentin, damit nichts still verschwindet.
// Diese fuenf tauchen laut Diagnose 17.09.2026 in creator_user_id auf. Die
// Pipedrive-IDs liefert listePipedriveUser(), die Slack-IDs das Slack-Profil
// des Kollegen ("Mitglieds-ID kopieren"). Erst wenn beide dastehen, geht die
// DM an den Richtigen — bis dahin landet alles bei Valentin mit Hinweis.
const CLOSER_SLACK_IDS = {
  // <Pipedrive-ID>: 'U01ABCDEF',   // Marco Benhammadi   (74 von 86 Deals)
  // <Pipedrive-ID>: 'U01ABCDEF',   // André Rechberger   (8)
  // <Pipedrive-ID>: 'U01ABCDEF',   // Manuel Wimmer      (2)
  // <Pipedrive-ID>: 'U01ABCDEF',   // Sean Golubovic     (1)
  // <Pipedrive-ID>: 'U01ABCDEF',   // Sergen Caf         (1)
};

// ---------- Torwaechter ----------

// Schreibt AUSSCHLIESSLICH der sevdesk->Pipedrive-Sync, und nur wenn er ueber
// Angebots- oder Kundennummer einen angenommenen Auftrag gefunden hat.
// Befuellt heisst deshalb zweierlei auf einmal: Angebot auf sevdesk angenommen
// UND sevdesk-Kunden-ID im Deal stimmt. Genau der Torwaechter, den Valentin
// wollte — und er kostet keinen einzigen sevdesk-API-Call.
const FELD_SEVDESK_SUMMARY = 'a38455087829e67f22cb5217a44c3cf31f39bcbc';

// ⚠️ Bewusst NICHT als Torwaechter benutzt: status === 'won'. Der wird bei RP
// schon BEI DER ANLAGE gesetzt (Origin Marketplace/Zapier, Befund D20 in
// REFERENZ-Pipedrive-AppsScript.md). 'won' und 'won_time' tragen kein Signal.
// Der echte Beweis ist pipeline_id === 2: dorthin verschiebt die Automatisierung
// den Deal nur, wenn er korrekt eingetragen wurde.

// ---------- Die Bewertung ----------

// Die drei Themen, in denen die Slack-Nachricht gegliedert ist. Ein Block mit
// zehn Stichpunkten ist fuer den Closer nicht lesbar — drei Themen mit je einem
// Punktestand sind es. Die Reihenfolge hier ist die Reihenfolge in der DM und
// folgt dem Gespraechsverlauf: erst das Dach, dann das Geld, dann die Papiere.
const GRUPPEN = ['Dach & Anlage', 'Förderung & Finanzierung', 'Unterlagen & Notizen'];

// Reihenfolge innerhalb der Gruppe = Reihenfolge in der Slack-Nachricht.
// typ: 'enum' | 'set' | 'text' | 'zahl'
// gruppe: muss exakt einer der Eintraege aus GRUPPEN sein.
const SCORE_FELDER = [
  { label: 'Neuanlage oder Erweiterung', code: '8bc19dfdb1f3135f1babe069f2f9bfba1b347c40', typ: 'enum', punkte: 3, gruppe: 'Dach & Anlage' },
  { label: 'Ausführungsart',             code: 'cc80ad5daf0788dba60b3da3931681edd3dd2c87', typ: 'enum', punkte: 3, gruppe: 'Dach & Anlage' },
  { label: 'Ausrichtung',                code: '7ba65cad11182422467e4923292422b601f6da80', typ: 'set',  punkte: 3, gruppe: 'Dach & Anlage' },
  { label: 'Dachform',                   code: '71ee37fc98c338877d435f4d77f409367c013451', typ: 'enum', punkte: 3, gruppe: 'Dach & Anlage' },
  { label: 'Eindeckung des Daches',      code: '2e8cc4c7d0592a418a58394a470e3386d125654a', typ: 'enum', punkte: 3, gruppe: 'Dach & Anlage' },
  { label: 'Förderstatus',               code: 'fe61797bd9d9e4990a2f5735b8c4de1919c7fa11', typ: 'enum', punkte: 3, gruppe: 'Förderung & Finanzierung' },
  { label: 'Finanzierung gewünscht?',    code: '8be8531405aa97034d8774d994903acca30f62af', typ: 'enum', punkte: 3, gruppe: 'Förderung & Finanzierung' },
  { label: 'Besondere Wünsche / Must knows', code: '896c816c7fa5ee755c279a9d4f8617e6ee48861a', typ: 'text', punkte: 2, gruppe: 'Unterlagen & Notizen' },
  { label: 'Projektdoku-Notizen',        code: '2565f8005e57f0b6bad0a36560f9f3213beffe98', typ: 'text', punkte: 2, gruppe: 'Unterlagen & Notizen' }
];

// Die beiden zusammengesetzten Posten haengen ebenfalls je an einer Gruppe.
const GRUPPE_FINANZIERUNG_DETAILS = 'Förderung & Finanzierung';
const GRUPPE_CHECKLISTE = 'Unterlagen & Notizen';

// Punkte je Gruppe: Dach & Anlage 15 | Förderung & Finanzierung 6 (9 mit
// Finanzierungs-Details) | Unterlagen & Notizen 7. Summe 28 bzw. 31.

// ⚠️ Nur DACH 1. Die 2_/3_-Felder (Mehrfach-Dach, live seit 27.08.) bleiben
// bewusst aussen vor: es gibt kein Feld "Anzahl Daecher", also waeren bei jedem
// Ein-Dach-Deal — also fast allen — Dach 2 und 3 leer und der Score dauerhaft rot.

// Finanzierung: die drei Detailfelder werden NUR verlangt, wenn in
// "Finanzierung gewünscht?" Ja (305) steht. Bei Nein (304) oder
// "nur als Vergleich" (306) entfallen sie komplett — sie zaehlen dann weder
// als erreicht noch als moeglich, das Maximum sinkt von 31 auf 28.
// Rechenweg: 7 Felder a 3 = 21, + Must-knows 2 + Projektnotizen 2 = 25,
// + Checkliste max 3 = 28 (ohne Finanzierung), + F-Details 3 = 31 (mit).
const FINANZIERUNG_FELD = '8be8531405aa97034d8774d994903acca30f62af';
const FINANZIERUNG_JA_ID = 305;

// ⚠️ F-Laufzeit ist varchar, NICHT double. Laut Closing-Cheatsheet gehoert dort
// "0" hinein, wenn mit dem Kunden nichts besprochen wurde. Leer ist also nicht
// dasselbe wie "0" — "0" zaehlt als ausgefuellt, leer nicht.
const FINANZIERUNG_DETAILS = [
  { label: 'F-Rate',      code: 'ee906b7561b905af2bf94ed50c5c8e03f250f5bc', typ: 'zahl' },
  { label: 'F-Laufzeit',  code: 'f3f7304afc47b2120199fb20283592f88cfc8992', typ: 'text' },
  { label: 'F-Anzahlung', code: '58772eeb2015a5cae0fe22fb1fda67db64e82ce1', typ: 'zahl' }
];

// Kunden-Dokumente/Fotos Checkliste (set). Bewertet wird DER HAKEN, nicht die
// Datei: ob wirklich ein Dachfoto haengt, prueft das Script nicht — das waere
// Bildklassifikation und ein eigenes Projekt. Der Haken ist die Selbstauskunft,
// und genau die soll erzogen werden.
// "Sonstiges" (310) zaehlt bewusst NICHT mit.
const CHECKLISTE_FELD = '36e7b14b2dff4ad584f875a4a5892ea0821e5f0d';
const CHECKLISTE_PFLICHT = [
  { id: 307, label: 'Stromrechnung (Zählpunkt)' },
  { id: 308, label: 'Dachfotos' },
  { id: 309, label: 'Zählerkasten' }
];

// Ampel-Schwellen PROZENTUAL vom jeweils gueltigen Maximum, damit ein Deal ohne
// Finanzierung (Max 28) nicht haerter bewertet wird als einer mit (Max 31).
// ⚠️ Korrektur 16.09.2026: der DRY-Vollauf hat gezeigt, dass die Maxima 28/31
// sind, nicht 25/28 — die urspruengliche Rechnung hatte die Checkliste vergessen.
// Die ANTEILE bleiben unveraendert, nur ihre Begruendung war falsch.
// Gruen ab 89 %: 25 von 28 (ohne Finanzierung) bzw. 28 von 31 (mit).
// Gelb  ab 68 %: 19 von 28 (ohne Finanzierung) bzw. 22 von 31 (mit).
// (21/31 = 67,7 % liegt knapp UNTER der Schwelle — nachgerechnet, nicht geschaetzt.)
const AMPEL_GRUEN_ANTEIL = 25 / 28; // 0.8928...
const AMPEL_GELB_ANTEIL  = 19 / 28; // 0.6785...

// ---------- Zustand ----------

// Eine ScriptProperty, JSON: { "<dealId>": { f: <erstSichtungMs>, s: <gesendetMs> } }
// s fehlt, solange noch keine DM raus ist. Deals, die nicht mehr in Pipeline 2
// liegen, fallen beim naechsten Lauf raus — damit bleibt der Zustand auf
// Pipeline-Groesse begrenzt (~60 Eintraege, weit unter dem 9-KB-Limit).
const STATE_PROPERTY = 'CLOSER_SCORE_STATE';
