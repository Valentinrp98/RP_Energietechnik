// ============================================================================
// DATEI 1 von 3: KatalogUndMapping.gs
// Artikel-Erkennung für das Deep-Core-Sheet — ordnet sevdesk-Auftragspositionen
// den 6 Artikel-Spalten-Kategorien im Sheet zu: Module, Dachart (Unterkonstruktion),
// Wechselrichter, Speicher, Notstrom (Umschaltboxen), Smartmeter, Zubehör.
//
// Basiert auf der bewährten Kategorie+Wert-Erkennung aus dem sevdesk-Pipedrive-
// Projekt (FieldKeysAndMapping.gs, dort 139/140 Artikel korrekt erkannt), aber
// feiner unterteilt, weil das Deep-Core-Sheet separate Spalten für Dachart,
// Notstrom und Smartmeter hat statt eines gemeinsamen "Zubehör"-Topfs.
//
// WICHTIG: Die Artikel-Dropdowns im Sheet sind FEST EINGETRAGENE LISTEN direkt in
// der Datenvalidierungsregel (nicht mit dem Einkauf/Katalog-Tab verknüpft!) und auf
// "Eingabe ablehnen" gestellt (strikt). Ein Wert, der nicht 1:1 in der jeweiligen
// Dropdown-Liste steht, kann NICHT geschrieben werden. Deshalb: bei jedem Fund wird
// versucht, den sevdesk-Namen auf einen der bekannten Katalog-Namen (siehe unten,
// Stand aus dem Deep-Core-Material-Katalog-Tab) zu mappen. Gelingt das nicht sicher,
// wird "⚠️ UNSICHER – manuell prüfen" geschrieben (MUSS vorher manuell in jede
// betroffene Dropdown-Liste eingetragen werden!) und der Original-Name landet in der
// Notizen-Spalte der Zeile.
// ============================================================================

const UNSICHER_LABEL = '⚠️ UNSICHER – manuell prüfen';

// ----------------------------------------------------------------------------
// Bekannte Dropdown-Werte je Kategorie (Stand: Deep-Core-Sheet-Katalog, 2026-08-19).
// Dient dem Best-Effort-Matching: sevdesk-Artikelname → passender Dropdown-Text.
// Bei Erweiterung/Änderung im Sheet HIER nachziehen, sonst driftet das Matching.
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
// Kategorie-Erkennung: Regex + Marke + Kennwert (kW/kWh/WP), Reihenfolge wichtig
// (Zubehör-Sonderfälle zuerst, sonst Wort-Überschneidungen wie bei "Batter(y)").
// ----------------------------------------------------------------------------
const CATEGORY_PATTERNS = {
  // Kombi "Power Sensor ... & Communication Modul" ist im Deep-Core-Katalog ein
  // ZUBEHÖR-Artikel (nicht Smartmeter!) — muss vor der reinen smartmeter-Regel geprüft werden.
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
    marken: [
      { pattern: /SIGENERGY/i, marke: 'Sigenergy' },
      { pattern: /FRONIUS/i, marke: 'Fronius' },
      { pattern: /HUAWEI/i, marke: 'Huawei' },
      { pattern: /GROWATT/i, marke: 'Growatt' },
      { pattern: /SOLAX/i, marke: 'SolaX' },
      { pattern: /SOFARSOLAR|SOFAR/i, marke: 'SofarSolar' }
    ],
    extractValue: (name) => {
      const match = name.match(/(\d+\.?\d*)\s*kW/i) || name.match(/(\d+)\s*KTL/i);
      if (match) return parseFloat(match[1]);
      const allDecimals = name.match(/\d+\.\d+/g);
      return allDecimals && allDecimals.length > 0 ? parseFloat(allDecimals[0]) : null;
    }
  },
  speicher: {
    match: /Batter(y|i)|Speicher|LUNA|SAX Power|SigenStor|SPEICHERSYSTEM|Battery-Box|T-BAT|Reserva|APX\s*\d/i,
    marken: [
      { pattern: /SIGENERGY/i, marke: 'Sigenergy' },
      { pattern: /SAX/i, marke: 'SAX' },
      { pattern: /HUAWEI|LUNA/i, marke: 'Huawei' },
      { pattern: /FRONIUS/i, marke: 'Fronius' },
      { pattern: /GROWATT/i, marke: 'Growatt' },
      { pattern: /SOLAX/i, marke: 'SolaX' },
      { pattern: /SOFARSOLAR|SOFAR/i, marke: 'SofarSolar' },
      { pattern: /BYD/i, marke: 'BYD' }
    ],
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
    marken: [
      { pattern: /AIKO/i, marke: 'AIKO' },
      { pattern: /SUNOVA/i, marke: 'SUNOVA' }
    ],
    extractValue: (name) => {
      const match = name.match(/(\d+)\s*WP/i);
      return match ? parseFloat(match[1]) : null;
    }
  }
};

/**
 * Normalisiert deutsche Kommazahlen (z.B. "8,06 kWh" → "8.06 kWh"), sonst greift
 * die Regex nur die Nachkommastellen ab.
 */
function normalizeName(rawName) {
  return (rawName || '').replace(/(\d),(\d)/g, '$1.$2');
}

/**
 * Ordnet eine einzelne sevdesk-Position einer Deep-Core-Spalten-Kategorie zu.
 * @param {{name: string, quantity: number, priceNet: number}} position
 * @returns {{category: string, value: number|null, quantity: number, priceNet: number, rawName: string}}
 */
