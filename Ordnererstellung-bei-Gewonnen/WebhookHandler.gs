// ===== WEBHOOK-EMPFANG =====
// Läuft nur, wenn dieses Script als Web App deployed ist (Bereitstellen > Neue Bereitstellung > Web App)
// und die Web-App-URL bei registerPipedriveWebhook() (siehe SetupHelpers.gs) hinterlegt wurde.

/**
 * Wird von Pipedrive aufgerufen, sobald sich ein Deal ändert (Webhook-Event "change.deal").
 * Reagiert auf JEDE Änderung an einem aktuell gewonnenen Deal, nicht nur auf den Wechsel
 * status -> "won" selbst.
 *
 * Bewusst NICHT auf den reinen Status-Wechsel-Moment eingeschränkt (frühere Fassung): war beim
 * Gewinnen noch kein Montagepartner gesetzt (Bundesland/Montagepartner-Zuordnung noch nicht
 * durchgelaufen), gab es danach nie wieder einen Status-Wechsel, der erneut ausgelöst hätte --
 * der Ordner wäre für diesen Deal nie automatisch entstanden (siehe Fall Knittelfelder/7093,
 * manuell nachgeholt). Jetzt reagiert der Handler wie Bundesland-aus-PLZ/Montagepartner-aus-
 * Bundesland auf jedes change.deal-Event und verlässt sich auf die Idempotenz in
 * processGewonnenDealUnlocked() (Skip bei fehlendem Partner / bereits vorhandenem Link) --
 * dieselbe Kettenreaktion wie zwischen den beiden anderen Scripts greift damit auch hier: setzt
 * Montagepartner-aus-Bundesland den Partner NACH dem Gewinn, feuert das selbst ein change.deal,
 * und dieser Handler bekommt jetzt eine zweite Chance.
 */
function doPost(e) {
  starteLauf('doPost (Webhook)');
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

    if (data.status !== 'won') {
      return ContentService.createTextOutput('ignoriert (Deal aktuell nicht gewonnen)');
    }

    const result = processGewonnenDeal(data.id);
    Logger.log(`Deal ${data.id}: ${result}`);
    return ContentService.createTextOutput('ok');
  } catch (err) {
    Logger.log(`FEHLER im Webhook-Handler: ${err.message}`);
    return ContentService.createTextOutput('error: ' + err.message);
  } finally {
    flushLog();
  }
}
