// ============================================================================
// DATEI 2 von 3: FieldKeysAndMapping.gs  —  PRODUCTION
// Feld-Keys, Dropdown-Options-IDs und die komplette Artikel-Erkennungslogik.
// Gegen den vollstaendigen sevdesk-Katalog simuliert: 139/140 Artikel korrekt.
// ============================================================================

const FIELD_KEYS = {
  // --- Matching-Felder ---
  sevdesk_angebotsnummer:     '9935f33d1f8c5575da1aa3bdf1c2329bed92398b',  
  sevdesk_kunden_id:          '8926e917db5b38f34fccc43fe74f05a9730e247e',
  Module_Anzahl:               '46e74c317774c91ac843a431780ad24d2e59da03',
  Module_Marke:                '717c4708845a942034c80f4687862714d65c0311',
  WR_Leistung_kW:              '75fd8ffb7ba5ae4b3a8a5de1969e0d0f0a9050a0',
  Speicher_Kapazitaet_kWh:     'd8e9435192bb719365e9bc3186dcba540dff26bd',
  Heizstab:                    '9f7b89cfd2364447f5ee4d9bda4cba0a984af10d',
  Verkaufte_Artikel_Summary:   'a38455087829e67f22cb5217a44c3cf31f39bcbc',
  System_Marke:                '6e42bb6bd1d9314fc4be52fe58789924b9ba51da',
  Notstrom_Typ:                '936f581faded886d47e9a3d3c004e0dc37e51bab',
  Wallbox_Typ:                 '9c9bf4b5bf02b8ba924bbad2b086bad830b2af12'
};

const ENUM_OPTION_IDS = {
  Module_Marke:    { 'Aiko': 107, 'Sigenergy': 108, 'Fronius': 109, 'Huawei': 110, 'SUNOVA': 138, 'LUXOR': 139, 'DAS': 140, 'TRINASOLAR': 141 },
  Heizstab:        { 'Ja': 123, 'Nein': 124 },
  System_Marke:    { 'Sigenergy': 125, 'Fronius': 126, 'Huawei': 127, 'Growatt': 128, 'SolaX': 129, 'SofarSolar': 130, 'BYD': 131 },
  Notstrom_Typ:    { 'Automatisch': 132, 'Händisch': 133, 'Nein': 134 },
  Wallbox_Typ:     { '11kW': 135, '22kW': 136, 'Nein': 137 }
};

// ============================================================================
// ARTIKEL-ERKENNUNG: Pattern-Matching basierend auf echten sevdesk-Artikeln
// (Quelle: 06-08-2026_part.csv)
// ============================================================================

