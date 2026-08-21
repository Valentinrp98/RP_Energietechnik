// ===== WEBHOOK (change.deal) =====
// Reagiert sofort auf Deal-Änderungen, statt auf den Tages-Trigger zu warten. Ersetzt den
// Tages-Trigger NICHT -- der bleibt als Sicherheitsnetz aktiv (Pipedrive kann Events verlieren,
// löscht einen Webhook nach 3 Tagen Dauerausfall automatisch, und HARD_ERROR/SOFT_ERROR-Deals
// brauchen ohnehin einen erneuten Versuch). Siehe README.md, Abschnitt "Webhook".

// ===== KONFIGURATION =====
// Web-App-URL erst nach dem ersten Deploy bekannt (Deploy > New deployment > Web app,
// "Execute as: Me", "Who has access: Anyone" -- MUSS ohne Google-Login erreichbar sein, sonst
// kommt Pipedrive nie durch). Danach hier eintragen, MIT dem ?secret=...-Anhang.
const WEBHOOK_SUBSCRIPTION_URL = 'TODO_WEB_APP_URL_MIT_SECRET';

// Zufälligen String eintragen (z.B. per `Utilities.getUuid()` einmal in der Konsole erzeugen) --
// Pipedrive kann keine Custom-Header mitschicken, deshalb Auth über einen Query-Param an der URL.
// Ohne das könnte jeder im Internet, der die Web-App-URL kennt/errät, processDeal() für beliebige
// Deal-IDs auslösen.
const WEBHOOK_SHARED_SECRET = 'TODO_SHARED_SECRET';

// Für loescheWebhookMitId() -- Editor-Funktionen mit Parametern kann man nicht per ▷-Button
// starten, deshalb Konstante statt Funktionsargument (gleiches Muster wie testEinzelDeal()).
const WEBHOOK_ID_ZUM_LOESCHEN = 0;

// ===== EMPFANG =====

/**
 * Web-App-Einstiegspunkt. Antwortet IMMER mit 200, auch bei eigenen Fehlern.
 *
 * Begründung: eine unbehandelte Exception in doPost lässt Google einen 5xx-artigen Fehler
 * zurückgeben -- das zählt bei Pipedrive als Fehlversuch (Retry nach 3/30/150s, Ban-Zähler, ab 10
 * Fehlversuchen 30 Min Sperre). processDeal() ist über den tatsächlichen Ordnerinhalt idempotent
 * (siehe DocGeneration.js, findExistingDoc/patchCustomFieldsVerified) -- ein Pipedrive-Retry würde
 * hier also nichts leisten, was der tägliche Backup-Trigger nicht ohnehin abdeckt. Deshalb: eigene
 * Fehler ins Log-Sheet, kein Rückkanal an Pipedrive, der den Ban-Zähler unnötig hochtreibt.
 */
function doPost(e) {
  try {
    verarbeiteWebhookEvent(e);
  } catch (err) {
    // Sollte nicht vorkommen (verarbeiteWebhookEvent fängt selbst) -- letzte Sicherung, damit doPost
    // in jedem Fall zurückkehrt statt mit einer Exception aus der Web-App-Runtime zu fallen.
    Logger.log(`doPost: unerwarteter Fehler außerhalb des inneren try/catch -- ${err.message}`);
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Payload-Format siehe Pipedrive "Guide for Webhooks v2": {meta: {action, entity, ...}, data, previous}.
 * `data` ist "the object data as of this update" -- vor dem eigentlichen processDeal() trotzdem
 * frisch nachgeladen (siehe unten), weil ungeklärt ist, ob das Webhook-`data` exakt dieselbe Form
 * hat wie eine GET /deals/{id}-Antwort (z.B. person_id-Verschachtelung). Der Vorab-Filter auf das
 * Statusfeld läuft aber bewusst NOCH auf dem rohen Payload, ohne API-Call -- der weit überwiegende
 * Teil aller change.deal-Events betrifft `Projektdokumentation-Partner` gar nicht, und genau das
 * ist der Kostenvorteil gegenüber dem Vollscan im Tages-Trigger.
 *
 * Bekannte Einschränkung: registriert ist nur `event_action: "change"`, nicht `"*"` -- ein Deal, der
 * schon BEI ANLAGE das Trigger-Feld gesetzt hat (z.B. Import), würde nicht sofort reagieren, sondern
 * erst vom nächsten Tageslauf erfasst. Bewusst nicht behandelt, weil in der Praxis extrem selten.
 */
function verarbeiteWebhookEvent(e) {
  starteLauf('doPost');
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
      Logger.log(`doPost: Event ${meta.action}.${meta.entity} ignoriert (nur change.deal registriert/erwartet).`);
      return;
    }

    const deal = payload.data;
    if (!deal || !deal.id) {
      Logger.log('doPost: kein data.id im Payload -- Event ignoriert.');
      return;
    }

    const cf = deal.custom_fields || {};
    const status = String(cf[DOKU_STATUS_FIELD_KEY]);
    let forceRegenerate;
    if (status === String(DOKU_STATUS_OPTION_TRIGGER)) forceRegenerate = false;
    else if (status === String(DOKU_STATUS_OPTION_NEU_ERSTELLEN)) forceRegenerate = true;
    else return; // die meisten Deal-Änderungen betreffen dieses Feld nicht -- stiller, günstiger Ausstieg

    verarbeiteTreffer(deal.id, deal.title);
  } finally {
    flushLog();
  }
}

