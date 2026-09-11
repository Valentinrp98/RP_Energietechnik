// ============================================================
// KONFIGURATION — Lieferkalender-Slack ("Ernst")
// ============================================================
// Zweck: Termin-Aenderungen in Pipedrive-Pipeline 2 (Fulfillment) nach Slack
// melden. Ueberwacht werden vier Datumsfelder am Deal:
//   Liefertermin, DC-Termin, AC-Termin, IB-Termin
//
// Ein Feld kann drei Dinge tun, und die werden unterschieden:
//   leer -> Datum          = "gesetzt"
//   Datum -> anderes Datum = "verschoben"  (alter UND neuer Wert in der Meldung)
//   Datum -> leer          = "geloescht"
// Dazu zwei datumsbasierte Ereignisse, die kein Klick in Pipedrive ausloest:
//   "vorher" (N Tage vor dem Termin) und "am Tag".
//
// Damit "gesetzt" von "steht schon lange drin" unterscheidbar ist, braucht das
// Script ein Gedaechtnis: der Tab "Snapshot" haelt eine Zeile pro Deal mit dem
// Stand des letzten Laufs. Derselbe Tab ist gleichzeitig die Liefer-Uebersicht.
//
// Gesteuert wird ueber den Tab "Regeln" — Feld + Ereignis + Tage + Channel +
// Textvorlage. Eine Regel aendern heisst eine Zelle aendern, kein clasp push.
//
// Das Script schreibt NIE nach Pipedrive. Nur lesend. Geschrieben wird
// ausschliesslich ins Sheet und nach Slack.

// ---------- Pipedrive ----------

const PIPEDRIVE_BASE = 'https://rp-energietechnik.pipedrive.com/api/v2';
const PIPELINE_ID = 2; // Fulfillment

// Basis fuer den Deal-Link in den Slack-Nachrichten ({deallink}).
// Von Valentin bestaetigt: https://rp-energietechnik.pipedrive.com/deal/<dealId>
const DEAL_URL_BASE = 'https://rp-energietechnik.pipedrive.com/deal/';

function getPipedriveToken() {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  if (!token) {
    throw new Error('PIPEDRIVE_API_TOKEN fehlt in den Script Properties.');
  }
  return token;
}

// Die vier ueberwachten Datumsfelder. Der Schluessel links ist der Name, den
// Valentin im Regeln-Tab in die Spalte "Feld" schreibt — Tippfehler dort
// erzeugen eine sichtbare Warnung, keine stille Nicht-Meldung.
// field_codes verifiziert gegen docs/REFERENZ-Pipedrive-AppsScript.md (Abschnitt "Termine").
const TERMIN_FELDER = {
  'Liefertermin': 'c0a676d8db66f0cb6300e8160e1401355a226990', // Label in Pipedrive: "Material-Liefertermin"
  'DC-Termin':    '6e4dc4e9017957ddadebddac3dd622ca3afe8676',
  'AC-Termin':    '0277ea7463b980044e0062e46467979ccc292127',
  'IB-Termin':    'ba820255728739b29c451287808fbe18f1c94b8e'
};

// Kontextfelder fuer die Textvorlagen (nur lesend, keine Ueberwachung).
const MONTAGEPARTNER_FIELD_KEY = '0190fd945adc86148657d2db36261ae9545e7bda';
const KUNDENORDNER_FIELD_KEY   = '5c442fe317da26ed4f60504e2b912df7e3116c5b';

// Montagepartner-Option-IDs -> Klartext. Aus REFERENZ-Pipedrive-AppsScript.md.
// Die API liefert bei include_option_labels=true schon das Label mit; diese
// Tabelle ist der Fallback, falls der Parameter mal wegfaellt.
const MONTAGEPARTNER_LABELS = {
  157: 'ALE', 158: 'Berger', 159: 'Greensky', 160: 'KOLLSTAR',
  161: 'Kreuzeder', 243: 'Tirol', 244: 'Vorarlberg'
};

// ---------- Person / PLZ ----------
// Die PLZ haengt an der PERSON, nicht am Deal — sie kommt also NICHT im
// Deal-Sweep mit. Deshalb ein zweiter Bulk-Sweep ueber /persons (nicht ein Call
// pro Deal). Beide Quellen sind bei RP nachweislich unzuverlaessig und
// widersprechen sich teils (siehe docs/CHECK-Kette-PLZ-Bundesland-
// Montagepartner-2026-09-10.md, K1). Deshalb wird hier NICHT geraten:
// weichen die beiden ab, zeigt die Meldung beide Werte mit Warnzeichen.
const PERSON_PLZ_FIELD_KEY     = '5fef394025c936df4b58763b2b58c340fbb0d251';
const PERSON_ADRESSE_FIELD_KEY = '432e4e165de7e9f474643c3d3a5552e2ec976f55';

// ---------- Sheet ----------

// Wird beim ersten Setup-Lauf angelegt, dann hier eintragen.
// IDs sind nicht geheim -> Konstante im Code, analog Telefon-Qualifizierung/Config.gs.
const SHEET_ID = '11lekovl_J-701s9xmbFHOxYodNta-9rVXa-MFCxjF8U';

const TAB_SNAPSHOT = 'Snapshot';
const TAB_REGELN   = 'Regeln';
const TAB_LOG      = 'Log';

