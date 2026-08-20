// ============================================================================
// DATEI 1 von 3: KatalogUndMapping.gs
// Artikel-Erkennung für das Deep-Core-Sheet — ordnet sevdesk-Auftragspositionen
// den Artikel-Spalten im Sheet zu: Module, Dachart (Unterkonstruktion),
// Wechselrichter, Speicher, Notstrom (Umschaltboxen), Smartmeter, Zubehör.
//
// Basiert auf der bewährten Kategorie+Wert-Erkennung aus dem sevdesk-Pipedrive-
// Projekt (FieldKeysAndMapping.gs, dort 139/140 Artikel korrekt erkannt), aber
// feiner unterteilt, weil das Deep-Core-Sheet separate Spalten für Dachart,
// Notstrom und Smartmeter hat statt eines gemeinsamen "Zubehör"-Topfs.
//
// Die Artikel-Dropdowns im Sheet sind FEST EINGETRAGENE LISTEN direkt in der
// Datenvalidierungsregel (nicht mit dem Einkauf/Katalog-Tab verknüpft) und auf
// "Eingabe ablehnen" gestellt. Deshalb wird bei jedem Fund versucht, den
// sevdesk-Namen auf einen bekannten Katalog-Namen zu mappen. Gelingt das nicht
// sicher, greift der UNSICHER-Fallback (siehe SCHREIBE_UNSICHER_LABEL in
// SheetWriter.gs) und der Original-Name landet in der Notizen-Spalte.
// ============================================================================

const UNSICHER_LABEL = '⚠️ UNSICHER – manuell prüfen';

// ----------------------------------------------------------------------------
// Bekannte Dropdown-Werte je Kategorie (Stand: Deep-Core-Sheet-Katalog, 2026-08-19).
// Dient dem Best-Effort-Matching: sevdesk-Artikelname → passender Dropdown-Text.
// Bei Erweiterung/Änderung im Sheet HIER nachziehen, sonst driftet das Matching.
// Abgleich gegen das echte Sheet: pruefeDropdownListen() in SheetWriter.gs.
// ----------------------------------------------------------------------------
const KNOWN_DROPDOWN_VALUES = {
  module: [
    'SUNOVA-GLAS-GLAS HOCHLEISTUNGS-SOLARMODUL FULL BLACK 450 WP',
    'SUNOVA-GLAS-GLAS HOCHLEISTUNGS-SOLARMODUL FULL BLACK 460 WP',
    'AIKO-GLAS-GLAS HOCHLEISTUNGS-SOLARMODUL FULL BLACK 475 WP',
    'AIKO-GLAS-GLAS HOCHLEISTUNGS-SOLARMODUL DARK BLACK 475 WP',
    'AIKO-GLAS-GLAS HOCHLEISTUNGS-SOLARMODUL FULL BLACK 490 WP'
  ],
  dachart: [
    'MONTAGESET PV SCHRÄGDACH ZIEGEL', 'MONTAGESET PV SCHRÄGDACH PREFA',
    'MONTAGESET PV FLACHDACH OST/WEST', 'MONTAGESET PV FLACHDACH SÜD',
    'MONTAGESET PV BLECHDACH-TRAPEZ', 'MONTAGESET PV BLECHDACH-FALZ',
    'MONTAGESET PV WELLETERNIT', 'MONTAGESET PV ETERNIT RHOMBUS',
    'MONTAGESET PV GELÄNDER', 'MONTAGESET PV BIEBERSCHWANZ',
    'MONTAGESET PV TOSCANA', 'MONTAGESET PV ZAUN', 'BLECHERSATZZIEGEL'
  ],
  wechselrichter: [
    'SIGENERGY Energy Controller 5kW', 'SIGENERGY Energy Controller 6kW',
    'SIGENERGY Energy Controller 8kW', 'SIGENERGY Energy Controller 10kW',
    'SIGENERGY Energy Controller 12kW', 'SIGENERGY Energy Controller 15kW',
    'SIGENERGY Energy Controller 17kW', 'SIGENERGY Energy Controller 20kW',
    'SIGENERGY Energy Controller 25kW', 'SIGENERGY Energy Controller 30kW',
    'FRONIUS Symo GEN24 3.0 Plus', 'FRONIUS Symo GEN24 4.0 Plus',
    'FRONIUS Symo GEN24 5.0 Plus', 'FRONIUS Symo GEN24 6.0 Plus',
    'FRONIUS Symo GEN24 8.0 Plus', 'FRONIUS Symo GEN24 10.0 Plus',
    'FRONIUS Symo GEN24 12.0 Plus'
  ],
  speicher: [
    'SIGENERGY Batteriemodul 6 kWh', 'SIGENERGY Batteriemodul 9 kWh',
    'BYD Battery-Box Premium HVM 11.0', 'BYD Battery-Box Premium HVM 13.8',
    'BYD Battery-Box Premium HVM 16.6', 'BYD Battery-Box Premium HVM 19.3',
    'BYD Battery-Box Premium HVM 22.1',
    'FRONIUS Reserva 6,3 kWh Speicher', 'FRONIUS Reserva 9,5 kWh Speicher',
    'FRONIUS Reserva 12,6 kWh Speicher', 'FRONIUS Reserva 15,8 kWh Speicher'
  ],
  notstrom: [
    'SIGENERGY Gateway Umschaltbox Dreiphasig', 'SIGENERGY Handumschalter',
    'Fronius Backup Controller'
  ],
  smartmeter: [
    'Sigenergy Power Sensor TPX - CH', 'SIGENERGY Power Sensor DH dreiphasig',
    'Fronius Smart Meter'
  ],
  zubehoer: [
    'SIGENERGY WALLBOX EVAC 11 4G T2SH-WH', 'SIGENERGY WALLBOX EVAC 22 4G T2-WH',
    'SIGENERGY WALLBOX EVAC 7 kW T2-WH', 'SIGENERGY WALLBOX EVDC 12 5S2',
    'SIGENERGY Power Sensor DH dreiphasig & Communication Modul',
    'ATON Heizstab', 'OPTIMIERER', 'SMARTFOX PRO + LEISTUNGSSTELLER',
    'GARANTIEVERLÄNGERUNG'
  ]
};

