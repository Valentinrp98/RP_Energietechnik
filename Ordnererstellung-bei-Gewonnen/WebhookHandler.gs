// ===== WEBHOOK-EMPFANG =====
// Läuft nur, wenn dieses Script als Web App deployed ist (Bereitstellen > Neue Bereitstellung > Web App)
// und die Web-App-URL bei registerPipedriveWebhook() (siehe SetupHelpers.gs) hinterlegt wurde.

/**
 * Wird von Pipedrive aufgerufen, sobald sich ein Deal ändert (Webhook-Event "updated.deal").
 * Reagiert nur auf den Wechsel status -> "won", ignoriert alles andere.
 */
function doPost(e) {
  try {
    // Einfache Absicherung: Secret muss als Query-Param an der Webhook-URL mitgegeben werden,
    // sonst könnte jeder im Internet diese URL aufrufen und Ordner anlegen lassen.
    if (e.parameter.token !== getWebhookSecret()) {
      Logger.log('Webhook-Aufruf mit falschem/fehlendem token abgelehnt.');
      return ContentService.createTextOutput('forbidden');
    }

    const body = JSON.parse(e.postData.contents);
    // Defensiv beide Payload-Formen lesen: Webhooks v2 liefert data/previous, v1 liefert current/previous.
    // Welche Version tatsächlich registriert ist, hängt von registerPipedriveWebhook() ab (siehe
    // SetupHelpers.gs) -- so bricht der Handler nicht still, falls sich das mal ändert.
    const data = body.data || body.current || {};
    const previous = body.previous || {};

    // v2-Webhooks schicken in "previous" oft nur die tatsächlich geänderten Felder. Bei jeder
    // beliebigen Änderung an einem BEREITS gewonnenen Deal fehlt "status" dann in previous ->
    // previous.status wäre undefined -> "undefined !== 'won'" ist true -> jede Feldänderung sähe
    // wie ein frischer Gewinn aus. Deshalb zusätzlich prüfen, ob "status" überhaupt im previous-
    // Objekt vorkommt.
    const statusHatSichGeaendert = Object.prototype.hasOwnProperty.call(previous, 'status');
    const istNeuGewonnen = data.status === 'won' && statusHatSichGeaendert && previous.status !== 'won';
    if (!istNeuGewonnen) {
      return ContentService.createTextOutput('ignoriert (kein neuer Gewonnen-Status)');
    }

    const result = processGewonnenDeal(data.id);
    Logger.log(`Deal ${data.id}: ${result}`);
    return ContentService.createTextOutput('ok');
  } catch (err) {
    Logger.log(`FEHLER im Webhook-Handler: ${err.message}`);
    return ContentService.createTextOutput('error: ' + err.message);
  }
}
