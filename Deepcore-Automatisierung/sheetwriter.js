// ============================================================================
// DATEI 2 von 3: SheetWriter.gs
// Findet die richtige Pufferzeile im "Aufträge"-Tab und befüllt sie.
//
// ANNAHME (vor dem ersten echten Lauf mit pruefeKonfiguration() verifizieren):
// Tab-Name "Aufträge", Spaltenreihenfolge A–AS wie im Google-Sheet-Export vom
// 2026-08-19 (Kopie). Monatsspalte E enthält bereits pro Pufferzeile den
// österreichischen Monatsnamen (z.B. "August"), auch wenn die Zeile sonst leer
// ist. Deshalb muss KEINE "Gesamt [Monat]"-Blockgrenze gesucht werden: die erste
// Zeile mit passendem Monat UND leerem Kundenname genügt.
//
// SCHREIBSTRATEGIE: Es werden nur zwei zusammenhängende Blöcke geschrieben
// (A–F und M–AS), jeweils mit einem einzigen setValues(). Bestehende Formeln in
// diesen Blöcken (EK netto, Handelsspanne, ggf. Summen-Spalten) werden vorher
// per getFormulas() gelesen und unverändert zurückgeschrieben — sonst würde ein
// Blockschreiben die vorformatierten Formeln der Pufferzeile zerstören.
// ============================================================================

const DEEPCORE_SHEET_ID = '1dqUQ3TNXtFojx86DYWd6Sa4sInPCFpFUWrqf10g7JhY'; // ⚠️ AKTUELL NUR DIE TEST-KOPIE
const AUFTRAEGE_TAB_NAME = 'Aufträge';
const AUFTRAEGE_HEADER_ROWS = 2; // Zeilen 1+2 sind Header, Daten beginnen ab Zeile 3

// Wenn false, wird bei unsicherem Artikel-Match NUR Stk./Summe geschrieben und die
// Namenszelle bleibt leer (die Erklärung steht ohnehin in der Notizen-Spalte).
// Erst auf true stellen, wenn UNSICHER_LABEL in JEDER Artikel-Dropdown-Liste
// ergänzt wurde — prüfbar mit pruefeDropdownListen().
const SCHREIBE_UNSICHER_LABEL = false;

const COL = {
  KUNDENNAME: 1, TEAM: 2, PROJEKT: 3, KAUFART: 4, MONAT: 5,
  VK_NETTO: 6, EK_NETTO: 7, HANDELSSPANNE: 8, HANDELSSPANNE_PROZENT: 9,
  LIEFERUNG_EINGEPLANT: 10, FOERDERUNG_BEANTRAGT: 11, LIEFERUNG_ABGESCHLOSSEN: 12,
  MODULE: 13, MODULE_STK: 14, MODULE_SUMME: 15,
  DACHART: 16, DACHART_STK: 17, DACHART_SUMME: 18,
  DACHART2: 19, DACHART2_STK: 20, DACHART2_SUMME: 21,
  WECHSELRICHTER: 22, WECHSELRICHTER_STK: 23, WECHSELRICHTER_SUMME: 24,
  WECHSELRICHTER2: 25, WECHSELRICHTER2_STK: 26, WECHSELRICHTER2_SUMME: 27,
  SPEICHER: 28, SPEICHER_STK: 29, SPEICHER_SUMME: 30,
  NOTSTROM: 31, NOTSTROM_STK: 32, NOTSTROM_SUMME: 33,
  SMARTMETER: 34, SMARTMETER_STK: 35, SMARTMETER_SUMME: 36,
  ZUBEHOER: 37, ZUBEHOER_STK: 38, ZUBEHOER_SUMME: 39,
  ZUBEHOER2: 40, ZUBEHOER2_STK: 41, ZUBEHOER2_SUMME: 42,
  SONSTIGE_KOSTEN: 43, NOTIZEN: 44, ANGEBOTS_NR: 45
};

