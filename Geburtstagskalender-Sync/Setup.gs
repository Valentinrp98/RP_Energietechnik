// ============================================================
// SETUP — einmalige Schritte (Kalender anlegen, Trigger einrichten)
// ============================================================

// Einmalig manuell ausführen, solange CALENDAR_ID leer ist. Legt den gemeinsamen Kalender an,
// gibt ihn domainweit (lesend) für rp-energietechnik.at frei — statt jeden Mitarbeiter einzeln
// einzuladen, skaliert automatisch mit neuen Kollegen — und loggt die einzutragende ID.
// BEWUSST nicht automatisch aus dem Sync heraus aufgerufen: das ergäbe pro Trigger-Lauf einen
// weiteren Kalender, solange die ID nicht eingetragen ist (siehe pruefeKonfiguration()).
function legeKalenderAnUndZeigeId() {
  if (CALENDAR_ID) {
    Logger.log('CALENDAR_ID ist bereits gesetzt (%s) — es wird kein zweiter Kalender angelegt.', CALENDAR_ID);
    return;
  }
  const kalender = legeKalenderAn();
  Logger.log('Neuer Kalender angelegt: %s', kalender.getName());
  Logger.log('>>> CALENDAR_ID in Config.gs eintragen: %s', kalender.getId());
}

function legeKalenderAn() {
  const kalender = CalendarApp.createCalendar(CALENDAR_NAME, { timeZone: 'Europe/Vienna' });
  Calendar.Acl.insert({
    role: 'reader',
    scope: { type: 'domain', value: WORKSPACE_DOMAIN }
  }, kalender.getId());
  Logger.log('Domainweite Freigabe (reader) für %s gesetzt.', WORKSPACE_DOMAIN);
  return kalender;
}

// Einmalig manuell ausführen, danach läuft syncGeburtstage() von selbst.
function richteTaeglichenTriggerEin() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'syncGeburtstage'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('syncGeburtstage')
    .timeBased()
    .atHour(4) // 02:00 (Bundesland-aus-PLZ, Projektdoku-Generator) und 03:00 (Montagepartner-aus-Bundesland) sind schon belegt, siehe gs-deploy SKILL.md
    .everyDays(1)
    .create();

  Logger.log('Täglicher Trigger für syncGeburtstage um 04:00 eingerichtet.');
}
