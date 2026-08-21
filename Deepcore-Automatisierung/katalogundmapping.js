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
  // Reale Dropdown-Werte sind NUR das Dachart-Stichwort, ohne "MONTAGESET PV..."-
  // Präfix (per pruefeDropdownListen() am 2026-08-21 gegen das echte Sheet verifiziert
  // — die ursprüngliche Annahme mit dem vollen Katalog-Namen war falsch).
  dachart: [
    'ZIEGEL', 'PREFA', 'FLACHDACH OST/WEST', 'FLACHDACH SÜD',
    'BLECHDACH-TRAPEZ', 'BLECHDACH-FALZ', 'WELLETERNIT', 'ETERNIT RHOMBUS',
    'GELÄNDER', 'BIEBERSCHWANZ', 'TOSCANA', 'PV-ZAUN', 'BLECHERSATZZIEGEL'
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
    'FRONIUS Symo GEN24 12.0 Plus',
    // Kombi-Angebote WR+Speicher als EIN Dropdown-Eintrag — real im Sheet vorhanden
    // (pruefeDropdownListen() 2026-08-21), ursprünglich fälschlich für "keinen echten
    // sevdesk-Artikel" gehalten. Werden über mergeSetHybridCombo() unten zusammengeführt,
    // wenn ein einzelner Sigenergy-WR + eine einzelne Sigenergy-Batterie im selben
    // Auftrag vorkommen.
    'Sigen Hybrid Wechselrichter 12.0 kW TP2 dreiphasig',
    'Sigenergy Set Hybrid TP2 5 kW / 6 kWh', 'Sigenergy Set Hybrid TP2 5 kW / 9 kWh',
    'Sigenergy Set Hybrid TP2 6 kW / 9 kWh', 'Sigenergy Set Hybrid TP2 8 kW / 9 kWh',
    'Sigenergy Set Hybrid TP2 8 kW / 18 kWh', 'Sigenergy Set Hybrid TP2 10 kW / 9 kWh',
    'Sigenergy Set Hybrid TP2 10 kW / 18 kWh', 'Sigenergy Set Hybrid TP2 12 kW / 9 kWh',
    'Sigenergy Set Hybrid TP2 12 kW / 18 kWh'
  ],
  speicher: [
    'SIGENERGY Batteriemodul 6 kWh', 'SIGENERGY Batteriemodul 9 kWh',
    'BYD Battery-Box Premium HVM 8.3',
    'BYD Battery-Box Premium HVM 11.0', 'BYD Battery-Box Premium HVM 13.8',
    'BYD Battery-Box Premium HVM 16.6', 'BYD Battery-Box Premium HVM 19.3',
    'BYD Battery-Box Premium HVM 22.1',
    'FRONIUS Reserva 6,3 kWh Speicher', 'FRONIUS Reserva 9,5 kWh Speicher',
    'FRONIUS Reserva 12,6 kWh Speicher', 'FRONIUS Reserva 15,8 kWh Speicher'
  ],
  // "SIGENERGY Gateway" (kurz!) ist der reale Wert — nicht "...Umschaltbox Dreiphasig".
  notstrom: [
    'SIGENERGY Gateway', 'SIGENERGY Handumschalter', 'Fronius Backup Controller'
  ],
  // Die Kombi "Power Sensor & Communication Modul" ist laut echtem Sheet ein
  // SMARTMETER-Eintrag, nicht Zubehör (ursprüngliche Annahme war falsch, siehe
  // classifyPositionForDeepCore: zubehoer_combo -> Kategorie 'smartmeter').
  // "Sigenergy Power Sensor TPX - CH" per pruefeDropdownListen() (2026-08-21) als
  // Annahme verworfen -- existiert im echten Sheet nicht, nur diese 3 real bestätigt.
  smartmeter: [
    'SIGENERGY Power Sensor DH dreiphasig',
    'FRONIUS SMART METER', 'SIGENERGY Power Sensor DH dreiphasig & Communication Modul'
  ],
  zubehoer: [
    'SIGENERGY WALLBOX EVAC 11 4G T2SH-WH', 'SIGENERGY WALLBOX EVAC 22 4G T2-WH',
    'SIGENERGY WALLBOX EVAC 7 kW T2-WH', 'SIGENERGY WALLBOX EVDC 12 5S2',
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
  // Kombi "Power Sensor ... & Communication Modul" ist laut echtem Sheet-Dropdown
  // (pruefeDropdownListen(), 2026-08-21) ein SMARTMETER-Eintrag. Eigener Regex-Eintrag
  // nur, damit die Reihenfolge in Object.entries() klar bleibt — Kategorie ist smartmeter.
  smartmeter_combo: {
    match: /Power Sensor.*Communication Modul|Communication Modul.*Power Sensor/i
  },
  smartmeter: {
    match: /Smart Meter|Power Sensor/i
  },
  notstrom: {
    match: /Handumschalter|Gateway Umschaltbox|Backup Controller|NOTSTROMSCHALTER|EPS.?Box|SYN Back-Up Box/i
  },
  // Nur echte DACH-Montagesysteme ("MONTAGESET PV ...") — bewusst NICHT das bloße
  // Wort "Montageset", sonst reißen Sigenergy-Boden-/Wandmontagesets für den
  // Speicherschrank (kein Dach-Bezug!) und "MODULHALTERUNG BALKON" (Balkonkraftwerk-
  // Zubehör) fälschlich die Dachart-Spalte an sich.
  dachart: {
    match: /MONTAGESET PV|BLECHERSATZZIEGEL/i
  },
  zubehoer: {
    // "Battery Controller BC" MUSS hier stehen, sonst schnappt sich weiter unten die
    // speicher-Regel (Batter(y|i)) den Artikel "SIGENERGY Battery Controller BC inkl.
    // Bodenmontageset" fälschlich als Speicher-Position — es ist aber nur das
    // Steuergerät/Montagekit fürs Speichersystem, kein Speicher selbst (Bug aus v1,
    // dieselbe Falle stand schon im sevdesk-Pipedrive-Projekt als Kommentar).
    match: /WALLBOX|EV.?CHARGER|EVAC|EVDC|Wattpilot|EVC-|Heizstab|Ohmpilot|OPTIMIERER|SparSmart|GARANTIE|Klima|Wärmepumpe|Aquarea|Single-Split|Adapter Box|Smart Wifi Plug|Schuko Stecker|Betteri|Balkonkraftwerk|Leistungssteller|Heizungsumwälzpumpe|EMMA|Dongle|SMARTFOX|Battery Controller|Bodenmontageset|Wandmontageset|Modulhalterung/i
  },
  sonstige_kosten: {
    // "Projektierung" ergänzt: reale sevdesk-Position heißt "TECHNISCHE PROJEKTIERUNG",
    // nicht "Projektbetreuung" — beim Live-Test (Order 2026-609-A) sonst in "unknown"
    // gelandet, obwohl es klar eine Dienstleistungs-Position ist.
    match: /Fernwartung|Planung der PV|Anmeldung EVU|EVU Abnahme|Elektroinstallation|Montagearbeiten|Projektbetreuung|Projektierung|Messpauschale|Landesförderung|Transportkosten|Gerätetechnik/i
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
      // smartmeter_combo ist nur eine Vorprüfung — landet real in der Kategorie "smartmeter"
      const category = key === 'smartmeter_combo' ? 'smartmeter' : key;
      const value = config.extractValue ? config.extractValue(name) : null;
      return { category, value, quantity, priceNet, rawName: position.name };
    }
  }

  return { category: 'unknown', value: null, quantity, priceNet, rawName: position.name };
}

