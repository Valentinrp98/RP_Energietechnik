// ===== WEBHOOK (change.deal) =====
// Reagiert sofort, wenn sich das Bundesland-Feld an einem Deal aendert (typischerweise: das
// Bundesland-aus-PLZ-Script hat es gerade gesetzt). Ersetzt den taeglichen Trigger (3:00 Uhr)
// NICHT -- der bleibt als Sicherheitsnetz, falls ein Webhook-Event verloren geht oder Pipedrive
// den Webhook nach 3 Tagen Dauerausfall automatisch loescht.
//
// Praktischer Nebeneffekt der Verkettung: schreibt Bundesland-aus-PLZ per SEINEM eigenen Webhook
// das Bundesland-Feld, ist DAS selbst wieder ein change.deal-Event -- dieses Script reagiert dann
// binnen Sekunden, statt bis 3:00 Uhr zu warten. Kein Ping-Pong-Risiko: fillMontagepartnerForDeal()
// prueft "Montagepartner bereits gesetzt" VOR dem Schreiben, der Folge-Event durch den eigenen
// Schreibvorgang bricht also beim naechsten Durchlauf sofort ab.

// ===== KONFIGURATION =====
const WEBHOOK_SUBSCRIPTION_URL = 'TODO_WEB_APP_URL_MIT_SECRET';
const WEBHOOK_SHARED_SECRET = 'TODO_SHARED_SECRET';
const WEBHOOK_ID_ZUM_LOESCHEN = 0;

// ===== EMPFANG =====

/**
 * Web-App-Einstiegspunkt. Antwortet IMMER mit 200, auch bei eigenen Fehlern -- siehe Begruendung
 * in Projektdoku-Generator/Webhook.js (gleiches Pattern): fillMontagepartnerForDeal() ist ueber
 * das "bereits gesetzt"-Gate idempotent, ein Pipedrive-Retry brächte hier nichts, was der
 * 3:00-Uhr-Trigger nicht ohnehin abdeckt -- deshalb eigene Fehler ins Log, kein Rueckkanal, der
 * den Ban-Zaehler unnoetig hochtreibt.
 */
function doPost(e) {
  try {
    verarbeiteWebhookEvent(e);
  } catch (err) {
    Logger.log(`doPost: unerwarteter Fehler außerhalb des inneren try/catch -- ${err.message}`);
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

function verarbeiteWebhookEvent(e) {
  try {
    if (!e.parameter || e.parameter.secret !== WEBHOOK_SHARED_SECRET) {
      Logger.log('doPost: falsches oder fehlendes secret -- Event ignoriert.');
      return;
    }
    if (!e.postData || !e.postData.contents) {
      Logger.log('doPost: kein Body -- Event ignoriert.');
      return;
    }
    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (err) {
      Logger.log(`doPost: Body kein gültiges JSON -- ${err.message}`);
      return;
    }

    const meta = payload.meta || {};
    if (meta.entity !== 'deal' || meta.action !== 'change') {
      Logger.log(`doPost: Event ${meta.action}.${meta.entity} ignoriert (nur change.deal registriert).`);
      return;
    }

    const deal = payload.data;
    if (!deal || !deal.id) {
      Logger.log('doPost: kein data.id im Payload -- Event ignoriert.');
      return;
    }

    // Guenstiger Vorab-Filter OHNE API-Call: der weit ueberwiegende Teil aller change.deal-Events
    // im ganzen Account betrifft weder Bundesland noch Montagepartner. Nur weiterverarbeiten, wenn
    // Bundesland gesetzt UND Montagepartner noch NICHT gesetzt ist (Rohwert aus dem Webhook-Payload).
    const cf = deal.custom_fields || {};
    if (!cf[BUNDESLAND_FIELD_KEY] || (cf[MONTAGEPARTNER_FIELD_KEY] && !FORCE_OVERWRITE)) {
      return;
    }

    verarbeiteTreffer(deal.id, deal.title);
  } finally {
    flushLog();
  }
}

/** Kurzer Lock (5s): bei Konflikt lieber ueberspringen (3:00-Uhr-Trigger holt es nach) als
 *  Pipedrives 10-Sekunden-Antwortfenster zu riskieren. */
function verarbeiteTreffer(dealId, dealTitelAusPayload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5 * 1000)) {
    logRow(dealId, dealTitelAusPayload, null, 'übersprungen', null, '[Webhook] Lock belegt -- wird vom nächsten Tages-Trigger nachgezogen');
    return;
  }
  try {
    // fillMontagepartnerForDeal() ruft fetchPipedrive() bei fehlendem dealVorab.custom_fields
    // selbst auf -- hier bewusst KEIN dealVorab durchreichen, der Payload kann seit dem Event
    // veraltet sein (z.B. zwischenzeitlich schon vom Tages-Trigger verarbeitet).
    const result = fillMontagepartnerForDeal(dealId);
    Logger.log(`[Webhook] Deal ${dealId}: ${result}`);
  } catch (err) {
    logRow(dealId, dealTitelAusPayload, null, 'FEHLER', null, `[Webhook] ${err.message}`);
    Logger.log(`doPost: FEHLER bei Deal ${dealId} -- ${err.message}`);
  } finally {
    lock.releaseLock();
  }
}

