// ============================================================
// PHASE 1 — Namensabgleich (NUR LESEN, keine Schreibvorgänge)
// ============================================================
// Sucht pro Namen aus NAMEN_LISTE per Volltextsuche nach Deals,
// prüft ob genau ein plausibler Treffer existiert und ob dessen
// Status "won" ist. Ergebnis geht NUR in ein Log-Sheet — nichts
// wird in Pipedrive verändert. Rät bei Unklarheit nicht, sondern
// markiert den Fall zur manuellen Entscheidung.

const NAMENSABGLEICH_LOG_SHEET_PROP = 'NAMENSABGLEICH_LOG_SHEET_ID';

function normalisiereName(s) {
  return (s || '').toString().trim().toLowerCase()
    .replace(/\s+/g, ' ');
}

// Testet EINEN festen Namen und loggt die Rohantwort — vor dem Vollauf einmal ausführen,
// um das Response-Format zu verifizieren (kein Parameter, da der ▷-Button ohne Argumente aufruft).
const TEST_NAME = 'Ralph Hemetinger';
function testEinzelnerName() {
  const result = fetchPipedrive('/deals/search?term=' + encodeURIComponent(TEST_NAME) + '&fields=title&limit=10');
  Logger.log(JSON.stringify(result, null, 2));
}

function sucheDealsFuerName(name) {
  const result = fetchPipedrive('/deals/search?term=' + encodeURIComponent(name) + '&fields=title&limit=10');
  const items = (result.data && result.data.items) || [];
  return items.map(it => it.item).filter(Boolean);
}

function bewerteTreffer(name, deals) {
  const normName = normalisiereName(name);
  const treffer = deals.filter(d => normalisiereName(d.title).indexOf(normName) !== -1
    || normName.indexOf(normalisiereName(d.title)) !== -1);

  if (treffer.length === 0) {
    return { kategorie: 'NICHT_GEFUNDEN', dealId: '', dealTitel: '', status: '', hinweis: 'Kein Deal-Titel enthält den Namen — manuell suchen' };
  }
  if (treffer.length > 1) {
    return {
      kategorie: 'MEHRDEUTIG', dealId: '', dealTitel: treffer.map(d => d.id + ':' + d.title).join(' | '),
      status: '', hinweis: treffer.length + ' Kandidaten — manuell auswählen'
    };
  }

  const deal = treffer[0];
  if (deal.status === 'won') {
    return { kategorie: 'WON', dealId: deal.id, dealTitel: deal.title, status: deal.status, hinweis: 'Kandidat zum Verschieben' };
  }
  return {
    kategorie: 'FEHLER_STATUS', dealId: deal.id, dealTitel: deal.title, status: deal.status,
    hinweis: 'Status ist "' + deal.status + '", nicht "won" — prüfen bevor verschoben wird'
  };
}

function getOderErstelleLogSheet() {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty(NAMENSABGLEICH_LOG_SHEET_PROP);
  let sheet;
  if (sheetId) {
    try {
      sheet = SpreadsheetApp.openById(sheetId);
      return sheet;
    } catch (e) {
      // ID war ungültig, neu anlegen
    }
  }
  sheet = SpreadsheetApp.create('LOG_Namensabgleich Fulfillment-Übernahme');
  props.setProperty(NAMENSABGLEICH_LOG_SHEET_PROP, sheet.getId());
  const tab = sheet.getSheets()[0];
  tab.setName('Log');
  tab.appendRow(['Zeitstempel', 'Name (Liste)', 'Verantwortlich', 'Kategorie', 'Deal-ID', 'Deal-Titel', 'Status', 'Hinweis']);
  Logger.log('Neues Log-Sheet angelegt: ' + sheet.getUrl());
  return sheet;
}

function starteNamensabgleich() {
  const sheet = getOderErstelleLogSheet();
  const tab = sheet.getSheetByName('Log') || sheet.getSheets()[0];

  // Duplikate in der Liste selbst erkennen (z. B. Hidir Özdek war 2x in der Rohliste)
  const gesehen = {};
  const zeilen = [];
  const jetzt = new Date();

  NAMEN_LISTE.forEach(eintrag => {
    const key = normalisiereName(eintrag.name);
    if (gesehen[key]) {
      zeilen.push([jetzt, eintrag.name, eintrag.verantwortlich, 'DUPLIKAT_IN_LISTE', '', '', '', 'Name stand mehrfach in der Ursprungsliste']);
      return;
    }
    gesehen[key] = true;

    let bewertung;
    try {
      const deals = sucheDealsFuerName(eintrag.name);
      bewertung = bewerteTreffer(eintrag.name, deals);
    } catch (e) {
      bewertung = { kategorie: 'HARD_ERROR', dealId: '', dealTitel: '', status: '', hinweis: e.message };
    }

    zeilen.push([jetzt, eintrag.name, eintrag.verantwortlich, bewertung.kategorie,
      bewertung.dealId, bewertung.dealTitel, bewertung.status, bewertung.hinweis]);
  });

  tab.getRange(tab.getLastRow() + 1, 1, zeilen.length, zeilen[0].length).setValues(zeilen);

  const zusammenfassung = zeilen.reduce((acc, z) => {
    acc[z[3]] = (acc[z[3]] || 0) + 1;
    return acc;
  }, {});
  Logger.log('Fertig. %s Namen verarbeitet. %s', zeilen.length, JSON.stringify(zusammenfassung));
  Logger.log('Log-Sheet: ' + sheet.getUrl());
}
