// ============================================================================
// DATEI 1 von 3: FieldSetup.gs  —  PRODUCTION
// Einmalige Setup- und Wartungsfunktionen für Pipedrive Custom Fields.
// Im Live-Betrieb läuft hier NICHTS automatisch. Nur bei Bedarf manuell starten.
// ============================================================================

const PD_BASE = 'https://rp-energietechnik.pipedrive.com/api/v2';

/** Zentrale Helper-Funktion für alle Pipedrive-Calls (einheitliche Auth + robustes Parsing). */
function pdFetch(path, options) {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN fehlt in den Script Properties!');

  const opts = Object.assign({ muteHttpExceptions: true }, options || {});
  opts.headers = Object.assign({ 'x-api-token': token }, opts.headers || {});

  const response = UrlFetchApp.fetch(`${PD_BASE}${path}`, opts);
  const text = response.getContentText();

  try {
    return { code: response.getResponseCode(), data: JSON.parse(text), raw: text };
  } catch (e) {
    throw new Error(`Pipedrive lieferte kein JSON (HTTP ${response.getResponseCode()}): ${text.substring(0, 200)}`);
  }
}

// ============================================================================
// SETUP: Neues Matching-Feld für die Angebotsnummer anlegen
// → Diese Funktion EINMAL ausführen, dann den field_code in Datei 2 eintragen.
// ============================================================================

function createAngebotsnummerField() {
  const feld = { field_name: 'sevdesk_angebotsnummer', field_type: 'varchar_auto' };

  const res = pdFetch('/dealFields', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(feld)
  });

  if (res.code === 200 || res.code === 201) {
    Logger.log(`✓ sevdesk_angebotsnummer angelegt → field_code: ${res.data.data.field_code}`);
    Logger.log('\n👉 Diesen field_code in Datei 2 unter FIELD_KEYS.sevdesk_angebotsnummer eintragen.');
  } else {
    Logger.log(`✗ Fehlgeschlagen (${res.code}): ${res.raw}`);
  }
}

// ============================================================================
// WARTUNG: Bestehende Felder und ihre Options-IDs anzeigen
// ============================================================================

/** Listet alle Deal-Felder mit Name, Typ und field_code. */
function checkExistingFields() {
  const res = pdFetch('/dealFields', { method: 'get' });
  if (!res.data.success) {
    Logger.log('✗ Fehler beim Abrufen: ' + res.raw);
    return;
  }
  Logger.log(`Gefundene Deal-Felder (${res.data.data.length} gesamt):`);
  res.data.data.forEach(f => Logger.log(`  - ${f.field_name} (${f.field_type}) [${f.field_code}]`));
}

/**
 * Zeigt alle Optionen eines Dropdown-Felds mit IDs.
 * Nutzen, wenn du in Pipedrive manuell eine neue Marke ergänzt hast und
 * die ID für ENUM_OPTION_IDS (Datei 2) brauchst.
 */
function showFieldOptions() {
  const FELDNAME = 'Module_Marke'; // ← anpassen: Module_Marke | System_Marke | Notstrom_Typ | Wallbox_Typ | Heizstab

  const res = pdFetch('/dealFields', { method: 'get' });
  const field = res.data.data.find(f => f.field_name === FELDNAME);
  if (!field) {
    Logger.log(`✗ Feld ${FELDNAME} nicht gefunden!`);
    return;
  }
  Logger.log(`${FELDNAME} Optionen:`);
  (field.options || []).forEach(o => Logger.log(`  '${o.label}': ${o.id},`));
}

// ============================================================================
// ARCHIV: Wurde bereits ausgeführt — nur zur Doku, NICHT erneut starten.
// (Würde doppelte Felder anlegen bzw. befüllte Felder löschen.)
// ============================================================================

/**
 * ⚠️ BEREITS AUSGEFÜHRT am 06.08.2026 — nicht erneut starten!
 * Legte die 14 ursprünglichen Artikel-Felder an.
 */
function ARCHIV_createArticleFields() {
  throw new Error('Diese Funktion wurde bereits ausgeführt. Erneutes Starten würde doppelte Felder anlegen.');
}

/**
 * ⚠️ BEREITS AUSGEFÜHRT am 06.08.2026 — nicht erneut starten!
 * Ersetzte 7 Detail-Felder durch System_Marke / Notstrom_Typ / Wallbox_Typ.
 */
function ARCHIV_migrateToSimplifiedFields() {
  throw new Error('Diese Funktion wurde bereits ausgeführt. Erneutes Starten würde befüllte Felder löschen.');
}