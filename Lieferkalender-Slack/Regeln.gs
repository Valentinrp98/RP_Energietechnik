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

// OPTIONALE siebte Spalte, nachgeruestet am 21.09.2026 fuer die
// CT-Kundenerinnerung per WhatsApp. Steht absichtlich NICHT in REGEL_SPALTEN:
// spaltenIndex() wirft bei fehlenden Spalten, und dieses Projekt laeuft live im
// 15-Minuten-Trigger. Als Pflichtspalte haette sie Ernst zwischen clasp push
// und dem Anlegen der Spalte stillgelegt.
// Fehlt die Spalte, bleibt {walink} leer — nicht mehr und nicht weniger.
// Anlegen per ergaenzeWaSpalte() in Setup.gs.
const REGEL_SPALTE_WA = 'WA-Text';

function leseRegeln() {
  const blatt = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB_REGELN);
  if (!blatt) throw new Error('Tab "' + TAB_REGELN + '" fehlt im Sheet ' + SHEET_ID);

  const werte = blatt.getDataRange().getValues();
  if (werte.length < 2) {
    Logger.log('⚠️ Regeln-Tab enthaelt keine Zeilen — es wird nichts gemeldet.');
    return [];
  }

  const spalte = spaltenIndex(werte[0], REGEL_SPALTEN);
  // Weiche Suche: undefined heisst "Spalte gibt es nicht", nicht "Fehler".
  const waSpalte = spalteWennDa(werte[0], REGEL_SPALTE_WA);
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
    const waText = waSpalte === undefined ? '' : String(zeile[waSpalte] || '').trim();
    const tageRoh = zeile[spalte['Tage davor']];

    // Konfigurationsfehler werden laut, nicht still. Eine Regel, die wegen
    // eines Tippfehlers nie feuert, ist der schlimmere Fall — man verlaesst
    // sich auf eine Meldung, die dann nie kommt.
    // Pseudo-Felder kommen nicht aus einem Deal-Datumsfeld, sondern aus einer
    // eigenen Quelle (CT-Termin -> Activities, siehe CtTermine.gs).
    const istPseudo = !!PSEUDO_FELDER[feld];
    if (!TERMIN_FELDER[feld] && !istPseudo) {
      warnRegel(zeilenNr, 'unbekanntes Feld "' + feld + '". Erlaubt: ' +
        Object.keys(TERMIN_FELDER).concat(Object.keys(PSEUDO_FELDER)).join(', '));
      continue;
    }
    if (ERLAUBTE_EREIGNISSE.indexOf(ereignis) === -1) {
      warnRegel(zeilenNr, 'unbekanntes Ereignis "' + ereignis + '". Erlaubt: ' + ERLAUBTE_EREIGNISSE.join(', '));
      continue;
    }
    // Ein Pseudo-Feld hat keine Snapshot-Spalte und damit kein Gedaechtnis.
    // "gesetzt"/"verschoben"/"geloescht" wuerden dort dauerhaft falsch feuern —
    // deshalb hier laut abgelehnt statt still nie ausgeloest.
    if (istPseudo && PSEUDO_EREIGNISSE_ERLAUBT.indexOf(ereignis) === -1) {
      warnRegel(zeilenNr, 'Feld "' + feld + '" kennt kein Ereignis "' + ereignis +
        '" (kein Snapshot vorhanden). Erlaubt: ' + PSEUDO_EREIGNISSE_ERLAUBT.join(', '));
      continue;
    }
    if (!channel) {
      warnRegel(zeilenNr, 'Channel-ID fehlt.');
      continue;
    }
    // Der Channel-NAME funktioniert nicht. Rechtsklick auf den Channel ->
    // Link kopieren, die ID am Ende beginnt mit C (oder G bei privaten).
    // Zusaetzlich erlaubt: U... (User-ID) und D... (DM-Channel) — damit geht
    // eine Regel auch als Direktnachricht statt in einen Channel. Slack
    // oeffnet die DM bei chat.postMessage selbst, sobald channel eine User-ID
    // ist. Gebraucht fuer die Bonus-Meldung, die niemanden sonst angeht.
    if (!/^[CGDU][A-Z0-9]{6,}$/.test(channel)) {
      warnRegel(zeilenNr, 'Channel-ID "' + channel + '" sieht nicht wie eine Slack-ID aus (erwartet z.B. C08ABC123 oder U0BM9J0KPQT fuer eine DM).');
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
      vorlage: vorlage,
      waText: waText
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

// Wie spaltenIndex(), aber fuer EINE optionale Spalte: undefined statt Fehler.
function spalteWennDa(headerZeile, name) {
  for (let i = 0; i < headerZeile.length; i++) {
    if (String(headerZeile[i]).trim() === name) return i;
  }
  return undefined;
}

function jaWert(wert) {
  if (wert === true) return true;
  const s = String(wert).trim().toLowerCase();
  return s === 'ja' || s === 'j' || s === 'true' || s === 'x' || s === 'yes';
}