/**
 * Sucht den best-passenden Dropdown-Text für eine Kategorie anhand des sevdesk-Namens.
 * 1. Exakte Übereinstimmung (Groß-/Kleinschreibung + Kommazahlen egal)
 * 2. Kennwert (kW/kWh/WP) grenzt den Kandidaten-Pool ein, falls vorhanden — bei
 *    Kategorien ohne Kennwert (z.B. Dachart) bleibt der gesamte Pool bestehen.
 * 3. Wort-Überlappung (≥3-Zeichen-Wörter, reine Zahlen ausgenommen) entscheidet
 *    innerhalb des Pools — eindeutig NUR wenn genau ein Kandidat die meisten
 *    Treffer hat UND das mindestens 1 Treffer ist.
 * 4. Sonst null -> Aufrufer schreibt UNSICHER (Grundsatz: bei Mehrdeutigkeit nicht raten)
 *
 * Der Wort-Score ersetzt zwei frühere Einzellösungen (Farbvarianten wie "AIKO ...
 * FULL BLACK" vs. "... DARK BLACK", UND das Dachart-Kurzwort-Problem "ZIEGEL" statt
 * "MONTAGESET PV ... ZIEGEL") mit einem einzigen Mechanismus. Er verhindert außerdem
 * einen realen Fehlgriff vom Live-Test (Order 2026-609-A, 2026-08-21): "SIGENERGY
 * Hybrid Wechselrichter 10.0 kW..." hätte per reinem Kennwert-Abgleich (beide = 10)
 * fälschlich auf "SIGENERGY Energy Controller 10kW" gematcht — zwei verschiedene
 * Sigenergy-Produktfamilien, die nur zufällig dieselbe kW-Zahl tragen. Mit dem
 * Wort-Score bleiben beide Kandidaten bei 1 Treffer (nicht eindeutig) -> UNSICHER,
 * statt eine falsche, aber selbstbewusste Antwort zu liefern.
 */
function findDropdownMatch(category, rawName, value) {
  const candidates = KNOWN_DROPDOWN_VALUES[category] || [];
  const nameNorm = normalizeName(rawName).toLowerCase();

  const exact = candidates.find(c => normalizeName(c).toLowerCase() === nameNorm);
  if (exact) return exact;

  let pool = candidates;
  if (value !== null && value !== undefined) {
    const valueMatches = candidates.filter(c => extractCandidateValue(c) === value);
    if (valueMatches.length > 0) pool = valueMatches;
  }
  if (pool.length === 0) return null;

  const scored = pool.map(c => {
    const worte = normalizeName(c).toLowerCase().split(/[\s,/-]+/)
      .filter(w => w.length >= 3 && !/^\d+$/.test(w));
    const treffer = worte.filter(w => nameNorm.includes(w)).length;
    return { c, treffer };
  });
  const maxTreffer = Math.max(...scored.map(s => s.treffer));
  const beste = scored.filter(s => s.treffer === maxTreffer);

  return (maxTreffer > 0 && beste.length === 1) ? beste[0].c : null;
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