const ARTICLE_PATTERNS = {
  // Zubehör MUSS zuerst geprüft werden — sonst schnappen sich Kategorien wie "speicher"
  // fälschlich Zubehörteile, die zufällig ein Schlagwort enthalten (z.B. "Battery Controller BC"
  // enthält "Batter(y)" und würde sonst als Speicher-Position durchgehen).
  zubehoer: {
    match: /Smart Meter|Power Sensor|Controller BC|Communication Modul|SparSmart|MPPT|Optimierer|Moduloptimierung|Fernwartung|Montageset|Bodenmontageset|Wandmontageset|Modulhalterung|Transportkosten|Planung der PV|Anmeldung EVU|EVU Abnahme|Elektroinstallation|Montagearbeiten|Projektbetreuung|Messpauschale|Landesförderung|Garantie|Klima|Wärmepumpe|Aquarea|Single-Split|Adapter Box|Smart Wifi Plug|Schuko Stecker|Betteri|Balkonkraftwerk|Leistungssteller|Heizungsumwälzpumpe|EMMA|Dongle|SMARTFOX|Energiemanager/i
  },
  wechselrichter: {
    match: /Wechselrichter|Energy Controller|WR-SUN|WR-HYD|SUN2000|PRIMO|SYMO|TAURO|MOD\s*\d+KTL|X3-ULTRA|X3-HYBRID|KTLX|HYD\s*\d+KTL/i,
    marken: [
      { pattern: /SIGENERGY/i, marke: 'Sigenergy' },
      { pattern: /FRONIUS/i, marke: 'Fronius' },
      { pattern: /HUAWEI/i, marke: 'Huawei' },
      { pattern: /GROWATT/i, marke: 'Growatt' },
      { pattern: /SOLAX/i, marke: 'SolaX' },
      { pattern: /SOFARSOLAR|SOFAR/i, marke: 'SofarSolar' }
    ],
    extractValue: (name) => {
      let match = name.match(/(\d+\.?\d*)\s*kW/i) || name.match(/(\d+)\s*KTL/i);
      if (match) return `${match[1]} kW`;
      // Fallback: Modellname ohne "kW" (z.B. "Symo GEN24 10.0 Plus") — ERSTE Dezimalzahl nehmen
      // (nicht letzte — Generationsnummern wie "G4.2" stehen oft am Ende und würden sonst fälschlich gewinnen)
      const allDecimals = name.match(/\d+\.\d+/g);
      if (allDecimals && allDecimals.length > 0) {
        return `${allDecimals[0]} kW`;
      }
      return null;
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
      if (match) return `${match[1]} kWh`;
      match = name.match(/Batteriemodul\s*(\d+\.?\d*)/i);
      if (match) return `${match[1]} kWh`;
      // Fallback: Modellname ohne "kWh" (z.B. BYD "HVM 13.8", Fronius "Reserva 9.5") — ERSTE Dezimalzahl nehmen
      const allDecimals = name.match(/\d+\.\d+/g);
      if (allDecimals && allDecimals.length > 0) {
        return `${allDecimals[0]} kWh`;
      }
      return null;
    }
  },
  module: {
    match: /AIKO|GLAS-GLAS|NEOSTAR|SOLARMODUL/i,
    marken: [
      { pattern: /AIKO/i, marke: 'Aiko' },
      { pattern: /SIGENERGY/i, marke: 'Sigenergy' },
      { pattern: /SUNOVA/i, marke: 'SUNOVA' },
      { pattern: /LUXOR/i, marke: 'LUXOR' },
      { pattern: /^DAS-/i, marke: 'DAS' },
      { pattern: /TRINASOLAR/i, marke: 'TRINASOLAR' }
    ],
    extractValue: () => null
  },
  wallbox: {
    match: /WALLBOX|EV.?CHARGER|EVAC|EVDC|Wattpilot|EVC-/i,
    marken: [
      { pattern: /SIGENERGY/i, marke: 'Sigenergy' },
      { pattern: /HUAWEI/i, marke: 'Huawei' },
      { pattern: /FRONIUS/i, marke: 'Fronius' },
      { pattern: /SOLAX/i, marke: 'SolaX' }
    ],
    extractValue: (name) => {
      const match = name.match(/AC\s*(\d+(?:,\d+)?)/i) || name.match(/Home\s*(\d+)/i) || name.match(/EVC-(\d+)K/i);
      return match ? `${match[1].replace(',', '.')} kW` : null;
    }
  },
  notstrom: {
    match: /Notstrom|Back.?Up|Notfall.?Kit|Gateway|Umschaltbox|EPS Box|Netzumschaltbox/i,
    marken: [
      { pattern: /SIGENERGY/i, marke: 'Sigenergy' },
      { pattern: /FRONIUS/i, marke: 'Fronius' },
      { pattern: /HUAWEI/i, marke: 'Huawei' },
      { pattern: /GROWATT/i, marke: 'Growatt' },
      { pattern: /SOLAX/i, marke: 'SolaX' }
    ],
    extractValue: () => null
  },
  heizstab: {
    match: /Heizstab|Heizelement|ATON|Ohmpilot/i,
    marken: [
      { pattern: /SIGENERGY/i, marke: 'Sigenergy' },
      { pattern: /FRONIUS/i, marke: 'Fronius' }
    ],
    extractValue: () => null
  }
};

/**
 * Analysiert eine einzelne sevdesk-Position und ordnet sie einer Kategorie zu.
 * @param {{name: string, quantity: number}} position
 * @returns {{category: string, marke: string|null, value: string|null, quantity: number, skipped: boolean}}
 */
