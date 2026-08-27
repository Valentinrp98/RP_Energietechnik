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

// Drosselung fuer planeNachzieherLauf()/pruefeConfigGedrosselt(). Beide Marker liegen in den
// ScriptProperties, damit sie einen Aufruf ueberleben -- jeder Webhook-Event ist eine eigene
// Ausfuehrung, globale Variablen sind danach weg.
const PROP_NACHZIEHER_GEPLANT = 'PROJEKTDOKU_NACHZIEHER_GEPLANT_TS';
const PROP_CONFIG_GEPRUEFT = 'PROJEKTDOKU_CONFIG_GEPRUEFT_TS';
const NACHZIEHER_DROSSEL_MS = 5 * 60 * 1000;
const CONFIG_PRUEFUNG_DROSSEL_MS = 60 * 60 * 1000;

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
    // KORREKTUR 27.08.2026: hier stand "verarbeiteWebhookEvent fängt selbst" -- falsch, die
    // Funktion hat try/finally OHNE catch. Alles, was dort ausserhalb von verarbeiteTreffer()
    // wirft (z.B. flushLog auf ein geloeschtes Sheet), landet wirklich hier. Deshalb zusaetzlich
    // der Versuch einer Sheet-Zeile -- ein reines Logger.log wuerde genau die Fehlerklasse
    // verstecken, die dieses Projekt schon einmal wochenlang unsichtbar gemacht hat.
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

  // Ab hier: kein Wert lesbar. Zwei sehr verschiedene Faelle, die vorher beide als "unbekanntes
  // Format" durchgingen und deshalb einen Fehlalarm samt vollem Deal-Nachladen ausgeloest haben:
  //
  //   a) BEKANNTER Typ, Feld gerade geleert  -> z.B. {"id": null, "type": "enum"}. Voellig normal,
  //      passiert bei jedem Leeren des Dropdowns. Muss still bleiben.
  //   b) UNBEKANNTE Form                     -> Payload-Format hat sich geaendert. Muss laut sein.
  //
  // Unterschieden wird am type-Diskriminator, den Pipedrive bei jedem Custom Field mitschickt.
  // 'set', 'daterange' und 'timerange' stehen bewusst NICHT in der Liste: die tragen ihre Werte in
  // `values`/`from`/`until`, ein Aufrufer der auf eine einzelne Options-ID vergleicht wuerde hier
  // stillschweigend das Falsche bekommen. Fuer die soll diese Funktion weiter undefined liefern.
  const BEKANNTE_EINZELWERT_TYPEN = [
    'enum', 'people', 'org', 'user',
    'varchar', 'varchar_auto', 'text', 'double', 'monetary', 'date', 'time', 'phone', 'address'
  ];
  if (feld.type && BEKANNTE_EINZELWERT_TYPEN.indexOf(String(feld.type)) !== -1) {
    return null; // bekannter Typ, aber leer -> Aufrufer behandelt das als "kein Trigger-Wert"
  }
  return undefined; // unbekannte Form -> Aufrufer soll das laut melden, nicht raten
}

/**
 * Kurzer Lock (5s) statt der 30s im Tages-Trigger: Pipedrives Antwortfenster liegt bei ~10s, ein
 * langes Warten wuerde als Zustellfehler zaehlen (und nach 3 Tagen Dauerausfall loescht Pipedrive
 * den Webhook -- genau das ist diesem Projekt schon passiert).
 *
 * FIX 27.08.2026: bei Lock-Konflikt wurde vorher eine Zeile "wird vom naechsten Tageslauf
 * nachgezogen" geschrieben -- und dann NICHTS nachgezogen, weil der Tages-Trigger nie angelegt
 * wurde. Ein Bulk-Edit des Statusfelds auf mehreren Deals (der vorgesehene Workflow!) erzeugt
 * mehrere Events fast gleichzeitig; Event 1 haelt den Lock ueber die gesamte Doc-Erzeugung
 * (Person-Fetch + Drive-Lookups + DocumentApp.create + moveTo + PATCHes, realistisch 6-15s),
 * alle weiteren liefen in den Timeout und blieben endgueltig liegen. Die Log-Zeile behauptete eine
 * Rettung, die es nicht gab. Jetzt wird ein echter Nachzieh-Lauf eingeplant.
 */
