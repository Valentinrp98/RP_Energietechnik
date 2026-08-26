// ===== WEBHOOK (change.deal) =====
// Reagiert sofort auf Deal-Änderungen, statt auf den Tages-Trigger zu warten. Ersetzt den
// Tages-Trigger NICHT -- der bleibt als Sicherheitsnetz aktiv (Pipedrive kann Events verlieren,
// löscht einen Webhook nach 3 Tagen Dauerausfall automatisch, und HARD_ERROR/SOFT_ERROR-Deals
// brauchen ohnehin einen erneuten Versuch). Siehe README.md, Abschnitt "Webhook".

// ===== KONFIGURATION =====
// Web-App-URL erst nach dem ersten Deploy bekannt (Deploy > New deployment > Web app,
// "Execute as: Me", "Who has access: Anyone" -- MUSS ohne Google-Login erreichbar sein, sonst
// kommt Pipedrive nie durch). Danach hier eintragen, MIT dem ?secret=...-Anhang.
// WICHTIG (24.08.2026): zeigt jetzt auf den Cloudflare-Worker-Relay statt direkt auf Apps Script --
// dieser Webhook wurde deshalb bereits von Pipedrive nach 3 Tagen Dauerausfall automatisch deaktiviert
// (302-Redirect-Problem). Siehe Montagepartner-aus-Bundesland/Webhook.js und
// [[project_cloudflare_webhook_relay]] in der Claude-Memory für die volle Diagnose.
const WEBHOOK_SUBSCRIPTION_URL = 'https://wispy-band-24d4.valentin-be0.workers.dev/?target=https%3A%2F%2Fscript.google.com%2Fmacros%2Fs%2FAKfycbz0ugT-r9AkiKeiKqM1gpzQi1IZAoRje4uXjau92OXdYrfIgKQS6hn4VHcCVEvsEActFA%2Fexec%3Fsecret%3D058e7406339685643355feca7ba1cd79';

