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
  Module_Bezeichnung:          'ba5c7c11d7a26d06d7de9973c25c4042dc21ae2d',
  WR_Leistung_kW:              '75fd8ffb7ba5ae4b3a8a5de1969e0d0f0a9050a0',
  Speicher_Kapazitaet_kWh:     'd8e9435192bb719365e9bc3186dcba540dff26bd',
  Heizstab:                    '9f7b89cfd2364447f5ee4d9bda4cba0a984af10d',
  Verkaufte_Artikel_Summary:   'a38455087829e67f22cb5217a44c3cf31f39bcbc',
  System_Marke:                '6e42bb6bd1d9314fc4be52fe58789924b9ba51da',
  Notstrom_Typ:                '936f581faded886d47e9a3d3c004e0dc37e51bab',
  Wallbox_Typ:                 '9c9bf4b5bf02b8ba924bbad2b086bad830b2af12',

  // --- Zahlungseingang-Feature (siehe ZahlungseingangSync.gs) ---
  // Per checkExistingFields() ermittelt (26.08.2026), Typ enum.
  zahlungseingang_erhalten:    'ddbfed2a1cdc25c2be460b9a825e056cca2d0284',

  // --- Montage/Elektro-Pauschalen (für Montagepartner, z.B. Christof) ---
  // Live angelegt per createMontageElektroFelder() (01.09.2026).
  Montage_Pauschale_EUR:            '126ce0b31fc718cfb05a8356f891684a8f7196c1',
  Elektroinstallation_Pauschale_EUR: '13892f466a82621f0c3ee7020b61f208724dcd6b',
  Elektromaterial_Pauschale_EUR:     '83713577892e7c77de66f55690c4299d14b47097',
  Technische_Projektierung_Pauschale_EUR: '61f65b794a6bac1d9160374f7ff1c4d78f3533f5',
  // Bruttosumme des gesamten sevdesk-Auftrags. Von Valentin in Pipedrive als TEXT-Feld angelegt
  // (09.09.2026) -- deshalb wird der Wert formatiert geschrieben ("27.140,39 EUR", siehe
  // formatiereBruttoSumme() in SyncEngine.gs), nicht als rohe Zahl.
  Gesamtsumme_Brutto:               '4af5a8d4ff079ac13a13b6de092748479fbe3d13'

  // VERWORFEN 09.09.2026: Montage_Elektro_Summary -- ABSICHTLICH KEIN FELD MEHR HIER.
  // Die Idee (01.09.2026) war eine zweite, kurze Summary nur für Montage/Elektro/Projektierung,
  // damit Christof nicht in der langen Hardware-Summary suchen muss. Sie wurde nie gebaut: das
  // Pipedrive-Feld wurde nie angelegt, der Key blieb ein PLACEHOLDER und ließ pruefeKonfiguration()
  // dauerhaft rot laufen (Befund D5). Valentins Entscheidung: die vier Beträge stehen längst
  // einzeln und strukturiert am Deal (Montage_/Elektroinstallation_/Elektromaterial_/
  // Technische_Projektierung_Pauschale_EUR, alle Typ Nummer) -- eine Textkopie derselben Zahlen
  // bringt nichts dazu. Der String wird weiter gebaut, aber nur noch ins Sync-Log geschrieben
  // (aggregated.montageSummary, siehe formatiereErkannteFelder() in SyncEngine.gs).
  // Wer das Feld doch will: erst mit Valentin und Christof klären, WOFÜR -- eine Listenansicht
  // oder ein Filter wäre der einzige echte Grund.

  // ENTFERNT 09.09.2026: SM_FS_Typ (SM/FS bzw. "Ausführungsart") -- ABSICHTLICH KEIN FELD MEHR HIER.
  // Valentins Entscheidung: die Ausführungsart trägt der Seller in Pipedrive selbst ein. Das Script
  // hat dafür bis 09.09. einen Wert aus den Positionen ABGELEITET (Montage/Elektro-Position
  // vorhanden => "FS") und hätte damit bei jedem Sync die Handeingabe überschrieben.
  // Der field_code ist bekannt (`cc80ad5daf0788dba60b3da3931681edd3dd2c87`, enum, Optionen
  // Full Service=154 / Selbstmontage=155 / Hybrid=156, siehe docs/REFERENZ-Pipedrive-AppsScript.md)
  // -- er fehlt hier also nicht aus Unwissen, sondern weil dieses Script das Feld nicht anfassen soll.
  // Wer es wieder einbauen will, klärt vorher mit Valentin, wer die Ausführungsart pflegt.
  // Damit ist Befund D6 ("geladene Waffe") erledigt, nicht nur entschärft.
};