const CATEGORY_COLS = {
  module: { name: COL.MODULE, stk: COL.MODULE_STK, summe: COL.MODULE_SUMME },
  dachart: { name: COL.DACHART, stk: COL.DACHART_STK, summe: COL.DACHART_SUMME },
  dachart2: { name: COL.DACHART2, stk: COL.DACHART2_STK, summe: COL.DACHART2_SUMME },
  wechselrichter: { name: COL.WECHSELRICHTER, stk: COL.WECHSELRICHTER_STK, summe: COL.WECHSELRICHTER_SUMME },
  wechselrichter2: { name: COL.WECHSELRICHTER2, stk: COL.WECHSELRICHTER2_STK, summe: COL.WECHSELRICHTER2_SUMME },
  speicher: { name: COL.SPEICHER, stk: COL.SPEICHER_STK, summe: COL.SPEICHER_SUMME },
  notstrom: { name: COL.NOTSTROM, stk: COL.NOTSTROM_STK, summe: COL.NOTSTROM_SUMME },
  smartmeter: { name: COL.SMARTMETER, stk: COL.SMARTMETER_STK, summe: COL.SMARTMETER_SUMME },
  zubehoer: { name: COL.ZUBEHOER, stk: COL.ZUBEHOER_STK, summe: COL.ZUBEHOER_SUMME },
  zubehoer2: { name: COL.ZUBEHOER2, stk: COL.ZUBEHOER2_STK, summe: COL.ZUBEHOER2_SUMME }
};

const GERMAN_MONTHS = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

// Alternative Schreibweisen, die im Sheet vorkommen können (Januar/Jänner, Maerz).
const MONTH_ALIASES = {
  'januar': 'Jänner', 'jaenner': 'Jänner', 'jänner': 'Jänner',
  'maerz': 'März', 'marz': 'März', 'märz': 'März'
};

// Spreadsheet/Sheet werden pro Script-Lauf einmal geholt statt bei jedem Zugriff.
// openById() pro Zelle war der teuerste Teil von v1.
let _ssCache = null;
let _auftraegeSheetCache = null;

function getDeepCoreSpreadsheet() {
  if (!_ssCache) _ssCache = SpreadsheetApp.openById(DEEPCORE_SHEET_ID);
  return _ssCache;
}

function getAuftraegeSheet() {
  if (!_auftraegeSheetCache) {
    const sheet = getDeepCoreSpreadsheet().getSheetByName(AUFTRAEGE_TAB_NAME);
    if (!sheet) {
      const vorhandene = getDeepCoreSpreadsheet().getSheets().map(s => s.getName()).join(', ');
      throw new Error(`Tab "${AUFTRAEGE_TAB_NAME}" nicht gefunden. Vorhandene Tabs: ${vorhandene}`);
    }
    _auftraegeSheetCache = sheet;
  }
  return _auftraegeSheetCache;
}

/**
 * Vergleichsform für Monatsnamen: trimmt, gleicht Aliase ab.
 * Falls die Zelle ein Datum enthält (kann bei Sheet-Formatierung passieren),
 * wird daraus der Monatsname abgeleitet statt stumpf zu vergleichen.
 * v1 verglich per === auf den Rohwert — ein Leerzeichen im Sheet hätte gereicht,
 * damit gar keine Zeile mehr gefunden wird.
 */
function normalizeMonat(zellwert) {
  if (zellwert instanceof Date) return GERMAN_MONTHS[zellwert.getMonth()];
  const s = String(zellwert === null || zellwert === undefined ? '' : zellwert).trim();
  if (!s) return '';
  return MONTH_ALIASES[s.toLowerCase()] || s;
}

/**
 * Findet die erste freie Pufferzeile für den übergebenen Monat.
 * Frei = Monat passt UND Kundenname-Zelle ist leer.
 * @returns {number|null} 1-basierter Zeilenindex, oder null wenn keine freie Zeile mehr da ist.
 */
function findFreeRowForMonth(monatName) {
  const sheet = getAuftraegeSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= AUFTRAEGE_HEADER_ROWS) return null;

  // Nur Spalten A–E lesen (Kundenname bis Monat) — bewusst explizite Breite;
  // v1 übergab COL.MONAT als numColumns, was nur zufällig passte.
  const anzahlZeilen = lastRow - AUFTRAEGE_HEADER_ROWS;
  const data = sheet.getRange(AUFTRAEGE_HEADER_ROWS + 1, 1, anzahlZeilen, COL.MONAT).getValues();

  const gesucht = normalizeMonat(monatName);

  for (let i = 0; i < data.length; i++) {
    const kundenname = data[i][COL.KUNDENNAME - 1];
    const monat = normalizeMonat(data[i][COL.MONAT - 1]);
    if (monat === gesucht && String(kundenname || '').trim() === '') {
      return AUFTRAEGE_HEADER_ROWS + 1 + i;
    }
  }
  return null;
}

/**
 * Liest einen Zellblock und gibt ein Array zurück, in dem Formeln als Formel-String
 * und alles andere als Wert stehen. Wird dieses Array per setValues() zurück-
 * geschrieben, bleiben bestehende Formeln erhalten.
 */
function leseBlockFormelsicher(sheet, row, startCol, breite) {
  const range = sheet.getRange(row, startCol, 1, breite);
  const formeln = range.getFormulas()[0];
  const werte = range.getValues()[0];
  return { range, inhalt: formeln.map((f, i) => (f !== '' ? f : werte[i])) };
}

