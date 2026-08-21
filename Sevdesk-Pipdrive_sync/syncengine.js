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

// Person-Custom-Fields, 1:1 aus Ordnererstellung-bei-Gewonnen/Projektdoku-Generator übernommen --
// gleiche Pipedrive-Felder, hier nur gelesen (für die Name/Adresse-Log-Liste, siehe unten).
const ADRESSE_FIELD_KEY = '432e4e165de7e9f474643c3d3a5552e2ec976f55';
const PLZ_FIELD_KEY = '5fef394025c936df4b58763b2b58c340fbb0d251';

// Wenn true: nichts wird nach Pipedrive geschrieben, nur geloggt was passieren würde (inkl. aller
// erkannten Felder). Betrifft NUR den schreibenden Schritt (writeArticleFieldsToDeal) -- Lesen/
// Matchen läuft immer live, sonst könnte man ja nichts prüfen. Default true, wie in den anderen
// RP-Scripts (Ordnererstellung-bei-Gewonnen etc.) -- bewusst umschalten, bevor scharf geschrieben wird.
const DRY_RUN = false;

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

/**
 * Liest den Wert eines einzelnen Custom Fields aus einem Deal (für die Angebotsnummer/Kundennummer-Gegenprobe).
 * BUGFIX (2026-08-21): `cf[fieldKey] !== undefined` allein reicht nicht -- ein leeres Pipedrive-Feld
 * liefert `null` (nicht `undefined`), und `String(null)` ergibt den STRING "null", der in der
 * Gegenprobe (`if (kundeCheck && ...)`) truthy ist. Das hat bei jedem Deal ohne gesetzte Kundennummer
 * fälschlich einen "vermutlich falscher Deal"-Konflikt ausgelöst, obwohl das Feld einfach nur leer
 * war -- betraf die komplette Angebotsnummer-Matching-Logik, nicht nur Einzelfälle.
 */
function getDealCustomFieldValue(dealId, fieldKey) {
  if (!fieldKey || fieldKey.indexOf('PLACEHOLDER') === 0) return null;
  const data = pipedriveFetch(`/deals/${dealId}?custom_fields=${fieldKey}`, { method: 'get' });
  if (!data.success || !data.data) return null;
  const cf = data.data.custom_fields || {};
  const wert = cf[fieldKey];
  return (wert !== undefined && wert !== null) ? String(wert) : null;
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

/**
 * Baut eine vollständige, lesbare Zeile aus allen erkannten Feldern -- nicht nur die grobe
 * Summary, sondern jedes Feld einzeln benannt, so wie es (bei DRY_RUN=false) nach Pipedrive
 * geschrieben würde. Damit sieht man beim DRY_RUN-Log genau, was das Script erkannt hat.
 */
function formatiereErkannteFelder(aggregated) {
  const f = aggregated.fields;
  const teile = [
    `Module: ${f.Module_Anzahl || 0}x ${f.Module_Marke || '-'}`,
    `WR: ${f.WR_Leistung_kW || '-'} (System-Marke: ${f.System_Marke || '-'})`,
    `Speicher: ${f.Speicher_Kapazitaet_kWh || '-'}`,
    `Notstrom: ${f.Notstrom_Typ}`,
    `Wallbox: ${f.Wallbox_Typ}`,
    `Heizstab: ${f.Heizstab}`
  ];
  const zeile = teile.join(' | ');
  return aggregated.summary ? `${zeile} || Rohpositionen: ${aggregated.summary}` : zeile;
}

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
    const erkannt = formatiereErkannteFelder(aggregated);

    if (!DRY_RUN) {
      writeArticleFieldsToDeal(dealId, aggregated);
    }

    const warnung = aggregated.unknownArticles.length > 0
      ? ` | ⚠️ Unbekannt: ${aggregated.unknownArticles.join(', ')}`
      : '';
    const details = `[${match.matchedBy}] ${erkannt}${warnung}`;

    logSyncResult(DRY_RUN ? 'DRY_RUN' : 'SUCCESS', dealId, label, '-', details);
    Logger.log(`${DRY_RUN ? '(DRY_RUN, nichts geschrieben) ' : ''}✓ ${label} → Deal ${dealId} (${match.matchedBy})`);
    return true;

  } catch (e) {
    logSyncResult('ERROR', dealId, orderId, e.message, '');
    Logger.log(`✗ Order ${orderId}: ${e.message}`);
    return false;
  }
}

