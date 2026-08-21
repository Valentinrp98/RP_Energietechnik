// ===== WEBHOOK (change.deal + change.person) =====
// Ersetzt den taeglichen Trigger (2:00 Uhr) NICHT -- bleibt Sicherheitsnetz. Zwei Webhooks auf
// DERSELBEN Web-App-URL sind noetig, weil die PLZ an der PERSON steht, nicht am Deal:
//   - change.deal:   Deal wird neu mit Person verknuepft / bearbeitet, Bundesland noch leer
//   - change.person: PLZ/Adresse einer bereits verknuepften Person wird nachtraeglich geaendert
// Ohne den zweiten Webhook wuerde eine spaete PLZ-Korrektur an der Person nie sofort reagieren --
// nur der 2:00-Uhr-Trigger wuerde es am naechsten Tag nachziehen.
//
// Bewusste Einschraenkung wie bei Projektdoku-Generator: registriert ist nur "change", nicht "*"
// -- ein brandneuer Deal/Person aus einer Neuanlage (create-Event) wird nicht sofort erfasst,
// sondern erst vom naechsten Tageslauf. In der Praxis selten, weil Deals meist noch bearbeitet
// werden (Stage-Wechsel, Notiz), was seinerseits ein change.deal-Event ausloest.

// ===== KONFIGURATION =====
const WEBHOOK_SUBSCRIPTION_URL = 'TODO_WEB_APP_URL_MIT_SECRET';
const WEBHOOK_SHARED_SECRET = 'TODO_SHARED_SECRET';
const WEBHOOK_ID_ZUM_LOESCHEN = 0;

// ===== EMPFANG =====

/** Web-App-Einstiegspunkt. Antwortet IMMER mit 200 -- Begruendung siehe Projektdoku-Generator/
 *  Webhook.js: fillBundeslandForDeal() ist ueber das "bereits gesetzt"-Gate idempotent, ein
 *  Pipedrive-Retry braechte nichts, was der 2:00-Uhr-Trigger nicht ohnehin abdeckt. */
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
    if (meta.action !== 'change') {
      Logger.log(`doPost: Event ${meta.action}.${meta.entity} ignoriert (nur change registriert).`);
      return;
    }

    if (meta.entity === 'deal') {
      verarbeiteDealEvent(payload.data);
    } else if (meta.entity === 'person') {
      verarbeitePersonEvent(payload.data);
    } else {
      Logger.log(`doPost: Event fuer entity "${meta.entity}" ignoriert (nur deal/person registriert).`);
    }
  } finally {
    flushLog();
  }
}

/** Deal-Zweig: guenstiger Vorab-Filter ohne API-Call, dann Einzelverarbeitung mit Lock. */
function verarbeiteDealEvent(deal) {
  if (!deal || !deal.id) {
    Logger.log('doPost (deal): kein data.id im Payload -- Event ignoriert.');
    return;
  }
  const cf = deal.custom_fields || {};
  if (cf[BUNDESLAND_FIELD_KEY] && !FORCE_OVERWRITE) return; // schon gesetzt, nichts zu tun

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5 * 1000)) {
    logRow(deal.id, deal.title, null, 'übersprungen', null, {}, '[Webhook] Lock belegt -- wird vom nächsten Tages-Trigger nachgezogen');
    return;
  }
  try {
    // Bewusst KEIN dealVorab durchreichen -- Payload kann seit dem Event veraltet sein.
    const result = fillBundeslandForDeal(deal.id);
    Logger.log(`[Webhook/deal] Deal ${deal.id}: ${result}`);
  } catch (err) {
    logRow(deal.id, deal.title, null, 'FEHLER', null, {}, `[Webhook] ${err.message}`);
    Logger.log(`doPost (deal): FEHLER bei Deal ${deal.id} -- ${err.message}`);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Person-Zweig: die PLZ steht an der Person, nicht am Deal -- also muessen erst alle mit dieser
 * Person verknuepften Deals gesucht werden (eine Person kann mehrere Deals haben). limit=100 ohne
 * Pagination bewusst: mehr als 100 Deals an einer einzigen Person sind praktisch ausgeschlossen.
 */
function verarbeitePersonEvent(person) {
  if (!person || !person.id) {
    Logger.log('doPost (person): kein data.id im Payload -- Event ignoriert.');
    return;
  }
  let deals;
  try {
    deals = fetchPipedrive(`deals?person_id=${person.id}&limit=100`);
  } catch (err) {
    Logger.log(`doPost (person): Deal-Suche für Person ${person.id} fehlgeschlagen -- ${err.message}`);
    return;
  }
  const offene = (deals || []).filter(d => {
    const cf = d.custom_fields || {};
    return !cf[BUNDESLAND_FIELD_KEY] || FORCE_OVERWRITE;
  });
  if (offene.length === 0) return; // alle verknüpften Deals haben schon ein Bundesland

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5 * 1000)) {
    logRow(null, person.name, null, 'übersprungen', null, {}, `[Webhook] Person ${person.id}: Lock belegt -- wird vom nächsten Tages-Trigger nachgezogen`);
    return;
  }
  try {
    offene.forEach(deal => {
      try {
        // dealVorab durchreichen: kommt aus derselben Listenabfrage, hat custom_fields schon mit --
        // spart pro betroffenem Deal einen zusätzlichen Einzelabruf (FIX-1-Pattern).
        const result = fillBundeslandForDeal(deal.id, deal);
        Logger.log(`[Webhook/person ${person.id}] Deal ${deal.id}: ${result}`);
      } catch (err) {
        logRow(deal.id, deal.title, null, 'FEHLER', null, {}, `[Webhook/person ${person.id}] ${err.message}`);
        Logger.log(`doPost (person): FEHLER bei Deal ${deal.id} -- ${err.message}`);
      }
    });
  } finally {
    lock.releaseLock();
  }
}

