// ============================================================================
// DATEI 3 von 3: SyncEngine.gs
// sevdesk abfragen (Status "Angenommen") → Deep-Core-Zeile im passenden Monat
// finden → befüllen → loggen.
//
// Anders als beim sevdesk-Pipedrive-Projekt wird hier KEINE bestehende Zeile
// gematcht — es wird immer eine neue (vorformatierte Puffer-)Zeile befüllt.
// Daraus folgt die wichtigste Regel dieses Scripts:
//   EIN AUFTRAG DARF NUR GENAU EINMAL VERARBEITET WERDEN.
// Ein erneuter Lauf über denselben Auftrag erzeugt keine Aktualisierung, sondern
// eine ZWEITE ZEILE. Deshalb merkt sich der State nur "schon erledigt ja/nein"
// und ignoriert bewusst spätere Änderungen am Auftrag (v1 verglich den
// update-Zeitstempel und legte bei jeder sevdesk-Änderung eine Dublette an).
//
// Team/Projekt/Kaufart bleiben absichtlich leer (manuelle Nacharbeit Verkäufer).
//
// ERSTE INBETRIEBNAHME — Reihenfolge einhalten:
//   1. pruefeKonfiguration()      (SheetWriter.gs) — Tab/Spalten/Puffer prüfen
//   2. pruefeDropdownListen()     (SheetWriter.gs) — Katalog-Drift prüfen
//   3. testMappingOnly()          — Artikel-Erkennung ohne API
//   4. seedSyncStateOhneSchreiben() — ALLE heute schon angenommenen Aufträge als
//      "erledigt" markieren, OHNE sie ins Sheet zu schreiben. Ohne diesen Schritt
//      kippt der erste Lauf den kompletten sevdesk-Bestand ins Sheet.
//   5. DRY_RUN auf true lassen, syncPendingOrdersToDeepCore() manuell starten,
//      Log lesen.
//   6. Erst dann DRY_RUN = false und Zeittrigger anlegen (trigger15MinAnlegen()).
// ============================================================================

// --- Schalter ---------------------------------------------------------------
const DRY_RUN = true;              // true = nichts ins Sheet schreiben, nur loggen
const MAX_ORDERS_PER_RUN = 25;     // Sicherheitsdeckel pro Lauf
const MAX_RUNTIME_MS = 4.5 * 60 * 1000;

// Aufträge, die VOR diesem Datum angenommen wurden, werden ignoriert.
// Zweites Sicherheitsnetz gegen Altbestand, falls seedSyncStateOhneSchreiben()
// vergessen wurde. Format: 'YYYY-MM-DD', leer = keine Grenze.
const IGNORIERE_AUFTRAEGE_VOR = '2026-08-01';

// --- Konstanten -------------------------------------------------------------
const SEVDESK_BASE_URL = 'https://my.sevdesk.de/api/v1';
const SEVDESK_STATUS_ANGENOMMEN = 500;
const DEEPCORE_LOG_TAB = 'DeepCore-Sync-Log'; // legt sich bei Bedarf selbst an
const DEEPCORE_SYNC_STATE_KEY = 'DEEPCORE_SYNCED_ORDERS'; // eigener Key, unabhängig vom Pipedrive-Sync

// Script Properties fassen 9 KB pro Wert. Bei ~10 Zeichen pro Order-ID plus
// Trennzeichen sind ~800 IDs die harte Grenze; 600 lässt Luft. Ältere IDs fliegen
// raus — die zugehörigen Aufträge sind längst aus dem Status-500-Poll verschwunden.
const MAX_STATE_EINTRAEGE = 600;

// ============================================================================
// HTTP-HELPER (mit Retry/Backoff — 429 und 5xx sind bei sevdesk real)
// ============================================================================

function sevdeskFetch(path) {
  const token = PropertiesService.getScriptProperties().getProperty('SEVDESK_API_TOKEN');
  if (!token) throw new Error('SEVDESK_API_TOKEN fehlt in den Script Properties!');

  const url = `${SEVDESK_BASE_URL}${path}`;
  let letzterFehler = '';

  for (let versuch = 0; versuch < 4; versuch++) {
    const response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': token },
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    const text = response.getContentText();

    if (code >= 200 && code < 300) {
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error(`sevdesk lieferte kein JSON (HTTP ${code}): ${text.substring(0, 150)}`);
      }
    }

    letzterFehler = `HTTP ${code}: ${text.substring(0, 150)}`;

    // 4xx wird durch Warten nicht besser -> sofort abbrechen (Ausnahme: 429).
    if (code < 500 && code !== 429) break;

    Utilities.sleep(Math.pow(2, versuch) * 1000); // 1s, 2s, 4s
  }

  throw new Error(`sevdesk-Aufruf fehlgeschlagen (${path}) — ${letzterFehler}`);
}

