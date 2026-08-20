// ============================================================================
// DATEI 3 von 3: SyncEngine.gs
// sevdesk abfragen (Status "Angenommen") → Deep-Core-Zeile für den aktuellen
// Monat finden → befüllen → loggen.
//
// Anders als beim sevdesk-Pipedrive-Projekt wird hier KEINE bestehende Zeile
// gematcht — es wird immer eine neue (vorformatierte Puffer-)Zeile befüllt.
// Team/Projekt/Kaufart bleiben absichtlich leer (manuelle Nacharbeit Verkäufer).
//
// LIVE-BETRIEB: Zeittrigger auf syncPendingOrdersToDeepCore(), alle 15 Minuten.
// ============================================================================

const SEVDESK_BASE_URL = 'https://my.sevdesk.de/api/v1';
const SEVDESK_STATUS_ANGENOMMEN = 500;
const DEEPCORE_LOG_TAB = 'DeepCore-Sync-Log'; // ⚠️ Tab muss existieren oder unten anlegen lassen
const DEEPCORE_SYNC_STATE_KEY = 'DEEPCORE_SYNCED_ORDERS'; // eigener Property-Key, unabhängig vom Pipedrive-Sync
const MAX_ORDERS_PER_RUN = 25;
const MAX_RUNTIME_MS = 4 * 60 * 1000;

// ============================================================================
// HTTP-HELPER
// ============================================================================

function sevdeskFetch(path) {
  const token = PropertiesService.getScriptProperties().getProperty('SEVDESK_API_TOKEN');
  if (!token) throw new Error('SEVDESK_API_TOKEN fehlt in den Script Properties!');

  const response = UrlFetchApp.fetch(`${SEVDESK_BASE_URL}${path}`, {
    headers: { 'Authorization': token },
    muteHttpExceptions: true
  });
  const text = response.getContentText();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`sevdesk lieferte kein JSON (HTTP ${response.getResponseCode()}): ${text.substring(0, 150)}`);
  }
}

// ============================================================================
// SEVDESK: Auftrag + Positionen abrufen
// ============================================================================

/**
 * @returns {{orderId, orderNumber, updateTimestamp, vkNetto, positions}}
 */
function fetchOrderFromSevdesk(orderId) {
  const orderData = sevdeskFetch(`/Order/${orderId}`);
  if (!orderData.objects || orderData.objects.length === 0) {
    throw new Error(`sevdesk Order ${orderId} nicht gefunden`);
  }
  const order = orderData.objects[0];

  const posData = sevdeskFetch(`/OrderPos?order[id]=${orderId}&order[objectName]=Order`);
  const positions = (posData.objects || []).map(p => ({
    name: p.name || (p.part && p.part.name) || 'Unbekannt',
    quantity: Number(p.quantity) || 1,
    // sevdesk liefert i.d.R. Einzelpreis netto in "price" (bei Bruttopreisen ggf. price/((100+tax)/100))
    priceNet: Number(p.price) || 0
  }));

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,        // z.B. "2026-154-A" -> direkt Angebots-Nr.
    updateTimestamp: order.update || null,
    kundenname: order.contact && order.contact.id ? fetchContactDisplayName(order.contact.id) : null,
    // ⚠️ Feldname noch gegen echte API-Antwort verifizieren (siehe debugSevdeskResponse()) —
    // Kandidaten: sumNet / sumNetGross / header-Summe. Fallback: Summe aller Positionen.
    vkNetto: Number(order.sumNet) || positions.reduce((sum, p) => sum + p.priceNet * p.quantity, 0),
    positions
  };
}

/**
 * Lädt den Anzeigenamen eines sevdesk-Kontakts. Firmen haben "name" gesetzt,
 * Privatpersonen stattdessen "surename"/"familyname" (name bleibt dann leer).
 * ⚠️ Feldnamen noch gegen echte API-Antwort verifizieren (siehe debugSevdeskResponse()).
 */
function fetchContactDisplayName(contactId) {
  const data = sevdeskFetch(`/Contact/${contactId}`);
  if (!data.objects || data.objects.length === 0) return null;
  const contact = data.objects[0];
  if (contact.name) return contact.name;
  const teile = [contact.surename, contact.familyname].filter(Boolean);
  return teile.length > 0 ? teile.join(' ') : null;
}

// ============================================================================
// LOGGING
// ============================================================================

function logDeepCoreSyncResult(status, orderLabel, row, fehler, details) {
  try {
    const ss = SpreadsheetApp.openById(DEEPCORE_SHEET_ID);
    let sheet = ss.getSheetByName(DEEPCORE_LOG_TAB);
    if (!sheet) {
      sheet = ss.insertSheet(DEEPCORE_LOG_TAB);
      sheet.appendRow(['Zeitstempel', 'Status', 'Auftrag', 'Zeile', 'Fehler', 'Details']);
    }
    sheet.appendRow([new Date(), status, orderLabel || '-', row || '-', fehler || '-', details || '-']);
  } catch (e) {
    Logger.log('⚠️ Konnte nicht ins DeepCore-Sync-Log schreiben: ' + e);
  }
}

// ============================================================================
// DUPLIKAT-SCHUTZ
// ============================================================================

