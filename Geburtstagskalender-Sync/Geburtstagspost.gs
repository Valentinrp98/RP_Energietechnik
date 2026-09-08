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
    const text = '🎂 Heute hat <@' + person.userId + '> Geburtstag — alles Gute!';

    BIRTHDAY_CHANNEL_IDS.forEach(function (channelId) {
      // Doppelpost-Schutz pro Tag, Person UND Channel. Der Status wird nach JEDEM
      // erfolgreichen Post gespeichert -- sonst würde ein Fehler im zweiten Channel
      // beim nächsten Lauf einen erneuten Post im ersten auslösen.
      const schluessel = channelId + ':' + person.userId;
      if (status.posted.indexOf(schluessel) !== -1) {
        Logger.log('Schon gratuliert heute in %s: %s', channelId, person.name);
        return;
      }

      if (DRY_RUN) {
        Logger.log('[DRY_RUN] Würde posten in %s: %s', channelId, text);
        return;
      }

      // Ein Channel, in dem der Bot fehlt, darf die übrigen nicht mitreißen.
      try {
        fetchSlackJson('chat.postMessage', null, { channel: channelId, text: text });
      } catch (fehler) {
        Logger.log('Post in %s fehlgeschlagen für %s: %s — Bot dort eingeladen?', channelId, person.name, fehler.message);
        return;
      }
      Logger.log('Gratulation gepostet für %s in %s', person.name, channelId);

      status.posted.push(schluessel);
      speicherePostStatus(status);
    });
  });
}

function ladePostStatus(heuteKey) {
  const roh = PropertiesService.getScriptProperties().getProperty(POST_STATUS_PROPERTY);
  if (roh) {
    const gespeichert = JSON.parse(roh);
    if (gespeichert.tag === heuteKey && gespeichert.posted) return gespeichert;
  }
  return { tag: heuteKey, posted: [] };
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