// ============================================================================
// SEVDESK: Auftrag + Positionen abrufen
// ============================================================================

/**
 * Nimmt den ersten Kandidaten, der sich in eine echte Zahl übersetzen lässt.
 * Wichtig gegen die Falle `null`: `p.priceNet !== undefined` ist bei null TRUE,
 * und `Number(null)` ist 0 — der Preis wäre dann still auf 0 gefallen, obwohl in
 * `p.price` der richtige Wert steht. Genau die Klasse Fehler, die im Log wie
 * Erfolg aussieht.
 */
function ersteZahl(kandidaten, standard) {
  for (let i = 0; i < kandidaten.length; i++) {
    const k = kandidaten[i];
    if (k === null || k === undefined || k === '') continue;
    const n = Number(k);
    if (isFinite(n)) return n;
  }
  return standard;
}

/**
 * @returns {{orderId, orderNumber, orderDate, kundenname, vkNetto, positions}}
 */
function fetchOrderFromSevdesk(orderId) {
  const orderData = sevdeskFetch(`/Order/${orderId}`);
  if (!orderData.objects || orderData.objects.length === 0) {
    throw new Error(`sevdesk Order ${orderId} nicht gefunden`);
  }
  const order = Array.isArray(orderData.objects) ? orderData.objects[0] : orderData.objects;

  const posData = sevdeskFetch(`/OrderPos?order[id]=${orderId}&order[objectName]=Order&limit=200`);
  const positions = (posData.objects || []).map(p => ({
    name: p.name || (p.part && p.part.name) || 'Unbekannt',
    quantity: ersteZahl([p.quantity], 1),
    // ⚠️ Annahme: Netto-EINZELpreis. Falls in sevdesk mit Bruttopreisen gearbeitet
    // wird, liefert die API priceGross statt priceNet — mit debugSevdeskRohdaten()
    // gegenprüfen, BEVOR DRY_RUN abgeschaltet wird.
    priceNet: ersteZahl([p.priceNet, p.price], 0)
  }));

  const positionsSumme = positions.reduce((sum, p) => sum + p.priceNet * p.quantity, 0);
  const sumNet = ersteZahl([order.sumNet], 0);
  const sumNetBrauchbar = sumNet > 0;

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,        // z.B. "2026-154-A" -> direkt Angebots-Nr.
    orderDate: order.orderDate || order.create || null,
    kundenname: order.contact && order.contact.id ? fetchContactDisplayName(order.contact.id) : null,
    vkNetto: sumNetBrauchbar ? sumNet : positionsSumme,
    vkNettoQuelle: sumNetBrauchbar ? 'order.sumNet' : 'Summe der Positionen',
    positions
  };
}

/**
 * Lädt den Anzeigenamen eines sevdesk-Kontakts. Firmen haben "name" gesetzt,
 * Privatpersonen stattdessen "surename"/"familyname" (name bleibt dann leer).
 * ⚠️ Feldnamen mit debugSevdeskRohdaten() gegen die echte Antwort verifizieren.
 */
function fetchContactDisplayName(contactId) {
  const data = sevdeskFetch(`/Contact/${contactId}`);
  if (!data.objects || data.objects.length === 0) return null;
  const contact = Array.isArray(data.objects) ? data.objects[0] : data.objects;
  if (contact.name) return String(contact.name).trim();
  const teile = [contact.surename, contact.familyname].filter(Boolean);
  return teile.length > 0 ? teile.join(' ').trim() : null;
}

// ============================================================================
// LOGGING
// ============================================================================

let _logSheetCache = null;

function getLogSheet() {
  if (_logSheetCache) return _logSheetCache;
  const ss = getDeepCoreSpreadsheet();
  let sheet = ss.getSheetByName(DEEPCORE_LOG_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(DEEPCORE_LOG_TAB);
    sheet.appendRow(['Zeitstempel', 'Modus', 'Status', 'Auftrag', 'Zeile', 'Fehler', 'Details']);
    sheet.setFrozenRows(1);
  }
  _logSheetCache = sheet;
  return sheet;
}

