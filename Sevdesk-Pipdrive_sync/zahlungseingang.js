// ============================================================================
// DATEI 4 von 4: ZahlungseingangSync.gs  —  ENTWURF, NOCH NICHT VERIFIZIERT
// Erkennt automatisch, wenn eine Anzahlungsrechnung (AR) in sevdesk als bezahlt
// markiert wird, und setzt dafür in Pipedrive die Checkbox "Zahlungseingang
// erhalten" + legt eine Aktivität "Zahlungseingang da!" an (Übergabepunkt für
// den nächsten Fulfillment-Schritt).
//
// WARUM AR UND NICHT SR: bewusste fachliche Entscheidung (Anzahlungsrechnung
// ist der auslösende Moment, nicht die Schlussrechnung).
//
// sevdesk hat KEINE Webhooks -- reines Polling, gleiches Muster wie
// syncPendingOrders() in SyncEngine.gs (Duplikat-Schutz per Script Property,
// Zeitwächter, Batch-Limit pro Lauf).
//
// ✅ field_code für Zahlungseingang erhalten inzwischen bekannt (26.08.2026, per
// checkExistingFields()): ddbfed2a1cdc25c2be460b9a825e056cca2d0284 -- steht jetzt in
// FieldKeysAndMapping.gs. Options-ID 207 für "Ja" noch nicht live gegengecheckt
// (pruefeZahlungseingangKonfiguration() macht das automatisch beim nächsten Lauf).
//
// EINE ECHTE UNBEKANNTE BLEIBT, NICHT GERATEN -- vor Scharfschaltung klären:
//   Ob eine sevdesk-AR die Angebotsnummer wirklich im Feld "header" trägt (wie beim
//   Order-Objekt) ist NICHT live verifiziert. testFetchInvoiceOnly() unten dumpt eine
//   echte AR zum Gegenchecken, BEVOR live geschrieben wird.
//
// ABLAUF BIS GO-LIVE:
//   1. pruefeZahlungseingangKonfiguration() -- muss grün sein (prüft auch die
//      Options-ID 207 live gegen Pipedrive)
//   2. testFetchInvoiceOnly() mit einer echten bezahlten AR-Rechnungs-ID (TEST_INVOICE_ID,
//      NICHT TEST_ORDER_ID -- das ist eine andere Funktion in SyncEngine.gs) --
//      prüfen, ob header/headText wirklich die Angebotsnummer enthält
//   3. DRY_RUN=true, syncZahlungseingaenge() manuell, Sync-Log prüfen
//   4. DRY_RUN=false, dann erst in den 5-Min-Trigger aufnehmen
// ============================================================================

const ZAHLUNGSEINGANG_DRY_RUN = true; // false = schreibt wirklich in Pipedrive

const SEVDESK_INVOICE_STATUS_BEZAHLT = 1000;
const SEVDESK_INVOICE_TYP_ANZAHLUNG = 'AR';
const ZAHLUNGSEINGANG_STATE_KEY = 'SYNCED_ANZAHLUNGSRECHNUNGEN'; // Script Property: {invoiceId: true}
const ZAHLUNGSEINGANG_STATE_MAX_EINTRAEGE = 500; // 9-KB-Property-Limit, siehe reference_apps_script_limits
const MAX_INVOICES_PER_RUN = 25;
const ZAHLUNGSEINGANG_MAX_RUNTIME_MS = 4 * 60 * 1000;
const ZAHLUNGSEINGANG_ACTIVITY_SUBJECT = 'Zahlungseingang da!';

// ============================================================================
// SEVDESK: bezahlte Anzahlungsrechnungen abrufen
// ============================================================================

/** Holt alle Invoices mit status=1000 (bezahlt) UND invoiceType=AR, paginiert. */
function fetchBezahlteAnzahlungsrechnungen_() {
  const alle = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const path = `/Invoice?status=${SEVDESK_INVOICE_STATUS_BEZAHLT}`
      + `&invoiceType=${SEVDESK_INVOICE_TYP_ANZAHLUNG}&limit=${limit}&offset=${offset}`;
    const data = sevdeskFetch(path);
    if (!data.objects || data.objects.length === 0) break;
    alle.push.apply(alle, data.objects);
    if (data.objects.length < limit) break;
    offset += limit;
    if (offset > 2000) break; // Sicherheitsnetz gegen Endlosschleife
  }

  return alle;
}

