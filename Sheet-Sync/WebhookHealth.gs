// ===== WEBHOOK-ERREICHBARKEIT (täglicher Check, liest nur) =====
//
// ANLASS (2.9.2026): Der Montagepartner-Webhook war tot und niemand hat es gemerkt.
// Zugriffsberechtigung stand auf "Jeder mit einem Google-Konto" (appsscript.json:
// webapp.access = ANYONE statt ANYONE_ANONYMOUS), also beantwortete Google jeden Aufruf mit
// einer Weiterleitung auf accounts.google.com/ServiceLogin -- doPost() lief NIE.
//
// Warum das keiner gesehen hat: Der Cloudflare-Relay
// (https://wispy-band-24d4.valentin-be0.workers.dev/) gibt am Ende UNBEDINGT 200 "ok" zurück,
// unabhängig vom Upstream-Status -- auch bei einer erfundenen Deployment-ID, auch im catch.
// Das war Absicht (Pipedrive löscht einen Webhook nach 3 Tagen Dauerausfall), hat aber
// "Webhook wird gelöscht" gegen "Webhook fällt unsichtbar für immer aus" getauscht.
// Pipedrive sieht 200, das Log-Sheet sieht nichts, weil gar kein Script-Code läuft.
//
// Dieser Check schließt genau diese Lücke: er fragt die /exec-URLs DIREKT (nicht über den Relay)
// per GET und schaut sich den ERSTEN Hop an.
//
// GEMESSEN am 2.9.2026 gegen alle vier Deployments -- die Erwartung "gesund = 302 auf
// script.googleusercontent.com" stimmt nur für POST. Bei GET sieht es so aus:
//   gesund : HTTP 200, keine Location, Body ist die Apps-Script-Fehlerseite
//            ("Script function not found: doGet", <title>Fehler</title>).
//            Der Zugriff war erlaubt, das Script wurde erreicht -- genau das wollen wir wissen.
//   kaputt : HTTP 302 mit Location auf accounts.google.com/ServiceLogin,
//            Body <title>Sign in - Google Accounts</title>.
//
// Das eigentliche Unterscheidungsmerkmal ist deshalb NICHT der Status-Code, sondern die Frage:
// landet der Aufruf auf einer Google-Anmeldeseite? Ein Check auf "== 200" würde bei POST
// fälschlich Alarm schlagen, ein Check auf "== 302" bei GET.
//
// Nebenwirkungsfrei: followRedirects:false bricht nach dem ersten Hop ab, und keines der vier
// Projekte definiert ein doGet() (nur doPost) -- ein GET führt also keinen Handler aus und
// schreibt nirgends etwas. DRY_RUN ist hier ohne Bedeutung, die Funktion liest ausschließlich.

// Deployment-IDs der vier Webhook-Projekte -- identisch mit der Tabelle in der Repo-CLAUDE.md
// und mit den bei Pipedrive registrierten subscription_urls (dort im target=-Parameter).
// Bei einem "New deployment" (statt Version-Update) ändern sich diese IDs -- dann hier UND in
// der CLAUDE.md nachziehen, sonst prüft der Check eine Leiche.
const WEBHOOK_DEPLOYMENTS = {
  'Bundesland-aus-PLZ': 'AKfycbz6qogKvDL1wpO5bkITp8W9h2f6wHoha_QK6JtsJD7Cil9rF-dpeJqa8WQR391HmIA60Q',
  'Montagepartner-aus-Bundesland': 'AKfycbwdb-CW4Rnj97F0_dWGPu5oBWCPX9WX5lsLxNY3pKM4Ay1uZL5qghixDaodvNy9oe1MqA',
  'Projektdoku-Generator': 'AKfycbz0ugT-r9AkiKeiKqM1gpzQi1IZAoRje4uXjau92OXdYrfIgKQS6hn4VHcCVEvsEActFA',
  'Ordnererstellung-bei-Gewonnen': 'AKfycbwOT0kO7tcxfEsgJ412zOvTzb2p3IuUXxnbcQfAkPwB4h8n8vQ-QGbDSe8Gg0YpQ4o7'
};

const RELAY_BASIS_URL = 'https://wispy-band-24d4.valentin-be0.workers.dev/';

/**
 * Täglicher Check: sind die vier Webhook-Web-Apps für einen anonymen Aufrufer erreichbar, und
 * steht der Relay überhaupt? Schreibt pro Projekt eine Log-Zeile und schließt mit
 * MANUELL_KLAEREN ab, sobald eines kaputt ist. Für einen Zeit-Trigger gedacht
 * (installWebhookHealthTrigger() unten). Kein Parameter -- per ▷ im Editor startbar.
 */
