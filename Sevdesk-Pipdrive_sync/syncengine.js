// ============================================================================
// DATEI 3 von 3: SyncEngine.gs  —  PRODUCTION
// sevdesk abfragen → passenden Pipedrive-Deal finden → Felder füllen → loggen
// ============================================================================
//
// MATCHING-LOGIK (neu, löst den "2 Angebote pro Kunde"-Fall):
//   1. Primär über sevdesk_angebotsnummer (z.B. "2026-154-A") → immer eindeutig
//   2. Fallback über sevdesk_kunden_id → nur wenn GENAU 1 Deal gefunden wird
//   3. Mehrere Kandidaten → WARNUNG, es wird nichts geschrieben
//
// DUPLIKAT-SCHUTZ:
//   Jeder Auftrag wird nur gesynct, wenn er sich seit dem letzten Sync geändert
//   hat (Vergleich über sevdesk-"update"-Zeitstempel). Verhindert, dass alle
//   15 Min sämtliche Altaufträge erneut durchlaufen.
//
// LIVE-BETRIEB: Zeittrigger auf syncPendingOrders(), alle 15 Minuten.
// ============================================================================

const SHEET_ID = '1Icpc12eOBEmp2674cdKFVa1PCP7m-AHSRlSwNeiwmeo';
const SYNC_LOG_TAB = 'Sync-Log';
const PIPEDRIVE_BASE_URL = 'https://rp-energietechnik.pipedrive.com/api/v2';
const SEVDESK_BASE_URL = 'https://my.sevdesk.de/api/v1';
const SEVDESK_STATUS_ANGENOMMEN = 500;
const SYNC_STATE_KEY = 'SYNCED_ORDERS';   // Script Property: {orderId: updateTimestamp}
const MAX_ORDERS_PER_RUN = 25;            // Obergrenze pro Lauf (Rest folgt im nächsten Takt)
const MAX_RUNTIME_MS = 4 * 60 * 1000;     // Freiwilliger Stopp bei 4 Min (Apps-Script-Limit: 6 Min)

// ============================================================================
// HTTP-HELPER: einheitliche Auth + robustes JSON-Parsing für beide APIs
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