// ----------------------------------------------------------------------------
// Kategorie-Erkennung: Regex + Kennwert (kW/kWh/WP). Reihenfolge ist wichtig
// (Zubehör-Sonderfälle zuerst, sonst Wort-Überschneidungen wie bei "Batter(y)").
// Object.entries() liefert String-Keys in Einfügereihenfolge — die Reihenfolge
// hier IST die Prüfreihenfolge. Nicht umsortieren.
// ----------------------------------------------------------------------------
const CATEGORY_PATTERNS = {
  // Kombi "Power Sensor ... & Communication Modul" ist im Deep-Core-Katalog ein
  // ZUBEHÖR-Artikel (nicht Smartmeter!) — muss vor der reinen smartmeter-Regel stehen.
  zubehoer_combo: {
    match: /Power Sensor.*Communication Modul|Communication Modul.*Power Sensor/i
  },
  smartmeter: {
    match: /Smart Meter|Power Sensor/i
  },
  notstrom: {
    match: /Handumschalter|Gateway Umschaltbox|Backup Controller|NOTSTROMSCHALTER|EPS.?Box|SYN Back-Up Box/i
  },
  dachart: {
    match: /MONTAGESET|BLECHERSATZZIEGEL|Modulhalterung/i
  },
  zubehoer: {
    match: /WALLBOX|EV.?CHARGER|EVAC|EVDC|Wattpilot|EVC-|Heizstab|Ohmpilot|OPTIMIERER|SparSmart|GARANTIE|Klima|Wärmepumpe|Aquarea|Single-Split|Adapter Box|Smart Wifi Plug|Schuko Stecker|Betteri|Balkonkraftwerk|Leistungssteller|Heizungsumwälzpumpe|EMMA|Dongle|SMARTFOX/i
  },
  sonstige_kosten: {
    match: /Fernwartung|Planung der PV|Anmeldung EVU|EVU Abnahme|Elektroinstallation|Montagearbeiten|Projektbetreuung|Messpauschale|Landesförderung|Transportkosten|Gerätetechnik/i
  },
  wechselrichter: {
    match: /Hybrid Wechselrichter|Energy Controller|Wechselrichter|WR-SUN|WR-HYD|SUN2000|Symo|Primo|Tauro|MOD\s*\d+KTL|X3-ULTRA|X3-HYBRID|KTLX/i,
    // (?!h) verhindert, dass "10 kWh" fälschlich als 10 kW gelesen wird.
    extractValue: (name) => {
      const match = name.match(/(\d+\.?\d*)\s*kW(?!h)/i) || name.match(/(\d+)\s*KTL/i);
      if (match) return parseFloat(match[1]);
      const allDecimals = name.match(/\d+\.\d+/g);
      return allDecimals && allDecimals.length > 0 ? parseFloat(allDecimals[0]) : null;
    }
  },
  speicher: {
    match: /Batter(y|i)|Speicher|LUNA|SAX Power|SigenStor|SPEICHERSYSTEM|Battery-Box|T-BAT|Reserva|APX\s*\d/i,
    extractValue: (name) => {
      let match = name.match(/(\d+\.?\d*)\s*kWh/i);
      if (match) return parseFloat(match[1]);
      match = name.match(/Batteriemodul\s*(\d+\.?\d*)/i);
      if (match) return parseFloat(match[1]);
      const allDecimals = name.match(/\d+\.\d+/g);
      return allDecimals && allDecimals.length > 0 ? parseFloat(allDecimals[0]) : null;
    }
  },
  module: {
    match: /AIKO|GLAS-GLAS|NEOSTAR|SOLARMODUL/i,
    extractValue: (name) => {
      const match = name.match(/(\d+)\s*WP/i);
      return match ? parseFloat(match[1]) : null;
    }
  }
};