/**
 * Fallback-Extraktion der Angebotsnummer aus dem Header-Text, NUR falls
 * ermittleDealFuerRechnung_() nicht über invoice.origin fündig wird.
 *
 * WICHTIG (live verifiziert 26.08.2026, Rechnung 73888855): Der Header enthält
 * ZWEI Nummern -- "Anzahlungssrechnung Nr. 2024-1001-A aus Angebot 2024-1266-A".
 * 2024-1001-A ist die Rechnung SELBST (== invoice.invoiceNumber), 2024-1266-A
 * ist die gesuchte Angebotsnummer. Ein naiver "erste Zahl im Text"-Match hätte
 * die FALSCHE (eigene) Nummer getroffen. Deshalb gezielt nach "Angebot X"
 * suchen, kein generischer Zahlenmuster-Fallback -- lieber null (→ WARNUNG im
 * Log) als eine geratene, potenziell falsche Nummer.
 */
function extractAngebotsnummerAusHeader_(invoice) {
  const kandidaten = [invoice.header, invoice.headText];
  const pattern = /Angebot\s+(20\d{2}-\d{2,4}-[A-Z])/i;

  for (const text of kandidaten) {
    if (!text) continue;
    const match = String(text).match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Findet den Ziel-Deal für eine Anzahlungsrechnung -- nutzt DIESELBE zweistufige
 * Matching-Logik (Angebotsnummer primär, Kundennummer-Fallback, Gegenprobe) wie
 * der bestehende Order-Sync, statt sie zu duplizieren. Primärweg: aus
 * invoice.origin (direkte sevdesk-Referenz auf den Auftrag) den vollen Auftrag
 * per fetchOrderFromSevdesk() laden (liefert orderNumber UND Kundennummer) und
 * an findTargetDeal() übergeben -- beide Funktionen bereits aus SyncEngine.gs,
 * unverändert wiederverwendet.
 *
 * Fallback (kein origin/Order, oder Order-Abruf schlägt fehl): nur Angebotsnummer
 * aus dem Header-Text (extractAngebotsnummerAusHeader_), kein Kundennummer-
 * Fallback möglich, weil dafür der Auftrag selbst gebraucht wird.
 *
 * @returns {{match: object, angebotsnummer: string, quelle: string}|null}
 */
function ermittleDealFuerRechnung_(invoice) {
  if (invoice.origin && invoice.origin.objectName === 'Order' && invoice.origin.id) {
    try {
      const order = fetchOrderFromSevdesk(invoice.origin.id);
      return { match: findTargetDeal(order), angebotsnummer: order.orderNumber, quelle: 'origin-Order' };
    } catch (e) {
      // fällt durch zum Header-Fallback, kein harter Abbruch wegen eines einzelnen fehlgeschlagenen Order-Abrufs
    }
  }

  const ausHeader = extractAngebotsnummerAusHeader_(invoice);
  if (!ausHeader) return null;

  const treffer = searchDealsByField(FIELD_KEYS.sevdesk_angebotsnummer, ausHeader);
  const match = treffer.length === 1
    ? { dealId: treffer[0], matchedBy: 'Angebotsnummer', ambiguous: false, candidates: treffer }
    : { dealId: null, matchedBy: 'Angebotsnummer', ambiguous: treffer.length > 1, candidates: treffer };
  return { match: match, angebotsnummer: ausHeader, quelle: 'Header-Text' };
}

// ============================================================================
// PIPEDRIVE: Deal-Status prüfen, Feld setzen, Aktivität anlegen
// ============================================================================

/** true, wenn der Deal im Stage "Gewonnen" ist. Nutzt PIPEDRIVE_BASE_URL/pipedriveFetch aus SyncEngine.gs. */
function istDealGewonnen_(dealId) {
  const data = pipedriveFetch(`/deals/${dealId}`, { method: 'get' });
  if (!data.success || !data.data) return false;
  return data.data.status === 'won';
}

/** Setzt die Checkbox "Zahlungseingang erhalten" (Ein-Options-Enum) auf "Ja". */
function schreibeZahlungseingangAufDeal_(dealId) {
  const optionId = (ENUM_OPTION_IDS.Zahlungseingang_erhalten || {}).Erhalten;
  if (!optionId) throw new Error('Keine Options-ID für Zahlungseingang_erhalten.Erhalten -- ENUM_OPTION_IDS prüfen.');

  const customFields = {};
  customFields[FIELD_KEYS.zahlungseingang_erhalten] = optionId;

  const result = pipedriveFetch(`/deals/${dealId}`, {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify({ custom_fields: customFields })
  });

  if (!result.success) {
    throw new Error(`Pipedrive Update fehlgeschlagen: ${JSON.stringify(result).substring(0, 200)}`);
  }
}

/** Legt eine Aktivität "Zahlungseingang da!" am Deal an -- Übergabepunkt für den nächsten Fulfillment-Schritt. */
function legeZahlungseingangAktivitaetAn_(dealId) {
  // owner_id bewusst NICHT gesetzt -- Pipedrive weist die Aktivität dann automatisch
  // dem Owner des API-Tokens zu. Solange der Token auf Valentin läuft, entspricht das
  // der aktuellen Vorgabe ("nur eine Person im Fulfillment"), ohne eine user_id zu
  // hartcodieren, die bei einem Token-Wechsel oder mehr Personal falsch würde.
  // Siehe project_sevdesk_pipedrive_sync-Memory, Abschnitt "Offen -- Aktivitäten-Zuständigkeit".
  const result = pipedriveFetch('/activities', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      subject: ZAHLUNGSEINGANG_ACTIVITY_SUBJECT,
      deal_id: dealId,
      type: 'task',
      done: false
    })
  });

  if (!result.success) {
    throw new Error(`Aktivität anlegen fehlgeschlagen: ${JSON.stringify(result).substring(0, 200)}`);
  }
}