// Zufälligen String eintragen (z.B. per `Utilities.getUuid()` einmal in der Konsole erzeugen) --
// Pipedrive kann keine Custom-Header mitschicken, deshalb Auth über einen Query-Param an der URL.
// Ohne das könnte jeder im Internet, der die Web-App-URL kennt/errät, processDeal() für beliebige
// Deal-IDs auslösen.
const WEBHOOK_SHARED_SECRET = '058e7406339685643355feca7ba1cd79';

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

    // BUGFIX 2026-08-26 (zweiter Anlauf -- der erste war falsch): das Entity-Feld heißt im
    // Webhooks-**v2**-Payload "meta.entity". "meta.object" ist die **v1**-Schreibweise. Ein Fix
    // vom selben Tag hatte das genau umgedreht (entity -> object) und damit den bis dahin
    // funktionierenden Filter kaputtgemacht: meta.object ist in v2 undefined, die Bedingung damit
    // immer wahr, jedes Event wurde ab Deployment-Version 3 stillschweigend verworfen.
    // Quelle: https://pipedrive.readme.io/docs/guide-for-webhooks-v2#webhook-format (v2: meta.entity)
    // vs. https://pipedrive.readme.io/docs/guide-for-webhooks (v1: meta.object) -- beide am
    // 26.08.2026 direkt gegen die Doku geprueft, nicht aus dem Gedaechtnis.
    // Deshalb wird jetzt BEIDES akzeptiert: der Filter darf nicht davon abhaengen, welche
    // Payload-Variante Pipedrive schickt -- diese Fehlerklasse soll in keiner Richtung mehr moeglich sein.
    const meta = payload.meta || {};
    const entity = meta.entity || meta.object;
    if (entity !== 'deal' || meta.action !== 'change') {
      // Ins Log-SHEET, nicht nur nach Stackdriver: genau dieser Zweig hat den Fix-Fehler oben
      // unsichtbar gemacht. Der stille Ausstieg weiter unten (Feld nicht betroffen) bleibt still --
      // der ist der Normalfall. Ein unerwartetes meta ist es nicht.
      logRow(null, null, null, 'SOFT_ERROR', null, null,
             `[Webhook] Event verworfen -- erwartet change.deal, bekommen ${meta.action}.${entity}. Roh-meta: ${JSON.stringify(meta)}`);
      return;
    }

    const deal = payload.data;
    if (!deal || !deal.id) {
      logRow(null, null, null, 'SOFT_ERROR', null, null,
             `[Webhook] Event verworfen -- kein data.id im Payload. Roh-meta: ${JSON.stringify(meta)}`);
      return;
    }

    // ===== Vorab-Filter auf dem rohen Payload, ohne API-Call =====
    // Der weit ueberwiegende Teil aller change.deal-Events betrifft das Statusfeld gar nicht, und
    // genau das ist der Kostenvorteil gegenueber dem Vollscan im Tages-Trigger.
    //
    // Fehlt der custom_fields-Block ganz, wird NICHT still ausgestiegen: dann stimmt die
    // Payload-Annahme nicht (wie schon zweimal), und wir wuerden wieder alles lautlos verwerfen.
    if (!deal.custom_fields) {
      logRow(deal.id, deal.title, null, 'SOFT_ERROR', null, null,
             '[Webhook] Payload enthaelt keinen custom_fields-Block -- Vorab-Filter nicht moeglich, Deal wird frisch geprueft. Wenn das dauerhaft auftritt: Payload-Format hat sich geaendert.');
      verarbeiteTreffer(deal.id, deal.title);
      return;
    }

    const statusRoh = deal.custom_fields[DOKU_STATUS_FIELD_KEY];
    const statusOptionId = leseWebhookOptionId(statusRoh);

    // Wert ist da, laesst sich aber nicht deuten -> die Formatannahme stimmt nicht mehr.
    // Genau hier lag der Bug (siehe leseWebhookOptionId): still bleiben ist das Schlimmste, was
    // dieser Zweig tun kann. Also laut ins Log und den Deal trotzdem frisch pruefen.
    if (statusRoh !== null && statusRoh !== undefined && statusOptionId === undefined) {
      logRow(deal.id, deal.title, null, 'SOFT_ERROR', null, null,
             `[Webhook] Statusfeld nicht interpretierbar, Payload-Format vermutlich geaendert -- Deal wird frisch geprueft. Rohwert: ${JSON.stringify(statusRoh)}`);
      verarbeiteTreffer(deal.id, deal.title);
      return;
    }

    const status = String(statusOptionId);
    if (status !== String(DOKU_STATUS_OPTION_TRIGGER) && status !== String(DOKU_STATUS_OPTION_NEU_ERSTELLEN)) {
      // Normalfall: diese Deal-Aenderung betrifft das Statusfeld nicht, oder es steht auf einem
      // anderen Wert (z.B. "erstellt und abgelegt", das schreibt dieses Script selbst). Stiller,
      // guenstiger Ausstieg -- absichtlich ohne Log-Zeile, sonst waechst das Sheet mit jedem
      // beliebigen Deal-Klick im Unternehmen.
      return;
    }

    verarbeiteTreffer(deal.id, deal.title);
  } finally {
    flushLog();
  }
}

/**
 * Options-ID eines Einfachauswahl-Felds aus einem Webhook-v2-PAYLOAD lesen.
 *
 * ⚠️ Das Webhook-Payload-Format ist NICHT das REST-API-v2-Format. Genau diese Verwechslung war der
 * Grund, warum dieser Webhook von Go-Live bis 26.08.2026 nie etwas getan hat:
 *
 *   REST v2 (GET /deals):  "custom_fields": { "<hash>": 235 }              -> nackter Wert
 *   Webhook v2:            "custom_fields": { "<hash>": {id: 235, type: "enum"} }  -> Objekt
 *
 * Der Code hat `String(cf[key])` auf das Objekt angewendet -> "[object Object]", das matcht nie
 * gegen "235", also stiller `return` bei JEDEM Event. Kein Fehler, keine Log-Zeile, Pipedrive bekam
 * brav 200 zurueck -- die Zustellstatistik sah bis zuletzt gesund aus (is_active=1,
 * last_http_status=200). Deshalb steckt der Beweis hier im Kommentar und nicht im Gedaechtnis:
 * https://pipedrive.readme.io/docs/webhooks-v2-migration-guide#custom-fields-format-in-webhooks-v2
 *
 * Weitere Typen aus derselben Doku-Sektion, falls hier mal mehr Felder gefiltert werden sollen:
 *   varchar/text/double/date/phone: {type, value}   monetary: {type, value, currency}
 *   enum:      {id, type}            set:  {values: [{id}, ...], type}
 *   people/org/user: {id, type}      address: {type, value, postal_code, locality, ...}
 * Bei "set" (Mehrfachauswahl) also NICHT diese Funktion nehmen -- die gibt dafuer absichtlich
 * undefined zurueck, statt eine der IDs zu erraten.
 *
 * Gibt bewusst `undefined` zurueck, wenn das Format unbekannt ist. Der Aufrufer macht daraus eine
 * laute Log-Zeile -- ein weiteres stilles Durchrutschen soll nicht mehr moeglich sein.
 */