// ============================================================================
// EINZELDEAL OHNE STATUS-FILTER: Artikel-Daten schon vor "Angenommen" holen
// ============================================================================
// syncPendingOrders() filtert bewusst auf status=500 (Angenommen), weil der Live-Betrieb nur
// abgeschlossene Aufträge automatisch verarbeiten soll. Für einen manuell ausgewählten Deal soll
// das nicht gelten -- sucht hier direkt über die Angebotsnummer, IN JEDEM sevdesk-Status.
// Sicherheitsregel (Valentins eigenes Prinzip, siehe CLAUDE.md "bei Mehrdeutigkeit nicht raten"):
// findet die Suche mehr als 1 Auftrag zur selben Angebotsnummer, wird NICHTS geschrieben.
//
// UNGETESTET: der Query-Parameter `orderNumber=` ist von den bestehenden, live bestätigten Calls
// (/Order/{id}, /Order?status=) abgeleitet, aber noch nicht live gegen sevdesk verifiziert -- vor
// dem ersten echten Einsatz einmal mit einem bekannten Testfall gegenchecken (Logger.log zeigt die
// rohe sevdesk-Antwort, falls `objects` leer bleibt obwohl der Auftrag existiert).

/**
 * Holt Artikel-Daten für EINEN Pipedrive-Deal direkt aus sevdesk, unabhängig vom Auftragsstatus.
 * Voraussetzung: der Deal hat schon eine Angebotsnummer eingetragen (FIELD_KEYS.sevdesk_angebotsnummer).
 * Bei genau 1 Treffer: normaler Sync (writeArticleFieldsToDeal). Bei 0 oder >1 Treffern: nur loggen,
 * NICHTS schreiben.
 */
function syncEinzelDealOhneStatusFilter(dealId) {
  const dealData = pipedriveFetch(`/deals/${dealId}?custom_fields=${FIELD_KEYS.sevdesk_angebotsnummer}`, { method: 'get' });
  if (!dealData.success || !dealData.data) {
    logSyncResult('ERROR', dealId, null, 'Deal nicht gefunden/lesbar', JSON.stringify(dealData).substring(0, 200));
    return false;
  }
  const angebotsnummer = (dealData.data.custom_fields || {})[FIELD_KEYS.sevdesk_angebotsnummer];
  if (!angebotsnummer) {
    logSyncResult('ERROR', dealId, null, 'Keine Angebotsnummer am Deal hinterlegt',
      'Ohne Angebotsnummer kann sevdesk nicht sicher durchsucht werden -- manuell eintragen, dann erneut versuchen');
    return false;
  }

  const orderData = sevdeskFetch(`/Order?orderNumber=${encodeURIComponent(angebotsnummer)}`);
  const treffer = orderData.objects || [];

  if (treffer.length === 0) {
    logSyncResult('ERROR', dealId, angebotsnummer, 'Kein sevdesk-Auftrag mit dieser Angebotsnummer gefunden', '');
    Logger.log(`✗ Deal ${dealId}: kein sevdesk-Auftrag zu Angebotsnummer "${angebotsnummer}"`);
    return false;
  }
  if (treffer.length > 1) {
    logSyncResult('WARNUNG', dealId, angebotsnummer,
      `${treffer.length} sevdesk-Aufträge mit derselben Angebotsnummer gefunden`,
      `Order-IDs: ${treffer.map(o => o.id).join(', ')} -- nichts geschrieben, manuell prüfen`);
    Logger.log(`⚠️ Deal ${dealId}: ${treffer.length} Treffer für "${angebotsnummer}" -- abgebrochen, keine Ratelogik`);
    return false;
  }

  // Genau 1 Treffer -- weiter über die bestehende, bereits getestete Sync-Logik (gleicher Weg wie
  // syncPendingOrders, nur ohne den Status-Filter davor).
  return syncOrderToPipedrive(treffer[0].id);
}

/** Für Einzeltests im Editor: Deal-ID unten eintragen (▷-Button ruft ohne Argumente auf). */
function testEinzelDealOhneStatusFilter() {
  const dealId = 7253; // hier Deal-ID eintragen
  const erfolg = syncEinzelDealOhneStatusFilter(dealId);
  Logger.log(erfolg ? '✓ Sync erfolgreich' : '✗ Sync nicht durchgeführt -- siehe Log/Sync-Log-Sheet');
}