function getDeepCoreSyncState() {
  const raw = PropertiesService.getScriptProperties().getProperty(DEEPCORE_SYNC_STATE_KEY);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveDeepCoreSyncState(state) {
  PropertiesService.getScriptProperties().setProperty(DEEPCORE_SYNC_STATE_KEY, JSON.stringify(state));
}

function resetDeepCoreSyncState() {
  PropertiesService.getScriptProperties().deleteProperty(DEEPCORE_SYNC_STATE_KEY);
  Logger.log('✓ DeepCore-Sync-Status zurückgesetzt. Nächster Lauf verarbeitet alle Aufträge neu.');
}

// ============================================================================
// HAUPT-FUNKTION: ein einzelner Auftrag
// ============================================================================

function syncOrderToDeepCore(orderId) {
  try {
    const order = fetchOrderFromSevdesk(orderId);
    const label = order.orderNumber || orderId;

    const monatName = GERMAN_MONTHS[new Date().getMonth()];
    const row = findFreeRowForMonth(monatName);

    if (!row) {
      logDeepCoreSyncResult('WARNUNG', label, null, `Keine freie Zeile für Monat "${monatName}"`,
        'Bitte manuell weitere Pufferzeilen im Sheet ergänzen (Format/Dropdowns von bestehenden Zeilen kopieren).');
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
    });

    const unsichereTeile = Object.values(aggregated.cells).filter(c => c && c.notiz).length;
    const details = unsichereTeile > 0
      ? `Zeile ${row}, Monat ${monatName} | ⚠️ ${unsichereTeile} unsichere Artikel-Zuordnung(en) — Notizen-Spalte prüfen`
      : `Zeile ${row}, Monat ${monatName}`;

    logDeepCoreSyncResult('SUCCESS', label, row, '-', details);
    Logger.log(`✓ ${label} → Zeile ${row} (${monatName})`);
    return true;

  } catch (e) {
    logDeepCoreSyncResult('ERROR', orderId, null, e.message, '');
    Logger.log(`✗ Order ${orderId}: ${e.message}`);
    return false;
  }
}

// ============================================================================
// POLLING — Zeittrigger, alle 15 Min
// ============================================================================

function syncPendingOrdersToDeepCore() {
  const state = getDeepCoreSyncState();
  let offset = 0;
  const limit = 100;
  let alleAuftraege = [];

  while (true) {
    const data = sevdeskFetch(`/Order?status=${SEVDESK_STATUS_ANGENOMMEN}&limit=${limit}&offset=${offset}`);
    if (!data.objects || data.objects.length === 0) break;
    alleAuftraege = alleAuftraege.concat(data.objects);
    if (data.objects.length < limit) break;
    offset += limit;
    if (offset > 1000) break;
  }

  const zuSyncen = alleAuftraege.filter(o => state[o.id] !== (o.update || ''));
  Logger.log(`Polling: ${alleAuftraege.length} angenommene Aufträge, davon ${zuSyncen.length} neu/geändert`);
  if (zuSyncen.length === 0) return;

  const batch = zuSyncen.slice(0, MAX_ORDERS_PER_RUN);
  let verarbeitet = 0;
  const startZeit = Date.now();

  for (let i = 0; i < batch.length; i++) {
    if (Date.now() - startZeit > MAX_RUNTIME_MS) {
      Logger.log(`⏱️ Zeitlimit-Schutz nach ${verarbeitet} Aufträgen — Rest folgt im nächsten Lauf`);
      break;
    }
    const o = batch[i];
    const erfolg = syncOrderToDeepCore(o.id);
    if (erfolg) {
      state[o.id] = o.update || '';
      verarbeitet++;
      if (verarbeitet % 5 === 0) saveDeepCoreSyncState(state);
    }
  }

  saveDeepCoreSyncState(state);
  const offen = zuSyncen.length - verarbeitet;
  if (offen > 0) Logger.log(`ℹ️ ${offen} Aufträge noch offen — nächster Lauf in 15 Min`);
}

// ============================================================================
// TEST- UND DEBUG-FUNKTIONEN (nie per Trigger, immer nur manuell)
// ============================================================================

/** Prüft nur die Artikel-Erkennung + Zuordnung, ohne API-Zugriff und ohne zu schreiben. */
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
    { name: 'TECHNISCHE PROJEKTBETREUUNG', quantity: 1, priceNet: 1000 }
  ];
  Logger.log(JSON.stringify(aggregatePositionsForDeepCore(testPositions), null, 2));
}

/** Liest einen sevdesk-Auftrag und zeigt Daten + Mapping + Zielzeile, OHNE zu schreiben. */
function testFetchSevdeskOnly() {
  const TEST_ORDER_ID = ''; // ← Order-ID eintragen

  if (!TEST_ORDER_ID) { Logger.log('✗ Bitte TEST_ORDER_ID eintragen.'); return; }
  try {
    const order = fetchOrderFromSevdesk(TEST_ORDER_ID);
    Logger.log('=== sevdesk Order ===');
    Logger.log(JSON.stringify(order, null, 2));
    Logger.log('\n=== Artikel-Mapping ===');
    Logger.log(JSON.stringify(aggregatePositionsForDeepCore(order.positions), null, 2));
    const monatName = GERMAN_MONTHS[new Date().getMonth()];
    Logger.log(`\n=== Zielzeile für Monat "${monatName}" ===`);
    Logger.log(findFreeRowForMonth(monatName));
  } catch (e) {
    Logger.log('✗ Fehler: ' + e.message);
  }
}

/** Führt den kompletten Sync für EINEN Auftrag aus. ⚠️ Schreibt echt ins Sheet. */
function testFullSync() {
  const TEST_ORDER_ID = ''; // ← Order-ID eintragen
  if (!TEST_ORDER_ID) { Logger.log('✗ Bitte TEST_ORDER_ID eintragen.'); return; }
  syncOrderToDeepCore(TEST_ORDER_ID);
}