function classifyPositionForDeepCore(position) {
  const name = normalizeName(position.name);
  const quantity = position.quantity || 1;
  const priceNet = position.priceNet || 0;

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
 * 1. Exakte Übereinstimmung (Groß-/Kleinschreibung egal)
 * 2. Gleicher Kennwert (kW/kWh/WP) UND gleiche Marke im Namen enthalten
 * 3. Kein sicherer Treffer → null (Aufrufer schreibt dann UNSICHER)
 */
function findDropdownMatch(category, rawName, value) {
  const candidates = KNOWN_DROPDOWN_VALUES[category] || [];
  const nameLower = rawName.toLowerCase();

  const exact = candidates.find(c => c.toLowerCase() === nameLower);
  if (exact) return exact;

  if (value !== null && value !== undefined) {
    const valueMatches = candidates.filter(c => {
      const cNum = normalizeName(c).match(/(\d+\.?\d*)\s*(kW|kWh|WP)/i);
      return cNum && parseFloat(cNum[1]) === value;
    });
    if (valueMatches.length === 1) return valueMatches[0];
    // Mehrere Kandidaten mit gleichem Kennwert (z.B. mehrere Marken) → nur eindeutig wenn
    // zusätzlich ein Markenwort aus dem Kandidaten im sevdesk-Namen vorkommt.
    if (valueMatches.length > 1) {
      const brandMatch = valueMatches.find(c => {
        const brandWord = c.split(/[\s-]/)[0];
        return nameLower.includes(brandWord.toLowerCase());
      });
      if (brandMatch) return brandMatch;
    }
  }

  return null;
}

/**
 * Baut aus einer klassifizierten Position den finalen Zellwert (Name für Dropdown)
 * plus eine Notiz, falls UNSICHER geschrieben werden musste.
 */
function resolveDropdownValue(classified) {
  if (classified.category === 'unknown' || classified.category === 'sonstige_kosten') {
    return { value: null, unsicher: false }; // wird vom Aufrufer separat behandelt
  }
  const match = findDropdownMatch(classified.category, classified.rawName, classified.value);
  if (match) {
    return { value: match, unsicher: false };
  }
  return { value: UNSICHER_LABEL, unsicher: true };
}

/**
 * Gruppiert alle Positionen eines Auftrags nach Deep-Core-Spalten-Kategorie.
 * Jede Kategorie kann mehrere unterschiedliche Artikel enthalten (z.B. 2 verschiedene
 * Wallboxen) — die werden zu EINER Zeile aggregiert: Stk. = Summe aller Mengen,
 * Summe = Summe aller Positions-Nettobeträge, Name = häufigster/erster Fund (bei
 * Uneinigkeit UNSICHER, weil das Sheet nur EINEN Dropdown-Wert pro Zelle erlaubt und
 * eine "Zweit"-Spalte (Dachart 2, Wechselrichter 2, Zubehör 2) nur für zwei
 * UNTERSCHIEDLICHE Artikel gedacht ist, nicht für Mengen-Summierung).
 *
 * @param {Array<{name: string, quantity: number, priceNet: number}>} positions
 * @returns {{cells: Object, sonstigeKosten: number, notizenZusatz: string[]}}
 */
function aggregatePositionsForDeepCore(positions) {
  const buckets = {
    module: [], dachart: [], wechselrichter: [], speicher: [],
    notstrom: [], smartmeter: [], zubehoer: []
  };
  let sonstigeKosten = 0;
  const notizenZusatz = [];

  positions.forEach(pos => {
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

  // Jede Kategorie kann bis zu 2 Slots im Sheet belegen (z.B. Dachart / Dachart 2).
  // Modul und Speicher haben im Sheet keinen "2"-Slot -> zusätzliche Artikel dort
  // landen als Zusatz-Notiz statt in einer nicht existierenden Spalte.
  const HAS_SECOND_SLOT = { dachart: true, wechselrichter: true, zubehoer: true };

  const cells = {};
  for (const [category, items] of Object.entries(buckets)) {
    if (items.length === 0) {
      cells[category] = null;
      if (HAS_SECOND_SLOT[category]) cells[`${category}2`] = null;
      continue;
    }

    // Nach Artikelname gruppieren, damit gleiche Artikel in mehreren Positionen
    // (kommt bei sevdesk vor) korrekt zu einer Menge summiert werden.
    const byName = {};
    items.forEach(it => {
      const key = it.rawName;
      if (!byName[key]) byName[key] = { ...it, quantity: 0, priceNet: 0 };
      byName[key].quantity += it.quantity;
      byName[key].priceNet += it.priceNet * it.quantity;
    });
    const distinctItems = Object.values(byName);

    cells[category] = buildCell(category, distinctItems[0]);
    if (HAS_SECOND_SLOT[category] && distinctItems[1]) {
      cells[`${category}2`] = buildCell(category, distinctItems[1]);
    }
    // Mehr als 2 unterschiedliche Artikel in einer Kategorie -> Rest in Notizen
    if (distinctItems.length > (HAS_SECOND_SLOT[category] ? 2 : 1)) {
      const rest = distinctItems.slice(HAS_SECOND_SLOT[category] ? 2 : 1);
      rest.forEach(r => notizenZusatz.push(`[weiterer ${category}] ${r.rawName} (${r.quantity}x)`));
    }
  }

  return { cells, sonstigeKosten, notizenZusatz };
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