function pruefeWebhookErreichbarkeit() {
  starteLauf('pruefeWebhookErreichbarkeit');
  const kaputt = [];
  let geprueft = 0;

  try {
    // Relay zuerst: fällt der aus, sind alle vier Webhooks tot, egal wie gesund Google antwortet.
    // Ohne target-Parameter antwortet der Worker mit 200 "missing target param" -- das ist der
    // billigste Lebensbeweis, der keinen Script-Aufruf nach sich zieht.
    try {
      const relay = UrlFetchApp.fetch(RELAY_BASIS_URL, { method: 'get', muteHttpExceptions: true });
      const relayCode = relay.getResponseCode();
      if (relayCode === 200) {
        logRow('webhook-check', null, 'Cloudflare-Relay', null, 'OK', 'Worker antwortet (HTTP 200)');
      } else {
        logRow('webhook-check', null, 'Cloudflare-Relay', null, 'MANUELL_KLAEREN',
               `Relay antwortet HTTP ${relayCode} -- ALLE vier Webhooks sind damit tot, unabhängig von Google.`);
        kaputt.push('Cloudflare-Relay');
      }
    } catch (err) {
      logRow('webhook-check', null, 'Cloudflare-Relay', null, 'MANUELL_KLAEREN',
             `Relay nicht erreichbar (${err.message}) -- ALLE vier Webhooks sind damit tot.`);
      kaputt.push('Cloudflare-Relay');
    }

    Object.entries(WEBHOOK_DEPLOYMENTS).forEach(([projekt, deploymentId]) => {
      geprueft++;
      const execUrl = `https://script.google.com/macros/s/${deploymentId}/exec`;

      let status, location;
      try {
        // followRedirects:false ist der ganze Trick -- wir wollen die 302 SEHEN, nicht ihr folgen.
        const resp = UrlFetchApp.fetch(execUrl, {
          method: 'get',
          followRedirects: false,
          muteHttpExceptions: true
        });
        status = resp.getResponseCode();
        const headers = resp.getAllHeaders();
        // Header-Namen kommen je nach Fall in unterschiedlicher Schreibweise zurück.
        location = String(headers['Location'] || headers['location'] || '');
      } catch (err) {
        logRow('webhook-check', null, projekt, null, 'MANUELL_KLAEREN',
               `Aufruf von /exec fehlgeschlagen: ${err.message}`);
        kaputt.push(projekt);
        return;
      }

      // Reihenfolge ist wichtig: ZUERST auf die Anmeldeseite prüfen. Das ist das einzige
      // verlässliche Kaputt-Signal, unabhängig von Methode und Status-Code.
      if (location.indexOf('accounts.google.com') !== -1) {
        logRow('webhook-check', null, projekt, null, 'MANUELL_KLAEREN',
               `KAPUTT (HTTP ${status} -> Google-Anmeldeseite): Die Zugriffsberechtigung steht auf `
               + '"Jeder mit einem Google-Konto". Pipedrive kann sich nicht anmelden, doPost() läuft NIE. '
               + 'Der Relay verdeckt das, weil er Pipedrive trotzdem 200 gibt. Fix: in appsscript.json '
               + 'webapp.access auf ANYONE_ANONYMOUS setzen, clasp push, clasp deploy --deploymentId.');
        kaputt.push(projekt);
        return;
      }

      // Alles, was das Script tatsächlich erreicht hat, gilt als gesund: 200 (GET, kein doGet
      // definiert -> Apps-Script-Fehlerseite) oder die 302 auf googleusercontent (POST-Fall).
      if (status === 200 || (status === 302 && location.indexOf('script.googleusercontent.com') !== -1)) {
        logRow('webhook-check', null, projekt, null, 'OK',
               `erreichbar (HTTP ${status}${location ? ' -> script.googleusercontent.com' : ', kein Redirect'})`);
        return;
      }

      logRow('webhook-check', null, projekt, null, 'MANUELL_KLAEREN',
             `unerwartete Antwort HTTP ${status}${location ? ` -> ${location}` : ' (keine Location)'}. `
             + 'Erwartet war 200 oder eine 302 auf script.googleusercontent.com. '
             + 'Deployment gelöscht oder Deployment-ID veraltet?');
      kaputt.push(projekt);
    });
  } finally {
    logLaufEnde(kaputt.length ? 'MANUELL_KLAEREN' : 'OK',
                { geprueft: geprueft, kaputt: kaputt.length, betroffen: kaputt });
    flushLog();
  }
}

/**
 * Installiert NUR den täglichen Trigger für pruefeWebhookErreichbarkeit() -- rührt keinen anderen
 * Trigger an, anders als installTriggers() (das löscht erst ALLE eigenen Trigger, inklusive des
 * laufenden 15-Minuten-Timers für syncNeueZeilen und der onEdit-Canaries).
 * Idempotent: entfernt vorher einen evtl. bestehenden eigenen Trigger für dieselbe Funktion.
 * 5:00 Uhr -- nach den nächtlichen Läufen der vier Webhook-Projekte (2:00/3:00) und vor
 * Arbeitsbeginn, damit ein kaputter Webhook morgens im Log steht.
 */
function installWebhookHealthTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'pruefeWebhookErreichbarkeit') {
      ScriptApp.deleteTrigger(t);
      Logger.log('Bestehenden pruefeWebhookErreichbarkeit-Trigger entfernt (Neuanlage folgt).');
    }
  });
  ScriptApp.newTrigger('pruefeWebhookErreichbarkeit').timeBased().everyDays(1).atHour(5).create();
  Logger.log('pruefeWebhookErreichbarkeit läuft jetzt täglich um 5:00. Andere Trigger sind unberührt.');
}