// Log-Zeilen werden im Lauf gesammelt und am Ende in EINEM setValues geschrieben
// (appendRow pro Zeile ist der klassische Apps-Script-Bremsklotz).
let _logPuffer = [];

function logDeepCoreSyncResult(status, orderLabel, row, fehler, details) {
  _logPuffer.push([new Date(), DRY_RUN ? 'DRY_RUN' : 'LIVE', status, orderLabel || '-', row || '-', fehler || '-', details || '-']);
  Logger.log(`[${status}] ${orderLabel || '-'} ${details || ''} ${fehler ? '| ' + fehler : ''}`);
}

function flushLog() {
  if (_logPuffer.length === 0) return;
  try {
    const sheet = getLogSheet();
    sheet.getRange(sheet.getLastRow() + 1, 1, _logPuffer.length, _logPuffer[0].length).setValues(_logPuffer);
  } catch (e) {
    Logger.log('⚠️ Konnte nicht ins DeepCore-Sync-Log schreiben: ' + e);
  }
  _logPuffer = [];
}

// ============================================================================
// DUPLIKAT-SCHUTZ
// State = { ids: [orderId, ...] } in Einfügereihenfolge, gedeckelt auf
// MAX_STATE_EINTRAEGE. Bewusst OHNE update-Zeitstempel: eine Änderung am
// sevdesk-Auftrag darf keine zweite Sheet-Zeile erzeugen.
// ============================================================================

function getDeepCoreSyncState() {
  const raw = PropertiesService.getScriptProperties().getProperty(DEEPCORE_SYNC_STATE_KEY);
  if (!raw) return { ids: [] };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.ids)) return parsed;
    // Migration vom v1-Format { orderId: updateTimestamp }
    return { ids: Object.keys(parsed) };
  } catch (e) {
    Logger.log('⚠️ Sync-State unlesbar, starte leer: ' + e);
    return { ids: [] };
  }
}

/** @returns {number} Anzahl der wegen des 9-KB-Limits verworfenen IDs. */
function saveDeepCoreSyncState(state) {
  // Duplikate raus (kostet sonst unnötig Platz im 9-KB-Budget).
  const gesehen = {};
  state.ids = state.ids.filter(id => {
    const k = String(id);
    if (gesehen[k]) return false;
    gesehen[k] = true;
    return true;
  });

  let verworfen = 0;
  if (state.ids.length > MAX_STATE_EINTRAEGE) {
    verworfen = state.ids.length - MAX_STATE_EINTRAEGE;
    // Die ZULETZT hinzugefügten behalten — die ältesten Aufträge fallen ohnehin
    // irgendwann aus dem Status-500-Poll und brauchen den Duplikatschutz nicht mehr.
    state.ids = state.ids.slice(verworfen);
  }
  PropertiesService.getScriptProperties().setProperty(DEEPCORE_SYNC_STATE_KEY, JSON.stringify(state));
  return verworfen;
}

function resetDeepCoreSyncState() {
  PropertiesService.getScriptProperties().deleteProperty(DEEPCORE_SYNC_STATE_KEY);
  Logger.log('✓ DeepCore-Sync-Status zurückgesetzt. ⚠️ Der nächste Lauf verarbeitet ALLE angenommenen Aufträge erneut und legt Dubletten an — vorher seedSyncStateOhneSchreiben() laufen lassen!');
}

/**
 * ERSTINBETRIEBNAHME: markiert alle aktuell in sevdesk angenommenen Aufträge als
 * "schon erledigt", OHNE etwas ins Sheet zu schreiben. Danach werden nur noch
 * Aufträge verarbeitet, die ab jetzt neu auf "Angenommen" wechseln.
 */
function seedSyncStateOhneSchreiben() {
  const alle = ladeAngenommeneAuftraege();
  const state = { ids: alle.map(o => String(o.id)) };
  const gesamt = state.ids.length;
  const verworfen = saveDeepCoreSyncState(state);

  Logger.log(`✓ ${state.ids.length} bereits angenommene Aufträge als erledigt markiert (nichts geschrieben).`);

  if (verworfen > 0) {
    // Nicht still schlucken: die verworfenen IDs gelten als NICHT erledigt und
    // würden ohne Cutoff beim nächsten Lauf ins Sheet geschrieben.
    Logger.log(`⚠️ ACHTUNG: ${verworfen} von ${gesamt} IDs passten nicht in die 9-KB-Property und wurden verworfen.`);
    Logger.log(`⚠️ Diese Aufträge sind NICHT duplikatgeschützt. Einziger Schutz ist jetzt IGNORIERE_AUFTRAEGE_VOR`);
    Logger.log(`⚠️ (steht auf "${IGNORIERE_AUFTRAEGE_VOR}"). Vor dem Live-Gang prüfen, dass das Datum passt.`);
  }
  Logger.log('Ab jetzt verarbeitet der Sync nur noch NEU angenommene Aufträge.');
}