// Kategorien mit eigener Artikel-Spalte im Sheet (Reihenfolge = Spalten-Reihenfolge).
const DEEPCORE_CATEGORIES = ['module', 'dachart', 'wechselrichter', 'speicher', 'notstrom', 'smartmeter', 'zubehoer'];

// Kategorien mit zweiter Spalte im Sheet (Dachart 2, Wechselrichter 2, Zubehör 2).
const HAS_SECOND_SLOT = { dachart: true, wechselrichter: true, zubehoer: true };

/**
 * Normalisiert deutsche Kommazahlen (z.B. "8,06 kWh" -> "8.06 kWh"), sonst greift
 * die Regex nur die Nachkommastellen ab.
 */
function normalizeName(rawName) {
  return (rawName || '').replace(/(\d),(\d)/g, '$1.$2');
}

/**
 * Zieht den Kennwert aus einem Dropdown-Kandidaten.
 * Reihenfolge kWh -> kW -> WP ist Absicht: bei einer Regex-Alternative "kW|kWh"
 * greift "kW" zuerst und liest "6 kWh" fälschlich als 6 kW (Bug aus v1).
 * Fallback auf die erste Dezimalzahl deckt Kandidaten ohne Einheit im Namen ab
 * ("FRONIUS Symo GEN24 10.0 Plus", "BYD Battery-Box Premium HVM 13.8") — die
 * wurden in v1 gar nicht erkannt und liefen immer in UNSICHER.
 */