/**
 * Kurzer Lock (5s) statt der 30s im Tages-Trigger: ein Event soll bei Konflikt lieber überspringen
 * (Backup-Trigger holt es nach) als Pipedrives 10-Sekunden-Antwortfenster zu riskieren.
 */
function verarbeiteTreffer(dealId, dealTitelAusPayload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5 * 1000)) {
    logRow(dealId, dealTitelAusPayload, null, 'SOFT_ERROR', null, null,
           '[Webhook] übersprungen -- Lock belegt (Tages-Trigger oder anderer Webhook-Event läuft), wird vom nächsten Tageslauf nachgezogen');
    return;
  }
  try {
    // Kein eigener checkConfiguration()-Aufruf hier -- zwei volle Feldlisten-Abrufe pro einzelnem
    // Event wären für die Web-App-Antwortzeit zu teuer. Der Tages-Trigger prüft die Config bereits
    // täglich und blockiert sich selbst bei Problemen; ein defekter Field-Code fällt hier stattdessen
    // als HARD_ERROR in dieser Zeile auf, statt den Lauf präventiv zu verweigern.
    const deal = fetchPipedrive(`deals/${dealId}`);
    // Status frisch neu auswerten statt den Payload-Wert von oben weiterzureichen -- zwischen Event
    // und dieser Zeile kann der Deal schon wieder anders stehen (z.B. Tages-Trigger war schneller).
    const statusFrisch = String((deal.custom_fields || {})[DOKU_STATUS_FIELD_KEY]);
    const forceRegenerate = statusFrisch === String(DOKU_STATUS_OPTION_NEU_ERSTELLEN);
    const result = processDeal(deal, forceRegenerate);
    logRow(deal.id, deal.title, result.kunde, result.status, result.docUrl, result.completeness, `[Webhook] ${result.detail}`);
  } catch (err) {
    logRow(dealId, dealTitelAusPayload, null, 'HARD_ERROR', null, null, `[Webhook] ${err.message}`);
    Logger.log(`doPost: HARD_ERROR bei Deal ${dealId} -- ${err.message}`);
  } finally {
    lock.releaseLock();
  }
}

// ===== REGISTRIERUNG =====

/**
 * Einmalig ausführen, NACHDEM die Web-App deployed und WEBHOOK_SUBSCRIPTION_URL/
 * WEBHOOK_SHARED_SECRET eingetragen sind.
 *
 * WICHTIG (CLAUDE.md-Learning "Webhooks gibt es nur in v1"): die Registrierung läuft über den
 * /v1/-Endpunkt mit `api_token` als QUERY-PARAMETER -- anders als jeder andere Call in diesem
 * Projekt, die alle `x-api-token` als Header nutzen (nur für v2-Daten-Endpunkte gültig). Genau
 * diese Verwechslung hat den Webhook von Ordnererstellung-bei-Gewonnen kaputt registriert (v1
 * statt v2 registriert, hat nie gefeuert). `version: "2.0"` + `event_action: "change"` (nicht
 * "updated") ist Pflicht -- sonst kommt entweder das alte v1-Payload-Format (current/previous statt
 * data/previous) oder gar kein Event an.
 */
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

/**
 * Diagnose: listet alle registrierten v1-Webhooks (gleicher Auth-Weg wie die Registrierung) und
 * prüft die eigene subscription_url auf version/event_action/event_object. Vor jedem "warum feuert
 * das nicht"-Verdacht hier zuerst nachsehen, statt zu raten -- genau diese Prüfung hätte den
 * v1/v2-Bug bei Ordnererstellung-bei-Gewonnen sofort sichtbar gemacht.
 *
 * Feldnamen der Antwort (id/version/event_action/event_object/active_flag) sind nicht gegen eine
 * echte Antwort verifiziert -- beim ersten Lauf wird die komplette Rohantwort mitgeloggt, damit sich
 * das sofort korrigieren lässt, falls Pipedrive andere Feldnamen liefert.
 */
function checkWebhookRegistration() {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/v1/webhooks?api_token=${getApiToken()}`;
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = response.getResponseCode();
  if (code !== 200) {
    Logger.log(`Abfrage fehlgeschlagen (HTTP ${code}): ${response.getContentText()}`);
    return;
  }
  const rohtext = response.getContentText();
  Logger.log(`Rohantwort (zur Gegenprobe der Feldnamen unten): ${rohtext}`);
  const data = JSON.parse(rohtext).data || [];
  const eigene = data.filter(w => w.subscription_url === WEBHOOK_SUBSCRIPTION_URL);
  if (eigene.length === 0) {
    Logger.log('Kein Webhook mit dieser subscription_url registriert -- SETUP_EINMALIG_registerWebhook() ausführen.');
    return;
  }
  eigene.forEach(w => {
    const versionOk = String(w.version) === '2.0' || String(w.version) === '2';
    const actionOk = w.event_action === 'change';
    const objectOk = w.event_object === 'deal';
    Logger.log(`Webhook ${w.id}: version=${w.version} (${versionOk ? 'ok' : 'FALSCH -- sollte 2.0 sein'}), ` +
               `event_action=${w.event_action} (${actionOk ? 'ok' : 'FALSCH'}), ` +
               `event_object=${w.event_object} (${objectOk ? 'ok' : 'FALSCH'}), aktiv=${w.active_flag}`);
  });
  if (eigene.length > 1) {
    Logger.log(`ACHTUNG: ${eigene.length} Webhooks mit derselben subscription_url -- Duplikate, jedes Event würde mehrfach ankommen. Überflüssige über loescheWebhookMitId() entfernen.`);
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
