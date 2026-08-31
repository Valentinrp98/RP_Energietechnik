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
//   5 Min sämtliche Altaufträge erneut durchlaufen.
//
// LIVE-BETRIEB: Zeittrigger auf syncPendingOrders(), alle 5 Minuten (seit 26.08.2026, vorher 15).
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

  return fetchMitRetry(() => UrlFetchApp.fetch(`${SEVDESK_BASE_URL}${path}`, {
    headers: { 'Authorization': token },
    muteHttpExceptions: true
  }), `sevdesk ${path}`);
}

function pipedriveFetch(path, options) {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN fehlt in den Script Properties!');

  const opts = Object.assign({ muteHttpExceptions: true }, options || {});
  opts.headers = Object.assign({ 'x-api-token': token }, opts.headers || {});

  return fetchMitRetry(() => UrlFetchApp.fetch(`${PIPEDRIVE_BASE_URL}${path}`, opts), `Pipedrive ${path}`);
}

/**
 * FIX V3 (2026-08-13-Review): Retry bei 429/5xx, bis zu 3 Versuche mit steigender Wartezeit
 * (2s, dann 4s), bei 4xx sofort durchreichen -- ein 4xx wird durchs Warten nicht besser. Dieses
 * Script laeuft als einziges der RP-Scripts alle 5 Min per Trigger und war damit als einziges
 * OHNE Retry-Wrapper, obwohl es am ehesten mal in ein Rate Limit laeuft. Gibt wie vorher das
 * geparste JSON zurueck (auch bei 4xx, damit die bestehenden `.success`-Checks der Aufrufer
 * unveraendert funktionieren) -- nur 429/5xx werden hier abgefangen und wiederholt.
 */