// ============================================================================
// EIN EINZELNER AUFTRAG
// ============================================================================

function syncOrderToDeepCore(orderId) {
  try {
    const order = fetchOrderFromSevdesk(orderId);
    const label = order.orderNumber || orderId;

    // Monat aus dem AUFTRAGSDATUM, nicht aus dem Laufdatum: ein am 31.08. abends
    // angenommener Auftrag landete in v1 im September, wenn der Trigger um 00:05 lief.
    const datum = order.orderDate ? new Date(order.orderDate) : new Date();
    const monatName = GERMAN_MONTHS[(isNaN(datum.getTime()) ? new Date() : datum).getMonth()];

    const row = findFreeRowForMonth(monatName);
    if (!row) {
      logDeepCoreSyncResult('WARNUNG', label, null, `Keine freie Zeile für Monat "${monatName}"`,
        'Pufferzeilen im Sheet ergänzen (Format/Dropdowns aus bestehender Zeile kopieren).');
      return false;
    }

    const aggregated = aggregatePositionsForDeepCore(order.positions);

    writeRowToDeepCore(row, {
      kundenname: order.kundenname || `⚠️ Kundenname unbekannt (sevdesk Order ${label})`,
      vkNetto: order.vkNetto,
      angebotsNr: order.orderNumber,
      cells: aggregated.cells,
      sonstigeKosten: aggregated.sonstigeKosten,
      notizenZusatz: aggregated.notizenZusatz
    }, DRY_RUN);

    const details = [
      `Zeile ${row}, Monat ${monatName}`,
      `VK netto ${order.vkNetto} (${order.vkNettoQuelle})`,
      `${order.positions.length} Positionen`
    ];
    if (aggregated.unsicherAnzahl > 0) {
      details.push(`⚠️ ${aggregated.unsicherAnzahl} unsichere Artikel-Zuordnung(en) — Notizen-Spalte prüfen`);
    }
    if (aggregated.notizenZusatz.length > 0) {
      details.push(`${aggregated.notizenZusatz.length} Position(en) in Notizen ausgelagert`);
    }

    logDeepCoreSyncResult('SUCCESS', label, row, '-', details.join(' | '));
    return true;

  } catch (e) {
    logDeepCoreSyncResult('ERROR', orderId, null, e.message, '');
    return false;
  }
}

// ============================================================================
// POLLING — Zeittrigger, alle 15 Min
// ============================================================================

/** Holt alle Aufträge mit Status "Angenommen" (paginiert). */
function ladeAngenommeneAuftraege() {
  const limit = 100;
  let offset = 0;
  let alle = [];

  while (true) {
    const data = sevdeskFetch(`/Order?status=${SEVDESK_STATUS_ANGENOMMEN}&limit=${limit}&offset=${offset}`);
    const objects = data.objects || [];
    if (objects.length === 0) break;
    alle = alle.concat(objects);
    if (objects.length < limit) break;
    offset += limit;
    if (offset >= 2000) {
      // Nicht still abschneiden — sonst sieht ein gekappter Lauf aus wie ein vollständiger.
      Logger.log(`⚠️ Pagination bei ${offset} Aufträgen abgebrochen (Deckel). Es kann mehr geben.`);
      break;
    }
  }
  return alle;
}

