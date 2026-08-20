// ===== EINMALIGE SETUP-FUNKTIONEN =====
// Im Apps-Script-Editor oben im Dropdown auswählen und ausführen (▷-Button).

/**
 * Registriert den Webhook bei Pipedrive, sodass diese Web-App bei jeder Deal-Änderung
 * benachrichtigt wird. NUR EINMAL ausführen (nach dem Deployment als Web App, WEB_APP_URL
 * in Config.gs muss vorher eingetragen sein -- der ▷-Button ruft Funktionen ohne Argumente
 * auf, ein Funktionsparameter für die URL würde also als "undefined" registriert werden).
 *
 * Registriert über die v2-Webhooks-Endpoint (event_action "change"), passend zum doPost-Handler
 * in WebhookHandler.gs, der body.data/body.previous erwartet. Falls Pipedrive hier zu v1-Verhalten
 * zurückfällt: doPost() liest defensiv auch body.current, sollte also trotzdem funktionieren --
 * mit listPipedriveWebhooks() nach der Registrierung trotzdem gegenchecken, welche Version aktiv ist.
 */
function registerPipedriveWebhook() {
  if (WEB_APP_URL.startsWith('TODO_')) {
    throw new Error('WEB_APP_URL in Config.gs ist noch nicht gesetzt -- erst als Web App deployen, dann die /exec-URL dort eintragen.');
  }
  const secret = getWebhookSecret(); // wirft Fehler, wenn WEBHOOK_SECRET noch nicht in Script Properties gesetzt ist
  const subscriptionUrl = `${WEB_APP_URL}?token=${encodeURIComponent(secret)}`;

  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/webhooks`;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-token': getApiToken() },
    payload: JSON.stringify({
      subscription_url: subscriptionUrl,
      event_action: 'change',
      event_object: 'deal',
      version: '2.0' // ohne dieses Feld liefert Pipedrive den v1-Payload (current/previous statt data/previous)
    }),
    muteHttpExceptions: true
  });
  // Secret NICHT mitloggen -- subscriptionUrl enthält es, deshalb hier maskiert.
  const statusCode = response.getResponseCode();
  const maskedBody = response.getContentText().replace(secret, '***');
  Logger.log(`Status ${statusCode}: ${maskedBody}`);
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Webhook-Registrierung fehlgeschlagen (Status ${statusCode}): ${maskedBody}`);
  }
}

/** Listet alle registrierten Webhooks (zum Prüfen/Aufräumen). Secret wird maskiert geloggt. */
function listPipedriveWebhooks() {
  const secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET') || '';
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/webhooks`;
  const response = UrlFetchApp.fetch(url, {
    headers: { 'x-api-token': getApiToken() },
    muteHttpExceptions: true
  });
  const text = secret ? response.getContentText().replace(secret, '***') : response.getContentText();
  Logger.log(text);
}

/** Debug: listet alle Deal-Custom-Fields (field_name + field_code), um KUNDENORDNER_LINK_FIELD_KEY zu finden. */
function listDealFieldsHelper() {
  const fields = fetchPipedrive('dealFields?limit=500');
  fields.forEach(f => Logger.log(`${f.field_name}  -->  ${f.field_code}`));
}

/**
 * Debug: zeigt die rohe Struktur des Adresse-Felds an der Person eines Deals.
 * Ausführen, wenn im Log-Sheet eine "Adresse-Feld hat unerwartete Struktur"-Warnung auftaucht.
 * Deal-ID unten anpassen -- der ▷-Button im Editor ruft ohne Argumente auf, ein Funktionsparameter
 * würde also als "undefined" ankommen (dieselbe Falle wie bei registerPipedriveWebhook()).
 */
function debugAdressFeld() {
  const dealId = 7253; // hier die Deal-ID aus der Log-Sheet-Warnung eintragen
  const deal = fetchPipedrive(`deals/${dealId}`);
  if (!deal.person_id) {
    Logger.log(`Deal ${dealId} hat keine verknüpfte Person.`);
    return;
  }
  const person = fetchPipedrive(`persons/${deal.person_id}`);
  Logger.log(JSON.stringify(person.custom_fields?.[ADRESSE_FIELD_KEY], null, 2));
}

/** Für Einzeltests: einen bekannten Deal durchlaufen lassen (Deal-ID unten anpassen). */
function testEinzelDeal() {
  starteLauf('testEinzelDeal');
  try {
    const result = processGewonnenDeal(7334); // Test-Deal-ID aus dem sevdesk-Sync-Projekt, ggf. anpassen
    Logger.log(result);
  } finally {
    flushLog();
  }
}

/**
 * Für kontrolliertes Testen: nur die hier eingetragenen Deal-IDs verarbeiten (statt auf den
 * Webhook zu warten), damit man die Ergebnisse im Log-Sheet gezielt gegenchecken kann.
 */
function processAusgewaehlteDeals() {
  starteLauf('processAusgewaehlteDeals');
  const dealIds = [7253]; // hier eigene Deal-IDs eintragen, z.B. [7253, 7301, 7455]
  const summary = { angelegt: 0, uebersprungen: 0, dryRun: 0, fehler: 0 };

  try {
    dealIds.forEach(dealId => {
      const result = processGewonnenDeal(dealId);
      Logger.log(`Deal ${dealId}: ${result}`);
      if (result.startsWith('angelegt')) summary.angelegt++;
      else if (result.startsWith('DRY-RUN')) summary.dryRun++;
      else if (result.startsWith('FEHLER')) summary.fehler++;
      else summary.uebersprungen++;
    });
  } finally {
    logLaufEnde(summary.fehler > 0 ? 'FEHLER' : 'OK', summary);
    flushLog();
  }
}
