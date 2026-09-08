// ============================================================
// GEBURTSTAGS-POST — Gratulation in den Slack-Channel
// ============================================================
// Läuft unabhängig vom Kalender-Sync (eigener Trigger, morgens): prüft, wer heute
// Geburtstag hat, und postet eine Gratulation in BIRTHDAY_CHANNEL_ID.
//
// Voraussetzungen: Bot-Scope chat:write, Bot ist Mitglied im Channel
// (/invite @Geburtstagsapp RP). pruefeSlackRechte() zeigt beides.

const POST_STATUS_PROPERTY = 'LETZTER_GRATULATIONS_POST';

function postGeburtstagsGruesse() {
  const heute = new Date();
  const heuteKey = Utilities.formatDate(heute, 'Europe/Vienna', 'yyyy-MM-dd');
  const status = ladePostStatus(heuteKey);

  const geburtstagskinder = holeMitarbeiterGeburtstage().filter(function (person) {
    return person.geburtstag &&
      person.geburtstag.monat === heute.getMonth() + 1 &&
      person.geburtstag.tag === heute.getDate();
  });

  if (!geburtstagskinder.length) {
    Logger.log('Heute (%s) hat niemand Geburtstag.', heuteKey);
    return;
  }

  geburtstagskinder.forEach(function (person) {
    // Doppelpost-Schutz: pro Tag und Person nur einmal. Der Status wird nach JEDEM
    // erfolgreichen Post gespeichert, damit ein Fehler mitten im Lauf nicht dazu führt,
    // dass beim nächsten Lauf schon Gratulierte erneut gepostet werden.
    if (status.userIds.indexOf(person.userId) !== -1) {
      Logger.log('Schon gratuliert heute: %s', person.name);
      return;
    }

    const text = '🎂 Heute hat <@' + person.userId + '> Geburtstag — alles Gute!';

    if (DRY_RUN) {
      Logger.log('[DRY_RUN] Würde posten in %s: %s', BIRTHDAY_CHANNEL_ID, text);
      return;
    }

    fetchSlackJson('chat.postMessage', null, {
      channel: BIRTHDAY_CHANNEL_ID,
      text: text
    });
    Logger.log('Gratulation gepostet für %s', person.name);

    status.userIds.push(person.userId);
    speicherePostStatus(status);
  });
}

function ladePostStatus(heuteKey) {
  const roh = PropertiesService.getScriptProperties().getProperty(POST_STATUS_PROPERTY);
  if (roh) {
    const gespeichert = JSON.parse(roh);
    if (gespeichert.tag === heuteKey) return gespeichert;
  }
  return { tag: heuteKey, userIds: [] };
}

function speicherePostStatus(status) {
  PropertiesService.getScriptProperties().setProperty(POST_STATUS_PROPERTY, JSON.stringify(status));
}

// Einmalig nach dem Hinzufügen von chat:write ausführen. auth.test braucht selbst keinen
// Scope und liefert im Antwort-Header x-oauth-scopes alle tatsächlich erteilten Scopes --
// damit ist ohne Testpost prüfbar, ob chat:write wirklich angekommen ist.
function pruefeSlackRechte() {
  const response = UrlFetchApp.fetch(SLACK_API_BASE + '/auth.test', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + getSlackToken() },
    muteHttpExceptions: true
  });
  const json = JSON.parse(response.getContentText());
  if (!json.ok) {
    throw new Error('auth.test fehlgeschlagen: ' + json.error);
  }
  const header = response.getHeaders();
  const scopes = header['x-oauth-scopes'] || header['X-OAuth-Scopes'] || '(Header nicht geliefert)';

  Logger.log('Workspace: %s | Bot: %s', json.team, json.user);
  Logger.log('Erteilte Scopes: %s', scopes);
  Logger.log(String(scopes).indexOf('chat:write') !== -1
    ? 'chat:write vorhanden — Posten möglich, sofern der Bot im Channel ist.'
    : '⚠️ chat:write FEHLT — in der App-Konfiguration ergänzen und App neu installieren.');
}