function syncPendingOrdersToDeepCore() {
  const startZeit = Date.now();

  // Verhindert, dass ein manueller Testlauf und der 15-Min-Trigger gleichzeitig
  // dieselbe freie Zeile finden und sich gegenseitig überschreiben.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log('⏭️ Anderer Lauf aktiv — dieser Durchgang wird übersprungen.');
    return;
  }

  try {
    const state = getDeepCoreSyncState();
    const erledigt = {};
    state.ids.forEach(id => { erledigt[String(id)] = true; });

    const alleAuftraege = ladeAngenommeneAuftraege();

    const cutoff = IGNORIERE_AUFTRAEGE_VOR ? new Date(IGNORIERE_AUFTRAEGE_VOR).getTime() : null;
    let zuAlt = 0;

    const zuSyncen = alleAuftraege.filter(o => {
      if (erledigt[String(o.id)]) return false;
      if (cutoff) {
        const d = new Date(o.orderDate || o.create || 0).getTime();
        if (isFinite(d) && d > 0 && d < cutoff) { zuAlt++; return false; }
      }
      return true;
    });

    Logger.log(`Polling (${DRY_RUN ? 'DRY RUN' : 'LIVE'}): ${alleAuftraege.length} angenommene Aufträge, ` +
      `${state.ids.length} bereits erledigt, ${zuAlt} vor Cutoff ${IGNORIERE_AUFTRAEGE_VOR}, ${zuSyncen.length} zu verarbeiten.`);
    if (DRY_RUN) {
      Logger.log('ℹ️ DRY RUN: es wird nichts geschrieben, deshalb meldet JEDER Auftrag dieselbe freie Zeile. ' +
        'Im Live-Lauf rückt die Zeile pro Auftrag weiter.');
    }

    if (zuSyncen.length === 0) return;

    // Ein ungeseedeter Erstlauf würde hier den kompletten Altbestand ins Sheet
    // kippen. Lieber hart stoppen und den Menschen entscheiden lassen.
    if (state.ids.length === 0 && zuSyncen.length > MAX_ORDERS_PER_RUN) {
      logDeepCoreSyncResult('ABBRUCH', '-', null,
        `${zuSyncen.length} unverarbeitete Aufträge bei leerem Sync-State`,
        'Sieht nach Erstinbetriebnahme aus. Bitte zuerst seedSyncStateOhneSchreiben() ausführen.');
      return;
    }

    const batch = zuSyncen.slice(0, MAX_ORDERS_PER_RUN);
    let verarbeitet = 0;

    for (let i = 0; i < batch.length; i++) {
      if (Date.now() - startZeit > MAX_RUNTIME_MS) {
        Logger.log(`⏱️ Zeitlimit-Schutz nach ${verarbeitet} Aufträgen — Rest folgt im nächsten Lauf.`);
        break;
      }
      const o = batch[i];
      if (syncOrderToDeepCore(o.id)) {
        verarbeitet++;
        // Im DRY RUN darf der State NICHT fortgeschrieben werden, sonst gilt der
        // Auftrag als erledigt, obwohl nie etwas im Sheet gelandet ist.
        if (!DRY_RUN) {
          state.ids.push(String(o.id));
          if (verarbeitet % 5 === 0) saveDeepCoreSyncState(state);
        }
      }
    }

    if (!DRY_RUN) saveDeepCoreSyncState(state);

    const offen = zuSyncen.length - verarbeitet;
    logDeepCoreSyncResult('LAUF-ENDE', '-', null, '-',
      `${verarbeitet} verarbeitet, ${offen} offen, ${Math.round((Date.now() - startZeit) / 1000)}s`);

  } finally {
    flushLog();
    lock.releaseLock();
  }
}

// ============================================================================
// TRIGGER-VERWALTUNG (idempotent — mehrfaches Ausführen legt nichts doppelt an)
// ============================================================================

function trigger15MinAnlegen() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncPendingOrdersToDeepCore')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('syncPendingOrdersToDeepCore').timeBased().everyMinutes(15).create();
  Logger.log('✓ Trigger auf syncPendingOrdersToDeepCore(), alle 15 Minuten.');
  if (DRY_RUN) Logger.log('⚠️ DRY_RUN ist noch true — der Trigger läuft, schreibt aber nichts.');
}

function triggerEntfernen() {
  const weg = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncPendingOrdersToDeepCore');
  weg.forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log(`✓ ${weg.length} Trigger entfernt.`);
}

// ============================================================================
// TEST- UND DEBUG-FUNKTIONEN (nie per Trigger, immer nur manuell)
// Hinweis: Funktionen mit Parametern lassen sich im Editor nicht starten
// (der ▷-Button ruft ohne Argumente auf) — deshalb überall Konstanten oben.
// ============================================================================

/** Order-ID für die Test-Funktionen. Hier eintragen, nicht als Parameter übergeben. */
const TEST_ORDER_ID = '';