function pipedriveFetch(path, options) {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN fehlt in den Script Properties!');

  const opts = Object.assign({ muteHttpExceptions: true }, options || {});
  opts.headers = Object.assign({ 'x-api-token': token }, opts.headers || {});

  const response = UrlFetchApp.fetch(`${PIPEDRIVE_BASE_URL}${path}`, opts);
  const text = response.getContentText();

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Pipedrive lieferte kein JSON (HTTP ${response.getResponseCode()}): ${text.substring(0, 150)}`);
  }
}

// ============================================================================
// SEVDESK: Auftrag + Positionen + Kundennummer abrufen
// ============================================================================

function fetchOrderFromSevdesk(orderId) {
  // 1. Order-Grunddaten (enthält KEINE Positionen)
  const orderData = sevdeskFetch(`/Order/${orderId}`);
  if (!orderData.objects || orderData.objects.length === 0) {
    throw new Error(`sevdesk Order ${orderId} nicht gefunden`);
  }
  const order = orderData.objects[0];

  // 2. Positionen über eigenen Endpoint
  const posData = sevdeskFetch(`/OrderPos?order[id]=${orderId}&order[objectName]=Order`);
  const positions = (posData.objects || []).map(p => ({
    name: p.name || (p.part && p.part.name) || 'Unbekannt',
    quantity: Number(p.quantity) || 1
  }));

  // 3. Sichtbare Kundennummer (nicht die interne Kontakt-ID!) über Contact-Endpoint
  let customerNumber = null;
  if (order.contact && order.contact.id) {
    const contactData = sevdeskFetch(`/Contact/${order.contact.id}`);
    if (contactData.objects && contactData.objects.length > 0) {
      customerNumber = contactData.objects[0].customerNumber;
    }
  }

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,          // z.B. "2026-154-A" → primärer Matching-Schlüssel
    updateTimestamp: order.update || null,   // für den Duplikat-Schutz
    customerId: customerNumber,              // z.B. "3700" → Fallback-Matching
    positions
  };
}

// ============================================================================
// PIPEDRIVE: passenden Deal finden (zweistufig)
// ============================================================================

/** Exakte Feldsuche. Gibt alle Deal-IDs zurück, deren Feld exakt dem Wert entspricht. */
function searchDealsByField(fieldKey, value) {
  if (!fieldKey || fieldKey.indexOf('PLACEHOLDER') === 0) return [];

  const path = `/itemSearch/field?term=${encodeURIComponent(value)}`
    + `&entity_type=deal&field=${fieldKey}&match=exact&return_item_ids=true`;

  const data = pipedriveFetch(path, { method: 'get' });
  if (!data.success) {
    Logger.log(`⚠️ itemSearch/field Fehler: ${JSON.stringify(data).substring(0, 200)}`);
    return [];
  }
  // Response-Struktur: [{id, [field_code]: value}, ...] — ein Eintrag pro Treffer
  return (data.data || []).map(r => r.id).filter(id => id !== undefined);
}

/**
 * Findet den Ziel-Deal für einen sevdesk-Auftrag.
 * @returns {{dealId, matchedBy, ambiguous, candidates}}
 */
function findTargetDeal(order) {
  // --- Stufe 1: Angebotsnummer (immer eindeutig, auch bei mehreren Angeboten pro Kunde)
  if (order.orderNumber) {
    const byNumber = searchDealsByField(FIELD_KEYS.sevdesk_angebotsnummer, order.orderNumber);
    if (byNumber.length === 1) {
      // Gegenprobe: falls der gefundene Deal AUCH eine Kundennummer trägt, muss sie zum
      // Auftrag passen. Tut sie das nicht, deutet das auf einen Tippfehler bei der
      // Angebotsnummer hin (falscher Deal) — dann lieber warnen statt blind schreiben.
      if (order.customerId) {
        const kundeCheck = getDealCustomFieldValue(byNumber[0], FIELD_KEYS.sevdesk_kunden_id);
        if (kundeCheck && kundeCheck !== String(order.customerId)) {
          return {
            dealId: null, matchedBy: 'Angebotsnummer', ambiguous: true,
            candidates: byNumber,
            konflikt: `Deal ${byNumber[0]} hat Angebotsnummer "${order.orderNumber}", aber Kundennummer "${kundeCheck}" statt erwarteter "${order.customerId}" — vermutlich falscher Deal`
          };
        }
      }
      return { dealId: byNumber[0], matchedBy: 'Angebotsnummer', ambiguous: false, candidates: byNumber };
    }
    if (byNumber.length > 1) {
      // Sollte nie passieren — dieselbe Angebotsnummer steht in mehreren Deals
      return { dealId: null, matchedBy: 'Angebotsnummer', ambiguous: true, candidates: byNumber };
    }
  }

  // --- Stufe 2: Kundennummer als Fallback (nur wenn eindeutig)
  if (order.customerId) {
    const byCustomer = searchDealsByField(FIELD_KEYS.sevdesk_kunden_id, order.customerId);
    if (byCustomer.length === 1) {
      return { dealId: byCustomer[0], matchedBy: 'Kundennummer', ambiguous: false, candidates: byCustomer };
    }
    if (byCustomer.length > 1) {
      // Kunde hat mehrere Deals → Angebotsnummer muss gepflegt werden
      return { dealId: null, matchedBy: 'Kundennummer', ambiguous: true, candidates: byCustomer };
    }
  }

  return { dealId: null, matchedBy: null, ambiguous: false, candidates: [] };
}

/** Liest den Wert eines einzelnen Custom Fields aus einem Deal (für die Angebotsnummer/Kundennummer-Gegenprobe). */
function getDealCustomFieldValue(dealId, fieldKey) {
  if (!fieldKey || fieldKey.indexOf('PLACEHOLDER') === 0) return null;
  const data = pipedriveFetch(`/deals/${dealId}?custom_fields=${fieldKey}`, { method: 'get' });
  if (!data.success || !data.data) return null;
  const cf = data.data.custom_fields || {};
  return cf[fieldKey] !== undefined ? String(cf[fieldKey]) : null;
}

// ============================================================================
// PIPEDRIVE: Deal mit Artikel-Daten füllen
// ============================================================================

function writeArticleFieldsToDeal(dealId, aggregated) {
  const customFields = {};

  // Immer aktiv setzen (auch null) — sonst bleiben Werte vom letzten Sync stehen
  customFields[FIELD_KEYS.Module_Anzahl] = aggregated.fields.Module_Anzahl;
  customFields[FIELD_KEYS.WR_Leistung_kW] = aggregated.fields.WR_Leistung_kW || null;
  customFields[FIELD_KEYS.Speicher_Kapazitaet_kWh] = aggregated.fields.Speicher_Kapazitaet_kWh || null;

  addEnumFieldIfSet(customFields, 'Module_Marke', aggregated.fields.Module_Marke);
  addEnumFieldIfSet(customFields, 'System_Marke', aggregated.fields.System_Marke);
  addEnumFieldIfSet(customFields, 'Notstrom_Typ', aggregated.fields.Notstrom_Typ);
  addEnumFieldIfSet(customFields, 'Wallbox_Typ', aggregated.fields.Wallbox_Typ);
  addEnumFieldIfSet(customFields, 'Heizstab', aggregated.fields.Heizstab);

  customFields[FIELD_KEYS.Verkaufte_Artikel_Summary] = aggregated.summary;

  const result = pipedriveFetch(`/deals/${dealId}`, {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify({ custom_fields: customFields })
  });

  if (!result.success) {
    throw new Error(`Pipedrive Update fehlgeschlagen: ${JSON.stringify(result).substring(0, 200)}`);
  }
  return true;
}

/** Setzt ein Dropdown-Feld auf die passende Options-ID (Groß-/Kleinschreibung egal) oder leert es. */
function addEnumFieldIfSet(customFields, fieldName, textValue) {
  if (!textValue) {
    customFields[FIELD_KEYS[fieldName]] = null;
    return;
  }
  const options = ENUM_OPTION_IDS[fieldName] || {};
  const matchKey = Object.keys(options).find(k => k.toLowerCase() === textValue.toLowerCase());
  const optionId = matchKey ? options[matchKey] : null;

  if (optionId !== null && optionId !== undefined) {
    customFields[FIELD_KEYS[fieldName]] = optionId;
  } else {
    Logger.log(`⚠️ Keine Options-ID für ${fieldName} = "${textValue}" — Dropdown-Option in Pipedrive anlegen`);
    customFields[FIELD_KEYS[fieldName]] = null;
  }
}

// ============================================================================
// LOGGING
// ============================================================================

function logSyncResult(status, dealId, orderId, fehler, details) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SYNC_LOG_TAB);
    sheet.appendRow([new Date(), status, dealId || '-', orderId || '-', fehler || '-', details || '-']);
  } catch (e) {
    Logger.log('⚠️ Konnte nicht ins Sync-Log schreiben: ' + e);
  }
}

// ============================================================================
// DUPLIKAT-SCHUTZ: merkt sich pro Auftrag den letzten Sync-Stand
// ============================================================================

function getSyncState() {
  const raw = PropertiesService.getScriptProperties().getProperty(SYNC_STATE_KEY);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveSyncState(state) {
  PropertiesService.getScriptProperties().setProperty(SYNC_STATE_KEY, JSON.stringify(state));
}

/** Setzt den Duplikat-Schutz zurück — danach werden beim nächsten Lauf alle Aufträge erneut gesynct. */
function resetSyncState() {
  PropertiesService.getScriptProperties().deleteProperty(SYNC_STATE_KEY);
  Logger.log('✓ Sync-Status zurückgesetzt. Nächster Lauf verarbeitet alle Aufträge neu.');
}

// ============================================================================
// HAUPT-FUNKTION: ein einzelner Auftrag
// ============================================================================

function syncOrderToPipedrive(orderId) {
  let dealId = null;

  try {
    const order = fetchOrderFromSevdesk(orderId);
    const label = order.orderNumber || orderId;

    const match = findTargetDeal(order);

    if (match.ambiguous) {
      const details = match.konflikt
        ? match.konflikt
        : `Kandidaten: ${match.candidates.join(', ')} — Angebotsnummer "${order.orderNumber}" im richtigen Deal eintragen`;
      logSyncResult('WARNUNG', null, label, `Mehrere Deals über ${match.matchedBy} gefunden`, details);
      return false;
    }

    if (!match.dealId) {
      logSyncResult('ERROR', null, label, 'Kein Pipedrive Deal gefunden',
        `Weder Angebotsnummer "${order.orderNumber}" noch Kundennummer "${order.customerId}" in einem Deal hinterlegt`);
      return false;
    }

    dealId = match.dealId;
    const aggregated = aggregatePositions(order.positions);
    writeArticleFieldsToDeal(dealId, aggregated);

    const details = aggregated.unknownArticles.length > 0
      ? `[${match.matchedBy}] ${aggregated.summary} | ⚠️ Unbekannt: ${aggregated.unknownArticles.join(', ')}`
      : `[${match.matchedBy}] ${aggregated.summary}`;

    logSyncResult('SUCCESS', dealId, label, '-', details);
    Logger.log(`✓ ${label} → Deal ${dealId} (${match.matchedBy})`);
    return true;

  } catch (e) {
    logSyncResult('ERROR', dealId, orderId, e.message, '');
    Logger.log(`✗ Order ${orderId}: ${e.message}`);
    return false;
  }
}

// ============================================================================
// POLLING — diese Funktion läuft im Live-Betrieb per Zeittrigger (alle 15 Min)
// ============================================================================

function syncPendingOrders() {
  const state = getSyncState();
  let offset = 0;
  const limit = 100;
  let alleAuftraege = [];

  // Pagination: sevdesk liefert max. 100 Einträge pro Aufruf
  while (true) {
    const data = sevdeskFetch(`/Order?status=${SEVDESK_STATUS_ANGENOMMEN}&limit=${limit}&offset=${offset}`);
    if (!data.objects || data.objects.length === 0) break;
    alleAuftraege = alleAuftraege.concat(data.objects);
    if (data.objects.length < limit) break;
    offset += limit;
    if (offset > 1000) break; // Sicherheitsnetz gegen Endlosschleife
  }

  // Nur Aufträge, die neu sind oder sich seit dem letzten Sync geändert haben
  const zuSyncen = alleAuftraege.filter(o => state[o.id] !== (o.update || ''));

  Logger.log(`Polling: ${alleAuftraege.length} angenommene Aufträge, davon ${zuSyncen.length} neu/geändert`);

  if (zuSyncen.length === 0) return;

  const batch = zuSyncen.slice(0, MAX_ORDERS_PER_RUN);
  let verarbeitet = 0;

  // Zeitwächter: Apps Script bricht nach 6 Min hart ab. Wir stoppen freiwillig bei 4 Min,
  // damit der Sync-Status noch sauber gespeichert werden kann und keine Arbeit verloren geht.
  const startZeit = Date.now();

  for (let i = 0; i < batch.length; i++) {
    if (Date.now() - startZeit > MAX_RUNTIME_MS) {
      Logger.log(`⏱️ Zeitlimit-Schutz nach ${verarbeitet} Aufträgen — Rest folgt im nächsten Lauf`);
      break;
    }

    const o = batch[i];
    const erfolg = syncOrderToPipedrive(o.id);

    // Nur bei Erfolg als erledigt merken — Fehlerfälle werden automatisch erneut versucht
    if (erfolg) {
      state[o.id] = o.update || '';
      verarbeitet++;
      // Alle 5 Aufträge zwischenspeichern, damit bei einem unerwarteten Abbruch
      // nicht die Arbeit des ganzen Laufs verloren geht
      if (verarbeitet % 5 === 0) saveSyncState(state);
    }
  }

  saveSyncState(state);

  const offen = zuSyncen.length - verarbeitet;
  if (offen > 0) {
    Logger.log(`ℹ️ ${offen} Aufträge noch offen (neu/geändert oder Fehler) — nächster Lauf in 15 Min`);
  }
}

// ============================================================================
// TEST- UND DEBUG-FUNKTIONEN (nie per Trigger, immer nur manuell)
// ============================================================================

/** Prüft nur die Artikel-Erkennung, ohne API-Zugriff und ohne zu schreiben. */
function testMappingOnly() {
  const testPositions = [
    { name: 'AIKO-GLAS-GLAS NEOSTAR FULL BLACK 475 WP', quantity: 13 },
    { name: 'SIGENERGY Hybrid Wechselrichter 10.0 kW TP2 dreiphasig', quantity: 1 },
    { name: 'SIGENERGY Batteriemodul 8,06 kWh', quantity: 2 },
    { name: 'SIGENERGY Gateway Umschaltbox Dreiphasig', quantity: 1 },
    { name: 'SIGENERGY Battery Controller BC inkl. Bodenmontageset', quantity: 1 },
    { name: 'HUAWEI WALLBOX AC 22, EV CHARGER', quantity: 1 },
  ];
  Logger.log(JSON.stringify(aggregatePositions(testPositions), null, 2));
}

/** Liest einen sevdesk-Auftrag und zeigt Daten + Mapping, ohne nach Pipedrive zu schreiben. */
function testFetchSevdeskOnly() {
  const TEST_ORDER_ID = '';  // ← Order-ID eintragen

  if (!TEST_ORDER_ID) { Logger.log('✗ Bitte TEST_ORDER_ID eintragen.'); return; }
  try {
    const order = fetchOrderFromSevdesk(TEST_ORDER_ID);
    Logger.log('=== sevdesk Order ===');
    Logger.log(JSON.stringify(order, null, 2));
    Logger.log('\n=== Artikel-Mapping ===');
    Logger.log(JSON.stringify(aggregatePositions(order.positions), null, 2));
    Logger.log('\n=== Deal-Matching (nur Suche, kein Schreiben) ===');
    Logger.log(JSON.stringify(findTargetDeal(order), null, 2));
  } catch (e) {
    Logger.log('✗ Fehler: ' + e.message);
  }
}

/** Führt den kompletten Sync für EINEN Auftrag aus. ⚠️ Schreibt echt nach Pipedrive. */
function testFullSync() {
  const TEST_ORDER_ID = '';  // ← Order-ID eintragen

  if (!TEST_ORDER_ID) { Logger.log('✗ Bitte TEST_ORDER_ID eintragen.'); return; }
  syncOrderToPipedrive(TEST_ORDER_ID);
}

/** Zeigt die rohe sevdesk-Antwort — für die Fehlersuche bei API-Problemen. */
function debugSevdeskResponse() {
  const TEST_ORDER_ID = '';  // ← Order-ID eintragen

  const token = PropertiesService.getScriptProperties().getProperty('SEVDESK_API_TOKEN');
  Logger.log('Token: ' + (token ? `vorhanden (${token.length} Zeichen)` : 'FEHLT!'));
  if (!TEST_ORDER_ID) { Logger.log('✗ Bitte TEST_ORDER_ID eintragen.'); return; }

  const response = UrlFetchApp.fetch(`${SEVDESK_BASE_URL}/Order/${TEST_ORDER_ID}`, {
    headers: { 'Authorization': token },
    muteHttpExceptions: true
  });
  Logger.log('HTTP ' + response.getResponseCode());
  Logger.log(response.getContentText().substring(0, 500));
}