// ============================================================
// SNAPSHOT — das Gedaechtnis, und gleichzeitig die Liefer-Uebersicht
// ============================================================
// Eine Zeile pro Deal. Ohne diese Zeilen kann das Script nur sehen, DASS ein
// Datum drinsteht — nicht, ob es gerade gesetzt oder verschoben wurde.
//
// Spalten:
//   Deal-ID | Kunde | PLZ | Montagepartner | Stage | Liefertermin |
//   DC-Termin | AC-Termin | IB-Termin | Zuletzt gesehen | Hinweis

const SNAPSHOT_SPALTEN = [
  'Deal-ID', 'Kunde', 'PLZ', 'Montagepartner', 'Stage',
  'Liefertermin', 'DC-Termin', 'AC-Termin', 'IB-Termin',
  'Zuletzt gesehen', 'Hinweis'
];

function leseSnapshot() {
  const blatt = holeOderLegeAn(TAB_SNAPSHOT, SNAPSHOT_SPALTEN);
  const werte = blatt.getDataRange().getValues();
  const map = {};
  if (werte.length < 2) return map;

  const spalte = spaltenIndex(werte[0], SNAPSHOT_SPALTEN);
  for (let z = 1; z < werte.length; z++) {
    const id = String(werte[z][spalte['Deal-ID']] || '').trim();
    if (!id) continue;
    map[id] = {
      'Liefertermin': alsDatumsText(werte[z][spalte['Liefertermin']]),
      'DC-Termin': alsDatumsText(werte[z][spalte['DC-Termin']]),
      'AC-Termin': alsDatumsText(werte[z][spalte['AC-Termin']]),
      'IB-Termin': alsDatumsText(werte[z][spalte['IB-Termin']])
    };
  }
  return map;
}

// Schreibt den Snapshot komplett neu. Deals, die im Sweep nicht mehr auftauchen,
// werden NICHT geloescht und NICHT als "Termin geloescht" gemeldet: getDeals
// liefert nur nicht-archivierte Deals, ein Verschwinden kann also Archivierung
// sein. Solche Zeilen bekommen einen Hinweis und bleiben stehen, damit ein
// Mensch entscheidet (Prinzip aus CLAUDE.md: mehrdeutige Daten entscheidbar
// machen, nicht raten).
function schreibeSnapshot(deals, plzMap, gesehenIds) {
  const blatt = holeOderLegeAn(TAB_SNAPSHOT, SNAPSHOT_SPALTEN);
  const altWerte = blatt.getDataRange().getValues();
  const heute = heuteAlsText();

  const zeilen = deals.map(function (deal) {
    return [
      deal.id,
      deal.title || '',
      plzText(deal, plzMap),
      leseMontagepartner(deal),
      deal.stage_id || '',
      leseTerminfeld(deal, 'Liefertermin'),
      leseTerminfeld(deal, 'DC-Termin'),
      leseTerminfeld(deal, 'AC-Termin'),
      leseTerminfeld(deal, 'IB-Termin'),
      heute,
      ''
    ];
  });

  // Verwaiste Zeilen aus dem alten Snapshot uebernehmen, mit Hinweis.
  if (altWerte.length > 1) {
    const spalte = spaltenIndex(altWerte[0], SNAPSHOT_SPALTEN);
    const hinweisIdx = SNAPSHOT_SPALTEN.indexOf('Hinweis');
    const gesehenIdx = SNAPSHOT_SPALTEN.indexOf('Zuletzt gesehen');
    for (let z = 1; z < altWerte.length; z++) {
      const id = String(altWerte[z][spalte['Deal-ID']] || '').trim();
      if (!id || gesehenIds[id]) continue;
      const kopie = SNAPSHOT_SPALTEN.map(function (name) { return altWerte[z][spalte[name]]; });
      kopie[hinweisIdx] = 'nicht mehr in Pipeline ' + PIPELINE_ID +
        ' (archiviert, verschoben oder geloescht?) — zuletzt gesehen ' + kopie[gesehenIdx];
      zeilen.push(kopie);
    }
  }

  blatt.clearContents();
  blatt.getRange(1, 1, 1, SNAPSHOT_SPALTEN.length).setValues([SNAPSHOT_SPALTEN]);
  if (zeilen.length) {
    blatt.getRange(2, 1, zeilen.length, SNAPSHOT_SPALTEN.length).setValues(zeilen);
  }
  blatt.setFrozenRows(1);
  Logger.log('Snapshot geschrieben: %s Zeilen (%s aktuelle Deals).', zeilen.length, deals.length);
}

// Die PLZ ist bei RP in BEIDEN Quellen unzuverlaessig und sie widersprechen
// sich teils (belegt: Deal 7177 und 6804, siehe
// docs/CHECK-Kette-PLZ-Bundesland-Montagepartner-2026-09-10.md, K1).
// Also nicht raten: bei Abweichung beide Werte zeigen.
function plzText(deal, plzMap) {
  const personId = deal.person_id;
  if (!personId || !plzMap[personId]) return '';
  const p = plzMap[personId];
  if (p.plzAdresse && p.plzFeld && p.plzAdresse !== p.plzFeld) {
    return p.plzAdresse + ' ⚠️ (PLZ-Feld: ' + p.plzFeld + ')';
  }
  return p.plzAdresse || p.plzFeld || '';
}

// Sheets liefert ein als Datum formatiertes Feld als Date-Objekt zurueck, nicht
// als String. Ohne diese Normalisierung wuerde jeder Lauf eine Abweichung
// sehen und jedes Mal "verschoben" melden — der klassische kaputte Diff.
function alsDatumsText(wert) {
  if (!wert) return '';
  if (Object.prototype.toString.call(wert) === '[object Date]') {
    return Utilities.formatDate(wert, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(wert).trim().slice(0, 10);
}

function heuteAlsText() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function holeOderLegeAn(tabName, spalten) {
  const datei = SpreadsheetApp.openById(SHEET_ID);
  let blatt = datei.getSheetByName(tabName);
  if (!blatt) {
    blatt = datei.insertSheet(tabName);
    blatt.getRange(1, 1, 1, spalten.length).setValues([spalten]);
    blatt.setFrozenRows(1);
    Logger.log('Tab "%s" neu angelegt.', tabName);
  }
  return blatt;
}