/** Prüft nur die Artikel-Erkennung, ohne API-Zugriff und ohne zu schreiben. */
function testMappingOnly() {
  const testPositions = [
    { name: 'AIKO-GLAS-GLAS NEOSTAR FULL BLACK 475 WP', quantity: 20, priceNet: 74 },
    { name: 'MONTAGESET PV SCHRÄGDACH ZIEGEL', quantity: 20, priceNet: 50 },
    { name: 'SIGENERGY Hybrid Wechselrichter 10.0 kW TP2 dreiphasig', quantity: 1, priceNet: 1990 },
    { name: 'SIGENERGY Batteriemodul 9 kWh', quantity: 1, priceNet: 2300 },
    { name: 'SIGENERGY Gateway Umschaltbox Dreiphasig', quantity: 1, priceNet: 1100 },
    { name: 'SIGENERGY Power Sensor DH dreiphasig', quantity: 1, priceNet: 202 },
    { name: 'SIGENERGY Power Sensor DH dreiphasig & Communication Modul', quantity: 1, priceNet: 349 },
    { name: 'HUAWEI WALLBOX AC 22, EV CHARGER', quantity: 1, priceNet: 890 },
    { name: 'FRONIUS Symo GEN24 10.0 Plus', quantity: 1, priceNet: 2100 },
    { name: 'TECHNISCHE PROJEKTBETREUUNG', quantity: 1, priceNet: 1000 }
  ];
  const result = aggregatePositionsForDeepCore(testPositions);
  Logger.log(JSON.stringify(result, null, 2));
  Logger.log(`→ ${result.unsicherAnzahl} unsichere Zuordnung(en), sonstige Kosten ${result.sonstigeKosten}`);
}

/** Zeigt die ROHE sevdesk-Antwort — zum Verifizieren der Feldnamen (sumNet, price, contact). */
function debugSevdeskRohdaten() {
  if (!TEST_ORDER_ID) { Logger.log('✗ Bitte TEST_ORDER_ID oben eintragen.'); return; }
  const order = sevdeskFetch(`/Order/${TEST_ORDER_ID}`);
  Logger.log('=== Order (roh) ===');
  Logger.log(JSON.stringify(order.objects, null, 2).substring(0, 4000));
  const pos = sevdeskFetch(`/OrderPos?order[id]=${TEST_ORDER_ID}&order[objectName]=Order&limit=200`);
  Logger.log('=== OrderPos (roh, erste Position) ===');
  Logger.log(JSON.stringify((pos.objects || [])[0], null, 2));
}

/** Liest einen sevdesk-Auftrag und zeigt Daten + Mapping + Zielzeile, OHNE zu schreiben. */
function testFetchSevdeskOnly() {
  if (!TEST_ORDER_ID) { Logger.log('✗ Bitte TEST_ORDER_ID oben eintragen.'); return; }
  try {
    const order = fetchOrderFromSevdesk(TEST_ORDER_ID);
    Logger.log('=== sevdesk Order (aufbereitet) ===');
    Logger.log(JSON.stringify(order, null, 2));
    Logger.log('=== Artikel-Mapping ===');
    Logger.log(JSON.stringify(aggregatePositionsForDeepCore(order.positions), null, 2));
    const datum = order.orderDate ? new Date(order.orderDate) : new Date();
    const monatName = GERMAN_MONTHS[datum.getMonth()];
    Logger.log(`=== Zielzeile für Monat "${monatName}": ${findFreeRowForMonth(monatName)}`);
  } catch (e) {
    Logger.log('✗ Fehler: ' + e.message);
  }
}

/**
 * Führt den Sync für EINEN Auftrag aus. Respektiert DRY_RUN.
 *
 * Wenn tatsächlich geschrieben wurde (DRY_RUN = false), wird der Auftrag auch im
 * Duplikat-State vermerkt. Sonst würde der 15-Min-Trigger denselben Auftrag kurz
 * darauf nochmal verarbeiten und eine ZWEITE Zeile anlegen.
 */
function testFullSync() {
  if (!TEST_ORDER_ID) { Logger.log('✗ Bitte TEST_ORDER_ID oben eintragen.'); return; }
  try {
    const erfolg = syncOrderToDeepCore(TEST_ORDER_ID);
    if (erfolg && !DRY_RUN) {
      const state = getDeepCoreSyncState();
      state.ids.push(String(TEST_ORDER_ID));
      saveDeepCoreSyncState(state);
      Logger.log(`✓ Auftrag ${TEST_ORDER_ID} als erledigt vermerkt — der Trigger legt keine zweite Zeile an.`);
    }
  } finally {
    flushLog();
  }
}