// Eine Zeile pro Lauf, auch wenn nichts passiert ist. Das ist der Unterschied
// zwischen "es gibt heute nichts zu melden" und "das Script laeuft seit
// Dienstag nicht mehr" — von aussen sehen beide gleich aus: stiller Channel.
// Genau die Falle, die das Cloudflare-Relay hatte: es meldete immer 200 und
// hat damit tote Webhooks maskiert.
const TAB_LAEUFE   = 'Laeufe';

// ---------- Slack ----------

const SLACK_API_BASE = 'https://slack.com/api';

// Eigene Slack-App "Ernst" (nicht der Token der Geburtstagsapp — ein Token pro
// Projekt, damit ein zurueckgezogener Token nicht beide Automatiken stilllegt).
// Scopes: chat:write, chat:write.public
function getSlackToken() {
  const token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN fehlt in den Script Properties. Slack-App "Ernst" unter api.slack.com/apps anlegen, im RP-Workspace installieren, Bot Token (xoxb-...) hier eintragen.');
  }
  return token;
}

// ---------- Betrieb ----------

// true = Simulation. Es wird gelesen und verglichen, aber NICHT nach Slack
// gepostet und NICHT in den Snapshot geschrieben. Das Log zeigt, was passieren
// wuerde. Der DRY-Vollauf ist das Messinstrument — erst messen, dann scharf.
// Scharf geschaltet am 11.09.2026 durch Valentin, nachdem der DRY-Lauf gegen
// den frisch befuellten Snapshot 0 Meldungen ergeben hat — der Beweis, dass
// der Diff nicht permanent "verschoben" schreit.
// Betrifft NUR Slack. Nach Pipedrive wird in diesem Projekt nie geschrieben.
const DRY_RUN = false;

// Nur beim allerersten Lauf auf true: fuellt den Snapshot und postet NICHTS.
// Ohne das wuerden die bereits vorhandenen Liefertermine alle als "gerade
// gesetzt" gemeldet — eine Spam-Welle zum Start.
// Nach dem ersten erfolgreichen Lauf zurueck auf false.
const SNAPSHOT_INITIALISIEREN = false;

// Vor dieser Stunde feuern die DATUMSBASIERTEN Regeln ("vorher", "am Tag")
// nicht. Grund: die fragen "ist heute == Termindatum?", und "heute" kippt um
// Mitternacht. Der 15-Minuten-Trigger laeuft also um 00:07 das erste Mal mit
// dem neuen Datum — und weil der Doppelpost-Schutz greift, waere das ZUGLEICH
// der einzige Post des Tages. "HEUTE Lieferung" kaeme jede Nacht um viertel
// nach zwoelf und waere am Morgen weggescrollt.
// Die Diff-Regeln (gesetzt/verschoben/geloescht) haben das Problem nicht: die
// haengen daran, dass ein Mensch etwas aendert, und nachts aendert niemand was.
const RUHEZEIT_BIS_STUNDE = 7;

// Weicher Ausstieg vor dem 6-Min-Limit, gleiches Muster wie
// Geburtstagskalender-Sync und Telefon-Qualifizierung.
const MAX_LAUFZEIT_MS = 4.5 * 60 * 1000;

// ============================================================
// SLACK-HTTP — uebernommen aus Geburtstagskalender-Sync/Config.gs:121
// ============================================================
// Bewusst kopiert statt neu geschrieben: die Fallen sind hier schon geloest.
// Insbesondere: Slack antwortet auch bei Fehlern mit HTTP 200, der Erfolg steht
// in json.ok. Nie dem Statuscode trauen.
function fetchSlackJson(method, params, payload) {
  const url = SLACK_API_BASE + '/' + method + (params ? '?' + toQueryString(params) : '');
  for (let versuch = 1; versuch <= 3; versuch++) {
    const optionen = {
      method: payload ? 'post' : 'get',
      headers: { Authorization: 'Bearer ' + getSlackToken() },
      muteHttpExceptions: true
    };
    if (payload) {
      optionen.contentType = 'application/json; charset=utf-8';
      optionen.payload = JSON.stringify(payload);
    }
    const response = UrlFetchApp.fetch(url, optionen);
    const code = response.getResponseCode();
    if (code === 429) {
      const retryAfter = Number(response.getHeaders()['Retry-After'] || response.getHeaders()['retry-after'] || 2);
      if (versuch === 3) throw new Error('Slack-Rate-Limit (' + method + ') nach 3 Versuchen weiter aktiv.');
      Utilities.sleep(retryAfter * 1000);
      continue;
    }
    const json = JSON.parse(response.getContentText());
    if (!json.ok) {
      // Bei missing_scope nennt Slack im Body beides: welchen Scope der Call
      // braucht (needed) und welche der Token wirklich traegt (provided).
      // Ohne diese zwei Angaben raet man, ob der Scope fehlt oder ob der Token
      // nur aelter ist als der Scope.
      let zusatz = '';
      if (json.needed || json.provided) {
        zusatz = ' | benoetigt: ' + (json.needed || '?') + ' | Token hat: ' + (json.provided || '?');
      }
      throw new Error('Slack-API-Fehler bei ' + method + ': ' + json.error + zusatz);
    }
    return json;
  }
}

function toQueryString(params) {
  return Object.keys(params)
    .map(function (key) { return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]); })
    .join('&');
}