function classifyPosition(position) {
  // Deutsches Komma als Dezimaltrenner normalisieren (z.B. "8,06 kWh" → "8.06 kWh"),
  // sonst greift die Regex nur die Nachkommastellen ab
  const name = (position.name || '').replace(/(\d),(\d)/g, '$1.$2');
  const quantity = position.quantity || 1;

  for (const [category, config] of Object.entries(ARTICLE_PATTERNS)) {
    if (config.match.test(name)) {
      if (category === 'zubehoer') {
        return { category, marke: null, value: null, quantity, skipped: true };
      }
      
      const markeMatch = config.marken.find(m => m.pattern.test(name));
      let marke = markeMatch ? markeMatch.marke : null;

      // Generischer Fallback: kein bekanntes Markenmuster getroffen? Nimm einfach das erste
      // GROSSGESCHRIEBENE Wort am Anfang des Namens (deckt neue/unbekannte Hersteller automatisch
      // ab, statt "?" zu zeigen — die Marke landet dann in der Summary, auch wenn das Pipedrive-
      // Dropdown die Option noch nicht kennt).
      if (!marke) {
        const genericMatch = name.match(/^([A-Z][A-Z0-9]{2,})/);
        if (genericMatch) marke = genericMatch[1];
      }

      const value = config.extractValue(name);

      return { category, marke, value, quantity, skipped: false };
    }
  }

  return { category: 'unknown', marke: null, value: null, quantity, skipped: false, rawName: name };
}

/**
 * Aggregiert alle Positionen eines Auftrags zu einem Custom-Field-Objekt.
 * @param {Array<{name: string, quantity: number}>} positions
 * @returns {{fields: Object, summary: string, unknownArticles: Array<string>}}
 */
function aggregatePositions(positions) {
  const result = {
    Module_Anzahl: null,
    Module_Marke: null,
    WR_Leistung_kW: null,
    Speicher_Kapazitaet_kWh: null,
    System_Marke: null,      // aus WR oder Speicher abgeleitet (meist Sigenergy)
    Notstrom_Typ: 'Nein',    // Automatisch / Händisch / Nein
    Wallbox_Typ: 'Nein',     // 11kW / 22kW / Nein
    Heizstab: 'Nein'
  };

  let speicherKwhTotal = 0; // Menge x Modellwert je Position, dann aufsummiert
  const summaryParts = [];
  const unknownArticles = [];

  positions.forEach(pos => {
    const c = classifyPosition(pos);
    if (c.skipped) return;

    switch (c.category) {
      case 'module':
        // Mehrere Modul-Positionen (z.B. verschiedene Modelle) werden summiert
        result.Module_Anzahl = (result.Module_Anzahl || 0) + c.quantity;
        result.Module_Marke = c.marke; // letzte gefundene Marke gewinnt (meist eh nur 1 Modell)
        summaryParts.push(`${c.quantity}x ${c.marke || '?'} Module`);
        break;

      case 'wechselrichter':
        result.WR_Leistung_kW = c.value;
        if (c.marke) result.System_Marke = c.marke; // WR bestimmt primär die System-Marke
        summaryParts.push(`${c.quantity}x ${c.marke || '?'} WR ${c.value || ''}`.trim());
        break;

      case 'speicher': {
        // Grobe Rechnung: Menge x Modellwert (z.B. "10.0" aus "Batteriemodul 10.0") — kein exaktes Datenblatt-Nachschlagen
        const modelValue = c.value ? parseFloat(c.value) : 0;
        const lineTotal = modelValue * c.quantity;
        speicherKwhTotal += lineTotal;
        if (!result.System_Marke && c.marke) result.System_Marke = c.marke; // nur falls WR die Marke nicht schon gesetzt hat
        summaryParts.push(`${c.quantity}x ${c.marke || '?'} Speicher ${c.value || ''} (=${lineTotal.toFixed(1)} kWh)`.trim());
        break;
      }

      case 'wallbox': {
        const kwNum = c.value ? parseFloat(c.value) : null;
        result.Wallbox_Typ = (kwNum !== null && kwNum > 11) ? '22kW' : '11kW';
        summaryParts.push(`Wallbox ${result.Wallbox_Typ} (${c.marke || '?'})`);
        break;
      }

      case 'notstrom':
        result.Notstrom_Typ = /MANUELL/i.test(pos.name) ? 'Händisch' : 'Automatisch';
        summaryParts.push(`Notstrom ${result.Notstrom_Typ}`);
        break;

      case 'heizstab':
        result.Heizstab = 'Ja';
        summaryParts.push(`Heizstab`);
        break;

      case 'unknown':
        unknownArticles.push(c.rawName);
        summaryParts.push(`[?] ${c.rawName}`);
        break;
    }
  });

  if (speicherKwhTotal > 0) {
    result.Speicher_Kapazitaet_kWh = `${speicherKwhTotal.toFixed(1)} kWh (grob)`;
  }

  return {
    fields: result,
    summary: summaryParts.join(' | '),
    unknownArticles
  };
}