/**
 * Schreibt Artikel-Daten direkt auf einen BEREITS BEKANNTEN Deal (aus Namensabgleich gefunden),
 * OHNE über die generische Angebotsnummer/Kundennummer-Rediscovery von findTargetDeal() zu gehen.
 *
 * BUGFIX (2026-08-21): syncPerNameVormatching() rief zuvor syncOrderToPipedrive(orderId) auf, die
 * intern versucht, den Ziel-Deal SELBST zu finden -- unnötig UND riskant, wenn wir den Deal doch
 * schon über den Namensabgleich sicher kennen. Da diese Deals nie eine Angebotsnummer/Kundennummer
 * in Pipedrive hatten, hätte die Rediscovery vermutlich für JEDEN Treffer "Kein Pipedrive Deal
 * gefunden" ergeben -- der komplette Namens-Vormatching-Batch hätte also nie tatsächlich
 * geschrieben, nur die Vorab-Log-Zeile hätte Erfolg vorgetäuscht. Diese Funktion schreibt die
 * Angebotsnummer als Nebeneffekt gleich mit auf den bekannten Deal (für Nachvollziehbarkeit/
 * künftige Läufe über die normale Route), dann direkt die Artikel-Felder -- kein Ratespiel mehr.
 */
function syncDirektAufBekannterDeal(dealId, orderId) {
  try {
    const order = fetchOrderFromSevdesk(orderId);
    const aggregated = aggregatePositions(order.positions);
    const erkannt = formatiereErkannteFelder(aggregated);

    if (!DRY_RUN) {
      if (order.orderNumber) {
        pipedriveFetch(`/deals/${dealId}`, {
          method: 'patch',
          contentType: 'application/json',
          payload: JSON.stringify({ custom_fields: { [FIELD_KEYS.sevdesk_angebotsnummer]: order.orderNumber } })
        });
      }
      writeArticleFieldsToDeal(dealId, aggregated);
    }

    const warnung = aggregated.unknownArticles.length > 0
      ? ` | ⚠️ Unbekannt: ${aggregated.unknownArticles.join(', ')}`
      : '';
    const details = `[Namensabgleich, Order ${order.orderNumber || orderId}] ${erkannt}${warnung}`;

    logSyncResult(DRY_RUN ? 'DRY_RUN' : 'SUCCESS', dealId, order.orderNumber || orderId, '-', details);
    Logger.log(`${DRY_RUN ? '(DRY_RUN, nichts geschrieben) ' : ''}✓ Deal ${dealId} direkt beschrieben (Order ${order.orderNumber || orderId})`);
    return true;
  } catch (e) {
    logSyncResult('ERROR', dealId, orderId, e.message, '');
    Logger.log(`✗ Deal ${dealId} / Order ${orderId}: ${e.message}`);
    return false;
  }
}

// ============================================================================
// VORMATCHING PER NAME: für Deals OHNE Angebotsnummer
// ============================================================================
// syncEinzelDealOhneStatusFilter() braucht zwingend eine Angebotsnummer am Deal. Für Deals, wo die
// noch fehlt, bleibt nur der Name als Anker -- deutlich unsicherer (Namensgleichheit, Tippfehler),
// deshalb strikt nach demselben Prinzip wie überall sonst: nur bei GENAU 1 Treffer schreiben, sonst
// nur loggen und den Fall dem Menschen zur Entscheidung vorlegen (siehe CLAUDE.md).
//
// UNGETESTET wie oben: /Contact liefert bei sevdesk je nach Kontakttyp entweder `name` (Firma) oder
// `surename`+`familyname` (Person) -- Feldnamen aus der bestehenden fetchOrderFromSevdesk()-Nutzung
// von /Contact/{id} übernommen, die Kombination beider Felder für den Vergleich ist aber noch nicht
// live verifiziert. Vor dem ersten echten Einsatz mit einem bekannten Namen gegenchecken.