function fetchMitRetry(doFetch, bezeichnung) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = doFetch();
    const code = response.getResponseCode();
    const text = response.getContentText();
    if (code === 429 || code >= 500) {
      if (attempt === maxAttempts) {
        throw new Error(`${bezeichnung}: HTTP ${code} nach ${maxAttempts} Versuchen: ${text.substring(0, 200)}`);
      }
      Utilities.sleep(1000 * Math.pow(2, attempt)); // 2s, dann 4s
      continue;
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(`${bezeichnung}: kein JSON (HTTP ${code}): ${text.substring(0, 150)}`);
    }
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
  // UNGETESTET (31.08.2026): `p.price` als sevdesk-OrderPos-Feld für den Netto-Einzelpreis ist aus
  // der gängigen sevdesk-API-Struktur abgeleitet (analog InvoicePos), aber NICHT live verifiziert --
  // vor dem ersten echten Einsatz mit debugOrderPosPreisFelder(orderId) gegen eine echte FS-Order
  // gegenchecken. Falls `price` nicht stimmt: rohe Positionsdaten dort einsehen und Feldnamen korrigieren.
  const positions = (posData.objects || []).map(p => ({
    name: p.name || (p.part && p.part.name) || 'Unbekannt',
    quantity: Number(p.quantity) || 1,
    einzelpreisNetto: (p.price !== undefined && p.price !== null) ? Number(p.price) : null
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
 * @returns {{dealId, matchedBy, ambiguous, candidates, konflikt}}
 */
function findTargetDeal(order) {
  // Wird gesetzt, wenn Stufe 1 einen Deal über die Angebotsnummer findet, die Kundennummer-
  // Gegenprobe aber nicht passt. FIX (26.08.2026, Deal 7138/7356): vorher wurde das als sofortiger
  // Abbruch behandelt -- dabei kann sevdesk dieselbe Angebotsnummer nachweislich an zwei
  // verschiedene Kunden vergeben (live beobachtet: "2026-630-A" bei Schwaiger UND Radmacher).
  // Jetzt läuft die Suche bei so einem Konflikt zu Stufe 2 (Kundennummer) weiter -- der eigentliche
  // Fehler war ja nicht "kein Treffer", sondern "der über die Nummer gefundene Deal ist der falsche".
  let angebotsnummerKonflikt = null;

  // --- Stufe 1: Angebotsnummer (i.d.R. eindeutig, aber siehe oben: nicht garantiert)
  if (order.orderNumber) {
    const byNumber = searchDealsByField(FIELD_KEYS.sevdesk_angebotsnummer, order.orderNumber);
    if (byNumber.length === 1) {
      if (order.customerId) {
        const kundeCheck = getDealCustomFieldValue(byNumber[0], FIELD_KEYS.sevdesk_kunden_id);
        if (kundeCheck && kundeCheck !== String(order.customerId)) {
          angebotsnummerKonflikt = `Deal ${byNumber[0]} hat Angebotsnummer "${order.orderNumber}", aber Kundennummer "${kundeCheck}" statt erwarteter "${order.customerId}" — vermutlich doppelt vergebene Angebotsnummer in sevdesk (weiter versucht über Kundennummer)`;
          // Kein return -- bewusst zu Stufe 2 weiterlaufen.
        } else {
          return { dealId: byNumber[0], matchedBy: 'Angebotsnummer', ambiguous: false, candidates: byNumber };
        }
      } else {
        return { dealId: byNumber[0], matchedBy: 'Angebotsnummer', ambiguous: false, candidates: byNumber };
      }
    }
    if (byNumber.length > 1) {
      // Mehrere Deals TRAGEN dieselbe Angebotsnummer -- das ist mit Kundennummer allein nicht mehr
      // sicher auflösbar, welcher Deal gemeint ist. Hier bleibt der Abbruch richtig.
      return { dealId: null, matchedBy: 'Angebotsnummer', ambiguous: true, candidates: byNumber };
    }
  }

  // --- Stufe 2: Kundennummer (Fallback bei fehlender Angebotsnummer ODER Konflikt aus Stufe 1)
  if (order.customerId) {
    const byCustomer = searchDealsByField(FIELD_KEYS.sevdesk_kunden_id, order.customerId);
    if (byCustomer.length === 1) {
      return {
        dealId: byCustomer[0], matchedBy: 'Kundennummer', ambiguous: false, candidates: byCustomer,
        konflikt: angebotsnummerKonflikt || undefined
      };
    }
    if (byCustomer.length > 1) {
      // Kunde hat mehrere Deals → Angebotsnummer muss gepflegt werden
      return { dealId: null, matchedBy: 'Kundennummer', ambiguous: true, candidates: byCustomer, konflikt: angebotsnummerKonflikt || undefined };
    }
  }

  if (angebotsnummerKonflikt) {
    // Weder über die Angebotsnummer (Konflikt) noch über Kundennummer eindeutig auflösbar --
    // jetzt bleibt nur noch der manuelle Weg (syncDirektAufBekannterDeal mit sevdesk-Order-ID).
    return { dealId: null, matchedBy: 'Angebotsnummer', ambiguous: true, candidates: [], konflikt: angebotsnummerKonflikt };
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

  // Immer aktiv setzen (auch null) — sonst bleiben Werte vom letzten Sync stehen.
  // FIX V4 (2026-08-13-Review): ohne "|| null" wirft JSON.stringify den Schlüssel bei
  // undefined komplett raus -- der PATCH geht dann mit leerem custom_fields raus, Pipedrive
  // antwortet 200, und das Log meldet faelschlich SUCCESS, obwohl nichts geschrieben wurde.
  customFields[FIELD_KEYS.Module_Anzahl] = aggregated.fields.Module_Anzahl || null;
  customFields[FIELD_KEYS.Module_Bezeichnung] = aggregated.fields.Module_Bezeichnung || null;
  customFields[FIELD_KEYS.WR_Leistung_kW] = aggregated.fields.WR_Leistung_kW || null;
  customFields[FIELD_KEYS.Speicher_Kapazitaet_kWh] = aggregated.fields.Speicher_Kapazitaet_kWh || null;

  addEnumFieldIfSet(customFields, 'Module_Marke', aggregated.fields.Module_Marke);
  addEnumFieldIfSet(customFields, 'System_Marke', aggregated.fields.System_Marke);
  addEnumFieldIfSet(customFields, 'Notstrom_Typ', aggregated.fields.Notstrom_Typ);
  addEnumFieldIfSet(customFields, 'Wallbox_Typ', aggregated.fields.Wallbox_Typ);
  addEnumFieldIfSet(customFields, 'Heizstab', aggregated.fields.Heizstab);

  // Montage/Elektro-Pauschalen (31.08.2026) -- setFieldIfConfigured() überspringt PLACEHOLDER-
  // Felder komplett, bis die echten field_codes eingetragen sind (siehe FIELD_KEYS).
  setFieldIfConfigured(customFields, 'Montage_Pauschale_EUR', aggregated.fields.Montage_Pauschale_EUR);
  setFieldIfConfigured(customFields, 'Elektroinstallation_Pauschale_EUR', aggregated.fields.Elektroinstallation_Pauschale_EUR);
  setFieldIfConfigured(customFields, 'Elektromaterial_Pauschale_EUR', aggregated.fields.Elektromaterial_Pauschale_EUR);
  addEnumFieldIfSet(customFields, 'SM_FS_Typ', aggregated.fields.SM_FS_Typ);

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

/**
 * Setzt ein einfaches Feld (Text/Zahl), aber NUR wenn der field_code schon konfiguriert ist --
 * sonst würde ein "PLACEHOLDER_..."-Platzhalter als echter custom_fields-Key an Pipedrive gesendet.
 * Gleiche Schutzlogik wie searchDealsByField()/getDealCustomFieldValue() weiter oben, nur für's
 * Schreiben statt Lesen. (31.08.2026, Montage/Elektro-Pauschalen)
 */
function setFieldIfConfigured(customFields, fieldName, value) {
  const fieldKey = FIELD_KEYS[fieldName];
  if (!fieldKey || fieldKey.indexOf('PLACEHOLDER') === 0) return;
  customFields[fieldKey] = (value !== undefined && value !== null) ? value : null;
}

/** Setzt ein Dropdown-Feld auf die passende Options-ID (Groß-/Kleinschreibung egal) oder leert es. */
function addEnumFieldIfSet(customFields, fieldName, textValue) {
  const fieldKey = FIELD_KEYS[fieldName];
  // Gleicher PLACEHOLDER-Schutz wie setFieldIfConfigured() -- betrifft aktuell nur SM_FS_Typ, bis
  // der field_code eingetragen ist. Bestehende Felder (Module_Marke etc.) sind nie PLACEHOLDER,
  // Verhalten für die bleibt unverändert.
  if (!fieldKey || fieldKey.indexOf('PLACEHOLDER') === 0) return;

  if (!textValue) {
    customFields[fieldKey] = null;
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

// FIX V1 (2026-08-13-Review): der State wuchs bisher monoton -- jeder je gesyncte Auftrag blieb
// fuer immer drin. Ein einzelner Script-Property-Wert ist auf 9 KB begrenzt, bei ~32 Zeichen pro
// Eintrag also bei ca. 285 Auftraegen erreicht. setProperty() wirft dann am ENDE von
// syncPendingOrders(), also NACHDEM schon nach Pipedrive geschrieben wurde -- die Auftraege sind
// gesynct, gelten aber weiter als "nicht gesynct" und werden beim naechsten Lauf erneut
// verarbeitet: Endlosschleife im 5-Minuten-Takt mit echten Pipedrive-Writes. Abgeschlossene
// Auftraege aendern sich nicht mehr, deshalb reicht Aufraeumen nach Alter.
const SYNC_STATE_MAX_AGE_TAGE = 90;
// FIX V2 (2026-08-13-Review): ein Auftrag ohne passenden Pipedrive-Deal schlug bisher JEDES Mal
// fehl, wurde nie gemerkt und stand deshalb immer wieder ganz vorne in der Batch-Warteschlange --
// bei genug dauerhaft unzuordenbaren Auftraegen kam dadurch KEIN neuer Auftrag mehr durch. Nach
// so vielen Fehlversuchen wird ein Auftrag "geparkt" (aus der Warteschlange raus, aber im Log als
// wartend sichtbar) statt fuer immer einen Platz zu blockieren.
const MAX_VERSUCHE_VOR_PARKEN = 5;
// FIX (26.08.2026): "geparkt" hiess bisher fuer immer -- Valentin will lieber 1x/Tag automatisch
// erneut versuchen (loest sich oft von selbst, wenn jemand nachtraeglich die Kundennummer in
// Pipedrive eintraegt, siehe Mario Golger) UND danach, wenn 2 Wochen lang gar nichts geht, endgueltig
// aufgeben (z.B. Metehan Hilal Arac -- 0 sevdesk-Auftraege, taegliches Neuversuchen bringt nie was).
const PARK_DAUERHAFT_NACH_TAGEN = 14;

function heuteAlsIso() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** Tage zwischen einem yyyy-MM-dd-Datum und heute. */
function tageSeit(datumIso) {
  return Math.floor((new Date(heuteAlsIso()) - new Date(datumIso)) / 86400000);
}

/** true, wenn ein geparkter Auftrag seit PARK_DAUERHAFT_NACH_TAGEN Tagen ohne Erfolg geparkt ist --
 *  dann keine taeglichen Versuche mehr, nur noch manuell per entparkeAuftraege() reaktivierbar. */
function istDauerhaftGeparkt(s) {
  return !!s.geparktSeit && tageSeit(s.geparktSeit) >= PARK_DAUERHAFT_NACH_TAGEN;
}

function getSyncState() {
  const raw = PropertiesService.getScriptProperties().getProperty(SYNC_STATE_KEY);
  let state;
  try {
    state = raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
  // Migration alter Eintraege: vor dem V1-Fix war der Wert ein reiner String (updateTimestamp).
  // "gespeichert" ist fuer diese Alteintraege nicht mehr bekannt -- HEUTE annehmen, dann fallen
  // sie beim naechsten turnusmaeßigen Aufraeumen nach SYNC_STATE_MAX_AGE_TAGE raus, nicht sofort.
  Object.keys(state).forEach(id => {
    if (typeof state[id] === 'string') {
      state[id] = { ts: state[id], gespeichert: heuteAlsIso(), versuche: 0 };
    }
    // Migration (26.08.2026): schon geparkte Alteintraege ohne geparktSeit (vor diesem Fix
    // angelegt) bekommen HEUTE als Start der 14-Tage-Frist -- nicht das alte "gespeichert"-Datum,
    // sonst waeren manche der 8 aktuell geparkten Auftraege sofort ueber die Frist und wuerden nie
    // den neuen taeglichen Retry bekommen, den sie eigentlich zuerst verdienen.
    if (state[id].geparkt && !state[id].geparktSeit) {
      state[id].geparktSeit = heuteAlsIso();
    }
  });
  return state;
}

/** FIX V1: Eintraege aelter als SYNC_STATE_MAX_AGE_TAGE verwerfen, bevor gespeichert wird. */
function bereinigeSyncState(state) {
  const grenze = new Date();
  grenze.setDate(grenze.getDate() - SYNC_STATE_MAX_AGE_TAGE);
  const grenzeIso = Utilities.formatDate(grenze, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  let entfernt = 0;
  Object.keys(state).forEach(id => {
    if (state[id].gespeichert < grenzeIso) { delete state[id]; entfernt++; }
  });
  if (entfernt > 0) Logger.log(`Sync-Status aufgeräumt: ${entfernt} Einträge älter als ${SYNC_STATE_MAX_AGE_TAGE} Tage entfernt.`);
  return state;
}

/**
 * FIX 27.08.2026 -- diese Funktion durfte nicht mehr still scheitern.
 *
 * Der ganze Sync-Stand liegt in EINER Script-Property, und Apps Script begrenzt einen einzelnen
 * Property-Wert auf 9 KB. Die Rechnung im Kommentar bei SYNC_STATE_MAX_AGE_TAGE war zu optimistisch:
 * ein Eintrag ist real ~79 Zeichen
 *   "29997036":{"ts":"2026-08-26 12:31:11","gespeichert":"2026-08-26","versuche":0}
 * und ~121 Zeichen, wenn er geparkt ist (geparkt + geparktSeit) -> ~115 bzw. ~75 Auftraege, nicht 285.
 *
 * Der Fehlerfall war der gefaehrliche Teil: setProperty wirft, ungefangen, und zwar NACH den
 * Pipedrive-Schreibvorgaengen. Der Stand wird dann nie gespeichert, der naechste Lauf sieht den
 * alten Stand, verarbeitet dieselben Auftraege erneut, schreibt erneut nach Pipedrive und wirft
 * erneut. Seit dem 5-Minuten-Takt waeren das 288 solche Runden pro Tag statt 96.
 *
 * Deshalb: Fehler fangen, EINMAL taeglich alarmieren (gleiche Dedupe-Mechanik wie beim
 * Konflikt-Alarm, sonst 288 Mails) und weiterwerfen -- der Lauf soll abbrechen, aber sichtbar.
 * Bewusst NICHT verschluckt: ein stiller Fehlschlag hier ist genau das Problem.
 */
function saveSyncState(state) {
  const bereinigt = bereinigeSyncState(state);
  const nutzlast = JSON.stringify(bereinigt);
  try {
    PropertiesService.getScriptProperties().setProperty(SYNC_STATE_KEY, nutzlast);
  } catch (e) {
    alarmiereEinmalTaeglich(
      'SYNC_STATE_SPEICHERN',
      'sevdesk-Sync: Sync-Stand kann NICHT gespeichert werden -- Auftraege werden doppelt verarbeitet',
      `Der Sync-Stand liess sich nicht speichern: ${e.message}\n\n` +
      `Groesse: ${nutzlast.length} Zeichen, ${Object.keys(bereinigt).length} Eintraege ` +
      `(Apps-Script-Limit pro Property: 9216 Zeichen).\n\n` +
      `WICHTIG: Die Deals sind bereits nach Pipedrive geschrieben, nur der Fortschritt nicht. ` +
      `Ohne Eingriff verarbeitet der Sync dieselben Auftraege alle 5 Minuten erneut und loest ` +
      `dabei jedes Mal die Pipedrive-Automations aus.\n\n` +
      `Naechster Schritt: zeigeSyncStateGroesse() im Editor ausfuehren und den Stand verkleinern ` +
      `oder auslagern.`
    );
    throw e;
  }
}

/**
 * Diagnose vor dem Umbau: wie nah ist der Sync-Stand wirklich am 9-KB-Limit?
 * Bewusst ohne Parameter, damit sie im Editor per ▷ startbar ist.
 */
function zeigeSyncStateGroesse() {
  const roh = PropertiesService.getScriptProperties().getProperty(SYNC_STATE_KEY) || '{}';
  const state = JSON.parse(roh);
  const ids = Object.keys(state);
  const geparkt = ids.filter(id => state[id].geparkt).length;
  const LIMIT = 9216; // 9 KB pro Property-Wert
  const proEintrag = ids.length ? Math.round(roh.length / ids.length) : 0;
  Logger.log(`Sync-Stand: ${roh.length} von ${LIMIT} Zeichen belegt (${Math.round(roh.length / LIMIT * 100)} %).`);
  Logger.log(`${ids.length} Eintraege, davon ${geparkt} geparkt, ~${proEintrag} Zeichen pro Eintrag.`);
  Logger.log(`Rechnerisch noch Platz fuer ~${proEintrag ? Math.floor((LIMIT - roh.length) / proEintrag) : '?'} weitere Eintraege.`);
  Logger.log('Unter ~4000 Zeichen: entspannt. Ueber ~6000: Stand verkleinern oder in ein Sheet auslagern.');
  Logger.log('ACHTUNG: SYNC_STATE_MAX_AGE_TAGE zu senken ist NICHT der richtige Hebel -- ' +
             'faellt der Eintrag eines noch angenommenen Auftrags raus, gilt er wieder als neu ' +
             '(siehe "if (!s) return true" im Filter) und wird komplett neu nach Pipedrive geschrieben.');
}

/**
 * Alarm-Mail, hoechstens einmal pro Schluessel und Kalendertag. Ohne die Drosselung waeren es beim
 * 5-Minuten-Takt 288 Mails am Tag. Reihenfolge wichtig: erst senden, dann den Dedupe-Marker setzen --
 * andernfalls ist der Alarm bei einem fehlgeschlagenen Mail-Versand fuer immer verloren.
 */
function alarmiereEinmalTaeglich(schluessel, betreff, text) {
  const props = PropertiesService.getScriptProperties();
  const KEY = 'ALARM_TAEGLICH';
  let gesendet = {};
  try {
    gesendet = JSON.parse(props.getProperty(KEY) || '{}');
  } catch (e) {
    gesendet = {};
  }
  const heute = heuteAlsIso();
  if (gesendet[schluessel] === heute) {
    Logger.log(`[Alarm heute schon gesendet] ${betreff}`);
    return;
  }
  try {
    MailApp.sendEmail({ to: 'valentin@rp-energietechnik.at', subject: betreff, body: text });
  } catch (e) {
    Logger.log(`⚠️ Alarm-Mail konnte nicht gesendet werden: ${e.message} -- Inhalt: ${text}`);
    return; // Marker NICHT setzen, damit der naechste Lauf es erneut versucht
  }
  const frisch = {};
  Object.keys(gesendet).forEach(k => { if (gesendet[k] === heute) frisch[k] = gesendet[k]; });
  frisch[schluessel] = heute;
  props.setProperty(KEY, JSON.stringify(frisch));
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
    `Heizstab: ${f.Heizstab}`,
    `SM/FS: ${f.SM_FS_Typ}`,
    `Montage: ${f.Montage_Pauschale_EUR !== null ? f.Montage_Pauschale_EUR + ' €' : '-'}`,
    `Elektroinstallation: ${f.Elektroinstallation_Pauschale_EUR !== null ? f.Elektroinstallation_Pauschale_EUR + ' €' : '-'}`,
    `Elektromaterial: ${f.Elektromaterial_Pauschale_EUR !== null ? f.Elektromaterial_Pauschale_EUR + ' €' : '-'}`
  ];
  const zeile = teile.join(' | ');
  return aggregated.summary ? `${zeile} || Rohpositionen: ${aggregated.summary}` : zeile;
}

/**
 * Mailt EINMAL pro Konflikt-Fall (Angebotsnummer bei mehreren Deals bzw. Kundennummer-Gegenprobe
 * fehlgeschlagen, siehe syncOrderToPipedrive) an Valentin -- diese WARNUNG-Zeilen sind selten und
 * brauchen fast immer eine manuelle Korrektur in Pipedrive/sevdesk (siehe Deal 7138/7356, 26.08.2026:
 * doppelt vergebene sevdesk-Angebotsnummer). Dedupe über Script Property, sonst mailt jeder
 * 5-Minuten-Lauf erneut, bis jemand den Konflikt behebt.
 */
function alarmiereBeiKonflikt(label, details) {
  const key = 'KONFLIKT_ALARM_GESENDET';
  const props = PropertiesService.getScriptProperties();
  let gesendet;
  try {
    gesendet = JSON.parse(props.getProperty(key) || '{}');
  } catch (e) {
    gesendet = {};
  }
  if (gesendet[label]) return;

  // Alte Einträge (>90 Tage) aufräumen, gleiche Regel wie beim Sync-State -- sonst wächst die
  // Property unbegrenzt und läuft irgendwann in die 9-KB-Grenze.
  const grenze = new Date();
  grenze.setDate(grenze.getDate() - SYNC_STATE_MAX_AGE_TAGE);
  const grenzeIso = Utilities.formatDate(grenze, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  Object.keys(gesendet).forEach(k => { if (gesendet[k] < grenzeIso) delete gesendet[k]; });

  gesendet[label] = heuteAlsIso();
  props.setProperty(key, JSON.stringify(gesendet));

  try {
    MailApp.sendEmail({
      to: 'valentin@rp-energietechnik.at',
      subject: `sevdesk-Sync: Konflikt bei Angebot ${label} -- manuell prüfen`,
      body: `${details}\n\nSync-Log: https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0 (Tab "${SYNC_LOG_TAB}")\n\nDiese Mail kommt nur einmal pro Fall -- sobald der Konflikt in Pipedrive/sevdesk behoben ist, taucht er im Log nicht mehr auf.`
    });
  } catch (e) {
    Logger.log(`⚠️ Konflikt-Mail konnte nicht gesendet werden: ${e.message}`);
  }
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
      alarmiereBeiKonflikt(label, details);
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
    // match.konflikt kann trotz erfolgreichem Schreiben gesetzt sein (Stufe 1 hatte einen falschen
    // Angebotsnummer-Treffer, Stufe 2 hat über Kundennummer korrekt aufgelöst) -- die doppelt
    // vergebene Nummer bleibt trotzdem eine Pipedrive/sevdesk-Datenlücke, die aufgeräumt gehört.
    const konfliktHinweis = match.konflikt ? ` | ⚠️ ${match.konflikt}` : '';
    const details = `[${match.matchedBy}] ${erkannt}${warnung}${konfliktHinweis}`;

    logSyncResult(DRY_RUN ? 'DRY_RUN' : 'SUCCESS', dealId, label, '-', details);
    Logger.log(`${DRY_RUN ? '(DRY_RUN, nichts geschrieben) ' : ''}✓ ${label} → Deal ${dealId} (${match.matchedBy})`);
    if (match.konflikt) {
      alarmiereBeiKonflikt(label, `Erfolgreich über Kundennummer nach Deal ${dealId} geschrieben, ABER: ${match.konflikt}`);
    }
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
    // Mehrfachtreffer auf dieselbe Angebotsnummer sind KEIN sevdesk-Bug, sondern beobachtetes
    // Verhalten (26.08.2026, Deal 7356/"2026-633-A"): sevdesk vergibt Nummern nicht global eindeutig,
    // ein Entwurf (status 100) kann zufällig dieselbe Nummer bekommen wie ein längst angenommener
    // Auftrag. Ein Entwurf kann aber nie der gemeinte Treffer sein -- daher zuerst auf
    // status=Angenommen einengen, bevor man aufgibt.
    const angenommen = treffer.filter(o => Number(o.status) === SEVDESK_STATUS_ANGENOMMEN);
    if (angenommen.length === 1) {
      Logger.log(`⚠️ Deal ${dealId}: ${treffer.length} Treffer für "${angebotsnummer}", davon 1 mit Status "Angenommen" -- diesen genommen (Order ${angenommen[0].id})`);
      return syncOrderToPipedrive(angenommen[0].id);
    }

    logSyncResult('WARNUNG', dealId, angebotsnummer,
      `${treffer.length} sevdesk-Aufträge mit derselben Angebotsnummer gefunden`,
      `Order-IDs: ${treffer.map(o => `${o.id} (status ${o.status})`).join(', ')} -- nichts geschrieben, manuell prüfen`);
    Logger.log(`⚠️ Deal ${dealId}: ${treffer.length} Treffer für "${angebotsnummer}" -- abgebrochen, keine eindeutige Auflösung über Status`);
    return false;
  }

  // Genau 1 Treffer -- weiter über die bestehende, bereits getestete Sync-Logik (gleicher Weg wie
  // syncPendingOrders, nur ohne den Status-Filter davor).
  return syncOrderToPipedrive(treffer[0].id);
}

/**
 * Debug (31.08.2026): zeigt ALLE Rohfelder jeder OrderPos einer Order -- nötig, um vor dem
 * Live-Schalten der Montage/Elektro-Pauschalen zu verifizieren, wie das sevdesk-Preisfeld wirklich
 * heißt (`fetchOrderFromSevdesk` nimmt aktuell `p.price` an, UNGETESTET, siehe Kommentar dort).
 * Am besten mit einer bekannten FS-Order aufrufen (z.B. 2026-633-A, Order-ID 26886490 laut Memory).
 * Prüfen: gibt's ein Feld mit dem tatsächlichen Netto-Einzelpreis der Position? Falls `price` nicht
 * passt, den echten Feldnamen in `fetchOrderFromSevdesk()` (einzelpreisNetto-Zeile) eintragen.
 */
function debugOrderPosPreisFelder(orderId) {
  const posData = sevdeskFetch(`/OrderPos?order[id]=${orderId}&order[objectName]=Order`);
  const positionen = posData.objects || [];
  Logger.log(`${positionen.length} Position(en) für Order ${orderId}:`);
  positionen.forEach((p, i) => {
    Logger.log(`--- Position ${i + 1}: "${p.name}" ---\n${JSON.stringify(p, null, 2)}`);
  });
}

/**
 * Debug: vergleicht alle sevdesk-Orders mit einer Angebotsnummer nebeneinander, um bei einem
 * Mehrfachtreffer ("WARNUNG: N sevdesk-Aufträge mit derselben Angebotsnummer") zu klären, ob es
 * sich um echte Duplikate (gleicher Kunde, gleicher Inhalt) oder wie bei Schwaiger/Radmacher um
 * zwei unabhängige Kunden mit zufällig gleicher Nummer handelt.
 */
function debugDuplikatAngebotsnummer() {
  const angebotsnummer = '2026-633-A'; // hier bei Bedarf die betroffene Nummer eintragen

  const orderData = sevdeskFetch(`/Order?orderNumber=${encodeURIComponent(angebotsnummer)}`);
  const treffer = orderData.objects || [];
  Logger.log(`${treffer.length} sevdesk-Order(s) für "${angebotsnummer}"`);

  treffer.forEach(o => {
    let customerNumber = null;
    if (o.contact && o.contact.id) {
      const contactData = sevdeskFetch(`/Contact/${o.contact.id}`);
      if (contactData.objects && contactData.objects.length > 0) {
        customerNumber = contactData.objects[0].customerNumber;
      }
    }
    Logger.log(
      `--- Order ${o.id} ---\n` +
      `  addressName: ${o.addressName}\n` +
      `  contact.id: ${o.contact && o.contact.id} (Kundennummer: ${customerNumber})\n` +
      `  orderType: ${o.orderType}, status: ${o.status}\n` +
      `  sumGross: ${o.sumGross}, sumNet: ${o.sumNet}\n` +
      `  orderDate: ${o.orderDate}, update: ${o.update}, create: ${o.create}\n` +
      `  header: ${o.header}`
    );
  });
}

/** Für Einzeltests im Editor: Deal-ID unten eintragen (▷-Button ruft ohne Argumente auf). */
function testEinzelDealOhneStatusFilter() {
  const dealId = 7356; // hier Deal-ID eintragen
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

/**
 * Einmal-Fix (26.08.2026): Deal 7138 (Wolfgang Schwaiger, sevdesk-Kundennummer 4062) blieb leer,
 * weil die Angebotsnummer-Suche nur Deal 7356 (Irene Radmacher) fand und die Kundennummer-
 * Gegenprobe zu Recht "falscher Deal" meldete. Schreibt hier über die eindeutige sevdesk-Order-ID
 * direkt auf den bekannten Deal -- umgeht die Text-Suche komplett.
 *
 * KORREKTUR der ursprünglichen Diagnose (26.08.2026, nach PDF-Vergleich): war KEIN sevdesk-
 * Duplikat, wie zunächst angenommen -- "2026-630-A" (Schwaiger) und "2026-633-A" (Radmacher) sind
 * zwei echte, unterschiedliche sevdesk-Angebote. Der eigentliche Fehler war ein Tippfehler: bei
 * Deal 7356 stand fälschlich "2026-630-A" im Angebotsnummer-Feld statt "2026-633-A" (630/633
 * leicht verwechselbar). Die Artikel-Daten bei Deal 7356 waren davon nicht betroffen (über die
 * Kundennummer-Route korrekt aus 2026-633-A geschrieben) -- siehe korrigiereIreneRadmacher7356()
 * für den eigentlichen Fix.
 */
function korrigiereWolfgangSchwaiger7138() {
  syncDirektAufBekannterDeal(7138, 29997036);
}

/**
 * Einmal-Fix (26.08.2026): Deal 7356 (Irene Radmacher) hatte im Angebotsnummer-Feld fälschlich
 * "2026-630-A" (Wolfgang Schwaigers Nummer) statt ihrer echten "2026-633-A" stehen -- Tippfehler,
 * kein sevdesk-Duplikat (siehe Kommentar bei korrigiereWolfgangSchwaiger7138()). Die bereits
 * geschriebenen Artikel-Daten sind korrekt (stammen schon von Order 2026-633-A), deshalb hier NUR
 * das Angebotsnummer-Feld korrigieren -- kein erneuter Artikel-Schreibvorgang nötig.
 */
function korrigiereIreneRadmacher7356() {
  if (DRY_RUN) {
    Logger.log('DRY_RUN aktiv -- würde Angebotsnummer bei Deal 7356 auf "2026-633-A" korrigieren.');
    return;
  }
  const result = pipedriveFetch('/deals/7356', {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify({ custom_fields: { [FIELD_KEYS.sevdesk_angebotsnummer]: '2026-633-A' } })
  });
  if (!result.success) {
    Logger.log(`✗ Deal 7356: Korrektur fehlgeschlagen -- ${JSON.stringify(result).substring(0, 200)}`);
    return;
  }
  Logger.log('✓ Deal 7356: Angebotsnummer auf "2026-633-A" korrigiert.');
}

/**
 * Korrektur nach händischer PDF-Prüfung (21.08.2026): bei 3 der 9 Deals mit mehreren sevdesk-
 * Order-Revisionen hat "neueste zuerst" (syncPerNameVormatching) die FALSCHE Order gewählt --
 * Valentin hat die richtige anhand der an Pipedrive angehängten Angebots-PDFs identifiziert (siehe
 * project_sevdesk_pipedrive_sync). Sucht die Order über die Angebotsnummer im nachNummer-Index aus
 * auditLadeAlleAuftraege() (Zuordnungspruefung.gs, schon für pruefeZuordnungAlle() gebaut/geprüft --
 * kein neuer, unverifizierter sevdesk-Filter-Parameter). Schreibt dann wie gehabt über
 * syncDirektAufBekannterDeal(): das überschreibt Angebotsnummer + ALLE Artikel-Felder vollständig
 * (writeArticleFieldsToDeal setzt jedes Feld inkl. null neu, FIX V4) -- korrigiert also automatisch,
 * was der falsche Erstlauf reingeschrieben hatte.
 */
function korrigiereFalscheOrderRevisionen() {
  const korrekturen = [
    { dealId: 6207, orderNumber: '2026-295-A', hinweis: 'Martin Gangl, 54 Module -- statt automatisch gewähltem 2026-357-A' },
    { dealId: 5972, orderNumber: '2026-87-A',  hinweis: 'Hamzic Edin -- statt automatisch gewähltem 2026-480-A' },
    { dealId: 6037, orderNumber: '2026-230-A', hinweis: 'Harald Lamprecht -- statt automatisch gewähltem 2026-429-A' }
  ];

  const idx = auditLadeAlleAuftraege();

  korrekturen.forEach(k => {
    const treffer = idx.nachNummer[k.orderNumber] || [];
    if (treffer.length !== 1) {
      Logger.log(`✗ Deal ${k.dealId}: Order "${k.orderNumber}" nicht eindeutig gefunden (${treffer.length} Treffer) -- abgebrochen, nichts geschrieben`);
      return;
    }
    Logger.log(`→ Deal ${k.dealId} (${k.hinweis}): korrigiere auf Order ${treffer[0].id} (${k.orderNumber})`);
    syncDirektAufBekannterDeal(k.dealId, treffer[0].id);
  });
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
  // Zweite Runde (21.08.): 27 Deals aus dem Projektdoku-Generator-Batch, die noch nie durch den
  // sevdesk-Sync gelaufen sind (nicht Teil der ursprünglichen 30er-Liste vom 20.08.) -- bei 9 davon
  // (Neureiter, Hemetinger, Hubmann, Raza, Kremser, Lamprecht, Moser, Maier, Kabelik) liegt laut
  // Drive-Check schon ein altes, manuell erstelltes Doc mit echten Modul-Daten im Kundenordner --
  // starkes Indiz, dass auch bei den restlichen 18 ein sevdesk-Auftrag existiert.
  //
  // Bewusst NICHT dabei (Valentins Entscheidung 2026-08-21):
  // - 6591/7107 (Mario Messiha) -- braucht die richtige Angebotsnummer manuell.
  // - 6922 (Hidir Özdek) -- 3 aktive Verträge gleichzeitig, unklar welcher zu diesem Deal gehört.
  // - 6406 (Karl Heindl), 6908 (Hans Greml) -- on Hold, Marco klärt noch.
  // - 7065 (Metehan Hilal Arac) -- schon versucht, 0 Aufträge in sevdesk, kein Match möglich.
  const dealIds = [
    6207, 7071, 7072, 7186, 7282, 7334, 4945, 5142, 5237, 5373, 5530,
    5749, 5758, 5829, 5972, 6006, 6013, 6027, 6037, 6198, 6326, 6454,
    6592, 6593, 6952, 4876, 6439
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
// KONFIGURATIONS-PRÜFUNG (FIX V7, 2026-08-13-Review)
// ============================================================================
// Die beiden Bundesland-Scripts haben eine pruefeKonfiguration(), die hartcodierte Option-IDs
// gegen die echte Pipedrive-API abgleicht -- hier gab es das nicht, obwohl ENUM_OPTION_IDS genauso
// hartcodiert ist. addEnumFieldIfSet() faengt eine fehlende Options-ID zwar ab und loggt eine
// Warnung, setzt das Feld dann aber auf null -- ueberschreibt also einen moeglicherweise
// korrekten Wert mit leer. Einmal vor dem Go-Live ausfuehren, danach bei jeder Pipedrive-
// Feldaenderung.

/** Gleicht FIELD_KEYS (Existenz) und ENUM_OPTION_IDS (Options-IDs + field_type) mit der echten
 *  Pipedrive-API ab. */
function pruefeKonfiguration() {
  const response = pipedriveFetch('/dealFields?limit=500', { method: 'get' });
  if (!response.success) {
    Logger.log(`FEHLER: dealFields nicht abrufbar -- ${JSON.stringify(response).substring(0, 200)}`);
    return;
  }
  const felder = response.data || [];
  if (response.additional_data && response.additional_data.next_cursor) {
    Logger.log('WARNUNG: dealFields ist auf 500 Einträge abgeschnitten -- die Prüfung unten ist unvollständig, Pagination nachrüsten.');
  }
  const byCode = Object.fromEntries(felder.map(f => [f.field_code, f]));
  let fehler = 0;

  Object.entries(FIELD_KEYS).forEach(([name, code]) => {
    if (!byCode[code]) {
      Logger.log(`FEHLER: Feld "${name}" (${code}) existiert nicht (mehr) in dealFields.`);
      fehler++;
    }
  });

  Object.entries(ENUM_OPTION_IDS).forEach(([name, sollMap]) => {
    const feld = byCode[FIELD_KEYS[name]];
    if (!feld) return; // schon oben gemeldet
    if (feld.field_type !== 'enum') {
      Logger.log(`WARNUNG: "${name}" ist field_type "${feld.field_type}", erwartet enum -- addEnumFieldIfSet() schreibt eine einzelne Options-ID.`);
      fehler++;
    }
    // Case-insensitiver Abgleich (2026-08-21, nach echtem Fehlalarm SUNOVA/LUXOR/TRINASOLAR):
    // addEnumFieldIfSet() matched selbst schon case-insensitive (Object.keys(options).find(k =>
    // k.toLowerCase() === textValue.toLowerCase())), und Pipedrive speichert Enums über die
    // numerische ID, nicht über das Label -- eine abweichende Schreibweise ("SUNOVA" im Script vs.
    // "Sunova" in Pipedrive) ist für den echten Schreibvorgang folgenlos. Dieser Check muss also
    // dasselbe Kriterium prüfen wie der Schreibpfad, sonst meldet er Scheinfehler statt echter.
    const liveByLower = {};
    (feld.options || []).forEach(o => { liveByLower[o.label.toLowerCase()] = o; });
    Object.entries(sollMap).forEach(([label, id]) => {
      const treffer = liveByLower[label.toLowerCase()];
      if (!treffer) { Logger.log(`FEHLER [${name}]: Option "${label}" existiert in Pipedrive nicht (auch nicht in anderer Schreibweise).`); fehler++; }
      else if (treffer.id !== id) { Logger.log(`FEHLER [${name}]: "${label}" -- Script sagt ${id}, Pipedrive sagt ${treffer.id} (Label dort: "${treffer.label}").`); fehler++; }
    });
    const bekannteLower = new Set(Object.keys(sollMap).map(l => l.toLowerCase()));
    Object.values(liveByLower).forEach(o => {
      if (!bekannteLower.has(o.label.toLowerCase())) Logger.log(`Hinweis [${name}]: Pipedrive kennt zusätzlich "${o.label}" (id ${o.id}), im Script nicht hinterlegt.`);
    });
  });

  Logger.log(fehler === 0 ? 'Konfiguration OK.' : `${fehler} Abweichung(en) -- oben korrigieren, BEVOR der 5-Minuten-Trigger scharf gestellt wird.`);
}

// ============================================================================
// POLLING — diese Funktion läuft im Live-Betrieb per Zeittrigger (alle 5 Min)
// ============================================================================

/**
 * Einmalig ausführen, um den 5-Min-Trigger für syncPendingOrders() anzulegen -- es gab dafür
 * bisher keine Setup-Funktion in diesem Projekt. Löscht zuerst eigene bestehende Trigger auf
 * denselben Handler (idempotent, siehe CLAUDE.md-Learning "Trigger-Installation idempotent
 * bauen"), sonst läuft nach einem zweiten Klick alles doppelt.
 * ERST ausführen, wenn pruefeKonfiguration() "Konfiguration OK" meldet.
 * Takt auf 5 Min verkürzt (Valentin, 26.08.) -- behebt NICHT den eigentlichen Blocker (Status-
 * 500-Filter, siehe project_sevdesk_pipedrive_sync), war aber explizit gewünscht.
 */
function SETUP_EINMALIG_createTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncPendingOrders')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('syncPendingOrders')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('5-Minuten-Trigger für syncPendingOrders() angelegt.');
}

/** Diagnose: listet alle dauerhaft geparkten Aufträge mit Kundennummer/Angebotsnummer, damit man
 *  gezielt nachschauen kann, warum die Zuordnung zu Pipedrive gescheitert ist. */
function zeigeGeparkteAuftraege() {
  const state = getSyncState();
  const geparkteIds = Object.keys(state).filter(id => state[id].geparkt);
  if (geparkteIds.length === 0) {
    Logger.log('Keine geparkten Aufträge.');
    return;
  }
  Logger.log(`${geparkteIds.length} geparkte Aufträge:`);
  geparkteIds.forEach(id => {
    try {
      const order = fetchOrderFromSevdesk(id);
      const match = findTargetDeal(order);
      const dauerhaft = istDauerhaftGeparkt(state[id]);
      Logger.log(`Order ${id}: Angebotsnummer="${order.orderNumber}", Kundennummer="${order.customerId}", ` +
                 `Versuche=${state[id].versuche}, geparkt seit ${state[id].geparktSeit} (${dauerhaft ? 'DAUERHAFT' : `noch ${PARK_DAUERHAFT_NACH_TAGEN - tageSeit(state[id].geparktSeit)} Tage täglicher Retry`}), ` +
                 `match=${match.matchedBy || 'KEIN TREFFER'}` +
                 (match.konflikt ? `, KONFLIKT: ${match.konflikt}` : '') +
                 (match.ambiguous ? `, mehrdeutig (Kandidaten: ${match.candidates.join(',')})` : ''));
    } catch (err) {
      Logger.log(`Order ${id}: Fehler beim Abrufen -- ${err.message}`);
    }
  });
}

// Für entparkeAuftraege() -- Editor-Funktionen mit Parametern kann man nicht per ▷-Button starten,
// deshalb Konstante statt Funktionsargument (gleiches Muster wie WEBHOOK_ID_ZUM_LOESCHEN).
const ORDER_IDS_ZUM_ENTPARKEN = ['29922505', '29975012'];

/** Entfernt geparkt:true bei den oben eingetragenen Order-IDs, damit syncPendingOrders() sie beim
 *  nächsten Lauf wieder ganz normal versucht (nicht sofort selbst syncen -- nur die Sperre lösen). */
function entparkeAuftraege() {
  const state = getSyncState();
  let entparkt = 0;
  ORDER_IDS_ZUM_ENTPARKEN.forEach(id => {
    if (state[id] && state[id].geparkt) {
      state[id] = { ts: null, gespeichert: heuteAlsIso(), versuche: 0 };
      entparkt++;
      Logger.log(`Order ${id} entparkt -- wird beim nächsten syncPendingOrders()-Lauf erneut versucht.`);
    } else {
      Logger.log(`Order ${id}: nicht (mehr) geparkt -- nichts zu tun.`);
    }
  });
  saveSyncState(state);
  Logger.log(`${entparkt} Auftrag/Aufträge entparkt.`);
}

function syncPendingOrders() {
  // FIX 27.08.2026 -- ueberlappende Laeufe.
  // Der Trigger steht seit 26.08. auf everyMinutes(5), ein Lauf kann aber laenger dauern: die
  // sevdesk-Pagination laeuft VOR der Stoppuhr (startZeit wird erst unten gesetzt), und der
  // Zeitwaechter prueft nur am Schleifenkopf -- ein bei 3:59 gestarteter Auftrag laeuft komplett
  // durch, inkl. Backoff-Pausen von 2s+4s pro gestoertem HTTP-Call. Bei 15 Min Takt lagen ~11 Min
  // Luft dazwischen, bei 5 Min sind es ~30 Sekunden.
  //
  // Zwei gleichzeitige Laeufe waren echter Schaden, nicht nur unschoen:
  //   - Beide lesen denselben (veralteten) State und berechnen dieselbe zuSyncen-Liste
  //     -> dieselben Deals werden ZWEIMAL gePATCHt. API-Schreibvorgaenge loesen Pipedrive-
  //        Automations genauso aus wie Klicks in der Oberflaeche ("es gibt kein silent update"),
  //        haengt dort eine Mail-Automation, geht sie doppelt raus.
  //   - saveSyncState() schreibt den KOMPLETTEN Block aus der Kopie des jeweiligen Laufs. Wer
  //     zuletzt speichert, gewinnt -- Erfolge und versuche-Zaehler des anderen Laufs sind weg.
  //     Damit kann die Park-Logik (5 Fehlversuche -> parken) nicht verlaesslich zaehlen.
  //
  // tryLock(0): nicht warten, sofort zurueckmelden. Belegt -> Lauf beenden. Das kostet nichts, die
  // Auftraege bleiben in zuSyncen und der naechste Takt ist in 5 Minuten.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    Logger.log('⏭️ Ein anderer Lauf ist noch aktiv -- dieser Lauf wird uebersprungen (naechster Takt in 5 Min).');
    return;
  }
  try {
    syncPendingOrdersUnlocked();
  } finally {
    lock.releaseLock();
  }
}

/** Eigentliche Arbeit. Nur aus syncPendingOrders() aufrufen, damit der Lock immer greift. */
function syncPendingOrdersUnlocked() {
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

  // Nur Aufträge, die neu sind, sich seit dem letzten Sync geändert haben, oder beim letzten
  // Versuch fehlgeschlagen sind (ts dann null, siehe unten) -- ausser sie sind schon geparkt (V2).
  // FIX (26.08.2026): geparkt hiess bisher "fuer immer ignorieren", bis jemand von Hand
  // entparkeAuftraege() ausfuehrt -- dabei loest sich der haeufigste Grund (Kundennummer/
  // Angebotsnummer wurde nachtraeglich in Pipedrive ergaenzt, wie bei Mario Golger) von selbst,
  // ohne dass das Script je davon erfaehrt. Geparkte Auftraege deshalb 1x/Tag automatisch erneut
  // versuchen (kein Mail-Spam-Risiko: "Kein Deal gefunden" loest keine alarmiereBeiKonflikt()-Mail
  // aus, nur der seltenere Angebotsnummer-Konflikt tut das) -- aber nur bis PARK_DAUERHAFT_NACH_TAGEN
  // Tage seit dem ersten Parken vergangen sind, danach endgueltig aufgeben (istDauerhaftGeparkt()).
  const zuSyncen = alleAuftraege.filter(o => {
    const s = state[o.id];
    if (!s) return true;
    if (s.geparkt) return !istDauerhaftGeparkt(s) && s.gespeichert < heuteAlsIso();
    return s.ts !== (o.update || '');
  });

  const geparkt = Object.values(state).filter(s => s.geparkt).length;
  Logger.log(`Polling: ${alleAuftraege.length} angenommene Aufträge, davon ${zuSyncen.length} neu/geändert/erneut zu versuchen` +
             (geparkt > 0 ? `, ${geparkt} dauerhaft geparkt (siehe unten)` : ''));

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
      state[o.id] = { ts: o.update || '', gespeichert: heuteAlsIso(), versuche: 0 };
      verarbeitet++;
      // Alle 5 Aufträge zwischenspeichern, damit bei einem unerwarteten Abbruch
      // nicht die Arbeit des ganzen Laufs verloren geht
      if (verarbeitet % 5 === 0) saveSyncState(state);
    } else if (erfolg && DRY_RUN) {
      verarbeitet++; // nur für die Log-Zeile unten, kein State-Save
    } else {
      // FIX V2: Fehlversuch zaehlen statt zu ignorieren, sonst blockiert ein dauerhaft
      // unzuordenbarer Auftrag fuer immer einen der MAX_ORDERS_PER_RUN-Plaetze.
      const bisherigeVersuche = (state[o.id] && state[o.id].versuche) || 0;
      const versuche = bisherigeVersuche + 1;
      if (versuche >= MAX_VERSUCHE_VOR_PARKEN) {
        // geparktSeit bei einem erneuten Fehlschlag NICHT ueberschreiben -- sonst wuerde jeder
        // taegliche Retry die 14-Tage-Uhr wieder auf null setzen und nie dauerhaft geparkt werden.
        const geparktSeit = (state[o.id] && state[o.id].geparktSeit) || heuteAlsIso();
        state[o.id] = { ts: o.update || '', gespeichert: heuteAlsIso(), versuche, geparkt: true, geparktSeit };
        const dauerhaft = istDauerhaftGeparkt(state[o.id]);
        Logger.log(dauerhaft
          ? `⏹️ Order ${o.id} nach ${versuche} Fehlversuchen über ${PARK_DAUERHAFT_NACH_TAGEN} Tage DAUERHAFT geparkt -- nur noch per entparkeAuftraege() reaktivierbar.`
          : `⏸️ Order ${o.id} nach ${versuche} Fehlversuchen geparkt -- wird 1x täglich automatisch erneut versucht (bis zu ${PARK_DAUERHAFT_NACH_TAGEN} Tage seit ${geparktSeit}).`);
      } else {
        // ts bewusst NICHT auf o.update setzen -- der Auftrag soll beim naechsten Lauf ueber den
        // Filter oben weiterhin als "zu syncen" gelten, bis er entweder klappt oder geparkt wird.
        state[o.id] = { ts: null, gespeichert: heuteAlsIso(), versuche };
      }
    }
  }

  saveSyncState(state);

  const offen = zuSyncen.length - verarbeitet;
  if (offen > 0) {
    Logger.log(`ℹ️ ${offen} Aufträge noch offen (neu/geändert oder Fehler) — nächster Lauf in 5 Min`);
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