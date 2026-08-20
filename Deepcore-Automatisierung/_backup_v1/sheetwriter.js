// ============================================================================
// DATEI 2 von 3: SheetWriter.gs
// Findet die richtige Pufferzeile im "Aufträge"-Tab und befüllt sie.
//
// ANNAHME (noch gegen echtes Sheet zu verifizieren, siehe pruefeSpaltenzuordnung()):
// Tab-Name "Aufträge", Spaltenreihenfolge A–AS wie im Google-Sheet-Export vom
// 2026-08-19 (Kopie). Monatsspalte E enthält bereits pro Pufferzeile den deutschen
// (österreichischen) Monatsnamen — z.B. "August" — auch wenn die Zeile sonst leer
// ist. Deshalb muss KEINE "Gesamt [Monat]"-Blockgrenze gesucht werden: einfach die
// erste Zeile mit passendem Monat UND leerem Kundenname nehmen.
// ============================================================================

const DEEPCORE_SHEET_ID = '1dqUQ3TNXtFojx86DYWd6Sa4sInPCFpFUWrqf10g7JhY'; // ⚠️ AKTUELL NUR DIE TEST-KOPIE
const AUFTRAEGE_TAB_NAME = 'Aufträge';
const AUFTRAEGE_HEADER_ROW = 2; // zweite Header-Zeile enthält die eigentlichen Spaltentitel (Stk./Summe)

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

const GERMAN_MONTHS = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

function getAuftraegeSheet() {
  const ss = SpreadsheetApp.openById(DEEPCORE_SHEET_ID);
  const sheet = ss.getSheetByName(AUFTRAEGE_TAB_NAME);
  if (!sheet) throw new Error(`Tab "${AUFTRAEGE_TAB_NAME}" nicht gefunden — Tab-Namen prüfen (siehe pruefeSpaltenzuordnung()).`);
  return sheet;
}

/**
 * Findet die erste freie Pufferzeile für den übergebenen Monat (deutscher Name,
 * z.B. "August"). Frei = Monat passt UND Kundenname-Zelle ist leer.
 * @returns {number|null} 1-basierter Zeilenindex, oder null wenn keine freie Zeile mehr da ist.
 */
function findFreeRowForMonth(monatName) {
  const sheet = getAuftraegeSheet();
  const lastRow = sheet.getLastRow();
  const data = sheet.getRange(1, COL.KUNDENNAME, lastRow, COL.MONAT).getValues();

  for (let i = AUFTRAEGE_HEADER_ROW; i < data.length; i++) {
    const kundenname = data[i][COL.KUNDENNAME - 1];
    const monat = data[i][COL.MONAT - 1];
    if (monat === monatName && (!kundenname || String(kundenname).trim() === '')) {
      return i + 1; // 1-basiert
    }
  }
  return null;
}

/**
 * Befüllt eine gefundene Zeile mit den Auftragsdaten. Team/Projekt/Kaufart werden
 * NICHT angefasst (bleiben leer für manuelle Nacharbeit durch den Verkäufer).
 * @param {number} row 1-basierter Zeilenindex
 * @param {{kundenname, vkNetto, angebotsNr, cells, sonstigeKosten, notizenZusatz}} data
 */
function writeRowToDeepCore(row, data) {
  const sheet = getAuftraegeSheet();

  sheet.getRange(row, COL.KUNDENNAME).setValue(data.kundenname);
  sheet.getRange(row, COL.VK_NETTO).setValue(data.vkNetto);
  sheet.getRange(row, COL.ANGEBOTS_NR).setValue(data.angebotsNr);

  writeCategoryCell(sheet, row, 'module', data.cells.module, null);
  writeCategoryCell(sheet, row, 'dachart', data.cells.dachart, data.cells.dachart2);
  writeCategoryCell(sheet, row, 'wechselrichter', data.cells.wechselrichter, data.cells.wechselrichter2);
  writeCategoryCell(sheet, row, 'speicher', data.cells.speicher, null);
  writeCategoryCell(sheet, row, 'notstrom', data.cells.notstrom, null);
  writeCategoryCell(sheet, row, 'smartmeter', data.cells.smartmeter, null);
  writeCategoryCell(sheet, row, 'zubehoer', data.cells.zubehoer, data.cells.zubehoer2);

  if (data.sonstigeKosten) {
    sheet.getRange(row, COL.SONSTIGE_KOSTEN).setValue(data.sonstigeKosten);
  }

  const notizen = [];
  [data.cells.module, data.cells.dachart, data.cells.dachart2, data.cells.wechselrichter,
   data.cells.wechselrichter2, data.cells.speicher, data.cells.notstrom, data.cells.smartmeter,
   data.cells.zubehoer, data.cells.zubehoer2].forEach(c => { if (c && c.notiz) notizen.push(c.notiz); });
  notizen.push(...(data.notizenZusatz || []));

  if (notizen.length > 0) {
    sheet.getRange(row, COL.NOTIZEN).setValue(notizen.join(' | '));
  }
}

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

function writeCategoryCell(sheet, row, categoryKey, cell, cell2) {
  if (cell) {
    const cols = CATEGORY_COLS[categoryKey];
    sheet.getRange(row, cols.name).setValue(cell.name);
    sheet.getRange(row, cols.stk).setValue(cell.stk);
    sheet.getRange(row, cols.summe).setValue(cell.summe);
  }
  if (cell2) {
    const cols2 = CATEGORY_COLS[`${categoryKey}2`];
    if (cols2) {
      sheet.getRange(row, cols2.name).setValue(cell2.name);
      sheet.getRange(row, cols2.stk).setValue(cell2.stk);
      sheet.getRange(row, cols2.summe).setValue(cell2.summe);
    }
  }
}

/**
 * DEBUG/SETUP: Liest die beiden Header-Zeilen und loggt sie neben der erwarteten
 * Spalten-Zuordnung (COL). Vor dem ersten echten Lauf ausführen und manuell
 * vergleichen — Grundlage war ein Text-Export, keine Live-API-Prüfung.
 */
function pruefeSpaltenzuordnung() {
  const sheet = getAuftraegeSheet();
  const header1 = sheet.getRange(1, 1, 1, 45).getValues()[0];
  const header2 = sheet.getRange(2, 1, 1, 45).getValues()[0];

  Object.entries(COL).forEach(([key, col]) => {
    Logger.log(`Spalte ${col} (${key}): Header1="${header1[col - 1]}" Header2="${header2[col - 1]}"`);
  });
}