function extractCandidateValue(candidate) {
  const n = normalizeName(candidate);
  let m = n.match(/(\d+\.?\d*)\s*kWh/i);
  if (m) return parseFloat(m[1]);
  m = n.match(/(\d+\.?\d*)\s*kW(?!h)/i);
  if (m) return parseFloat(m[1]);
  m = n.match(/(\d+\.?\d*)\s*WP/i);
  if (m) return parseFloat(m[1]);
  m = n.match(/\d+\.\d+/);
  if (m) return parseFloat(m[0]);
  m = n.match(/\s(\d+)\s*$/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Ordnet eine einzelne sevdesk-Position einer Deep-Core-Spalten-Kategorie zu.
 * @param {{name: string, quantity: number, priceNet: number}} position
 * @returns {{category: string, value: number|null, quantity: number, priceNet: number, rawName: string}}
 */
function classifyPositionForDeepCore(position) {
  const name = normalizeName(position.name);
  const quantity = Number(position.quantity) || 1;
  const priceNet = Number(position.priceNet) || 0;

  for (const [key, config] of Object.entries(CATEGORY_PATTERNS)) {
    if (config.match.test(name)) {
      // zubehoer_combo ist nur eine Vorprüfung — landet real in der Kategorie "zubehoer"
      const category = key === 'zubehoer_combo' ? 'zubehoer' : key;
      const value = config.extractValue ? config.extractValue(name) : null;
      return { category, value, quantity, priceNet, rawName: position.name };
    }
  }

  return { category: 'unknown', value: null, quantity, priceNet, rawName: position.name };
}

/**
 * Sucht den best-passenden Dropdown-Text für eine Kategorie anhand des sevdesk-Namens.
 * 1. Exakte Übereinstimmung (Groß-/Kleinschreibung + Kommazahlen egal)
 * 2. Genau EIN Kandidat mit gleichem Kennwert (kW/kWh/WP)
 * 3. Mehrere Kandidaten mit gleichem Kennwert -> nur wenn GENAU EINE Marke passt
 * 4. Sonst null -> Aufrufer schreibt UNSICHER (Grundsatz: bei Mehrdeutigkeit nicht raten)
 */
function findDropdownMatch(category, rawName, value) {
  const candidates = KNOWN_DROPDOWN_VALUES[category] || [];
  const nameNorm = normalizeName(rawName).toLowerCase();

  const exact = candidates.find(c => normalizeName(c).toLowerCase() === nameNorm);
  if (exact) return exact;

  if (value === null || value === undefined) return null;

  const valueMatches = candidates.filter(c => extractCandidateValue(c) === value);
  if (valueMatches.length === 1) return valueMatches[0];

  // Mehrere Kandidaten mit gleichem Kennwert (z.B. mehrere Marken): nur eindeutig,
  // wenn GENAU EINER davon mit seinem Markenwort im sevdesk-Namen vorkommt.
  // v1 nahm hier per .find() stillschweigend den ersten Treffer.
  if (valueMatches.length > 1) {
    const brandMatches = valueMatches.filter(c => {
      const brandWord = c.split(/[\s-]/)[0].toLowerCase();
      return brandWord.length >= 3 && nameNorm.includes(brandWord);
    });
    if (brandMatches.length === 1) return brandMatches[0];
  }

  return null;
}

/**
 * Baut aus einer klassifizierten Position den finalen Zellwert (Dropdown-Name)
 * plus ein Flag, falls UNSICHER geschrieben werden muss.
 */
function resolveDropdownValue(classified) {
  if (classified.category === 'unknown' || classified.category === 'sonstige_kosten') {
    return { value: null, unsicher: false }; // wird vom Aufrufer separat behandelt
  }
  const match = findDropdownMatch(classified.category, classified.rawName, classified.value);
  if (match) return { value: match, unsicher: false };
  return { value: UNSICHER_LABEL, unsicher: true };
}

/**
 * Gruppiert alle Positionen eines Auftrags nach Deep-Core-Spalten-Kategorie.
 * Gleiche Artikelnamen werden zu einer Menge summiert. Unterschiedliche Artikel
 * derselben Kategorie belegen Slot 1 und (falls vorhanden) Slot 2 — sortiert nach
 * Nettosumme absteigend, damit der wertmäßig wichtigste Artikel in Slot 1 landet.
 * Alles darüber hinaus geht in die Notizen-Spalte, weil das Sheet nur einen
 * Dropdown-Wert pro Zelle erlaubt.
 *
 * @param {Array<{name: string, quantity: number, priceNet: number}>} positions
 * @returns {{cells: Object, sonstigeKosten: number, notizenZusatz: string[], unsicherAnzahl: number}}
 */
function aggregatePositionsForDeepCore(positions) {
  const buckets = {};
  DEEPCORE_CATEGORIES.forEach(c => { buckets[c] = []; });

  let sonstigeKosten = 0;
  const notizenZusatz = [];

  (positions || []).forEach(pos => {
    const c = classifyPositionForDeepCore(pos);
    if (c.category === 'sonstige_kosten') {
      sonstigeKosten += c.priceNet * c.quantity;
      return;
    }
    if (c.category === 'unknown') {
      notizenZusatz.push(`[?] ${c.rawName} (${c.quantity}x)`);
      return;
    }
    buckets[c.category].push(c);
  });

  const cells = {};
  let unsicherAnzahl = 0;

  DEEPCORE_CATEGORIES.forEach(category => {
    const slots = HAS_SECOND_SLOT[category] ? 2 : 1;
    cells[category] = null;
    if (slots === 2) cells[`${category}2`] = null;

    const items = buckets[category];
    if (items.length === 0) return;

    // Nach Artikelname gruppieren, damit derselbe Artikel in mehreren Positionen
    // (kommt bei sevdesk vor) zu einer Menge summiert wird.
    // priceNet wird dabei zur Positions-SUMME (Einzelpreis x Menge).
    const byName = {};
    items.forEach(it => {
      if (!byName[it.rawName]) byName[it.rawName] = { ...it, quantity: 0, priceNet: 0 };
      byName[it.rawName].quantity += it.quantity;
      byName[it.rawName].priceNet += it.priceNet * it.quantity;
    });

    const distinctItems = Object.values(byName).sort((a, b) => b.priceNet - a.priceNet);

    distinctItems.slice(0, slots).forEach((item, idx) => {
      const key = idx === 0 ? category : `${category}${idx + 1}`;
      const cell = buildCell(category, item);
      if (cell.notiz) unsicherAnzahl++;
      cells[key] = cell;
    });

    distinctItems.slice(slots).forEach(r => {
      notizenZusatz.push(`[weiterer ${category}] ${r.rawName} (${r.quantity}x)`);
    });
  });

  return { cells, sonstigeKosten, notizenZusatz, unsicherAnzahl };
}

function buildCell(category, item) {
  const resolved = resolveDropdownValue({ category, rawName: item.rawName, value: item.value });
  if (resolved.unsicher) {
    return {
      name: resolved.value,
      stk: item.quantity,
      summe: item.priceNet,
      notiz: `${category}: "${item.rawName}" (${item.quantity}x) nicht im Dropdown gefunden`
    };
  }
  return { name: resolved.value, stk: item.quantity, summe: item.priceNet, notiz: null };
}
