// ============================================================
// KONFIGURATION — Geburtstagskalender-Sync
// ============================================================
// Zweck: Geburtstage aus einem Slack Custom Profile Field ("Geburtstag") lesen
// und als jährlich wiederkehrende Ganztags-Events in EINEN gemeinsamen Google-
// Kalender ("Geburtstage RP intern") schreiben. Kein Schreiben in individuelle
// Mitarbeiter-Kalender — alle abonnieren/sehen denselben Kalender.
//
// Ablauf:
//   1. pruefeKonfiguration() — prüft nur (Token, Feld-ID, Kalenderzugriff), legt nichts an.
//   2. ermittleGeburtstagsFeldId() — einmalig, falls SLACK_BIRTHDAY_FIELD_ID
//      noch leer ist (siehe SlackClient.gs).
//   3. syncGeburtstage() — Kernlogik (siehe CalendarSync.gs), täglich per
//      richteTaeglichenTriggerEin() (siehe Setup.gs).
//
// Setup-Stand 08.09.2026 — erledigt:
//   - Slack Custom Profile Field "Geburtstag" (Typ Date) angelegt, Feld-ID live verifiziert
//   - Slack App "Geburtstagsapp RP" + Bot Token (users:read, users.profile:read) installiert
//   - Apps-Script-Projekt per clasp create gebunden, Code gepusht
//   - Kalender "Geburtstage RP intern" manuell unter sales@rp-energietechnik.at angelegt
// Offen: Bot Token in Script Properties, Kalender-Schreibrecht für den ausführenden
// Account, Mitarbeiter tragen ihr Geburtsdatum ein.

const SLACK_API_BASE = 'https://slack.com/api';

// Tokens/Secrets liegen in Script Properties, nicht hier im Code — siehe D4 im
// RP-Google-Scripts-CLAUDE.md (Klartext-Secrets-Falle).
function getSlackToken() {
  const token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN fehlt in den Script Properties. Slack App unter api.slack.com/apps anlegen, im RP-Workspace installieren, Bot Token hier eintragen.');
  }
  return token;
}

// IDs sind nicht geheim — analog ERGEBNIS_SHEET_ID in Telefon-Qualifizierung/Config.gs
// als Konstante im Code, nicht in Script Properties.

// Manuell von Valentin unter sales@rp-energietechnik.at angelegt (08.09.2026) -- nicht vom
// Skript, legeKalenderAnUndZeigeId() ist damit für dieses Setup nicht mehr nötig.
// ⚠️ Der Kalender gehört sales@, das Skript läuft aber als der Account, der es autorisiert hat.
// Dieser Account braucht auf dem Kalender "Änderungen an Terminen vornehmen", sonst wirft
// pruefeKonfiguration() "Kalender nicht gefunden/kein Zugriff" (aufgetreten 08.09.2026).
const CALENDAR_ID = '9a320c57e44d7fa904c66b39e6428813f40c8986a16478909d53006f154a7b6d@group.calendar.google.com';
const CALENDAR_NAME = 'Geburtstage RP intern';
const WORKSPACE_DOMAIN = 'rp-energietechnik.at'; // für domainweite Kalenderfreigabe

// Slack Custom-Field-ID für "Geburtstag" (Format "Xf0XXXXXXXX") — einmalig über
// ermittleGeburtstagsFeldId() ermitteln (siehe SlackClient.gs) und hier eintragen.
const SLACK_BIRTHDAY_FIELD_ID = 'Xf0BV2CREFUP';

const EVENT_TITEL_PRAEFIX = '🎂 ';

// true = Simulation: es wird nur geloggt, was angelegt/geändert/gelöscht WÜRDE.
// AUF true LASSEN, bis Valentin explizit sagt "ja, live in den Kalender schreiben"
// (Arbeitsregel "Nie ungefragt schreiben" gilt hier genauso wie für Pipedrive).
// Deckt die Events ab -- NICHT das einmalige Anlegen des Kalenders selbst, das passiert
// nur auf ausdrücklichen Zuruf über legeKalenderAnUndZeigeId() (Setup.gs).
const DRY_RUN = true;