// ===== REGISTRIERUNG =====
// WICHTIG (CLAUDE.md-Learning "Webhooks gibt es nur in v1"): Registrierung ueber /v1/ mit
// api_token als QUERY-PARAMETER -- anders als alle anderen Calls in diesem Projekt (x-api-token
// im Header, nur fuer v2-Daten-Endpunkte gueltig).

/** Registriert BEIDE Webhooks (deal + person) auf dieselbe subscription_url. */
function SETUP_EINMALIG_registerWebhook() {
  if (String(WEBHOOK_SUBSCRIPTION_URL).startsWith('TODO_')) {
    throw new Error('WEBHOOK_SUBSCRIPTION_URL ist noch nicht gesetzt -- erst Web-App deployen (Execute as: Me, Access: Anyone), URL inkl. ?secret=... eintragen.');
  }
  if (String(WEBHOOK_SHARED_SECRET).startsWith('TODO_')) {
    throw new Error('WEBHOOK_SHARED_SECRET ist noch nicht gesetzt.');
  }
  registriereEinenWebhook('deal');
  registriereEinenWebhook('person');
  Logger.log('Beide Webhooks registriert. Direkt danach checkWebhookRegistration() laufen lassen zur Gegenprobe.');
}

function registriereEinenWebhook(eventObject) {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/v1/webhooks?api_token=${getApiToken()}`;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      subscription_url: WEBHOOK_SUBSCRIPTION_URL,
      event_action: 'change',
      event_object: eventObject,
      version: '2.0'
    }),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  Logger.log(`Registrierung (${eventObject}): HTTP ${code} -- ${response.getContentText()}`);
  if (code !== 200 && code !== 201) {
    throw new Error(`Webhook-Registrierung (${eventObject}) fehlgeschlagen (HTTP ${code}): ${response.getContentText()}`);
  }
}

/** Diagnose: listet alle registrierten v1-Webhooks, prueft beide eigenen subscription_url-Eintraege. */
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
  ['deal', 'person'].forEach(obj => {
    if (!eigene.some(w => w.event_object === obj)) {
      Logger.log(`FEHLT: kein Webhook mit event_object "${obj}" -- SETUP_EINMALIG_registerWebhook() erneut ausführen oder gezielt registriereEinenWebhook("${obj}") aufrufen.`);
    }
  });
  const proObjekt = {};
  eigene.forEach(w => { proObjekt[w.event_object] = (proObjekt[w.event_object] || 0) + 1; });
  Object.entries(proObjekt).forEach(([obj, anzahl]) => {
    if (anzahl > 1) Logger.log(`ACHTUNG: ${anzahl} Webhooks fuer "${obj}" mit derselben subscription_url -- Duplikate. Ueberfluessige via loescheWebhookMitId() entfernen.`);
  });
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