// ============================================================================
// DUPLIKAT-SCHUTZ
// ============================================================================

function getZahlungseingangState_() {
  const raw = PropertiesService.getScriptProperties().getProperty(ZAHLUNGSEINGANG_STATE_KEY);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

/** Deckelt die Property auf ZAHLUNGSEINGANG_STATE_MAX_EINTRAEGE -- gleiche 9-KB-Falle wie beim Order-Sync. */
function saveZahlungseingangState_(state) {
  const ids = Object.keys(state);
  if (ids.length > ZAHLUNGSEINGANG_STATE_MAX_EINTRAEGE) {
    const zuLoeschen = ids.slice(0, ids.length - ZAHLUNGSEINGANG_STATE_MAX_EINTRAEGE);
    zuLoeschen.forEach(function (id) { delete state[id]; });
  }
  PropertiesService.getScriptProperties().setProperty(ZAHLUNGSEINGANG_STATE_KEY, JSON.stringify(state));
}

function resetZahlungseingangState() {
  PropertiesService.getScriptProperties().deleteProperty(ZAHLUNGSEINGANG_STATE_KEY);
  Logger.log('Zahlungseingang-Sync-Status zurückgesetzt.');
}

// ============================================================================
// HAUPT-FUNKTION: eine einzelne Rechnung
// ============================================================================

function syncZahlungseingangFuerRechnung_(invoice) {
  const label = invoice.invoiceNumber || invoice.id;
  const gefunden = ermittleDealFuerRechnung_(invoice);

  if (!gefunden) {
    logSyncResult('WARNUNG', null, `AR ${label}`, 'Keine Angebotsnummer ermittelbar (weder origin-Order noch Header)',
      `origin=${JSON.stringify(invoice.origin || null)} header="${invoice.header || ''}"`);
    return false;
  }

  const match = gefunden.match;
  const angebotsnummer = gefunden.angebotsnummer;
  const quelle = gefunden.quelle;

  if (match.ambiguous) {
    const details = match.konflikt
      ? match.konflikt
      : `Kandidaten: ${match.candidates.join(', ')} -- Angebotsnummer "${angebotsnummer}" im richtigen Deal eintragen`;
    logSyncResult('WARNUNG', null, `AR ${label}`, `Mehrere Deals über ${match.matchedBy} gefunden`, details);
    return false;
  }

  if (!match.dealId) {
    logSyncResult('ERROR', null, `AR ${label}`, 'Kein Pipedrive Deal gefunden', `[${quelle}] Angebotsnummer "${angebotsnummer}"`);
    return false;
  }

  const dealId = match.dealId;

  if (!istDealGewonnen_(dealId)) {
    logSyncResult('SOFT_ERROR', dealId, `AR ${label}`, 'Deal noch nicht Gewonnen',
      `Zahlung kam vor Stage "Gewonnen" -- sehr unwahrscheinlicher Fall, nur geloggt`);
    return false;
  }

  if (ZAHLUNGSEINGANG_DRY_RUN) {
    Logger.log(`[dry] AR ${label} → Deal ${dealId} würde Zahlungseingang setzen + Aktivität anlegen`);
    logSyncResult('DRY', dealId, `AR ${label}`, '-', `[${quelle}/${match.matchedBy}] Angebotsnummer "${angebotsnummer}" -- würde geschrieben`);
    return true;
  }

  try {
    schreibeZahlungseingangAufDeal_(dealId);
    legeZahlungseingangAktivitaetAn_(dealId);
  } catch (e) {
    logSyncResult('ERROR', dealId, `AR ${label}`, e.message, `[${quelle}/${match.matchedBy}] Angebotsnummer "${angebotsnummer}"`);
    Logger.log(`✗ AR ${label} → Deal ${dealId}: ${e.message}`);
    return false;
  }

  logSyncResult('SUCCESS', dealId, `AR ${label}`, '-', `[${quelle}/${match.matchedBy}] Angebotsnummer "${angebotsnummer}" -- Zahlungseingang gesetzt + Aktivität angelegt`);
  Logger.log(`✓ AR ${label} → Deal ${dealId}: Zahlungseingang gesetzt`);
  return true;
}

// ============================================================================
// POLLING — für den 5-Min-Trigger (nach Go-Live neben syncPendingOrders eintragen)
// ============================================================================

function syncZahlungseingaenge() {
  const state = getZahlungseingangState_();
  const alle = fetchBezahlteAnzahlungsrechnungen_();
  const zuSyncen = alle.filter(function (r) { return !state[r.id]; });

  Logger.log(`Zahlungseingang-Polling: ${alle.length} bezahlte AR, davon ${zuSyncen.length} neu`);
  if (zuSyncen.length === 0) return;

  const batch = zuSyncen.slice(0, MAX_INVOICES_PER_RUN);
  const startZeit = Date.now();
  let verarbeitet = 0;

  for (let i = 0; i < batch.length; i++) {
    if (Date.now() - startZeit > ZAHLUNGSEINGANG_MAX_RUNTIME_MS) {
      Logger.log(`⏱️ Zeitlimit-Schutz nach ${verarbeitet} Rechnungen -- Rest folgt im nächsten Lauf`);
      break;
    }
    const r = batch[i];
    const erfolg = syncZahlungseingangFuerRechnung_(r);
    // Nur bei echtem Erfolg (nicht bei WARNUNG/SOFT_ERROR) als erledigt merken,
    // damit korrigierbare Fälle (fehlende Angebotsnummer, noch nicht Gewonnen)
    // beim nächsten Lauf automatisch erneut versucht werden.
    if (erfolg && !ZAHLUNGSEINGANG_DRY_RUN) {
      state[r.id] = true;
      verarbeitet++;
      // Alle 5 Rechnungen zwischenspeichern (gleiches Muster wie syncPendingOrders), damit ein
      // Fehler bei einer späteren Rechnung im selben Batch nicht den State der bereits erfolgreich
      // verarbeiteten verwirft -- sonst würde der nächste Lauf für diese die Aktivität erneut
      // anlegen (POST /activities ist nicht idempotent).
      if (verarbeitet % 5 === 0) saveZahlungseingangState_(state);
    }
  }

  saveZahlungseingangState_(state);
}

// ============================================================================
// KONFIGURATIONS-CHECK — vor jedem Live-Lauf einmal ausführen
// ============================================================================

function pruefeZahlungseingangKonfiguration() {
  const probleme = [];

  if (!FIELD_KEYS.zahlungseingang_erhalten || FIELD_KEYS.zahlungseingang_erhalten.indexOf('PLACEHOLDER') === 0) {
    probleme.push('FIELD_KEYS.zahlungseingang_erhalten ist noch PLACEHOLDER -- mit checkExistingFields() (FieldSetup.gs) ermitteln.');
  } else {
    const felder = pipedriveFetch('/dealFields', { method: 'get' });
    // pipedriveFetch() (SyncEngine.gs) liefert die geparste Antwort direkt, NICHT in
    // {code,data,raw} verpackt wie pdFetch() (FieldSetup.gs) -- felder.data ist bereits
    // das Array, kein felder.data.data.
    const feld = (felder.data || []).find(function (f) { return f.field_code === FIELD_KEYS.zahlungseingang_erhalten; });
    if (!feld) {
      probleme.push(`field_code "${FIELD_KEYS.zahlungseingang_erhalten}" existiert nicht (mehr) in Pipedrive.`);
    } else {
      const erwartetesLabel = Object.keys(ENUM_OPTION_IDS.Zahlungseingang_erhalten || {})[0] || 'Erhalten';
      // Case-insensitiver Abgleich (gleiches Muster wie pruefeKonfiguration() in SyncEngine.gs, nach
      // echtem Fehlalarm SUNOVA/LUXOR/TRINASOLAR): geschrieben/gelesen wird über die numerische
      // Options-ID, eine abweichende Schreibweise ist für den echten Schreibpfad folgenlos.
      const treffer = (feld.options || []).find(function (o) { return o.label.toLowerCase() === erwartetesLabel.toLowerCase(); });
      const erwarteteId = (ENUM_OPTION_IDS.Zahlungseingang_erhalten || {})[erwartetesLabel];
      if (!treffer) {
        const echteOptionen = (feld.options || []).map(function (o) { return `'${o.label}': ${o.id}`; }).join(', ');
        probleme.push(`Feld hat keine Option "${erwartetesLabel}" -- echte Optionen: [${echteOptionen || 'keine'}]. ENUM_OPTION_IDS.Zahlungseingang_erhalten mit dem echten Label korrigieren.`);
      } else if (treffer.id !== erwarteteId) {
        probleme.push(`Options-ID für "${erwartetesLabel}" ist live ${treffer.id}, hartcodiert aber ${erwarteteId} -- ENUM_OPTION_IDS.Zahlungseingang_erhalten korrigieren.`);
      }
    }
  }

  if (probleme.length === 0) {
    Logger.log('✓ pruefeZahlungseingangKonfiguration: alles passt.');
  } else {
    Logger.log('✗ pruefeZahlungseingangKonfiguration: ' + probleme.length + ' Problem(e):');
    probleme.forEach(function (p) { Logger.log('  - ' + p); });
  }
  return probleme;
}

// ============================================================================
// TEST- UND DEBUG-FUNKTIONEN (nie per Trigger, immer nur manuell)
// ============================================================================

/** Liest eine echte AR-Rechnung und zeigt ALLE Felder -- zum Klären, ob header/headText die Angebotsnummer trägt. */
function testFetchInvoiceOnly() {
  const TEST_INVOICE_ID = ''; // ← Invoice-ID einer bezahlten AR eintragen

  if (!TEST_INVOICE_ID) { Logger.log('✗ Bitte TEST_INVOICE_ID eintragen (ID einer bezahlten Anzahlungsrechnung).'); return; }

  const data = sevdeskFetch(`/Invoice/${TEST_INVOICE_ID}`);
  if (!data.objects || data.objects.length === 0) { Logger.log('✗ Rechnung nicht gefunden.'); return; }

  const invoice = data.objects[0];
  Logger.log('=== Komplettes Invoice-Objekt ===');
  Logger.log(JSON.stringify(invoice, null, 2));
  Logger.log('\n=== Deal-Ermittlung ===');
  Logger.log('origin: ' + JSON.stringify(invoice.origin));
  Logger.log('header: ' + JSON.stringify(invoice.header));
  Logger.log('Ergebnis: ' + JSON.stringify(ermittleDealFuerRechnung_(invoice)));
}

/**
 * Trockenlauf über einen Ausschnitt des Bestands, ohne zu schreiben (ZAHLUNGSEINGANG_DRY_RUN
 * wird dabei ignoriert -- immer read-only). Macht pro Rechnung mehrere API-Calls
 * (voller Order-Abruf + Deal-Suche) -- bei 219 Rechnungen würde ein kompletter
 * Durchlauf ans 6-Min-Limit stoßen, deshalb per Default auf die ersten 30 gedeckelt.
 */
function testMappingAllerBezahltenAR() {
  const LIMIT = 30;
  const alle = fetchBezahlteAnzahlungsrechnungen_().slice(0, LIMIT);
  Logger.log(`Prüfe die ersten ${alle.length} bezahlten Anzahlungsrechnungen (von insgesamt mehr, LIMIT=${LIMIT}).`);
  alle.forEach(function (r) {
    const gefunden = ermittleDealFuerRechnung_(r);
    if (!gefunden) {
      Logger.log(`  ${r.invoiceNumber || r.id}: ⚠️ NICHT GEFUNDEN`);
      return;
    }
    const m = gefunden.match;
    const status = m.ambiguous ? `MEHRDEUTIG (${m.matchedBy})` : (m.dealId ? `Deal ${m.dealId}` : 'KEIN TREFFER');
    Logger.log(`  ${r.invoiceNumber || r.id}: ${gefunden.angebotsnummer} [${gefunden.quelle}] -> ${status}`);
  });
}