/** Namen zu vergleichbarer Form normalisieren (lowercase, Whitespace vereinheitlicht). */
function nameNormalisiert(roh) {
  return String(roh || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Holt ALLE sevdesk-Aufträge unabhängig vom Status (Pagination wie syncPendingOrders, nur ohne
 * status=-Filter). Matched wird über `addressName` -- das Feld, das den Kundennamen so trägt, wie
 * er auf dem Angebot/Auftrag STEHT, unabhängig vom verknüpften Contact-Datensatz.
 *
 * KORREKTUR (2026-08-20): Erste Fassung hat über den verknüpften Contact (`contact.id` ->
 * /Contact/{id} -> name/surename+familyname) gematcht. Das lieferte bei ~24/30 echten Kunden
 * "kein Treffer", obwohl der Kunde nachweislich in sevdesk existiert (händisch in der sevdesk-
 * Angebote-Suche bestätigt, z.B. "Metehan Hilal Arac"). Root Cause: `addressName` am Auftrag und
 * der Name im verknüpften Contact-Datensatz sind zwei UNABHÄNGIGE Felder und können auseinanderlaufen
 * -- addressName ist näher an dem, was die sevdesk-UI selbst durchsucht. Direkt darauf zu matchen
 * spart zusätzlich den kompletten /Contact-Preload (kein N+1-Risiko mehr, einfacher Code).
 * Siehe project_sevdesk_pipedrive_sync.md für Details.
 */
function holeAlleAuftraegeMitKundenname() {
  const treffer = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = sevdeskFetch(`/Order?limit=${limit}&offset=${offset}`);
    if (!data.objects || data.objects.length === 0) break;
    data.objects.forEach(o => {
      if (!o.addressName || !o.contact || !o.contact.id) return;
      treffer.push({
        orderId: o.id, orderNumber: o.orderNumber, contactId: o.contact.id,
        update: o.update || o.orderDate || '', kundenName: nameNormalisiert(o.addressName)
      });
    });
    if (data.objects.length < limit) break;
    offset += limit;
    if (offset > 20000) { Logger.log('⚠️ Sicherheitsnetz bei 20000 Aufträgen erreicht -- es gibt mehr, als geladen wurden!'); break; }
  }
  return treffer;
}

/** Wie formatAdresse() in Projektdoku-Generator/Config.js -- gleiche Feldstruktur (Google-Maps-
 *  Autocomplete füllt Subfelder, freie Texteingabe füllt nur `value`), hier lokal dupliziert, weil
 *  Sevdesk-Pipdrive_sync ein eigenes Apps-Script-Projekt ist (kein Datei-Teilen zwischen Projekten). */
function holeAdresseFuerLog(person) {
  if (!person || !person.custom_fields) return '(keine Adresse)';
  const adressFeld = person.custom_fields[ADRESSE_FIELD_KEY];
  const plzFeld = person.custom_fields[PLZ_FIELD_KEY];
  const adresse = adressFeld && typeof adressFeld === 'object'
    ? (adressFeld.formatted_address || adressFeld.value || '')
    : (adressFeld ? String(adressFeld) : '');
  const plzText = plzFeld ? String(plzFeld) : '';
  const plzSchonDrin = plzText && adresse.includes(plzText);
  const teile = [adresse, !plzSchonDrin ? plzText : ''].filter(Boolean);
  return teile.length ? teile.join(', ') : '(keine Adresse)';
}

/**
 * Reine Log-Liste Name/Adresse für eine Deal-Liste -- keine sevdesk-Abfrage, kein Schreiben.
 * Zum Vor-Check bevor man Vormatching per Name laufen lässt: zeigt, was überhaupt an Name/Adresse
 * in Pipedrive steht, damit man Namensgleichheiten (zwei "Maier") schon vorher im Blick hat.
 * Ergebnis kommt sowohl in Logger.log (direkt im Editor sichtbar) als auch als eigene INFO-Zeile
 * im Sync-Log-Sheet (persistent, auch nach Schließen des Editors nachlesbar).
 */
function listeNameUndAdresse(dealIds) {
  dealIds.forEach(dealId => {
    const dealData = pipedriveFetch(`/deals/${dealId}`, { method: 'get' });
    if (!dealData.success || !dealData.data) {
      Logger.log(`Deal ${dealId}: nicht gefunden/lesbar`);
      logSyncResult('INFO', dealId, null, 'Name/Adresse-Check: Deal nicht gefunden/lesbar', '');
      return;
    }
    const personRef = dealData.data.person_id;
    const personId = personRef && (personRef.value || personRef);
    if (!personId) {
      Logger.log(`Deal ${dealId} (${dealData.data.title}): keine Person verknüpft`);
      logSyncResult('INFO', dealId, null, 'Name/Adresse-Check: keine Person verknüpft', dealData.data.title || '');
      return;
    }
    const personData = pipedriveFetch(`/persons/${personId}`, { method: 'get' });
    const person = personData.success ? personData.data : null;
    const name = person ? person.name : dealData.data.title;
    const adresse = holeAdresseFuerLog(person);

    Logger.log(`Deal ${dealId}: ${name} -- ${adresse}`);
    logSyncResult('INFO', dealId, null, 'Name/Adresse-Check', `${name} -- ${adresse}`);
  });
}

/** Für Einzeltests im Editor: Deal-IDs unten eintragen (▷-Button ruft ohne Argumente auf). */
function testListeNameUndAdresse() {
  const dealIds = [7253]; // hier die zu prüfenden Deal-IDs eintragen
  listeNameUndAdresse(dealIds);
}

/**
 * Massen-Vorschau Name/Adresse für die 32 Fulfillment-Deals -- vor dem Vormatching per Name
 * ausführen, um Namensgleichheiten/fehlende Adressen vorab zu sehen.
 */
function listeNameUndAdresseMassentransfer() {
  // 6591 und 7107 (beide Mario Messiha, identischer Name+Adresse) bewusst ausgelassen -- er hat
  // mehrere Deals, Namensmatching kann die beiden nicht unterscheiden. Bei Bedarf später einzeln
  // mit der richtigen Angebotsnummer nachziehen (syncEinzelDealOhneStatusFilter).
  const dealIds = [
    7065, 6970, 5587, 6694, 5779, 6922, 5984, 6659, 6084, 5837, 6686,
    6804, 5867, 6971, 6843, 7096, 6406, 7129, 5728, 6179, 6738, 6219, 6771,
    7059, 5307, 7177, 6908, 6018, 5663, 6493
  ];
  listeNameUndAdresse(dealIds);
}

/**
 * Manuell bestätigte Namens-Abweichungen zwischen Pipedrive-Person und sevdesk-Kundenname (Stand
 * 2026-08-20/21, live in der sevdesk-UI gegengecheckt von Valentin -- siehe project_sevdesk_
 * pipedrive_sync.md). Der sevdesk-Auftrag läuft auf Ehepartner statt auf die Pipedrive-Person.
 *
 * Kalman/Waldhaus waren hier ursprünglich auch drin (Firmenname statt Person), matchten aber trotz
 * exakt passendem addressName nicht (2026-08-21, Ursache ungeklärt -- evtl. Pagination-Timing bei
 * holeAlleAuftraegeMitKundenname). Laufen jetzt stattdessen über die zuverlässigere Angebotsnummer-
 * Route (setzeBekannteAngebotsnummernUndSync), nicht mehr über diese Namens-Override-Liste.
 */
const NAME_UEBERSCHREIBUNGEN = {
  5663: 'Johanna Seitz'  // Christian Seitz -- Auftrag läuft auf die Ehefrau
};

/**
 * Vormatching per Name für Deals ohne Angebotsnummer. dealIds = Array von Pipedrive Deal-IDs.
 * Holt den Personennamen aus Pipedrive (oder nimmt die Override aus NAME_UEBERSCHREIBUNGEN, falls
 * vorhanden), vergleicht gegen alle sevdesk-Aufträge (per Kundenname aus addressName).
 * Genau 1 Treffer -> normaler Sync über syncOrderToPipedrive(). 0 oder >1 Treffer -> nur Log-Eintrag
 * (inkl. Pipedrive-Adresse, damit man die Kandidaten bei >1 Treffer manuell unterscheiden kann).
 */
function syncPerNameVormatching(dealIds) {
  Logger.log('Lade alle sevdesk-Aufträge + Kundennamen (einmalig, dann pro Deal wiederverwendet)...');
  const alleAuftraege = holeAlleAuftraegeMitKundenname();
  Logger.log(`${alleAuftraege.length} Aufträge mit Kundenname geladen.`);

  dealIds.forEach(dealId => {
    const dealData = pipedriveFetch(`/deals/${dealId}`, { method: 'get' });
    if (!dealData.success || !dealData.data) {
      logSyncResult('ERROR', dealId, null, 'Deal nicht gefunden/lesbar', '');
      return;
    }
    const personRef = dealData.data.person_id;
    const personId = personRef && (personRef.value || personRef);
    if (!personId) {
      logSyncResult('ERROR', dealId, null, 'Kein Personenname am Deal ermittelbar (kein person_id)', '');
      return;
    }
    // person_id am Deal ist nur eine Referenz ({value, ...}), der Name steht NICHT eingebettet mit
    // drin -- deshalb wie bei listeNameUndAdresse() ein separater /persons/{id}-Call.
    const personData = pipedriveFetch(`/persons/${personId}`, { method: 'get' });
    const personName = personData.success && personData.data ? personData.data.name : null;
    if (!personName) {
      logSyncResult('ERROR', dealId, null, 'Kein Personenname ermittelbar (person_id vorhanden, aber /persons-Call ohne Namen)', '');
      return;
    }
    const ueberschriebenerName = NAME_UEBERSCHREIBUNGEN[dealId];
    const sucheName = ueberschriebenerName || personName;
    const gesuchterName = nameNormalisiert(sucheName);
    if (ueberschriebenerName) {
      Logger.log(`ℹ️ Deal ${dealId}: suche mit bestätigtem Override "${ueberschriebenerName}" statt Pipedrive-Name "${personName}"`);
    }

    const treffer = alleAuftraege.filter(a => a.kundenName === gesuchterName);
    // Nach ECHTEM Kontakt dedupen, nicht nach Auftrag -- ein realer Kunde kann mehrere Order-
    // Objekte haben (Angebots-Revisionen, orderType "AN" vs. spätere Auftragsbestätigung, siehe
    // project_sevdesk_pipedrive_sync). Sonst zählt z.B. 1 Kunde mit 3 Angebots-Versionen fälschlich
    // als "3 Treffer" / mehrdeutig, obwohl es nur einen echten Kandidaten gibt.
    const distinctContactIds = [...new Set(treffer.map(t => t.contactId))];

    if (treffer.length === 0) {
      logSyncResult('ERROR', dealId, null, `Kein sevdesk-Auftrag mit Kundenname "${sucheName}" gefunden`, '');
      Logger.log(`✗ Deal ${dealId} (${sucheName}): kein Treffer per Name`);
    } else if (distinctContactIds.length > 1) {
      // Adresse aus dem schon geladenen personData mitloggen, damit bei >1 Treffer wenigstens eine
      // Entscheidungsgrundlage dasteht (siehe CLAUDE.md "bei Mehrdeutigkeit nicht raten, sondern
      // entscheidbar machen") -- kein zusätzlicher Call nötig, personData ist schon oben geladen.
      const adresse = holeAdresseFuerLog(personData.data);
      logSyncResult('WARNUNG', dealId, null,
        `${distinctContactIds.length} verschiedene sevdesk-Kontakte mit demselben Namen "${sucheName}"`,
        `Adresse lt. Pipedrive: ${adresse} -- Order-Nummern: ${treffer.map(t => t.orderNumber || t.orderId).join(', ')} -- nichts geschrieben, Angebotsnummer manuell eintragen`);
      Logger.log(`⚠️ Deal ${dealId} (${sucheName}, ${adresse}): ${distinctContactIds.length} verschiedene Kontakte -- abgebrochen, keine Ratelogik`);
    } else {
      // Genau 1 echter Kontakt, evtl. mehrere Order-Revisionen -- die zuletzt aktualisierte nehmen.
      const neuesterAuftrag = treffer.reduce((a, b) => (String(b.update) > String(a.update) ? b : a));
      const hinweis = treffer.length > 1 ? ` (${treffer.length} Order-Revisionen desselben Kontakts, neueste genommen)` : '';
      Logger.log(`✓ Deal ${dealId} (${sucheName}): 1 Kontakt${hinweis} -- Order ${neuesterAuftrag.orderId}, syncing...`);
      syncDirektAufBekannterDeal(dealId, neuesterAuftrag.orderId);
    }
  });
}

/**
 * Massentransfer für die 32 Fulfillment-Deals (Namensabgleich-Uebernahme, Stand 2026-08-20) ohne
 * Angebotsnummer -- lädt die sevdesk-Aufträge EINMAL für alle 32, nicht pro Deal (kein N+1).
 */
function syncPerNameVormatchingMassentransfer() {
  // Ausgelassen (Stand 2026-08-21):
  // - 6591/7107 (Mario Messiha, identischer Name+Adresse) -- Namensmatching kann die 2 Deals nicht
  //   unterscheiden, braucht die richtige Angebotsnummer manuell.
  // - 6219/7059/5307 (Bobál/van Dyck/Kavlak), 6493/6771 (Kalman/Waldhaus) -- alle 5 laufen jetzt
  //   über setzeBekannteAngebotsnummernUndSync() mit bekannter/gefundener Angebotsnummer, statt
  //   "neueste Revision" zu raten bzw. weiter am addressName-Matching zu debuggen.
  // - 6922 (Hidir Özdek) -- 3 aktive Verträge gleichzeitig, unklar welcher zu diesem Deal gehört.
  // - 6406 (Karl Heindl), 6908 (Hans Greml) -- on Hold, Marco klärt noch.
  // - 5663 (Christian Seitz) -- Override "Johanna Seitz" bleibt drin, noch keine Angebotsnummer bekannt.
  // - 7065 (Metehan Hilal Arac) -- 0 Aufträge in sevdesk, kein Match möglich.
  const dealIds = [
    7065, 6970, 5587, 6694, 5779, 5984, 6659, 6084, 5837, 6686,
    6804, 5867, 6971, 6843, 7096, 7129, 5728, 6179, 6738,
    7177, 6018, 5663
  ];
  syncPerNameVormatching(dealIds);
}

/**
 * Bestätigte Angebotsnummern für 3 der Revisions-Fälle (Valentin, 2026-08-21, nach Rücksprache/
 * sevdesk-Check) -- schreibt die Angebotsnummer ins Pipedrive-Deal-Feld und synct danach über die
 * zuverlässige Angebotsnummer-Route (syncEinzelDealOhneStatusFilter), statt sich auf "neueste
 * Revision" zu verlassen wie beim Vormatching per Name.
 */
function setzeBekannteAngebotsnummernUndSync() {
  const eintraege = {
    6219: '2026-470-A', // Zoltán Bobál
    7059: '2026-536-A', // Christian van Dyck
    5307: '2026-535-A', // Kenan Kavlak
    6493: '2026-554-A', // Canan Kalman -- Auftrag läuft auf "Brot & Gebäck KALMAN KG"
    6771: '2026-425-A'  // Rudy Waldhaus -- Auftrag läuft auf "Waldhaus GmbH"
  };
  Object.entries(eintraege).forEach(([dealId, angebotsnummer]) => {
    const result = pipedriveFetch(`/deals/${dealId}`, {
      method: 'patch',
      contentType: 'application/json',
      payload: JSON.stringify({ custom_fields: { [FIELD_KEYS.sevdesk_angebotsnummer]: angebotsnummer } })
    });
    if (!result.success) {
      Logger.log(`✗ Deal ${dealId}: Angebotsnummer-Patch fehlgeschlagen -- ${JSON.stringify(result).substring(0, 200)}`);
      return;
    }
    Logger.log(`✓ Deal ${dealId}: Angebotsnummer "${angebotsnummer}" gesetzt, synce jetzt...`);
    syncEinzelDealOhneStatusFilter(dealId);
  });
}

/** Für Einzeltests im Editor: Deal-IDs unten eintragen (▷-Button ruft ohne Argumente auf). */
function testSyncPerNameVormatching() {
  // Nachzug für die 3 JASOLAR-Deals -- Modul_Marke war beim ersten Lauf leer, weil die Pipedrive-
  // Dropdown-Option damals noch nicht existierte (jetzt in ENUM_OPTION_IDS.Module_Marke ergänzt).
  const dealIds = [5728, 5867, 6738];
  syncPerNameVormatching(dealIds);
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

    // Nur bei Erfolg als erledigt merken — Fehlerfälle werden automatisch erneut versucht.
    // Bei DRY_RUN NIE als erledigt markieren, sonst hält der Duplikat-Schutz einen Auftrag für
    // "schon gesynct", obwohl nie wirklich geschrieben wurde -- der nächste LIVE-Lauf würde ihn
    // dann fälschlich überspringen.
    if (erfolg && !DRY_RUN) {
      state[o.id] = o.update || '';
      verarbeitet++;
      // Alle 5 Aufträge zwischenspeichern, damit bei einem unerwarteten Abbruch
      // nicht die Arbeit des ganzen Laufs verloren geht
      if (verarbeitet % 5 === 0) saveSyncState(state);
    } else if (erfolg && DRY_RUN) {
      verarbeitet++; // nur für die Log-Zeile unten, kein State-Save
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

/** Führt den kompletten Sync für EINEN Auftrag aus. Schreibt nach Pipedrive, AUSSER DRY_RUN=true. */
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

/**
 * DIAGNOSE-Funktion, die den 25/30-"kein Treffer"-Bug beim Vormatching per Name aufgeklärt hat
 * (2026-08-20): Root Cause war, dass über den verknüpften Contact-Datensatz gematcht wurde, dessen
 * Namensfelder unabhängig vom `addressName`-Feld auf dem Auftrag selbst sein können (siehe
 * project_sevdesk_pipedrive_sync.md). Fix: holeAlleAuftraegeMitKundenname() matched jetzt direkt
 * über `addressName`, kein Contact-Umweg mehr. Funktion hier belassen für künftige Sevdesk-API-
 * Diagnosen (z.B. neue Feldstruktur-Fragen), nicht mehr aktiv für dieses Problem gebraucht.
 */
function debugKontaktUndAuftragStruktur() {
  Logger.log('=== Erste 3 rohe Kontakte (/Contact) ===');
  const kontakte = sevdeskFetch('/Contact?limit=3');
  Logger.log(JSON.stringify(kontakte, null, 2));

  Logger.log('\n=== Erste 3 rohe Aufträge (/Order) ===');
  const auftraege = sevdeskFetch('/Order?limit=3');
  Logger.log(JSON.stringify(auftraege, null, 2));

  // Falls einer der 3 Beispiel-Aufträge einen contact hat: den echten Kontakt dazu zeigen,
  // damit man Order.contact.id direkt gegen das Contact-Objekt vergleichen kann.
  const ersterKontaktId = auftraege.objects && auftraege.objects[0] && auftraege.objects[0].contact
    ? auftraege.objects[0].contact.id : null;
  if (ersterKontaktId) {
    Logger.log(`\n=== Kontakt zu erstem Auftrag (Contact/${ersterKontaktId}) ===`);
    Logger.log(JSON.stringify(sevdeskFetch(`/Contact/${ersterKontaktId}`), null, 2));
  }

  // Bekannter Deal aus dem Vormatching-Lauf mit "3 Treffer" (Kenan Kavlak, Deal 5307) -- zeigt,
  // welche 3 Aufträge/Kontakte für denselben Namen zusammenlaufen (echte Duplikate? Angebot+Auftrag
  // derselben Bestellung? unterschiedliche Kontakte mit Zufallstreffer im Namen?).
  Logger.log('\n=== Alle sevdesk-Kontakte, deren Name "kavlak" enthält ===');
  let offset = 0;
  const treffer = [];
  while (true) {
    const data = sevdeskFetch(`/Contact?limit=100&offset=${offset}`);
    if (!data.objects || data.objects.length === 0) break;
    data.objects.forEach(c => {
      const roh = JSON.stringify(c).toLowerCase();
      if (roh.includes('kavlak')) treffer.push(c);
    });
    if (data.objects.length < 100) break;
    offset += 100;
    if (offset > 5000) break;
  }
  Logger.log(JSON.stringify(treffer, null, 2));
}

/**
 * DIAGNOSE: Kalman/Waldhaus matchen trotz NAME_UEBERSCHREIBUNGEN immer noch nicht -- zeigt die
 * rohen addressName-Werte aller Aufträge, deren JSON "kalman" bzw. "waldhaus" enthält, damit man
 * sieht, was tatsächlich in addressName steht (Firmenname mit Zusatz? c/o-Ansprechpartner?
 * andere Schreibweise?), statt weiter zu raten.
 */
function debugKalmanUndWaldhaus() {
  ['kalman', 'waldhaus'].forEach(suchbegriff => {
    Logger.log(`\n=== Aufträge, deren Rohdaten "${suchbegriff}" enthalten ===`);
    let offset = 0;
    const treffer = [];
    while (true) {
      const data = sevdeskFetch(`/Order?limit=100&offset=${offset}`);
      if (!data.objects || data.objects.length === 0) break;
      data.objects.forEach(o => {
        if (JSON.stringify(o).toLowerCase().includes(suchbegriff)) {
          treffer.push({ id: o.id, orderNumber: o.orderNumber, addressName: o.addressName, contactId: o.contact && o.contact.id });
        }
      });
      if (data.objects.length < 100) break;
      offset += 100;
      if (offset > 20000) break;
    }
    Logger.log(JSON.stringify(treffer, null, 2));
  });
}