// ===== REGISTRIERUNG =====
// WICHTIG (CLAUDE.md-Learning "Webhooks gibt es nur in v1"): Registrierung ueber /v1/ mit
// api_token als QUERY-PARAMETER -- anders als alle anderen Calls in diesem Projekt (x-api-token
// im Header, nur fuer v2-Daten-Endpunkte gueltig). version:"2.0" + event_action:"change" ist
// Pflicht, sonst kommt entweder das alte v1-Payload-Format oder gar kein Event an.

function SETUP_EINMALIG_registerWebhook() {
  if (String(WEBHOOK_SUBSCRIPTION_URL).startsWith('TODO_')) {
    throw new Error('WEBHOOK_SUBSCRIPTION_URL ist noch nicht gesetzt -- erst Web-App deployen (Execute as: Me, Access: Anyone), URL inkl. ?secret=... eintragen.');
  }
  if (String(WEBHOOK_SHARED_SECRET).startsWith('TODO_')) {
    throw new Error('WEBHOOK_SHARED_SECRET ist noch nicht gesetzt.');
  }
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/v1/webhooks?api_token=${getApiToken()}`;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      subscription_url: WEBHOOK_SUBSCRIPTION_URL,
      event_action: 'change',
      event_object: 'deal',
      version: '2.0'
    }),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  Logger.log(`Registrierung: HTTP ${code} -- ${response.getContentText()}`);
  if (code !== 200 && code !== 201) {
    throw new Error(`Webhook-Registrierung fehlgeschlagen (HTTP ${code}): ${response.getContentText()}`);
  }
  Logger.log('Registriert. Direkt danach checkWebhookRegistration() laufen lassen zur Gegenprobe.');
}

/** Diagnose: listet alle registrierten v1-Webhooks, prueft die eigene subscription_url. Beim
 *  ersten Lauf wird die Rohantwort mitgeloggt, falls Pipedrive andere Feldnamen liefert. */
function checkWebhookRegistration() {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/v1/webhooks?api_token=${getApiToken()}`;
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = response.getResponseCode();
  if (code !== 200) {
    Logger.log(`Abfrage fehlgeschlagen (HTTP ${code}): ${response.getContentText()}`);
    return;
  }
  const rohtext = response.getContentText();
  Logger.log(`Rohantwort: ${rohtext}`);
  const data = JSON.parse(rohtext).data || [];
  const eigene = data.filter(w => w.subscription_url === WEBHOOK_SUBSCRIPTION_URL);
  if (eigene.length === 0) {
    Logger.log('Kein Webhook mit dieser subscription_url registriert -- SETUP_EINMALIG_registerWebhook() ausführen.');
    return;
  }
  eigene.forEach(w => {
    Logger.log(`Webhook ${w.id}: version=${w.version}, event_action=${w.event_action}, event_object=${w.event_object}, aktiv=${w.active_flag}`);
  });
  if (eigene.length > 1) {
    Logger.log(`ACHTUNG: ${eigene.length} Webhooks mit derselben subscription_url -- Duplikate. Ueberfluessige via loescheWebhookMitId() entfernen.`);
  }
}

/** WEBHOOK_ID_ZUM_LOESCHEN oben eintragen (ID aus checkWebhookRegistration()), dann ausführen. */
function loescheWebhookMitId() {
  if (!WEBHOOK_ID_ZUM_LOESCHEN) {
    throw new Error('WEBHOOK_ID_ZUM_LOESCHEN ist noch 0 -- ID aus checkWebhookRegistration() eintragen.');
  }
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/v1/webhooks/${WEBHOOK_ID_ZUM_LOESCHEN}?api_token=${getApiToken()}`;
  const response = UrlFetchApp.fetch(url, { method: 'delete', muteHttpExceptions: true });
  Logger.log(`Löschung: HTTP ${response.getResponseCode()} -- ${response.getContentText()}`);
}