const ENUM_OPTION_IDS = {
  Module_Marke:    { 'Aiko': 107, 'Sigenergy': 108, 'Fronius': 109, 'Huawei': 110, 'SUNOVA': 138, 'LUXOR': 139, 'DAS': 140, 'TRINASOLAR': 141, 'JASOLAR': 247 },
  Heizstab:        { 'Ja': 123, 'Nein': 124 },
  System_Marke:    { 'Sigenergy': 125, 'Fronius': 126, 'Huawei': 127, 'Growatt': 128, 'SolaX': 129, 'SofarSolar': 130, 'BYD': 131 },
  Notstrom_Typ:    { 'Automatisch': 132, 'Händisch': 133, 'Nein': 134 },
  Wallbox_Typ:     { '11kW': 135, '22kW': 136, 'Nein': 137 },
  // Live gegen Pipedrive verifiziert (26.08.2026, pruefeZahlungseingangKonfiguration()):
  // Label heißt "Erhalten", nicht "Ja" -- gleiches Namensmuster wie bei "AR versendet".
  Zahlungseingang_erhalten: { 'Erhalten': 207 }
  // SM_FS_Typ hier ebenfalls entfernt (09.09.2026) -- Begründung oben bei FIELD_KEYS.
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
    // Montagearbeiten/Elektroinstallation(smaterial) bewusst NICHT hier -- eigene Kategorien weiter
    // unten (31.08.2026), damit die Pauschalbeträge nicht mehr stillschweigend übersprungen werden.
    // Projektbetreuung/Projektierung bewusst NICHT hier -- eigene Kategorie weiter unten (01.09.2026).
    // "EMS Integration" ergaenzt 11.09.2026: tauchte in Order 30321086 als "SIGENERGY EMS
    // Integration" (1.200 EUR) auf und landete mangels Muster als "[?]" in der Summary.
    // Bewusst eng gefasst ("EMS Integration", nicht blosses "EMS"), damit kein Geraetename
    // mit EMS im Titel versehentlich mitverschluckt wird.
    match: /Smart Meter|Power Sensor|Controller BC|Communication Modul|SparSmart|MPPT|Optimierer|Moduloptimierung|Fernwartung|Montageset|Bodenmontageset|Wandmontageset|Modulhalterung|Transportkosten|Planung der PV|Anmeldung EVU|EVU Abnahme|Messpauschale|Landesförderung|Garantie|Klima|Wärmepumpe|Aquarea|Single-Split|Adapter Box|Smart Wifi Plug|Schuko Stecker|Betteri|Balkonkraftwerk|Leistungssteller|Heizungsumwälzpumpe|EMMA|Dongle|SMARTFOX|Energiemanager|EMS[\s-]?Integration/i
  },
  montage: {
    // Deckt "MONTAGEARBEITEN (PAUSCHAL)", "(PAUSCHAL PRO KW)" und "(REGIE)" gleichermaßen ab --
    // WIDERLEGT am 11.09.2026: hier stand,
    // die tatsaechliche Preisbasis stehe im gelesenen Positionspreis und nicht im Namen. Falsch --
    // "(REGIE)" liefert einen STUNDENSATZ, "(PAUSCHAL)" einen Endbetrag, und im Preis sieht man
    // den Unterschied nicht. Unterschieden wird jetzt ueber EINHEIT_STUNDE/REGIE_IM_NAMEN, siehe dort.
    match: /Montagearbeiten/i
  },
  elektroinstallation: {
    // Negative Lookahead schließt "Elektroinstallationsmaterial" aus (eigene Kategorie, siehe unten) --
    // sonst würden beide Positionen hier landen, weil "Elektroinstallation" ein Teilstring ist.
    match: /Elektroinstallation(?!smaterial)/i
  },
  elektromaterial: {
    match: /Elektroinstallationsmaterial/i
  },
  projektierung: {
    // Katalog-Artikel heißt "TECHNISCHE PROJEKTBETREUUNG" (1121), im Angebots-PDF steht aber
    // "TECHNISCHE PROJEKTIERUNG" (2026-644-A) -- beide Schreibweisen abdecken, nicht nur eine raten.
    match: /Projekt(betreuung|ierung)/i
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
    // Nur für die kompakte Verkaufte_Artikel_Summary (255-Zeichen-Limit) -- die exakte
    // Modulbezeichnung steht ohnehin vollständig in Module_Bezeichnung (siehe c.rawName).
    extractValue: (name) => {
      // 1) Wattzahl mit Einheit: "440 Wp", "440Wp", "445W".
      const mitEinheit = name.match(/(\d{3,4})\s*W(?:P|ATT)?\b/i);
      if (mitEinheit) return `${mitEinheit[1]}Wp`;
      // 2) Fallback ohne Einheit: bei vielen Modulnamen steckt die Wattzahl nur im Modellcode
      // ("JAM54D41-440/LB"). Ohne diesen Fallback bliebe die Summary bei "20x JASOLAR" stehen und
      // wäre weniger wert als vorher, wo der exakte Name drinstand. Bewusst nur DREIstellige Zahlen
      // im plausiblen Modulbereich -- vierstellige sind in der Praxis Maße (1722x1134) oder
      // Artikelnummern, und Modellcode-Fragmente wie "54"/"41" fallen durch die Längenprüfung.
      const wattKandidat = (name.match(/\d+/g) || [])
        .map(Number)
        .find(n => String(n).length === 3 && n >= 250 && n <= 900);
      return wattKandidat ? `${wattKandidat}Wp` : null;
    }
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

// Kategorien ohne Marken-Logik -- haben stattdessen einen Pauschalbetrag (siehe unten, 31.08.2026/01.09.2026).
const BETRAG_KATEGORIEN = ['montage', 'elektroinstallation', 'elektromaterial', 'projektierung'];

// --- REGIE vs. PAUSCHALE (11.09.2026) ---------------------------------------
// sevdesk-Einheit "Stunde". Eine Position mit dieser Einheit traegt einen STUNDENSATZ,
// keinen Endbetrag: "MONTAGEARBEITEN (REGIE), 1 x 89" heisst "89 EUR pro Stunde, Gesamtsumme
// offen" -- NICHT "Montage kostet 89 EUR". Live belegt an Order 30321086.
// ACHTUNG, das widerlegt den frueheren Kommentar bei ARTICLE_PATTERNS.montage, die tatsaechliche
// Preisbasis stehe im gelesenen Positionspreis. Tut sie nicht -- sie steht in der Einheit.
const EINHEIT_STUNDE = 9;

// Zweiter, unabhaengiger Indikator: sevdesk-Artikelnamen fuehren die Abrechnungsart im Klartext
// ("(REGIE)" vs "(PAUSCHAL)"). Bewusst ZUSAETZLICH zur Einheit geprueft -- fehlt die unity mal
// (aelterer Auftrag, handisch erfasste Position), traegt der Name die Information noch.
const REGIE_IM_NAMEN = /\(\s*REGIE\s*\)/i;

/**
 * Analysiert eine einzelne sevdesk-Position und ordnet sie einer Kategorie zu.
 * @param {{name: string, quantity: number, einzelpreisNetto: number|null}} position
 * @returns {{category: string, marke: string|null, value: string|null, quantity: number, skipped: boolean, betrag: number|null}}
 */
function classifyPosition(position) {
  // Deutsches Komma als Dezimaltrenner normalisieren (z.B. "8,06 kWh" → "8.06 kWh"),
  // sonst greift die Regex nur die Nachkommastellen ab
  const name = (position.name || '').replace(/(\d),(\d)/g, '$1.$2');
  const quantity = position.quantity || 1;
  // Gesamtbetrag der Position (Einzelpreis x Menge) -- null wenn der Preis nicht gelesen werden
  // konnte (siehe UNGETESTET-Hinweis bei fetchOrderFromSevdesk in SyncEngine.gs).
  const betrag = (position.einzelpreisNetto !== null && position.einzelpreisNetto !== undefined)
    ? Math.round(position.einzelpreisNetto * quantity * 100) / 100
    : null;

  // Wird die Position nach Aufwand verrechnet? Zwei unabhaengige Indikatoren, damit ein
  // fehlender reicht (siehe EINHEIT_STUNDE / REGIE_IM_NAMEN oben).
  const istRegie = position.einheitId === EINHEIT_STUNDE || REGIE_IM_NAMEN.test(name);

  for (const [category, config] of Object.entries(ARTICLE_PATTERNS)) {
    if (config.match.test(name)) {
      if (category === 'zubehoer') {
        return { category, marke: null, value: null, quantity, skipped: true, betrag: null };
      }

      if (BETRAG_KATEGORIEN.indexOf(category) !== -1) {
        // REGIE: `betrag` bleibt bewusst null. Ein Stundensatz in ein Feld namens
        // "... Pauschale EUR" zu schreiben waere nicht ungenau, sondern FALSCH -- der
        // Montagepartner liest "89 EUR" und plant damit, obwohl die Summe offen ist.
        // Entscheidung Valentin 11.09.2026: "wenn wir es nicht wissen, soll es nicht falsch sein".
        // Leer ist ehrlich und fuehrt zur Rueckfrage, eine falsche Zahl tut das nicht.
        // Der Satz geht dabei NICHT verloren: er wandert als `stundensatz` in die Montage-
        // Summary, die "89EUR/Std" darstellen kann -- ein Zahlenfeld kann das nicht.
        return {
          category, marke: null, value: null, quantity, skipped: false, rawName: name,
          betrag: istRegie ? null : betrag,
          istRegie: istRegie,
          stundensatz: istRegie ? position.einzelpreisNetto : null
        };
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

      return { category, marke, value, quantity, skipped: false, rawName: name, betrag: null };
    }
  }

  return { category: 'unknown', marke: null, value: null, quantity, skipped: false, rawName: name, betrag: null };
}

/**
 * Baut eine Zeile der Montage-Summary (11.09.2026).
 *   Pauschale -> "Montage 2400EUR"
 *   Regie     -> "Montage REGIE 89EUR/Std"
 * Der Regie-Fall ist der Grund, warum es diese Textzeile ueberhaupt braucht: das Pipedrive-
 * ZAHLENfeld kann "89 EUR pro Stunde" nicht ausdruecken und bleibt deshalb leer. Ohne diese
 * Zeile waere der Stundensatz komplett verloren, statt nur nicht im Zahlenfeld zu stehen.
 * Trailing-Underscore = im Apps-Script-Editor nicht als ausfuehrbare Funktion gelistet.
 */
function montageSummaryTeil_(label, c) {
  if (c.istRegie) {
    const satz = (c.stundensatz !== null && c.stundensatz !== undefined)
      ? c.stundensatz + '€/Std'
      : 'Satz unbekannt';
    return label + ' REGIE ' + satz;
  }
  return label + ' ' + (c.betrag !== null ? c.betrag + '€' : '?');
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
    Module_Bezeichnung: null, // exakter Artikelname, für Pipedrive-Mailvorlagen-Platzhalter
    WR_Leistung_kW: null,
    Speicher_Kapazitaet_kWh: null,
    System_Marke: null,      // aus WR oder Speicher abgeleitet (meist Sigenergy)
    Notstrom_Typ: 'Nein',    // Automatisch / Händisch / Nein
    Wallbox_Typ: 'Nein',     // 11kW / 22kW / Nein
    Heizstab: 'Nein',
    // --- Montage/Elektro-Pauschalen (31.08.2026) ---
    Montage_Pauschale_EUR: null,
    Elektroinstallation_Pauschale_EUR: null,
    Elektromaterial_Pauschale_EUR: null,
    Technische_Projektierung_Pauschale_EUR: null
    // Kein SM_FS_Typ mehr (09.09.2026): die Ausführungsart pflegt der Seller von Hand, siehe
    // Kommentar oben bei FIELD_KEYS.
  };

  let speicherKwhTotal = 0; // Menge x Modellwert je Position, dann aufsummiert
  const summaryParts = [];
  // Getrennt von summaryParts (01.09.2026, auf Wunsch): Montage/Elektro/Projektierung bekommen eine
  // eigene, kurze Zusammenfassung statt in der Hardware-Summary mitzulaufen.
  const montageSummaryParts = [];
  const unknownArticles = [];

  positions.forEach(pos => {
    const c = classifyPosition(pos);
    if (c.skipped) return;

    switch (c.category) {
      case 'module':
        // Mehrere Modul-Positionen (z.B. verschiedene Modelle) werden summiert
        result.Module_Anzahl = (result.Module_Anzahl || 0) + c.quantity;
        result.Module_Marke = c.marke; // letzte gefundene Marke gewinnt (meist eh nur 1 Modell)
        result.Module_Bezeichnung = c.rawName; // letzter gefundener Artikelname gewinnt (meist eh nur 1 Modell)
        // Kompakt für die Summary (255-Zeichen-Limit) -- exakter Name steht komplett in
        // Module_Bezeichnung, hier reicht Marke + Wp.
        summaryParts.push(`${c.quantity}x ${c.marke || '?'}${c.value ? ' ' + c.value : ''}`.trim());
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
        // "(=X kWh)" nur zeigen, wenn Menge>1 -- bei Menge 1 ist die Summe identisch zum Modellwert
        // und war reine Doppelung ("12.60 kWh (=12.6 kWh)").
        const summeSuffix = c.quantity > 1 ? ` (Σ${lineTotal.toFixed(1)}kWh)` : '';
        summaryParts.push(`${c.quantity}x ${c.marke || '?'} Speicher ${c.value || ''}${summeSuffix}`.trim());
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

      case 'montage':
        // Bei REGIE bleibt das Zahlenfeld leer -- siehe Begruendung in classifyPosition().
        if (!c.istRegie) result.Montage_Pauschale_EUR = c.betrag;
        montageSummaryParts.push(montageSummaryTeil_('Montage', c));
        break;

      case 'elektroinstallation':
        // Bei REGIE bleibt das Zahlenfeld leer -- siehe Begruendung in classifyPosition().
        if (!c.istRegie) result.Elektroinstallation_Pauschale_EUR = c.betrag;
        montageSummaryParts.push(montageSummaryTeil_('E-Install', c));
        break;

      case 'elektromaterial':
        // Bei REGIE bleibt das Zahlenfeld leer -- siehe Begruendung in classifyPosition().
        if (!c.istRegie) result.Elektromaterial_Pauschale_EUR = c.betrag;
        montageSummaryParts.push(montageSummaryTeil_('E-Material', c));
        break;

      case 'projektierung':
        // Bei REGIE bleibt das Zahlenfeld leer -- siehe Begruendung in classifyPosition().
        if (!c.istRegie) result.Technische_Projektierung_Pauschale_EUR = c.betrag;
        montageSummaryParts.push(montageSummaryTeil_('Projekt.', c));
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
    montageSummary: montageSummaryParts.join(' | '), // "", nicht null, wenn nichts gefunden -- konsistent mit summary
    unknownArticles
  };
}