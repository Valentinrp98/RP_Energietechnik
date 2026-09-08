// ============================================================
// ÜBERSICHT — alle Geburtstage in einem Sheet
// ============================================================
// Zweck: ein Blick statt Profil-für-Profil-Klicken. Zeigt pro Workspace-Mitglied das
// Geburtsdatum, wann es zum ersten Mal erfasst wurde und wer noch fehlt.
//
// "Erstmals erfasst" kann NICHT von Slack kommen -- Slack liefert keinen Zeitstempel,
// wann ein Profilfeld gefüllt wurde. Der Wert ist deshalb der Tag, an dem dieses Skript
// das Datum zum ersten Mal gesehen hat, und wird danach nie mehr überschrieben.
//
// Wird am Ende von syncGeburtstage() automatisch mitgezogen (siehe CalendarSync.gs) und
// kann jederzeit per aktualisiereUebersicht() von Hand angestoßen werden.

// Leer lassen, bis legeUebersichtSheetAn() einmal gelaufen ist -- dann hier eintragen.
// ⚠️ Bewusst KEINE Selbst-Anlage aus aktualisiereUebersicht() heraus: die Funktion läuft
// täglich mit, das hätte jeden Tag ein neues Sheet erzeugt (genau der Fehler, der beim
// Kalender am 05.09.2026 gefixt wurde).
const UEBERSICHT_SHEET_ID = '';

const UEBERSICHT_TAB_NAME = 'Geburtstage';
const UEBERSICHT_HEADER = [
  'Name', 'Slack-ID', 'Geburtstag', 'Erstmals erfasst', 'Zuletzt gesehen', 'Status'
];

// Einmalig manuell ausführen, danach die geloggte ID oben eintragen.
function legeUebersichtSheetAn() {
  if (UEBERSICHT_SHEET_ID) {
    Logger.log('UEBERSICHT_SHEET_ID ist bereits gesetzt (%s) — es wird kein zweites Sheet angelegt.', UEBERSICHT_SHEET_ID);
    return;
  }
  const sheet = SpreadsheetApp.create('Geburtstage RP — Übersicht');
  const tab = sheet.getActiveSheet();
  tab.setName(UEBERSICHT_TAB_NAME);
  tab.getRange(1, 1, 1, UEBERSICHT_HEADER.length).setValues([UEBERSICHT_HEADER]);
  tab.setFrozenRows(1);
  tab.getRange(1, 1, 1, UEBERSICHT_HEADER.length).setFontWeight('bold');

  Logger.log('Neues Übersicht-Sheet angelegt: %s', sheet.getUrl());
  Logger.log('>>> UEBERSICHT_SHEET_ID in Uebersicht.gs eintragen: %s', sheet.getId());
}

// mitarbeiterOptional: wird von syncGeburtstage() mitgegeben, damit die Slack-Abfrage nicht
// doppelt läuft. Von Hand im Editor ohne Parameter aufrufbar -- dann holt sie sich die Daten selbst.
function aktualisiereUebersicht(mitarbeiterOptional) {
  if (!UEBERSICHT_SHEET_ID) {
    Logger.log('UEBERSICHT_SHEET_ID ist leer — einmalig legeUebersichtSheetAn() ausführen und die geloggte ID eintragen. Übersicht wird übersprungen.');
    return;
  }

  const tab = holeUebersichtTab();
  const heute = Utilities.formatDate(new Date(), 'Europe/Vienna', 'yyyy-MM-dd');
  const bisher = leseBestehendeZeilen(tab);
  const mitarbeiter = mitarbeiterOptional || holeMitarbeiterGeburtstage();

  const zeilen = mitarbeiter.map(function (person) {
    const alt = bisher[person.userId] || {};
    const datumText = person.geburtstag
      ? padZahl(person.geburtstag.tag) + '.' + padZahl(person.geburtstag.monat) + '.'
      : '';

    // Erstmals-erfasst nur setzen, wenn ein Datum da ist und noch nichts gespeichert war --
    // danach bleibt der Wert für immer stehen, auch wenn jemand sein Datum später ändert.
    let erstmals = alt.erstmals || '';
    if (person.geburtstag && !erstmals) erstmals = heute;

    return [
      person.name,
      person.userId,
      datumText,
      erstmals,
      heute,
      person.geburtstag ? '✓ eingetragen' : '— fehlt noch'
    ];
  });

  // Sortiert nach Monat/Tag, damit die Liste als Jahresüberblick lesbar ist; wer nichts
  // eingetragen hat, rutscht nach unten.
  zeilen.sort(function (a, b) {
    if (!a[2]) return 1;
    if (!b[2]) return -1;
    return sortierSchluessel(a[2]) - sortierSchluessel(b[2]);
  });

  if (tab.getLastRow() > 1) {
    tab.getRange(2, 1, tab.getLastRow() - 1, UEBERSICHT_HEADER.length).clearContent();
  }
  if (zeilen.length) {
    tab.getRange(2, 1, zeilen.length, UEBERSICHT_HEADER.length).setValues(zeilen);
  }
  tab.autoResizeColumns(1, UEBERSICHT_HEADER.length);

  const fehlen = zeilen.filter(function (z) { return !z[2]; }).length;
  Logger.log('Übersicht aktualisiert: %s Mitglieder, davon %s ohne Geburtsdatum.',
    String(zeilen.length), String(fehlen));
}

function holeUebersichtTab() {
  const spreadsheet = SpreadsheetApp.openById(UEBERSICHT_SHEET_ID);
  let tab = spreadsheet.getSheetByName(UEBERSICHT_TAB_NAME);
  if (!tab) {
    tab = spreadsheet.insertSheet(UEBERSICHT_TAB_NAME);
    tab.getRange(1, 1, 1, UEBERSICHT_HEADER.length).setValues([UEBERSICHT_HEADER]);
    tab.setFrozenRows(1);
  }
  return tab;
}

// Bestehende Zeilen nach Slack-ID indizieren, damit "Erstmals erfasst" erhalten bleibt.
function leseBestehendeZeilen(tab) {
  const index = {};
  if (tab.getLastRow() < 2) return index;

  const werte = tab.getRange(2, 1, tab.getLastRow() - 1, UEBERSICHT_HEADER.length).getValues();
  werte.forEach(function (zeile) {
    const slackId = String(zeile[1] || '').trim();
    if (slackId) {
      index[slackId] = { erstmals: zeile[3] ? formatiereZellDatum(zeile[3]) : '' };
    }
  });
  return index;
}

// Die Zelle kann als Text ODER als echtes Datum zurückkommen (Sheets erkennt Datumsformate
// selbstständig) -- beides auf yyyy-MM-dd normalisieren, sonst wandert der Wert bei jedem
// Lauf durch verschiedene Schreibweisen.
function formatiereZellDatum(wert) {
  if (Object.prototype.toString.call(wert) === '[object Date]') {
    return Utilities.formatDate(wert, 'Europe/Vienna', 'yyyy-MM-dd');
  }
  return String(wert).trim();
}

function sortierSchluessel(datumText) {
  const teile = datumText.split('.');
  return Number(teile[1]) * 100 + Number(teile[0]);
}

function padZahl(n) {
  return String(n).padStart(2, '0');
}