function leseWebhookOptionId(feld) {
  if (feld === null || feld === undefined) return undefined;
  // Nackter Wert: REST-Form. Kommt hier normalerweise nicht an, ist aber der Fall, den der alte
  // Code angenommen hat -- bleibt akzeptiert, damit derselbe Filter auch mit einer API-Antwort
  // funktioniert (z.B. wenn jemand die Funktion spaeter im Tages-Trigger wiederverwendet).
  if (typeof feld !== 'object') return feld;
  if (feld.id !== undefined && feld.id !== null) return feld.id;      // enum/people/org/user
  if (feld.value !== undefined && feld.value !== null) return feld.value; // varchar/double/date/...
  return undefined; // unbekannte Form -> Aufrufer soll das laut melden, nicht raten
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
    // Und dann auch WIRKLICH danach handeln: ohne diese Prüfung würde processDeal() unabhängig vom
    // frischen Status laufen. Das ist der Unterschied zwischen "Doku bei Bedarf" und "Doku bei jeder
    // beliebigen Deal-Änderung" -- der Tages-Trigger filtert in findDealsForDokuErstellung(), dieser
    // Pfad hatte kein Gegenstück dazu. Nötig geworden durch den custom_fields-Fallback in
    // verarbeiteWebhookEvent(), der hier absichtlich ungefiltert hereinkommt.
    if (statusFrisch !== String(DOKU_STATUS_OPTION_TRIGGER) && statusFrisch !== String(DOKU_STATUS_OPTION_NEU_ERSTELLEN)) {
      Logger.log(`doPost: Deal ${dealId} steht beim Nachladen auf Status "${statusFrisch}" -- kein Trigger-Wert (mehr), nichts zu tun.`);
      return;
    }
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
 * Feldnamen 2026-08-21 gegen eine echte Antwort verifiziert: Pipedrive liefert "is_active",
 * nicht das zunächst angenommene "active_flag" -- deshalb hier weiterhin die Rohantwort mitloggen,
 * falls sich das nochmal ändert.
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
               `event_object=${w.event_object} (${objectOk ? 'ok' : 'FALSCH'}), aktiv=${w.is_active}`);
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

/**
 * Ein Aufruf, der beide Wege prüft: den Webhook (Sofort-Reaktion) UND den Tages-Trigger
 * (Sicherheitsnetz). Entstanden am 26.08.2026, weil das Log-Sheet gezeigt hat, dass BEIDE Wege
 * gleichzeitig still lagen -- kein einziger "[Webhook]"-Eintrag seit Go-Live, und keine
 * Zusammenfassungszeile des Tageslaufs mehr seit dem 21.08. Alle Einträge dazwischen kamen von
 * manuellen testEinzelDeal()-Läufen. Genau diese Kombination sieht von außen aus wie
 * "das Script funktioniert doch", weil ja Dokumente entstehen.
 *
 * Wichtig: ein von Pipedrive nach 3 Tagen Dauerausfall automatisch deaktivierter Webhook wird
 * NICHT dadurch wieder aktiv, dass man WEBHOOK_SUBSCRIPTION_URL im Code korrigiert -- die
 * Registrierung lebt in Pipedrive, nicht im Script. Dann muss SETUP_EINMALIG_registerWebhook()
 * erneut laufen.
 */
function DIAGNOSE_pruefeGesundheit() {
  const trigger = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'generateDailyProjectDocumentation');
  if (trigger.length === 0) {
    Logger.log('TAGES-TRIGGER: KEINER vorhanden -- das Sicherheitsnetz fehlt. SETUP_EINMALIG_createDailyTrigger() ausführen.');
  } else {
    Logger.log(`TAGES-TRIGGER: ${trigger.length} vorhanden (${trigger.length > 1 ? 'ACHTUNG: Duplikate, läuft mehrfach' : 'ok'}).`);
  }
  Logger.log('--- Webhook ---');
  checkWebhookRegistration();
}
