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

/**
 * EINMALIG: Trägt Kundenordner-Link für Deals nach, die schon vor dieser Automatisierung
 * manuell einen befüllten Ordner bekommen haben (Namensabgleich-Uebernahme, Stand 2026-08-20).
 * Verhindert, dass processGewonnenDeal() dort einen zweiten, doppelten Ordner anlegt --
 * das Skript prüft nur das Pipedrive-Feld, nicht ob in Drive schon ein Ordner existiert.
 */
function setzeBekannteKundenordnerLinks() {
  const links = {
    6037: 'https://drive.google.com/drive/folders/1xMmxVJs_k4yZB2u6gMMtoRvuWhC-u6w8', // Harald Lamprecht
    4876: 'https://drive.google.com/drive/folders/1rXdfnAXq1B7S3UP1_nInEM-KwqkizfqB', // Christoph Maier
    6439: 'https://drive.google.com/drive/folders/1E-geiNepgeZJXZEUFbGbLvUe8KjiYndt', // Manfred Kabelik
    6454: 'https://drive.google.com/drive/folders/1AB6VtlRlcds3cjGK8yZfk2o7ngURYLkV', // Johannes Moser
    7072: 'https://drive.google.com/drive/folders/1A_j1w1p8M9iyKTnkF3Af9KJ8vjGu1HyU', // Ralph Hemetinger
    6006: 'https://drive.google.com/drive/folders/19VebTT_r25H56yPwnFCjJDFyEjAnCumJ'  // Werner Kremser
  };
  Object.entries(links).forEach(([dealId, link]) => {
    patchPipedrive(`deals/${dealId}`, { custom_fields: { [KUNDENORDNER_LINK_FIELD_KEY]: link } });
    Logger.log(`Deal ${dealId}: Kundenordner-Link gesetzt -> ${link}`);
  });
}

/** Für Einzeltests: einen bekannten Deal durchlaufen lassen (Deal-ID unten anpassen). */
function testEinzelDeal() {
  starteLauf('testEinzelDeal');
  // Ronald Pargfrieder (4971) und Martin Gangl -- Montagepartner wurde manuell eingetragen
  const dealIds = [6692, 6207];
  try {
    dealIds.forEach(dealId => {
      const result = processGewonnenDeal(dealId);
      Logger.log(`Deal ${dealId}: ${result}`);
    });
  } finally {
    flushLog();
  }
}

/**
 * Kurzer Check: hat jeder der 32 Fulfillment-Deals einen Kundenordner-Link in Pipedrive?
 * Liest nur, schreibt nichts -- gefahrlos jederzeit ausführbar.
 */
function checkKundenordnerLinks() {
  const dealIds = [
    7065, 6970, 5587, 6694, 5779, 6922, 5984, 6659, 6084, 5837, 6591, 6686,
    6804, 5867, 6971, 6843, 7096, 6406, 7129, 5728, 6179, 6738, 6219, 6771,
    7059, 7107, 5307, 7177, 6908, 6018, 5663, 6493
  ];
  const fehlend = [];
  dealIds.forEach(dealId => {
    const deal = fetchPipedrive(`deals/${dealId}`);
    const link = deal.custom_fields?.[KUNDENORDNER_LINK_FIELD_KEY];
    if (!link) {
      fehlend.push(`${dealId} (${deal.title})`);
    }
  });
  if (fehlend.length === 0) {
    Logger.log(`Alle ${dealIds.length} Deals haben einen Kundenordner-Link. ✓`);
  } else {
    Logger.log(`${fehlend.length} von ${dealIds.length} OHNE Link:`);
    fehlend.forEach(f => Logger.log(`  - ${f}`));
  }
}

/**
 * Für kontrolliertes Testen: nur die hier eingetragenen Deal-IDs verarbeiten (statt auf den
 * Webhook zu warten), damit man die Ergebnisse im Log-Sheet gezielt gegenchecken kann.
 */
function processAusgewaehlteDeals() {
  starteLauf('processAusgewaehlteDeals');
  // Aus dem ersten Live-Batch von Projektdoku-Generator (21.08.) als "Kein Kundenordner-Link am
  // Deal" aufgefallen -- die alte 32er-Namensabgleich-Liste vom 20.08. ist inzwischen komplett
  // durch (alle 32 stehen im heutigen Log als OK), deshalb hier ersetzt statt ergänzt.
  // 6952 (Hajrulla Krasniqi) ist schon raus (21.08. angelegt) -- die übrigen 14 hängen noch bei
  // Montagepartner-aus-Bundesland fest ("kein Montagepartner gesetzt"), erst DANACH hier nochmal laufen lassen.
  const dealIds = [
    4945, 5142, 5237, 5373, 5530, 5749, 5758, 5829, 5972, 6013, 6027, 6198, 6326, 6592
  ];
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