function verarbeiteTreffer(dealId, dealTitelAusPayload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5 * 1000)) {
    planeNachzieherLauf(`Lock belegt bei Deal ${dealId}`);
    logRow(dealId, dealTitelAusPayload, null, 'SOFT_ERROR', null, null,
           '[Webhook] uebersprungen -- Lock belegt, Nachzieh-Lauf eingeplant (planeNachzieherLauf)');
    return;
  }
  try {
    pruefeConfigGedrosselt();
    const deal = fetchPipedrive(`deals/${dealId}`);
    // Status frisch neu auswerten statt den Payload-Wert von oben weiterzureichen -- zwischen Event
    // und dieser Zeile kann der Deal schon wieder anders stehen (z.B. Nachzieh-Lauf war schneller).
    const statusFrisch = String((deal.custom_fields || {})[DOKU_STATUS_FIELD_KEY]);
    // Und dann auch WIRKLICH danach handeln: ohne diese Pruefung wuerde processDeal() unabhaengig
    // vom frischen Status laufen -- der Unterschied zwischen "Doku bei Bedarf" und "Doku bei jeder
    // beliebigen Deal-Aenderung". Noetig wegen des custom_fields-Fallbacks in
    // verarbeiteWebhookEvent(), der hier absichtlich ungefiltert hereinkommt.
    if (statusFrisch !== String(DOKU_STATUS_OPTION_TRIGGER) && statusFrisch !== String(DOKU_STATUS_OPTION_NEU_ERSTELLEN)) {
      Logger.log(`doPost: Deal ${dealId} steht beim Nachladen auf Status "${statusFrisch}" -- kein Trigger-Wert (mehr), nichts zu tun.`);
      return;
    }
    const forceRegenerate = statusFrisch === String(DOKU_STATUS_OPTION_NEU_ERSTELLEN);
    const result = processDeal(deal, forceRegenerate);

    // Log-Aufteilung (FIX 27.08.2026, gleiche Klasse wie Ordnererstellung-Commit 658d4ab):
    // Ein Deal, der auf einem Trigger-Wert steht und dauerhaft blockiert ist (haeufigster Fall:
    // Kundenordner-Link fehlt noch, weil Ordnererstellung-bei-Gewonnen noch nicht gelaufen ist),
    // erzeugte bei JEDER weiteren Deal-Aenderung eine identische SOFT_ERROR-Zeile -- inklusive der
    // Aenderungen, die der sevdesk-Sync alle 5 Minuten schreibt. Unbegrenzt wachsend, und die
    // echten Fehler waeren darin untergegangen (Sheets-Limit 10 Mio Zellen).
    // Wiederholbare Grenzfaelle deshalb nur nach Stackdriver; ins Sheet gehoert der Erfolg und das
    // technische Versagen. Der Tages-Trigger protokolliert blockierte Deals weiterhin einmal
    // taeglich ins Sheet -- DESHALB ist SETUP_EINMALIG_createDailyTrigger() Pflicht, nicht Deko.
    if (result.status === 'SOFT_ERROR') {
      Logger.log(`doPost: Deal ${dealId} uebersprungen (SOFT_ERROR) -- ${result.detail}`);
    } else {
      logRow(deal.id, deal.title, result.kunde, result.status, result.docUrl, result.completeness, `[Webhook] ${result.detail}`);
    }
  } catch (err) {
    logRow(dealId, dealTitelAusPayload, null, 'HARD_ERROR', null, null, `[Webhook] ${err.message}`);
    Logger.log(`doPost: HARD_ERROR bei Deal ${dealId} -- ${err.message}`);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Einmaliger Nachzieh-Lauf in ~2 Minuten. Ersetzt die frueher nur behauptete Rettung bei
 * Lock-Konflikt durch eine echte: generateDailyProjectDocumentation() scannt alle Deals auf die
 * Trigger-Werte, ist idempotent und prueft vorher die Config -- damit holt EIN Lauf beliebig viele
 * liegengebliebene Events nach, egal wie viele Events gleichzeitig kamen.
 *
 * Drosselung ueber eine ScriptProperty statt ueber Trigger-Introspektion: Apps Script bietet keine
 * verlaessliche Unterscheidung zwischen einem taeglichen und einem einmaligen Clock-Trigger, ein
 * Aufraeumen "aller Clock-Trigger dieser Funktion" wuerde also den Tages-Trigger mitloeschen.
 * Ohne Drosselung wuerde ein Bulk-Edit auf 20 Deals 19 Trigger anlegen und ins Apps-Script-Limit
 * (20 Trigger pro Script und Nutzer) laufen -- das blockiert dann auch
 * SETUP_EINMALIG_createDailyTrigger(). Ein einziger Nachzieher reicht ohnehin fuer alle.
 */
function planeNachzieherLauf(grund) {
  try {
    const props = PropertiesService.getScriptProperties();
    const letzter = Number(props.getProperty(PROP_NACHZIEHER_GEPLANT) || 0);
    if (Date.now() - letzter < NACHZIEHER_DROSSEL_MS) {
      Logger.log(`planeNachzieherLauf: bereits einer eingeplant (${grund}) -- kein zweiter.`);
      return;
    }
    ScriptApp.newTrigger('generateDailyProjectDocumentation')
      .timeBased().after(2 * 60 * 1000).create();
    props.setProperty(PROP_NACHZIEHER_GEPLANT, String(Date.now()));
    Logger.log(`planeNachzieherLauf: Nachzieh-Lauf in 2 Min eingeplant (${grund}).`);
  } catch (e) {
    // Nicht werfen: der Webhook-Event soll deswegen nicht als Fehler enden. Aber laut ins Sheet --
    // ohne Nachzieher ist der Deal wirklich liegengeblieben, und das ist kein Grenzfall.
    logRow(null, null, null, 'HARD_ERROR', null, null,
           `[Webhook] Nachzieh-Lauf konnte NICHT eingeplant werden (${e.message}) -- liegengebliebene Deals brauchen einen manuellen Lauf von generateDailyProjectDocumentation()`);
  }
}

/**
 * checkConfiguration() hoechstens einmal pro Stunde, Ergebnis-Zeitpunkt in einer ScriptProperty.
 *
 * FIX 27.08.2026: vorher stand hier bewusst KEIN Config-Check, begruendet mit "der Tages-Trigger
 * prueft das ja taeglich". Da der Tages-Trigger nie existierte, war die Pruefung faktisch komplett
 * abgeschaltet -- genau die Pruefung, die gegen die stille Nicht-Schreibung gebaut wurde (eine in
 * Pipedrive verschobene Options-ID laesst den PATCH leer rausgehen, Pipedrive antwortet 200, das
 * Log meldet Erfolg, geschrieben wurde nichts). Zwei Feldlisten-Abrufe pro Event waeren fuer die
 * Web-App-Antwortzeit zu teuer, einmal pro Stunde ist es nicht.
 *
 * Wirft bei Problemen: der Aufrufer macht daraus eine HARD_ERROR-Zeile, und es wird nichts
 * geschrieben. Lieber ein sichtbarer Fehler als ein stiller Erfolg.
 */
function pruefeConfigGedrosselt() {
  const props = PropertiesService.getScriptProperties();
  const letzte = Number(props.getProperty(PROP_CONFIG_GEPRUEFT) || 0);
  if (Date.now() - letzte < CONFIG_PRUEFUNG_DROSSEL_MS) return;
  const probleme = checkConfiguration();
  props.setProperty(PROP_CONFIG_GEPRUEFT, String(Date.now()));
  if (probleme.length > 0) {
    throw new Error(`Config-Pruefung fehlgeschlagen, nichts geschrieben: ${probleme.join(' | ')}`);
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
    const aktivHinweis = String(w.is_active) === '1' || w.is_active === true
      ? 'aktiv'
      : 'INAKTIV -- Pipedrive hat den Webhook deaktiviert (3 Tage Dauerausfall), SETUP_EINMALIG_registerWebhook() noetig';
    Logger.log(`Webhook ${w.id}: version=${w.version} (${versionOk ? 'ok' : 'FALSCH -- sollte 2.0 sein'}), ` +
               `event_action=${w.event_action} (${actionOk ? 'ok' : 'FALSCH'}), ` +
               `event_object=${w.event_object} (${objectOk ? 'ok' : 'FALSCH'}), ${aktivHinweis}`);
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