/**
 * Befüllt eine gefundene Zeile mit den Auftragsdaten.
 * Team/Projekt/Kaufart/Monat werden NICHT angefasst (bleiben leer für die manuelle
 * Nacharbeit durch den Verkäufer bzw. so, wie vorformatiert).
 *
 * @param {number} row 1-basierter Zeilenindex
 * @param {{kundenname, vkNetto, angebotsNr, cells, sonstigeKosten, notizenZusatz}} data
 * @param {boolean} dryRun wenn true, wird nichts geschrieben, nur geloggt
 * @returns {{kopf: Array, artikel: Array}} die Zeileninhalte (für DRY-RUN-Log/Tests)
 */
function writeRowToDeepCore(row, data, dryRun) {
  const sheet = getAuftraegeSheet();

  // --- Block 1: A–F (Kundenname .. VK netto) -------------------------------
  const kopf = leseBlockFormelsicher(sheet, row, COL.KUNDENNAME, COL.VK_NETTO);
  kopf.inhalt[COL.KUNDENNAME - COL.KUNDENNAME] = data.kundenname;
  kopf.inhalt[COL.VK_NETTO - COL.KUNDENNAME] = data.vkNetto;

  // --- Block 2: M–AS (Module .. Angebots-Nr.) ------------------------------
  const START = COL.MODULE;
  const breite = COL.ANGEBOTS_NR - START + 1;
  const artikel = leseBlockFormelsicher(sheet, row, START, breite);
  const setze = (col, wert) => { artikel.inhalt[col - START] = wert; };

  Object.keys(CATEGORY_COLS).forEach(slotKey => {
    const cell = data.cells[slotKey];
    if (!cell) return;
    const cols = CATEGORY_COLS[slotKey];
    const nameWert = (cell.name === UNSICHER_LABEL && !SCHREIBE_UNSICHER_LABEL) ? '' : cell.name;
    setze(cols.name, nameWert);
    setze(cols.stk, cell.stk);
    setze(cols.summe, cell.summe);
  });

  if (data.sonstigeKosten) setze(COL.SONSTIGE_KOSTEN, data.sonstigeKosten);
  setze(COL.ANGEBOTS_NR, data.angebotsNr);

  const notizen = Object.keys(CATEGORY_COLS)
    .map(k => data.cells[k])
    .filter(c => c && c.notiz)
    .map(c => c.notiz)
    .concat(data.notizenZusatz || []);
  if (notizen.length > 0) setze(COL.NOTIZEN, notizen.join(' | '));

  if (dryRun) {
    Logger.log(`[DRY RUN] Zeile ${row} würde geschrieben:`);
    Logger.log(`  A–F : ${JSON.stringify(kopf.inhalt)}`);
    Logger.log(`  M–AS: ${JSON.stringify(artikel.inhalt)}`);
  } else {
    kopf.range.setValues([kopf.inhalt]);
    artikel.range.setValues([artikel.inhalt]);
    // Abschließen, bevor der nächste Auftrag im selben Lauf dieselbe Zeile sucht.
    SpreadsheetApp.flush();
  }

  return { kopf: kopf.inhalt, artikel: artikel.inhalt };
}

// ============================================================================
// PRÜF-/DEBUG-FUNKTIONEN — vor dem ersten Lauf manuell ausführen
// ============================================================================

/**
 * Prüft Tab, Header-Zuordnung und Pufferzeilen-Bestand gegen das echte Sheet.
 * Entspricht dem pruefeKonfiguration()-Muster aus den anderen RP-Scripts:
 * hartcodierte Annahmen einmal gegen die Realität halten, bevor geschrieben wird.
 */