// Weicher Ausstieg vor dem 6-Min-Ausführungslimit — bei größerer Belegschaft kann
// die Schleife über users.profile.get + Calendar.Events.list sonst mittendrin
// abbrechen. Nächster Tages-Trigger macht dort weiter (kein Datenverlust, nur
// verzögert), siehe gleiches Muster in Telefon-Qualifizierung/Config.gs.
const MAX_LAUFZEIT_MS = 4.5 * 60 * 1000;

// Vor jedem Lauf einmal ausführen — prüft Token, Feld-ID und Kalender. Legt selbst NICHTS an.
// Rückgabe: true = vollständig konfiguriert, der Sync darf laufen.
//
// ⚠️ Bis 05.09.2026 hat diese Funktion den Kalender selbst angelegt, wenn CALENDAR_ID leer war
// — und syncGeburtstage() ruft sie bei JEDEM Trigger-Lauf auf. Wäre die geloggte ID nicht
// sofort eingetragen worden, hätte der Tages-Trigger jeden Tag einen weiteren Kalender
// "RP Geburtstage" angelegt und domainweit freigegeben. DRY_RUN hätte das nicht verhindert,
// weil das Anlegen am Schalter vorbeilief. Anlegen geht jetzt nur noch auf ausdrücklichen
// Zuruf: legeKalenderAnUndZeigeId() in Setup.gs.
function pruefeKonfiguration() {
  getSlackToken();
  Logger.log('Slack-Bot-Token vorhanden.');

  if (!SLACK_BIRTHDAY_FIELD_ID) {
    Logger.log('SLACK_BIRTHDAY_FIELD_ID ist leer — ermittleGeburtstagsFeldId() ausführen und Ergebnis hier eintragen.');
    return false;
  }

  if (!CALENDAR_ID) {
    Logger.log('CALENDAR_ID ist leer — einmalig legeKalenderAnUndZeigeId() (Setup.gs) ausführen und die geloggte ID hier eintragen.');
    return false;
  }

  // Bewusst über den Advanced Calendar Service geprüft, nicht über CalendarApp:
  // CalendarApp.getCalendarById() liefert auch null, wenn der Account Zugriff HAT, den
  // Kalender aber nicht in seiner eigenen Kalenderliste abonniert hat (Falle am 08.09.2026).
  // Calendar.Calendars.get() ist derselbe Weg, den der Sync später tatsächlich benutzt.
  let kalender;
  try {
    kalender = Calendar.Calendars.get(CALENDAR_ID);
  } catch (fehler) {
    throw new Error('Kein Zugriff auf CALENDAR_ID ' + CALENDAR_ID + ' als ' +
      Session.getEffectiveUser().getEmail() + '. Diesem Account im Kalender unter "Geteilt mit" ' +
      '"Änderungen an Terminen vornehmen" geben. Original-Fehler: ' + fehler.message);
  }
  Logger.log('Ziel-Kalender: %s (%s)', kalender.summary, CALENDAR_ID);
  Logger.log('Ausführender Account: %s', Session.getEffectiveUser().getEmail());
  Logger.log('OK — Konfiguration passt. DRY_RUN=%s', DRY_RUN);
  return true;
}

// ---------- gemeinsamer Slack-HTTP-Helper mit Retry (respektiert Retry-After bei Rate-Limit) ----------
function fetchSlackJson(method, params) {
  const url = SLACK_API_BASE + '/' + method + (params ? '?' + toQueryString(params) : '');
  for (let versuch = 1; versuch <= 3; versuch++) {
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + getSlackToken() },
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code === 429) {
      const retryAfter = Number(response.getHeaders()['Retry-After'] || response.getHeaders()['retry-after'] || 2);
      if (versuch === 3) throw new Error('Slack-Rate-Limit (' + method + ') nach 3 Versuchen weiter aktiv.');
      Utilities.sleep(retryAfter * 1000);
      continue;
    }
    const json = JSON.parse(response.getContentText());
    if (!json.ok) {
      throw new Error('Slack-API-Fehler bei ' + method + ': ' + json.error);
    }
    return json;
  }
}

function toQueryString(params) {
  return Object.keys(params)
    .map(function (key) { return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]); })
    .join('&');
}
