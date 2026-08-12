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
    const data = body.data || {};
    const previous = body.previous || {};

    const istNeuGewonnen = data.status === 'won' && previous.status !== 'won';
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