function pruefeKonfiguration() {
  const sheet = getAuftraegeSheet();
  Logger.log(`✓ Tab "${AUFTRAEGE_TAB_NAME}": ${sheet.getLastRow()} Zeilen, ${sheet.getLastColumn()} Spalten.`);

  if (sheet.getLastColumn() < COL.ANGEBOTS_NR) {
    Logger.log(`✗ WARNUNG: Sheet hat nur ${sheet.getLastColumn()} Spalten, erwartet werden ${COL.ANGEBOTS_NR} (bis AS).`);
  }

  const header1 = sheet.getRange(1, 1, 1, COL.ANGEBOTS_NR).getValues()[0];
  const header2 = sheet.getRange(2, 1, 1, COL.ANGEBOTS_NR).getValues()[0];
  Logger.log('--- Spaltenzuordnung (manuell gegenlesen) ---');
  Object.entries(COL).forEach(([key, col]) => {
    Logger.log(`  Spalte ${col} (${key}): "${header1[col - 1]}" / "${header2[col - 1]}"`);
  });

  Logger.log('--- Freie Pufferzeilen je Monat ---');
  const beispielZeilen = [];
  GERMAN_MONTHS.forEach(m => {
    const row = findFreeRowForMonth(m);
    if (row) beispielZeilen.push(row);
    Logger.log(`  ${m}: ${row ? 'erste freie Zeile ' + row : '✗ KEINE freie Zeile'}`);
  });

  // Welche Zellen einer leeren Pufferzeile tragen Formeln? Das entscheidet, ob der
  // Code sie überschreiben darf. Kritisch sind die Summen-Spalten: wenn dort eine
  // Formel steht, würde der sevdesk-Betrag sie ersetzen.
  if (beispielZeilen.length > 0) {
    const row = beispielZeilen[0];
    const formeln = sheet.getRange(row, 1, 1, COL.ANGEBOTS_NR).getFormulas()[0];
    const mitFormel = [];
    Object.entries(COL).forEach(([key, col]) => {
      if (formeln[col - 1] !== '') mitFormel.push(`${key} (Sp. ${col}): ${formeln[col - 1]}`);
    });
    Logger.log(`--- Formeln in leerer Pufferzeile ${row} ---`);
    if (mitFormel.length === 0) {
      Logger.log('  keine — alle Zielspalten dürfen beschrieben werden.');
    } else {
      mitFormel.forEach(f => Logger.log('  ' + f));
      Logger.log('  ⚠️ Steht eine dieser Formeln in einer Spalte, die das Script beschreibt' +
        ' (VK_NETTO, *_STK, *_SUMME, SONSTIGE_KOSTEN), wird sie durch den Wert ersetzt. Bewusst entscheiden.');
    }
  }
}

/**
 * Liest die echten Dropdown-Listen aus der ersten freien Zeile des aktuellen Monats
 * und vergleicht sie mit KNOWN_DROPDOWN_VALUES. Macht die Drift zwischen
 * Sheet-Katalog und Code-Konstante sichtbar, statt sie erst beim Schreiben zu merken.
 * Zeigt außerdem, ob die Validierung wirklich auf "Eingabe ablehnen" steht und
 * ob UNSICHER_LABEL schon in der Liste ergänzt wurde.
 */
function pruefeDropdownListen() {
  const sheet = getAuftraegeSheet();
  const row = findFreeRowForMonth(GERMAN_MONTHS[new Date().getMonth()]);
  if (!row) { Logger.log('✗ Keine freie Zeile im aktuellen Monat gefunden.'); return; }

  DEEPCORE_CATEGORIES.forEach(cat => {
    const rule = sheet.getRange(row, CATEGORY_COLS[cat].name).getDataValidation();
    if (!rule) { Logger.log(`  ${cat}: keine Datenvalidierung in Zeile ${row}`); return; }

    // Bei "Liste aus einem Bereich" ist getCriteriaValues()[0] ein Range-Objekt,
    // kein Array — dann würde .map() hart werfen. Beide Fälle abfangen, denn
    // welcher der beiden vorliegt, ist genau die offene Frage im Projekt.
    const roh = rule.getCriteriaValues()[0];
    if (!Array.isArray(roh)) {
      const quelle = roh && roh.getA1Notation ? roh.getA1Notation() : String(roh);
      Logger.log(`  ${cat}: Validierung ist ein BEREICHSVERWEIS (${quelle}), keine feste Liste.` +
        ' → KNOWN_DROPDOWN_VALUES im Code ist dann der falsche Ansatz, Werte direkt aus dem Bereich lesen.');
      return;
    }

    const imSheet = roh.map(String);
    const imCode = KNOWN_DROPDOWN_VALUES[cat] || [];
    const fehltImCode = imSheet.filter(v => imCode.indexOf(v) === -1);
    const fehltImSheet = imCode.filter(v => imSheet.indexOf(v) === -1);

    Logger.log(`  ${cat}: ${imSheet.length} Werte im Sheet / ${imCode.length} im Code` +
      ` | Eingabe-ablehnen=${rule.getAllowInvalid() === false}` +
      ` | UNSICHER-Eintrag vorhanden=${imSheet.indexOf(UNSICHER_LABEL) !== -1}`);
    if (fehltImCode.length) Logger.log(`      nur im Sheet: ${fehltImCode.join(' ; ')}`);
    if (fehltImSheet.length) Logger.log(`      nur im Code : ${fehltImSheet.join(' ; ')}`);
  });
}
