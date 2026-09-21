// ============================================================
// PIPEDRIVE — nur lesend
// ============================================================
// Muster uebernommen aus Lieferkalender-Slack/PipedriveClient.gs:8 (Cursor-
// Pagination, Retry bei 429/5xx, Netzwerkfehler-Retry). In diesem Projekt sind
// ausnahmslos alle Aufrufe GET — ein Retry ist deshalb gefahrlos.

function fetchPipedriveJson(pfad, params, basis) {
  const url = (basis || PIPEDRIVE_BASE) + pfad + '?' + toQueryString(params || {});
  const token = getPipedriveToken(); // vor die Schleife: fehlendes Token ist kein Netzwerkfehler
  for (let versuch = 1; versuch <= 3; versuch++) {
    // muteHttpExceptions deckt nur HTTP-Statuscodes ab. Bei Zeitueberschreitung
    // wirft UrlFetchApp.fetch() selbst, noch bevor es eine Response gibt — das
    // liefe an der Statuscode-Pruefung vorbei und risse den ganzen Lauf ab.
    let response;
    try {
      response = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { 'x-api-token': token },
        muteHttpExceptions: true
      });
    } catch (e) {
      if (versuch === 3) throw new Error('Pipedrive-Netzwerkfehler bei ' + pfad + ': ' + e.message);
      Utilities.sleep(versuch * 2000);
      continue;
    }
    const code = response.getResponseCode();
    if (code === 429 || code >= 500) {
      if (versuch === 3) throw new Error('Pipedrive ' + code + ' bei ' + pfad + ' nach 3 Versuchen.');
      Utilities.sleep(versuch * 2000); // 2s, dann 4s
      continue;
    }
    const json = JSON.parse(response.getContentText());
    if (code !== 200 || json.success === false) {
      throw new Error('Pipedrive-Fehler ' + code + ' bei ' + pfad + ': ' + response.getContentText().slice(0, 300));
    }
    return json;
  }
}

// Alle nicht-archivierten Deals der Fulfillment-Pipeline.
// ⚠️ KEIN status-Parameter. v2 kennt nur open|won|lost|deleted; "all_not_deleted"
// wirft HTTP 400. Und status:"won" wird bei RP schon bei der Anlage gesetzt —
// es traegt kein Signal und darf nicht filtern (Befund D20).
// Der Listen-Endpoint liefert custom_fields schon mit: kein Call pro Deal.
function holeFulfillmentDeals() {
  const start = Date.now();
  const deals = [];
  let cursor = null;
  do {
    if (Date.now() - start > MAX_LAUFZEIT_MS) {
      throw new Error('Zeitlimit beim Deal-Abruf nach ' + deals.length + ' Deals. Lauf abgebrochen (Zustand unveraendert).');
    }
    const params = { pipeline_id: PIPELINE_ID, limit: 100 };
    if (cursor) params.cursor = cursor;
    const json = fetchPipedriveJson('/deals', params);
    (json.data || []).forEach(function (d) { deals.push(d); });
    cursor = json.additional_data && json.additional_data.next_cursor;
  } while (cursor);
  return deals;
}

// HILFSFUNKTION ZUM EINRICHTEN — einmal laufen lassen, um CLOSER_SLACK_IDS in
// Config.gs zu befuellen. Loggt ID, Name und E-Mail aller aktiven Pipedrive-User.
// ⚠️ /users gibt es nur in v1. Der Header x-api-token funktioniert dort aber
// genauso (REFERENZ-Pipedrive-AppsScript.md: v1 ist nicht abgeschaltet).
function listePipedriveUser() {
  const json = fetchPipedriveJson('/users', {}, PIPEDRIVE_BASE_V1);
  const user = (json.data || []).filter(function (u) { return u.active_flag !== false; });
  Logger.log('%s aktive Pipedrive-User:', String(user.length));
  Logger.log('| Pipedrive-ID | Name | E-Mail |');
  Logger.log('|---|---|---|');
  user.forEach(function (u) {
    Logger.log('| %s | %s | %s |', String(u.id), u.name, u.email);
  });
  Logger.log('\nDiese IDs in Config.gs unter CLOSER_SLACK_IDS eintragen, jeweils mit der');
  Logger.log('Slack-Mitglieds-ID des Kollegen (Slack-Profil -> "Mitglieds-ID kopieren").');
}

function toQueryString(params) {
  return Object.keys(params)
    .map(function (key) { return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]); })
    .join('&');
}
