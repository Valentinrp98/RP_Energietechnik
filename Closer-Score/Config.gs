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

// BETRIEBSMODUS — loest den frueheren Schalter TEST_ALLES_AN_MICH ab (22.09.2026).
//
//   'test'      Jede DM geht an Valentin, fertig. Keine Freigabe, nichts erreicht
//               je einen Closer. Zum Anschauen des Nachrichtenformats.
//   'freigabe'  Valentin bekommt die Nachricht zuerst als Vorlage. Setzt er eine
//               Freigabe-Reaktion drauf, geht sie an den Closer; bei einer
//               Ablehnungs-Reaktion wird sie verworfen. Ohne Reaktion passiert
//               nichts. <- der laufende Modus
//   'direkt'    Sofort an den Closer, ohne Zwischenstopp.
const BETRIEBSMODUS = 'freigabe';

// Welche Reaktion heisst was. Mehrere erlaubt, damit man nicht raten muss,
// welches Hakerl gemeint ist. Slack liefert die Namen ohne Doppelpunkte.
const FREIGABE_JA   = ['white_check_mark', 'heavy_check_mark', 'ballot_box_with_check', '+1', 'ok_hand'];
const FREIGABE_NEIN = ['x', '-1', 'no_entry', 'no_entry_sign', 'wastebasket'];

// Wie lange eine Vorlage auf eine Reaktion wartet. Danach verfaellt sie still —
// eine DM, die zwei Wochen spaeter beim Closer aufschlaegt, erzieht niemanden
// mehr, sie irritiert nur.
// Kopie an Valentin, sobald eine Nachricht wirklich beim Closer gelandet ist.
// Im Freigabe-Modus kommt sie als Antwort im Thread der Vorlage - so steht die
// Zustellung direkt unter dem, was freigegeben wurde, statt als loser Schnipsel
// weiter unten im Verlauf.
const KOPIE_AN_VALENTIN = true;

const FREIGABE_FRIST_MS = 7 * 24 * 60 * 60 * 1000;

// Wie oft nach neuen Reaktionen geschaut wird. Freigaben sind nicht
// zeitkritisch; alle 15 Minuten kostet ~96 Laeufe am Tag und bleibt weit
// unter jedem Kontingent.
const FREIGABE_PRUEFUNG_MINUTEN = 15;

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
// ❌ WIDERLEGT am 23.09.2026: creator_user_id ist "wer den Deal ANGELEGT hat"
// und eben NICHT "wer verkauft hat". Der Beweis ist Deal 6777 (Glauninger):
// creator_user_id = Marco, in #sales hat aber Sven Mlinar den Auftrag gepostet.
// Marco legt die Deals an - daher die 84%. Dieses Feld taugt damit NICHT als
// Empfaenger. Die verlaessliche Quelle ist der #sales-Kanal, siehe
// SalesKanal.gs. CLOSER_FELD bleibt nur noch als Vergleichswert fuer
// pruefeSalesKanal() stehen.
const CLOSER_FELD = 'creator_user_id';

// Pipedrive-User-ID (Wert aus CLOSER_FELD) -> Slack-User-ID.
// NOCH LEER. Befuellen ueber:
//   1. listePipedriveUser()  -> loggt ID, Name, E-Mail aller Pipedrive-User
//   2. Slack-Profil des Kollegen -> "Mitglieds-ID kopieren"
// Bewusst hart hinterlegt statt ueber users:read.email aufgeloest — das waere
// ein zusaetzlicher Scope fuer eine Handvoll Leute.
// Ein Closer OHNE Eintrag bekommt keine DM ins Leere: die Nachricht geht mit
// einem Hinweis an Valentin, damit nichts still verschwindet.
// Erzeugt von baueCloserMapping() (Mapping.gs) am 23.09.2026 über den Abgleich
// der Firmen-E-Mail zwischen Pipedrive und Slack. Bei Personalwechsel nicht von
// Hand pflegen, sondern die Funktion nochmal laufen lassen.
//
// ⚠️ Dieses Mapping ist NICHT mehr der Weg zum Empfänger.
// Am Vormittag des 23.09.2026 stand hier, die 84%-Dominanz von Marco sei echte
// Verteilung. Das war falsch: der Blick in #sales hat gezeigt, dass Marco die
// Deals nur anlegt. Die Zuordnung läuft jetzt über SalesKanal.gs, wo der Autor
// der Auftrags-Meldung direkt die Slack-ID liefert.
// Der Block bleibt stehen, weil pruefeSalesKanal() beide Seiten
// gegenüberstellt - und als Notnagel, falls der Kanal mal nicht lesbar ist.
const CLOSER_SLACK_IDS = {
  21708253: 'U06TCB95A9Y',   // Marco Benhammadi  (81 von 96 Deals)
  21716129: 'U07030XUKJ8',   // André Rechberger  (8)
  26640642: 'U0BGM3RRYB0',   // Sergen Caf        (3)
  22609153: 'U08356D2VFU',   // Sean Golubovic    (1)
  27727277: 'U0BH9M1QTD1'    // Jonathan Rössner  (1)
  // Manuel Wimmer (Pipedrive 26488160) ist nicht mehr in der Firma. Seine zwei
  // noch laufenden Deals landen mit Hinweis bei Valentin - eine Rückmeldung an
  // einen Ex-Kollegen wäre sinnlos, die Deals selbst laufen aber weiter.
  // Sven Mlinar fehlt hier noch, weil er bisher keinen Deal angelegt hat. Sobald
  // der erste kommt, baueCloserMapping() laufen lassen - seine Slack-ID liegt
  // schon in SLACK_NACH_MAIL (Mapping.gs).
};

