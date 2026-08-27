// ============================================================================
// EINMALIGES SETUP (27.08.2026): Dach-Felder für "Dach 2" und "Dach 3" duplizieren.
// Hintergrund: manche Deals haben mehrere Dächer (z.B. Haus + Garage), das Doku-Formular
// bildet bisher nur EIN Dach ab. Statt eines Reiters in Pipedrive selbst (gibt's nicht) werden
// die Felder pro zusätzlichem Dach als eigene Custom Fields mit Präfix "2_"/"3_" angelegt.
// Nutzt fetchPipedrive/getApiToken aus Config.js (selbes Projekt, globale Funktionen).
// ============================================================================

// Suchbegriffe für die Basis-Felder (Dach 1), die dupliziert werden sollen. Substring-Match,
// case-insensitiv, gegen field_name -- keine hartcodierten field_code, weil unklar ist, welche
// dieser Felder überhaupt schon existieren (nicht alle stehen in Config.js/CONTENT_FIELDS).
const DACH_DUPLIZIER_KEYWORDS = [
  'Dachform',
  'Eindeckung',
  'Dachneigung',
  'Gebäudehöhe',
  'Unterkonstruktion',
  'Höhe Sparren',
  'Breite Sparren',
  'Kabelweg DC',
  'Kabelweg AC',
  'Störfläch',
  'Blitzschutz'
];

/**
 * Nur LESEND: findet zu jedem Keyword das passende dealField und loggt field_name, field_code,
 * field_type und (bei enum/set) die Optionen. Immer ZUERST laufen lassen, bevor
 * erstelleDach2_3Felder() ausgeführt wird -- zeigt, welche Basis-Felder es überhaupt gibt und ob
 * ein Keyword mehrdeutig oder gar nicht trifft (dann NICHT blind weitermachen, sondern Keyword
 * in DACH_DUPLIZIER_KEYWORDS präzisieren).
 */
function listeDachFelderFuerDuplizierung() {
  const fields = fetchPipedrive('dealFields?limit=500');
  DACH_DUPLIZIER_KEYWORDS.forEach(keyword => {
    const treffer = fields.filter(f => f.field_name.toLowerCase().includes(keyword.toLowerCase()));
    if (treffer.length === 0) {
      Logger.log(`✗ "${keyword}": KEIN Feld gefunden.`);
    } else if (treffer.length > 1) {
      Logger.log(`⚠ "${keyword}": ${treffer.length} Treffer, mehrdeutig -- Keyword präzisieren:`);
      treffer.forEach(f => Logger.log(`    - "${f.field_name}" (${f.field_type}) [${f.field_code}]`));
    } else {
      const f = treffer[0];
      const optionsInfo = f.options ? ` -- Optionen: ${f.options.map(o => o.label).join(', ')}` : '';
      Logger.log(`✓ "${keyword}" --> "${f.field_name}" (${f.field_type}) [${f.field_code}]${optionsInfo}`);
    }
  });
}

// Sicherheitsschalter: true = nur loggen was passieren würde, nichts anlegen.
const DACH_DUPLIZIER_DRY_RUN = true;

/**
 * Legt für jedes eindeutig gefundene Basis-Feld (siehe DACH_DUPLIZIER_KEYWORDS) zwei neue
 * dealFields an: "2_<Originalname>" und "3_<Originalname>", mit demselben field_type. Bei
 * enum/set-Feldern werden die Options-LABELS mitkopiert (neue Felder bekommen automatisch neue,
 * eigene Options-IDs -- unabhängig von denen des Originalfelds).
 * Idempotent: überspringt ein Zielfeld, wenn es (exakt beim Namen) schon existiert, statt
 * Duplikate anzulegen.
 * IMMER zuerst mit DACH_DUPLIZIER_DRY_RUN=true laufen lassen und das Log gegen
 * listeDachFelderFuerDuplizierung() prüfen, bevor auf false umgestellt wird.
 */
function erstelleDach2_3Felder() {
  const fields = fetchPipedrive('dealFields?limit=500');
  const bestehendeNamen = new Set(fields.map(f => f.field_name));

  DACH_DUPLIZIER_KEYWORDS.forEach(keyword => {
    const treffer = fields.filter(f => f.field_name.toLowerCase().includes(keyword.toLowerCase()));
    if (treffer.length !== 1) {
      Logger.log(`⏭ "${keyword}" übersprungen (${treffer.length} Treffer, siehe listeDachFelderFuerDuplizierung()).`);
      return;
    }
    const basis = treffer[0];

    ['2_', '3_'].forEach(prefix => {
      const neuerName = `${prefix}${basis.field_name}`;
      if (bestehendeNamen.has(neuerName)) {
        Logger.log(`⏭ "${neuerName}" existiert schon -- übersprungen.`);
        return;
      }

      const payload = { field_name: neuerName, field_type: basis.field_type };
      if (basis.options) {
        payload.options = basis.options.map(o => ({ label: o.label }));
      }

      if (DACH_DUPLIZIER_DRY_RUN) {
        Logger.log(`[DRY RUN] würde anlegen: "${neuerName}" (${basis.field_type})${basis.options ? ' -- Optionen: ' + basis.options.map(o => o.label).join(', ') : ''}`);
        return;
      }

      const res = pdFetchDealFieldCreate(payload);
      if (res.code === 200 || res.code === 201) {
        Logger.log(`✓ "${neuerName}" angelegt -- field_code: ${res.data.data.field_code}`);
      } else {
        Logger.log(`✗ "${neuerName}" fehlgeschlagen (${res.code}): ${res.raw}`);
      }
    });
  });
}

/** POST /dealFields (v2) -- separater Helper statt patchPipedrive/fetchPipedrive, weil die
 *  bestehenden Config.js-Helper nur GET/PATCH auf einzelne Deals abdecken, kein POST für neue
 *  Felder. Gleiches Auth-Pattern (x-api-token Header) wie der Rest des Projekts. */
function pdFetchDealFieldCreate(payload) {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/dealFields`;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-token': getApiToken() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const text = response.getContentText();
  try {
    return { code: response.getResponseCode(), data: JSON.parse(text), raw: text };
  } catch (e) {
    return { code: response.getResponseCode(), data: null, raw: text };
  }
}
