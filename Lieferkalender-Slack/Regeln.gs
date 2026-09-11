// ============================================================
// REGELN — der Steuerungs-Tab
// ============================================================
// Spalten (Reihenfolge im Sheet egal, es wird nach HEADER-NAME gelesen —
// dieselbe Lehre wie bei den Partner-Sheets, wo 5 von 6 eine andere
// Spaltenreihenfolge haben):
//
//   Aktiv | Feld | Ereignis | Tage davor | Channel-ID | Vorlage
//
// Ereignis:
//   gesetzt     leer -> Datum
//   verschoben  Datum -> anderes Datum
//   geloescht   Datum -> leer
//   vorher      N Tage vor dem Termin   (braucht "Tage davor")
//   am Tag      am Termin selbst
//
// Mehrere Zeilen pro Feld sind erlaubt und der Normalfall. Eine Kadenz
// 14/7/2/0 Tage vorher sind vier Zeilen mit Ereignis "vorher".

const ERLAUBTE_EREIGNISSE = ['gesetzt', 'verschoben', 'geloescht', 'vorher', 'am Tag'];

const REGEL_SPALTEN = ['Aktiv', 'Feld', 'Ereignis', 'Tage davor', 'Channel-ID', 'Vorlage'];

function leseRegeln() {
  const blatt = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB_REGELN);
  if (!blatt) throw new Error('Tab "' + TAB_REGELN + '" fehlt im Sheet ' + SHEET_ID);

  const werte = blatt.getDataRange().getValues();
  if (werte.length < 2) {
    Logger.log('⚠️ Regeln-Tab enthaelt keine Zeilen — es wird nichts gemeldet.');
    return [];
  }

  const spalte = spaltenIndex(werte[0], REGEL_SPALTEN);
  const regeln = [];

  for (let z = 1; z < werte.length; z++) {
    const zeile = werte[z];
    const zeilenNr = z + 1;

    const feld = String(zeile[spalte['Feld']] || '').trim();
    if (!feld) continue; // Leerzeile

    if (!jaWert(zeile[spalte['Aktiv']])) continue; // bewusst deaktiviert

    const ereignis = String(zeile[spalte['Ereignis']] || '').trim();
    const channel = String(zeile[spalte['Channel-ID']] || '').trim();
    const vorlage = String(zeile[spalte['Vorlage']] || '').trim();
    const tageRoh = zeile[spalte['Tage davor']];

    // Konfigurationsfehler werden laut, nicht still. Eine Regel, die wegen
    // eines Tippfehlers nie feuert, ist der schlimmere Fall — man verlaesst
    // sich auf eine Meldung, die dann nie kommt.
    if (!TERMIN_FELDER[feld]) {
      warnRegel(zeilenNr, 'unbekanntes Feld "' + feld + '". Erlaubt: ' + Object.keys(TERMIN_FELDER).join(', '));
      continue;
    }
    if (ERLAUBTE_EREIGNISSE.indexOf(ereignis) === -1) {
      warnRegel(zeilenNr, 'unbekanntes Ereignis "' + ereignis + '". Erlaubt: ' + ERLAUBTE_EREIGNISSE.join(', '));
      continue;
    }
    if (!channel) {
      warnRegel(zeilenNr, 'Channel-ID fehlt.');
      continue;
    }
    // Der Channel-NAME funktioniert nicht. Rechtsklick auf den Channel ->
    // Link kopieren, die ID am Ende beginnt mit C (oder G bei privaten).
    if (!/^[CG][A-Z0-9]{6,}$/.test(channel)) {
      warnRegel(zeilenNr, 'Channel-ID "' + channel + '" sieht nicht wie eine Slack-ID aus (erwartet z.B. C08ABC123).');
      continue;
    }
    if (!vorlage) {
      warnRegel(zeilenNr, 'Vorlage (Text) fehlt.');
      continue;
    }

    let tage = null;
    if (ereignis === 'vorher') {
      tage = Number(tageRoh);
      if (String(tageRoh).trim() === '' || !isFinite(tage) || tage < 0) {
        warnRegel(zeilenNr, 'Ereignis "vorher" braucht eine Zahl in "Tage davor" (gefunden: "' + tageRoh + '").');
        continue;
      }
      tage = Math.round(tage);
    } else if (ereignis === 'am Tag') {
      tage = 0;
    }

    regeln.push({
      zeile: zeilenNr,
      feld: feld,
      ereignis: ereignis,
      tage: tage,
      channel: channel,
      vorlage: vorlage
    });
  }

  Logger.log('%s aktive Regeln gelesen.', regeln.length);
  return regeln;
}

function warnRegel(zeilenNr, text) {
  Logger.log('⚠️ Regeln-Tab Zeile %s uebersprungen: %s', zeilenNr, text);
}

// Header nach NAME suchen, nicht nach Position — die Partner-Sheets haben
// gezeigt, wohin Positionsannahmen fuehren.
function spaltenIndex(headerZeile, erwartet) {
  const map = {};
  headerZeile.forEach(function (wert, i) {
    map[String(wert).trim()] = i;
  });
  const fehlend = erwartet.filter(function (name) { return map[name] === undefined; });
  if (fehlend.length) {
    throw new Error('Im Tab fehlen die Spalten: ' + fehlend.join(', ') + '. Gefunden: ' + headerZeile.join(' | '));
  }
  return map;
}

function jaWert(wert) {
  if (wert === true) return true;
  const s = String(wert).trim().toLowerCase();
  return s === 'ja' || s === 'j' || s === 'true' || s === 'x' || s === 'yes';
}