// Deals, die nie gescored werden - egal wie gut sie ausgefuellt sind.
// 7253 "AI TEST" ist der Pilot-Deal der Datei-Klassifikation. Er ist vollstaendig
// befuellt und wuerde Sean sonst eine Rueckmeldung fuer ein Geschaeft schicken,
// das es nicht gibt.
const IGNORIERTE_DEALS = [7253];

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

// Punkte je Gruppe: Dach & Anlage 15 | Förderung & Finanzierung 6 |
// Unterlagen & Notizen 7. Summe 28.
// (Bis 23.09.2026 kamen bei Finanzierungs-Deals 3 Punkte fuer die Detailfelder
// dazu, Maximum 31 — siehe FINANZIERUNG_DETAILS_ZAEHLEN weiter unten.)

// ⚠️ Nur DACH 1. Die 2_/3_-Felder (Mehrfach-Dach, live seit 27.08.) bleiben
// bewusst aussen vor: es gibt kein Feld "Anzahl Daecher", also waeren bei jedem
// Ein-Dach-Deal — also fast allen — Dach 2 und 3 leer und der Score dauerhaft rot.

// Finanzierung: gewertet wird nur noch, OB in "Finanzierung gewünscht?" etwas
// steht — Ja, Nein oder "nur als Vergleich". Das sind die 3 Punkte des Feldes
// selbst, mehr nicht.
//
// ⬇ Aenderung 23.09.2026, von Valentin so vorgegeben: die drei Detailfelder
// (F-Rate, F-Laufzeit, F-Anzahlung) zaehlen NICHT mehr mit, auch nicht bei
// "Ja". Vorher standen sie bei jedem Finanzierungs-Deal als Luecke in der
// Nachricht. Sie stehen zum Zeitpunkt der Uebergabe oft noch gar nicht fest —
// die Kondition kommt erst von easyleasing/UNIQA zurueck. Dem Closer etwas
// vorzuhalten, das er nicht liefern kann, ist genau die Art Rauschen, die den
// ganzen Score unglaubwuerdig macht.
//
// Das Maximum ist damit fuer JEDEN Deal 28 — kein 28/31 mehr.
// Rechenweg: 7 Felder a 3 = 21, + Must-knows 2 + Projektnotizen 2 = 25,
// + Checkliste max 3 = 28.
//
// Zurueckdrehen: FINANZIERUNG_DETAILS_ZAEHLEN auf true. Dann gilt wieder die
// alte Regel (Details nur bei Ja, Maximum 31).
const FINANZIERUNG_DETAILS_ZAEHLEN = false;
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

// Ampel-Schwellen PROZENTUAL vom jeweils gueltigen Maximum. Seit dem Wegfall
// der Finanzierungs-Details (23.09.2026) ist das Maximum immer 28, die
// Prozentrechnung bleibt aber stehen: sie kostet nichts und traegt sofort
// wieder, falls je ein Posten dazukommt, der nur manche Deals betrifft.
// ⚠️ Korrektur 16.09.2026: der DRY-Vollauf hat gezeigt, dass die Maxima 28/31
// sind, nicht 25/28 — die urspruengliche Rechnung hatte die Checkliste vergessen.
// Die ANTEILE bleiben unveraendert, nur ihre Begruendung war falsch.
// ⬇ Seit 23.09.2026 gibt es das Maximum 31 nicht mehr, siehe
//    FINANZIERUNG_DETAILS_ZAEHLEN weiter oben. Es gilt nur noch die 28er-Spalte.
// Gruen ab 89 %: 25 von 28.  (frueher zusaetzlich 28 von 31 bei Finanzierung)
// Gelb  ab 68 %: 19 von 28.  (frueher zusaetzlich 22 von 31 bei Finanzierung)
const AMPEL_GRUEN_ANTEIL = 25 / 28; // 0.8928...
const AMPEL_GELB_ANTEIL  = 19 / 28; // 0.6785...

// ---------- Zustand ----------

// Eine ScriptProperty, JSON: { "<dealId>": { f: <erstSichtungMs>, s: <gesendetMs> } }
// s fehlt, solange noch keine DM raus ist. Deals, die nicht mehr in Pipeline 2
// liegen, fallen beim naechsten Lauf raus — damit bleibt der Zustand auf
// Pipeline-Groesse begrenzt (~60 Eintraege, weit unter dem 9-KB-Limit).
const STATE_PROPERTY = 'CLOSER_SCORE_STATE';
