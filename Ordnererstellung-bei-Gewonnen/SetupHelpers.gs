// ===== EINMALIGE SETUP-FUNKTIONEN =====
// Im Apps-Script-Editor oben im Dropdown auswählen und ausführen (▷-Button).

/**
 * Registriert den Webhook bei Pipedrive, sodass diese Web-App bei jeder Deal-Änderung
 * benachrichtigt wird. NUR EINMAL ausführen (nach dem Deployment als Web App).
 * webAppUrl: die URL aus "Bereitstellen > Neue Bereitstellung > Web App" (endet auf /exec).
 *
 * ACHTUNG API-Quirk: Die Webhooks-Endpoint gibt es nur in Pipedrive API v1 (nicht v2),
 * und v1 authentifiziert über ?api_token=... in der URL statt über den x-api-token-Header.
 */
function registerPipedriveWebhook(webAppUrl) {
  const secret = getWebhookSecret(); // wirft Fehler, wenn WEBHOOK_SECRET noch nicht in Script Properties gesetzt ist
  const subscriptionUrl = `${webAppUrl}?token=${encodeURIComponent(secret)}`;

  const url = `https://api.pipedrive.com/v1/webhooks?api_token=${getApiToken()}`;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      subscription_url: subscriptionUrl,
      event_action: 'updated',
      event_object: 'deal'
    }),
    muteHttpExceptions: true
  });
  Logger.log(`Status ${response.getResponseCode()}: ${response.getContentText()}`);
}

/** Listet alle registrierten Webhooks (zum Prüfen/Aufräumen). */
function listPipedriveWebhooks() {
  const url = `https://api.pipedrive.com/v1/webhooks?api_token=${getApiToken()}`;
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  Logger.log(response.getContentText());
}

/** Debug: listet alle Deal-Custom-Fields (field_name + field_code), um KUNDENORDNER_LINK_FIELD_KEY zu finden. */
function listDealFieldsHelper() {
  const fields = fetchPipedrive('dealFields?limit=500');
  fields.forEach(f => Logger.log(`${f.field_name}  -->  ${f.field_code}`));
}

/** Für Einzeltests: einen bekannten Deal durchlaufen lassen (Deal-ID unten anpassen). */
function testEinzelDeal() {
  const result = processGewonnenDeal(7253); // Test-Deal-ID aus dem sevdesk-Sync-Projekt, ggf. anpassen
  Logger.log(result);
}

/**
 * Für kontrolliertes Testen: nur die hier eingetragenen Deal-IDs verarbeiten (statt auf den
 * Webhook zu warten), damit man die Ergebnisse im Log-Sheet gezielt gegenchecken kann.
 */
function processAusgewaehlteDeals() {
  const dealIds = [7253]; // hier eigene Deal-IDs eintragen, z.B. [7253, 7301, 7455]
  dealIds.forEach(dealId => {
    const result = processGewonnenDeal(dealId);
    Logger.log(`Deal ${dealId}: ${result}`);
  });
}
