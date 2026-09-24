// ============================================================
// SETUP — einmalig ausfuehren, prueft und legt an
// ============================================================
// Reihenfolge:
//   1. legeSheetAnUndZeigeId()   (nur wenn noch kein Sheet existiert)
//   2. SHEET_ID in Config.gs eintragen
//   3. befuelleRegelnMitStartwerten()  -> legt die Regel-Zeilen an
//   4. Channel-IDs im Regeln-Tab eintragen
//   5. pruefeKonfiguration()     -> prueft alles, legt nichts an
//   6. testePost()               -> eine Nachricht mit Platzhalterdaten
//   7. sweep() mit DRY_RUN=true und SNAPSHOT_INITIALISIEREN=true
//   8. SNAPSHOT_INITIALISIEREN=false, DRY_RUN=false, installiereTrigger()

function legeSheetAnUndZeigeId() {
  const datei = SpreadsheetApp.create('Lieferkalender RP — Snapshot + Regeln');
  // Das Standard-Blatt "Tabellenblatt1" wegwerfen, die Tabs legt der Code an.
  holeOderLegeAnIn(datei, TAB_SNAPSHOT, SNAPSHOT_SPALTEN);
  holeOderLegeAnIn(datei, TAB_REGELN, REGEL_SPALTEN);
  holeOderLegeAnIn(datei, TAB_LOG, LOG_SPALTEN);
  const standard = datei.getSheetByName('Tabellenblatt1') || datei.getSheetByName('Sheet1');
  if (standard) datei.deleteSheet(standard);

  Logger.log('Sheet angelegt.');
  Logger.log('SHEET_ID = %s', datei.getId());
  Logger.log('URL: %s', datei.getUrl());
  Logger.log('>>> Diese ID jetzt in Config.gs bei SHEET_ID eintragen.');
}

function holeOderLegeAnIn(datei, tabName, spalten) {
  let blatt = datei.getSheetByName(tabName);
  if (!blatt) blatt = datei.insertSheet(tabName);
  blatt.getRange(1, 1, 1, spalten.length).setValues([spalten]);
  blatt.setFrozenRows(1);
  return blatt;
}

// Die von Valentin am 10.09.2026 festgelegten Regeln:
//   Liefertermin: gesetzt, verschoben, 1 Tag vorher, am Tag
//   DC / AC / IB: gesetzt, 2 Tage vorher, am Tag
// Die Texte sind Platzhalter-Formulierungen — Valentin schreibt sie um, dafuer
// ist der Tab da. Channel-ID muss noch eingesetzt werden (Spalte bleibt leer,
// solche Zeilen werden mit Warnung uebersprungen, nicht still ignoriert).
function befuelleRegelnMitStartwerten() {
  const blatt0 = holeOderLegeAn(TAB_REGELN, REGEL_SPALTEN);
  if (blatt0.getLastRow() > 1) {
    Logger.log('⚠️ Regeln-Tab enthaelt schon %s Zeilen — es wird NICHTS ueberschrieben. Bei Bedarf manuell leeren.', blatt0.getLastRow() - 1);
    Logger.log('   -> Nur die Texte auffrischen: setzeVorlagenNeu()');
    Logger.log('   -> Nur neue Regeln nachziehen: ergaenzeWaSpalte() + ergaenzeFehlendeRegeln()');
    return;
  }

  // Die WA-Spalte muss vor dem Schreiben existieren, sonst haette die
  // CT-Regel keinen Platz fuer den Kundentext.
  ergaenzeWaSpalte();

  const spaltenNamen = regelSpaltenAlle();
  // Zeilen mit nur 6 Werten auf die volle Breite auffuellen — setValues()
  // bricht bei unterschiedlich langen Zeilen ab.
  const zeilen = startRegeln().map(function (z) {
    const reihe = z.slice();
    while (reihe.length < spaltenNamen.length) reihe.push('');
    return reihe;
  });

  const blatt = holeOderLegeAn(TAB_REGELN, REGEL_SPALTEN);
  blatt.getRange(2, 1, zeilen.length, spaltenNamen.length).setValues(zeilen);
  Logger.log('%s Regel-Zeilen angelegt. Jetzt die Channel-ID(s) in Spalte "Channel-ID" eintragen.', zeilen.length);
}

// Ueberschreibt NUR die Spalte "Vorlage", passend zu Feld+Ereignis+Tage.
// Aktiv-Schalter, Channel-IDs und selbst angelegte Zusatzzeilen bleiben stehen.
// Die alten Texte wandern vorher ins Log — wer eigene Formulierungen drin
// hatte, holt sie von dort zurueck, statt sie zu verlieren.
function setzeVorlagenNeu() {
  // Der CHANNEL gehoert in den Schluessel. "Liefertermin / am Tag" gibt es
  // zweimal — einmal nach #ernst-knows, einmal als Bonus-DM. Ohne den Channel
  // im Schluessel wuerde diese Funktion der DM den Channel-Text verpassen.
  const vorgabe = {};
  startRegeln().forEach(function (z) {
    vorgabe[regelSchluessel(z[1], z[2], z[3], z[4])] = z[5];
  });

  const blatt = holeOderLegeAn(TAB_REGELN, REGEL_SPALTEN);
  const werte = blatt.getDataRange().getValues();
  if (werte.length < 2) {
    Logger.log('Regeln-Tab ist leer. Erst befuelleRegelnMitStartwerten() laufen lassen.');
    return;
  }
  const spalte = spaltenIndex(werte[0], REGEL_SPALTEN);
  let geaendert = 0;

  for (let z = 1; z < werte.length; z++) {
    const feld = String(werte[z][spalte['Feld']] || '').trim();
    const ereignis = String(werte[z][spalte['Ereignis']] || '').trim();
    const tage = String(werte[z][spalte['Tage davor']] || '').trim().replace(/\.0$/, '');
    const channel = String(werte[z][spalte['Channel-ID']] || '').trim();
    const neu = vorgabe[regelSchluessel(feld, ereignis, tage, channel)];
    if (!neu) {
      Logger.log('— Zeile %s (%s/%s) hat keine Vorgabe, bleibt unveraendert.', z + 1, feld, ereignis);
      continue;
    }
    const alt = String(werte[z][spalte['Vorlage']] || '');
    if (alt === neu) continue;
    Logger.log('Zeile %s (%s/%s)\n  ALT: %s\n  NEU: %s', z + 1, feld, ereignis, alt, neu);
    blatt.getRange(z + 1, spalte['Vorlage'] + 1).setValue(neu);
    geaendert++;
  }
  Logger.log('%s Vorlagen aktualisiert. Die ALT-Texte oben stehen im Log, falls du sie zurueck willst.', geaendert);
}

function startRegeln() {
  // #ernst-knows, von Valentin am 11.09.2026 angelegt.
  // Channel-ID, NICHT der Name — Umbenennen bricht sonst alles.
  const CH = 'C0C0Q6JML23';
  // Ziel der Bonus-Meldung: Valentins User-ID. Slack oeffnet die DM selbst.
  const DM = VALENTIN_USER_ID;
  // Slack-Formatierung, die hier benutzt wird (mrkdwn, kein Markdown):
  //   *fett*           — EIN Stern, nicht zwei. **so** bleibt sichtbar stehen.
  //   _kursiv_         — Unterstrich
  //   `code`           — Backtick
  //   <url|Beschriftung>  — Link mit Text statt nackter URL
  //   \n               — Zeilenumbruch (wird in baueText() aufgeloest)
  // Der Link steht bewusst in <…|…>: die nackte URL ist 50 Zeichen Rauschen,
  // und unfurl_links ist aus, es gibt also sowieso keine Vorschaukarte.
  // '\\n' im Code ist ein echter Backslash plus n in der Sheet-Zelle — genau
  // das, was Valentin beim Umschreiben auch tippt.
  const L = '\\n<{deallink}|Deal {dealId} öffnen>';
  const Z = '\\n{kunde} · {plz} · {partner}';

  // Ein Symbol pro EREIGNISKLASSE, nicht pro Terminart (Vorgabe Valentin,
  // 11.09.2026). Beim Ueberfliegen des Channels zaehlt die Frage "muss ich
  // reagieren?" — und die haengt am Ereignis, nicht daran, ob es DC oder AC
  // war. Die Terminart steht ohnehin im Fettext daneben.
  const FIX  = '✅';   // gesetzt   — fixiert, nichts zu tun
  const VERS = '↪️';   // verschoben — Termin wandert, Koordination noetig
  const WEG  = '🗑️';   // geloescht  — selten, muss auffallen
  const ERIN = '➡️';   // vorher + am Tag — reine Erinnerung, keine Aenderung

  const zeilen = [
    ['ja', 'Liefertermin', 'gesetzt',    '',  CH, FIX + ' *Liefertermin fix* — {datum}' + Z + L],
    ['ja', 'Liefertermin', 'verschoben', '',  CH, VERS + ' *Liefertermin verschoben* — {altdatum} → {neudatum}' + Z + L],
    ['ja', 'Liefertermin', 'geloescht',  '',  CH, WEG + ' *Liefertermin gelöscht* — war {altdatum}' + Z + L],
    ['ja', 'Liefertermin', 'vorher',     1,   CH, ERIN + ' *Morgen Lieferung* — {datum}' + Z + L],
    ['ja', 'Liefertermin', 'am Tag',     '',  CH, ERIN + ' *HEUTE Lieferung*' + Z + L],

    // Dieselbe Bedingung, anderer Empfaenger: als DM an Valentin, mit der
    // Praemie dazu. Bewusst NICHT in #ernst-knows — was Valentin pro Lieferung
    // verdient, ist keine Team-Information.
    // Warum "am Tag" und nicht der Meilenstein "Geliefert" (Erledigt-Option
    // 228): der ist am 16.09.2026 bei 0 von 485 gewonnenen Deals gesetzt, also
    // als Ausloeser wertlos. Der Liefertermin ist der einzige gepflegte Marker.
    // Heisst auch: gemeldet wird der GEPLANTE Tag, nicht die bestaetigte
    // Lieferung. Wird der Termin danach verschoben, ist die Meldung schon raus.
    ['ja', 'Liefertermin', 'am Tag',     '',  DM, '💰 *Lieferung heute — Bonus +{bonus_brutto}* · {bonus_netto}' + Z + L],

    ['ja', 'DC-Termin', 'gesetzt', '', CH, FIX + ' *DC-Termin fix* — {datum}' + Z + L],
    ['ja', 'DC-Termin', 'vorher',  2,  CH, ERIN + ' *DC-Montage in {tage} Tagen* — {datum}' + Z + L],
    ['ja', 'DC-Termin', 'am Tag',  '', CH, ERIN + ' *HEUTE DC-Montage*' + Z + L],

    ['ja', 'AC-Termin', 'gesetzt', '', CH, FIX + ' *AC-Termin fix* — {datum}' + Z + L],
    ['ja', 'AC-Termin', 'vorher',  2,  CH, ERIN + ' *AC-Montage in {tage} Tagen* — {datum}' + Z + L],
    ['ja', 'AC-Termin', 'am Tag',  '', CH, ERIN + ' *HEUTE AC-Montage*' + Z + L],

    ['ja', 'IB-Termin', 'gesetzt', '', CH, FIX + ' *IB-Termin fix* — {datum}' + Z + L],
    ['ja', 'IB-Termin', 'vorher',  2,  CH, ERIN + ' *Inbetriebnahme in {tage} Tagen* — {datum}' + Z + L],
    ['ja', 'IB-Termin', 'am Tag',  '', CH, ERIN + ' *HEUTE Inbetriebnahme*' + Z + L]
  ];

  // ---- CT-Kundenerinnerung ("Weg A", 21.09.2026) ----
  // Siebtes Element pro Zeile: der WA-Text. Den bekommt der KUNDE, die Vorlage
  // daneben bekommt Slack. Zwei Texte, zwei Empfaenger, eine Regel.
  //
  // Ziel ist Valentins DM und NICHT #ernst-knows: im wa.me-Link steckt die
  // Telefonnummer des Kunden im Klartext, die gehoert nicht in einen Channel,
  // den das halbe Team liest.
  //
  // BEIDE Erinnerungen sind scharf (Entscheidung 21.09.2026): am Vortag und am
  // Tag des Termins. Der Kunde bekommt also zwei Nachrichten — gewollt, weil
  // jede einzeln ein menschlicher Klick ist und niemand versehentlich sendet.
  // Die zwei Regeln blockieren sich nicht: das Ereignis steckt im
  // Doppelpost-Schluessel, "vorher" und "am Tag" sind verschiedene Schluessel.
  //
  // Der Kundentext nennt bewusst NICHT "Cash Collection". Fuer den Kunden ist
  // das schlicht sein Termin.
  // {um} statt {uhrzeit}: fehlt die Uhrzeit am Termin, verschwindet die
  // Wendung ganz, statt "um Uhr" zu schreiben. Gleiches Prinzip beim
  // Absender — ohne CC-Namen bleibt nur "RP Energietechnik" stehen.
  // Der Termin STEHT — kein "falls es nicht passt". Eine Erinnerung, die zum
  // Absagen einlaedt, produziert Absagen. Bestaetigen statt rueckfragen, und
  // die Vorfreude gehoert dazu.
  //
  // Signatur = Firma, nicht {cc} (Entscheidung 21.09.2026). Die DM geht immer
  // an Valentin, abgeschickt wird also aus SEINER Nummer — eine Unterschrift
  // mit dem Namen des Cash Collectors passt dann nicht zum Absender. {cc}
  // bleibt in der Slack-Vorlage, dort ist "wer ist zustaendig" genau richtig.
  const SIG = '\\nBeste Grüße\\nIhr Team von RP Energietechnik';
  const WA = 'Guten Tag {vorname} {nachname}, kurze Erinnerung: unser Termin morgen ' +
             '({datum}) {um} steht. Wir freuen uns auf Sie!' + SIG;
  const WA_HEUTE = 'Guten Tag {vorname} {nachname}, kurze Erinnerung: unser Termin heute ' +
             '{um} steht. Wir freuen uns auf Sie!' + SIG;

  // Ein Klick auf den Link oeffnet WhatsApp Desktop mit dem fertigen Text.
  const WA_L = '\\n<{walink}|📲 WhatsApp-Erinnerung öffnen> · <{deallink}|Deal {dealId}>';

  zeilen.push(
    ['ja',   'CT-Termin', 'vorher', 1,  DM,
     ERIN + ' *CT morgen* — {datum} {um}\\n{kunde} · {plz} · CC: {cc}' + WA_L, WA],
    ['ja',   'CT-Termin', 'am Tag', '', DM,
     ERIN + ' *CT heute* — {um}\\n{kunde} · {plz} · CC: {cc}' + WA_L, WA_HEUTE]
  );

  return zeilen;
}

// Zieht die CT-Zeilen im Regeln-Tab auf die aktuellen Startwerte nach:
// Aktiv-Flag, Slack-Vorlage und Kundentext. Gedacht fuer den Fall "die Zeile
// steht schon im Tab, aber die Texte haben sich geaendert" —
// ergaenzeFehlendeRegeln() laesst vorhandene Zeilen bewusst in Ruhe.
//
// ACHTUNG: das ueberschreibt Texte, die im Sheet von Hand angepasst wurden.
// Deshalb wird jede Aenderung mit Vorher/Nachher ins Log geschrieben, und
// unveraenderte Zellen werden nicht angefasst.
function aktualisiereCtRegeln() {
  const blatt = holeOderLegeAn(TAB_REGELN, REGEL_SPALTEN);
  const werte = blatt.getDataRange().getValues();
  if (werte.length < 2) {
    Logger.log('Regeln-Tab ist leer. Erst befuelleRegelnMitStartwerten() laufen lassen.');
    return;
  }
  const spalte = spaltenIndex(werte[0], REGEL_SPALTEN);
  const waIdx = spalteWennDa(werte[0], REGEL_SPALTE_WA);
  if (waIdx === undefined) {
    Logger.log('⚠️ Spalte "%s" fehlt — erst ergaenzeWaSpalte() laufen lassen.', REGEL_SPALTE_WA);
    return;
  }

  // Nur die CT-Zeilen, und nur die drei Spalten, die Texte/Schalter tragen.
  // Feld, Ereignis, Tage und Channel bleiben unberuehrt — die bilden den
  // Schluessel, ueber den zugeordnet wird.
  const soll = {};
  startRegeln().forEach(function (z) {
    if (z[1] !== CT_PSEUDO_FELD) return;
    soll[regelSchluessel(z[1], z[2], z[3], z[4])] = z;
  });

  let geaendert = 0;
  for (let z = 1; z < werte.length; z++) {
    const feld = String(werte[z][spalte['Feld']] || '').trim();
    if (feld !== CT_PSEUDO_FELD) continue;
    const key = regelSchluessel(
      feld,
      werte[z][spalte['Ereignis']],
      werte[z][spalte['Tage davor']],
      werte[z][spalte['Channel-ID']]
    );
    const start = soll[key];
    if (!start) {
      Logger.log('… Zeile %s (%s / %s) kennt startRegeln() nicht — von Hand angelegt, bleibt unberuehrt.',
        z + 1, feld, werte[z][spalte['Ereignis']]);
      continue;
    }

    [{ idx: spalte['Aktiv'], wert: start[0], name: 'Aktiv' },
     { idx: spalte['Vorlage'], wert: start[5], name: 'Vorlage' },
     { idx: waIdx, wert: start[6], name: REGEL_SPALTE_WA }].forEach(function (s) {
      if (s.idx === undefined || s.wert === undefined) return;
      if (String(werte[z][s.idx]) === String(s.wert)) return;
      blatt.getRange(z + 1, s.idx + 1).setValue(s.wert);
      Logger.log('~ Zeile %s, %s: "%s" -> "%s"', z + 1, s.name, werte[z][s.idx], s.wert);
      geaendert++;
    });
  }

  Logger.log(geaendert ? '%s Zelle(n) angeglichen. Gegenpruefen: testeCtLauf()'
                       : 'Nichts zu tun — die CT-Zeilen sind auf Stand.', geaendert);
}

// Alle Spalten, die startRegeln() befuellen kann — die siebte ist optional und
// wird nur beschrieben, wenn es sie im Sheet gibt.
function regelSpaltenAlle() {
  return REGEL_SPALTEN.concat([REGEL_SPALTE_WA]);
}

// Legt die optionale Spalte "WA-Text" im Regeln-Tab an, falls sie fehlt.
// Idempotent. Muss EINMAL laufen, bevor die CT-Regeln einen wa.me-Link
// erzeugen koennen — ohne die Spalte bleibt {walink} leer und die Meldung sagt
// das auch ("keine WhatsApp-Nummer" waere irrefuehrend, deshalb warnt
// pruefeKonfiguration() zusaetzlich).
function ergaenzeWaSpalte() {
  const blatt = holeOderLegeAn(TAB_REGELN, REGEL_SPALTEN);
  const header = blatt.getRange(1, 1, 1, Math.max(blatt.getLastColumn(), 1)).getValues()[0];
  for (let i = 0; i < header.length; i++) {
    if (String(header[i]).trim() === REGEL_SPALTE_WA) {
      Logger.log('Spalte "%s" ist schon da (Spalte %s). Nichts zu tun.', REGEL_SPALTE_WA, i + 1);
      return;
    }
  }
  const neu = header.length + 1;
  blatt.getRange(1, neu).setValue(REGEL_SPALTE_WA);
  blatt.setColumnWidth(neu, 420);
  Logger.log('✅ Spalte "%s" als Spalte %s angelegt. Jetzt ergaenzeFehlendeRegeln() laufen lassen.',
    REGEL_SPALTE_WA, neu);
}

function regelSchluessel(feld, ereignis, tage, channel) {
  const t = (tage === '' || tage === null || tage === undefined) ? '' : String(tage).trim().replace(/\.0$/, '');
  return [String(feld).trim(), String(ereignis).trim(), t, String(channel).trim()].join('|');
}

// Haengt Regel-Zeilen aus startRegeln() an, die im Sheet noch fehlen.
// befuelleRegelnMitStartwerten() verweigert die Arbeit, sobald der Tab gefuellt
// ist (richtig so — es soll nichts ueberschrieben werden). Fuer das Nachruesten
// einer einzelnen neuen Regel braucht es deshalb diesen Weg.
// Idempotent: zweimal laufen lassen aendert nichts, bestehende Zeilen werden
// nicht angefasst — weder Aktiv-Schalter noch selbst umgeschriebene Texte.
function ergaenzeFehlendeRegeln() {
  const blatt = holeOderLegeAn(TAB_REGELN, REGEL_SPALTEN);
  const werte = blatt.getDataRange().getValues();
  if (werte.length < 1) {
    Logger.log('Regeln-Tab ist leer. Erst befuelleRegelnMitStartwerten() laufen lassen.');
    return;
  }
  const spalte = spaltenIndex(werte[0], REGEL_SPALTEN);

  const vorhanden = {};
  for (let z = 1; z < werte.length; z++) {
    const feld = String(werte[z][spalte['Feld']] || '').trim();
    if (!feld) continue;
    vorhanden[regelSchluessel(
      feld,
      werte[z][spalte['Ereignis']],
      werte[z][spalte['Tage davor']],
      werte[z][spalte['Channel-ID']]
    )] = true;
  }

  const fehlend = startRegeln().filter(function (z) {
    return !vorhanden[regelSchluessel(z[1], z[2], z[3], z[4])];
  });

  if (!fehlend.length) {
    Logger.log('Keine fehlende Regel — der Tab ist auf Stand.');
    return;
  }

  // In der Spaltenreihenfolge des SHEETS schreiben, nicht in der von
  // REGEL_SPALTEN: die Spalten duerfen verschoben sein, gelesen wird ueberall
  // nach Header-Namen. Hier genauso, sonst landen die Werte schief.
  // Die optionale WA-Text-Spalte wird nur beschrieben, wenn sie existiert.
  // Fehlt sie, gehen die CT-Regeln trotzdem rein — nur ohne Kundentext, und
  // die Warnung unten sagt, was zu tun ist.
  const waIdx = spalteWennDa(werte[0], REGEL_SPALTE_WA);
  const spaltenNamen = regelSpaltenAlle();

  const zeilen = fehlend.map(function (z) {
    const reihe = [];
    for (let i = 0; i < werte[0].length; i++) reihe.push('');
    spaltenNamen.forEach(function (name, i) {
      const ziel = name === REGEL_SPALTE_WA ? waIdx : spalte[name];
      if (ziel === undefined) return;
      if (z[i] === undefined) return;
      reihe[ziel] = z[i];
    });
    return reihe;
  });

  if (waIdx === undefined && fehlend.some(function (z) { return z.length > REGEL_SPALTEN.length; })) {
    Logger.log('⚠️ Es fehlen Regeln mit Kundentext, aber die Spalte "%s" gibt es nicht. ' +
      'Erst ergaenzeWaSpalte() laufen lassen, dann diese Funktion nochmal.', REGEL_SPALTE_WA);
  }

  blatt.getRange(blatt.getLastRow() + 1, 1, zeilen.length, werte[0].length).setValues(zeilen);
  fehlend.forEach(function (z) { Logger.log('+ %s / %s -> %s', z[1], z[2], z[4]); });
  Logger.log('%s Regel-Zeile(n) ergaenzt.', fehlend.length);
}

// Prueft alles, legt nichts an, sendet nichts.
function pruefeKonfiguration() {
  let ok = true;

  // --- Slack ---
  try {
    const auth = fetchSlackJson('auth.test', {});
    Logger.log('✅ Slack-Token gueltig. Bot: %s in Workspace %s', auth.user, auth.team);
  } catch (fehler) {
    Logger.log('❌ Slack: %s', fehler.message);
    ok = false;
  }

  // --- Pipedrive: existieren die vier field_codes wirklich? ---
  try {
    // ⚠️ v2 liefert den Identifier als "field_code" und das Label als
    // "field_name". "key"/"name" sind die v1-Namen und kommen hier als
    // undefined zurueck — wer danach greift, bekommt lautlos nichts und haelt
    // jedes existierende Feld fuer geloescht.
    // (docs/REFERENZ-Pipedrive-AppsScript.md, Abschnitt "v2-Fallen")
    // limit=500 ist Pflicht: RP hat ueber 100 Deal-Felder, die Default-Seite
    // schneidet ab (Befund D12).
    const felder = fetchPipedriveJson('/dealFields', { limit: 500 });
    const liste = felder.data || [];
    const vorhanden = {};
    liste.forEach(function (f) {
      const code = f.field_code || f.key;
      if (code) vorhanden[code] = { label: f.field_name || f.name || '(ohne Label)', typ: f.field_type || f.type || '?' };
    });
    Logger.log('%s Deal-Felder von Pipedrive gelesen.', liste.length);
    if (felder.additional_data && felder.additional_data.next_cursor) {
      Logger.log('⚠️ dealFields ist abgeschnitten (next_cursor vorhanden) — die Pruefung unten ist unvollstaendig.');
    }

    Object.keys(TERMIN_FELDER).forEach(function (name) {
      const code = TERMIN_FELDER[name];
      const treffer = vorhanden[code];
      if (!treffer) {
        Logger.log('❌ %s: field_code %s existiert nicht in Pipedrive.', name, code);
        ok = false;
      } else if (treffer.typ !== 'date') {
        // Ein Feld, das kein Datum ist, wuerde stumm falsche Vergleiche liefern.
        Logger.log('❌ %s -> "%s" (%s) ist vom Typ "%s", erwartet "date".', name, treffer.label, code, treffer.typ);
        ok = false;
      } else {
        Logger.log('✅ %s -> "%s" (%s, date)', name, treffer.label, code);
      }
    });
  } catch (fehler) {
    Logger.log('❌ Pipedrive dealFields: %s', fehler.message);
    ok = false;
  }

  // --- CT-Kette (nur wenn eine CT-Regel existiert) ---
  try {
    const ctRegeln = leseRegeln().filter(function (r) { return r.feld === CT_PSEUDO_FELD; });
    if (!ctRegeln.length) {
      Logger.log('… keine aktive CT-Regel — CT-Erinnerung ist aus. (Anschalten: ergaenzeWaSpalte() + ergaenzeFehlendeRegeln())');
    } else {
      const blatt = holeOderLegeAn(TAB_REGELN, REGEL_SPALTEN);
      const header = blatt.getRange(1, 1, 1, Math.max(blatt.getLastColumn(), 1)).getValues()[0];
      if (spalteWennDa(header, REGEL_SPALTE_WA) === undefined) {
        Logger.log('❌ %s CT-Regel(n) aktiv, aber die Spalte "%s" fehlt — es gibt keinen Kundentext und damit keinen wa.me-Link. ergaenzeWaSpalte() ausfuehren.',
          ctRegeln.length, REGEL_SPALTE_WA);
        ok = false;
      } else {
        const ohneText = ctRegeln.filter(function (r) { return !r.waText; });
        if (ohneText.length) {
          Logger.log('⚠️ %s CT-Regel(n) ohne Kundentext in "%s" — die Slack-DM kommt, der Link bleibt leer.',
            ohneText.length, REGEL_SPALTE_WA);
        }
        const ohneLink = ctRegeln.filter(function (r) { return r.vorlage.indexOf('{walink}') === -1; });
        if (ohneLink.length) {
          Logger.log('⚠️ %s CT-Regel(n) ohne {walink} in der Vorlage — dann ist die DM nur eine Notiz, kein Ein-Klick-Versand.',
            ohneLink.length);
        }
        Logger.log('✅ %s CT-Regel(n) aktiv, Spalte "%s" vorhanden. Probelauf: testeCtLauf()',
          ctRegeln.length, REGEL_SPALTE_WA);
      }
    }
  } catch (fehler) {
    Logger.log('❌ CT-Pruefung: %s', fehler.message);
    ok = false;
  }

  // --- Sheet + Tabs ---
  if (SHEET_ID === 'TODO_SHEET_ID') {
    Logger.log('❌ SHEET_ID ist noch TODO. legeSheetAnUndZeigeId() ausfuehren.');
    ok = false;
  } else {
    try {
      const datei = SpreadsheetApp.openById(SHEET_ID);
      Logger.log('✅ Sheet erreichbar: %s', datei.getName());
      [TAB_SNAPSHOT, TAB_REGELN, TAB_LOG].forEach(function (tab) {
        if (!datei.getSheetByName(tab)) {
          Logger.log('❌ Tab "%s" fehlt.', tab);
          ok = false;
        }
      });
    } catch (fehler) {
      Logger.log('❌ Sheet: %s', fehler.message);
      ok = false;
    }
  }

  // --- Regeln + ist der Bot in den genannten Channels? ---
  try {
    const regeln = leseRegeln();
    if (!regeln.length) {
      Logger.log('❌ Keine gueltige aktive Regel. Ohne Regel meldet das Script nichts.');
      ok = false;
    }
    const channels = {};
    regeln.forEach(function (r) { channels[r.channel] = true; });
    Object.keys(channels).forEach(function (id) {
      try {
        const info = fetchSlackJson('conversations.info', { channel: id });
        const kanal = info.channel || {};
        const drin = !!kanal.is_member;
        const privat = !!kanal.is_private;

        if (drin) {
          Logger.log('✅ Channel %s (#%s) — Bot ist Mitglied', id, kanal.name);
        } else if (privat) {
          // In privaten Channels hilft chat:write.public nicht. Ohne Einladung
          // gibt es keinen Weg hinein — das ist ein echter Fehler.
          Logger.log('❌ Channel %s (#%s) ist PRIVAT und der Bot ist nicht drin.', id, kanal.name);
          Logger.log('   -> im Channel "/invite @Ernst" ausfuehren, sonst: not_in_channel.');
          ok = false;
        } else {
          // Oeffentlicher Channel: chat:write.public reicht zum Posten. Trotzdem
          // melden — ein eingeladener Bot ist im Channel sichtbar und die Leute
          // wissen, wer da postet.
          Logger.log('⚠️ Channel %s (#%s): Bot ist kein Mitglied. Posten geht trotzdem (chat:write.public).', id, kanal.name);
          Logger.log('   -> Empfehlung: "/invite @Ernst", dann ist Ernst in der Mitgliederliste sichtbar.');
        }
      } catch (fehler) {
        // Bewusst nur eine Warnung, kein ok=false: conversations.info ist der
        // EINZIGE Call im ganzen Projekt, der channels:read braucht. Zum Posten
        // reichen chat:write + chat:write.public. Ein fehlgeschlagener
        // Lese-Check darf den DRY-Lauf nicht blockieren — der ist das
        // eigentliche Messinstrument.
        // Ist die ID wirklich falsch, meldet chat.postMessage spaeter
        // channel_not_found — testePost() zeigt das in fuenf Sekunden.
        Logger.log('⚠️ Channel %s nicht lesbar: %s', id, fehler.message);
        Logger.log('   -> Nur der Vorab-Check faellt aus, das Posten haengt nicht an channels:read.');
        Logger.log('   -> Gegenprobe: testePost() ausfuehren, das postet wirklich.');
      }
    });
  } catch (fehler) {
    Logger.log('❌ Regeln: %s', fehler.message);
    ok = false;
  }

  Logger.log(ok ? '=== Konfiguration vollstaendig ===' : '=== Konfiguration UNVOLLSTAENDIG, siehe ❌ oben ===');
  return ok;
}

// Fuellt den Snapshot-Tab mit dem aktuellen Stand und postet NICHTS.
// Ignoriert DRY_RUN bewusst — genau wie testePost().
//
// Warum es diese Funktion gibt: der Snapshot ist das Gedaechtnis, gegen das
// der Diff laeuft. Ein DRY-Lauf schreibt ihn nicht (das ist der Sinn von DRY),
// also misst ein DRY-Lauf ohne vorher befuellten Snapshot gar nichts — jeder
// Deal gilt als "neu" und gesetzt/verschoben/geloescht bleiben stumm.
// Die Alternative waere, kurz DRY_RUN=false zu setzen, den Snapshot zu fuellen
// und schnell wieder zurueck. Dieses Flag-Geschiebe ist die Stelle, an der man
// scharf bleibt, ohne es zu merken. Darum lieber eine eigene Funktion, die nur
// ins Sheet schreibt und keine einzige Slack-Nachricht senden kann.
//
// Reihenfolge zum Messen:
//   1. initialisiereSnapshotJetzt()   (DRY_RUN bleibt true)
//   2. SNAPSHOT_INITIALISIEREN = false setzen, pushen
//   3. sweep()  -> zeigt im Log, was gepostet WUERDE
function initialisiereSnapshotJetzt() {
  const regeln = leseRegeln();
  const deals = holeFulfillmentDeals();
  Logger.log('%s Deals in Pipeline %s.', deals.length, PIPELINE_ID);

  const brauchtPlz = regeln.some(function (r) { return r.vorlage.indexOf('{plz}') !== -1; });
  const plzMap = brauchtPlz ? holePersonenPlzMap() : {};
  if (brauchtPlz) Logger.log('PLZ-Map: %s Personen.', Object.keys(plzMap).length);

  const gesehenIds = {};
  deals.forEach(function (d) { gesehenIds[String(d.id)] = true; });

  schreibeSnapshot(deals, plzMap, gesehenIds);
  Logger.log('✅ Snapshot mit %s Zeilen geschrieben. 0 Meldungen gesendet.', deals.length);
  Logger.log('>>> Ab jetzt wird nur noch gemeldet, was sich GEGENUEBER DIESEM STAND aendert.');
  Logger.log('>>> Naechster Schritt: sweep(). Das muss 0 Meldungen ergeben — sonst ist der Diff kaputt.');
}

// Schickt EINE Nachricht mit Platzhalterdaten in den Channel der ersten
// aktiven Regel. Zeigt, ob das Layout im Slack-Client wirklich lesbar ist.
// Ignoriert DRY_RUN bewusst — das ist der gewollte Testschuss.
function testePost() {
  const regeln = leseRegeln();
  if (!regeln.length) throw new Error('Keine aktive Regel im Regeln-Tab.');
  const regel = regeln[0];

  const text = baueText(regel.vorlage, {
    dealId: 5829, kunde: 'TEST Fam. Muster', plz: '2340', partner: 'ALE',
    stage: 15, datum: deutschesDatum('2026-09-18'),
    altdatum: deutschesDatum('2026-09-11'), neudatum: deutschesDatum('2026-09-18'),
    tage: regel.tage === null ? '' : regel.tage, feld: regel.feld,
    liefertermin: deutschesDatum('2026-09-18'), dc: '', ac: '', ib: '',
    deallink: DEAL_URL_BASE + '5829', ordnerlink: ''
  });

  fetchSlackJson('chat.postMessage', null, {
    channel: regel.channel,
    // Eigene Zeile, nicht davorgeklebt: sonst schiebt der Hinweis die erste
    // Zeile der echten Vorlage aus dem Layout.
    text: '_[TEST, keine echten Daten]_\n' + text,
    unfurl_links: false
  });
  Logger.log('Testnachricht in %s gesendet:\n%s', regel.channel, text);
}

// 15-Minuten-Trigger fuer die Aenderungs-Erkennung + Tages-Trigger 07:15 fuer
// die datumsbasierten Regeln ("vorher", "am Tag"). Beide rufen sweep() auf;
// der Doppelpost-Schutz macht das unschaedlich.
// Belegt sind bei RP schon 02:00, 03:00, 04:00 und 08:00 — 07:00 ist frei.
// ============================================================
// DIAGNOSE: was wuerde die CT-Erinnerung heute tun?
// ============================================================
// Liest nur. Sendet nichts, schreibt nichts — auch bei DRY_RUN = false.
// Das ist das Messinstrument vor dem Scharfschalten: erst sehen, welche CTs
// gefunden werden und wie die Nachricht samt wa.me-Link aussieht.
// Den wa.me-Link kann man aus dem Log kopieren und im Browser aufrufen —
// WhatsApp Desktop oeffnet sich mit dem Text, abgeschickt wird nichts.
function testeCtLauf() {
  const regeln = leseRegeln().filter(function (r) { return r.feld === CT_PSEUDO_FELD; });
  if (!regeln.length) {
    Logger.log('Keine aktive CT-Regel im Regeln-Tab. ergaenzeWaSpalte() + ergaenzeFehlendeRegeln() laufen lassen.');
    return;
  }
  Logger.log('%s aktive CT-Regel(n).', regeln.length);

  const deals = holeFulfillmentDeals();
  const ctMap = holeCtMap();
  setzeCtMap(ctMap);
  setzeCtKalenderMap(holeCtKalenderMap());
  if (!ctKalenderMap()) {
    Logger.log('… Kalender-Abgleich ist aus (CT_KALENDER_ID leer in CtKalender.gs). ' +
      'listeKalender() zeigt die verfuegbaren IDs.');
  }
  pruefeCtOhneDeal(ctMap, deals);
  pruefeDoppelDeals(ctMap, deals);

  const plzMap = holePersonenPlzMap();
  const userMap = holeUserMap();
  const heute = heuteAlsText();

  // Erst die Bestandsaufnahme: welche CTs sind ueberhaupt gefunden worden und
  // welchem Deal haengen sie an? Nach Datum sortiert, damit sich die Liste
  // gegen den Kalender gegenlesen laesst.
  const uebersicht = [];
  deals.forEach(function (deal) {
    const ct = ctFuerDeal(ctMap, deal);
    if (!ct) return;
    const p = (deal.person_id && plzMap[deal.person_id]) || {};
    // Ein CT, dessen Termin vorbei ist und der noch offen steht, ist entweder
    // ungepflegt oder die Cash Collection haengt wirklich. Fuer die Erinnerung
    // harmlos (der Stichtag ist durch), fuer die Pflege der interessante Fall.
    const ueberfaellig = ct.datum < heute;
    uebersicht.push({
      datum: ct.datum,
      ueberfaellig: ueberfaellig,
      zeile: (ueberfaellig ? '⏰ UEBERFAELLIG ' : '') +
        ct.datum + ' ' + (ct.uhrzeit || '--:--') +
        ' · Deal ' + deal.id + ' · ' + (deal.title || '') +
        ' · CC ' + (vornameVon(userMap[String(ct.ownerId)] || '') || '?') +
        ' · Tel ' + (waNummer(p.telefon) ? 'ok' : 'FEHLT') +
        ' · Kal ' + pruefeCtKalender(ct, deal, plzMap).status +
        ' · Activity #' + ct.activityId
    });
  });
  if (ctKalenderMap()) {
    pruefeKalenderOhnePipedrive(ctMap, deals, plzMap);
    pruefeVerdachtGegenKalender(ctMap.verdachtsfaelle);
  }
  uebersicht.sort(function (a, b) { return a.datum < b.datum ? -1 : 1; });
  Logger.log('--- Alle %s gefundenen CT-Termine (nach Datum) ---', uebersicht.length);
  uebersicht.forEach(function (u) { Logger.log('   %s', u.zeile); });
  const alt = uebersicht.filter(function (u) { return u.ueberfaellig; }).length;
  if (alt) {
    Logger.log('⏰ %s CT-Termin(e) liegen in der Vergangenheit und stehen noch offen — ' +
      'entweder in Pipedrive als erledigt markieren oder die Cash Collection nachfassen. ' +
      'Fuer die Erinnerung sind sie ohne Folgen.', alt);
  }
  Logger.log('--- Heute ist %s. Nur Termine am passenden Stichtag loesen unten eine Meldung aus. ---', heute);

  let treffer = 0;
  let mitCt = 0;
  deals.forEach(function (deal) {
    const ct = ctFuerDeal(ctMap, deal);
    if (!ct) return;
    mitCt++;
    regeln.forEach(function (regel) {
      const befund = pruefeRegel(regel, '', ct.datum, heute, false);
      if (!befund) return;
      const kontext = baueKontext(deal, plzMap, regel.feld, befund.altWert, befund.neuWert,
        regel.tage, userMap, regel.waText);
      const text = baueText(regel.vorlage, kontext);
      treffer++;
      Logger.log('--- Deal %s | Regel Zeile %s (%s, %s Tage) -> %s\nSLACK:\n%s\nKUNDENTEXT:\n%s\nLINK: %s',
        deal.id, regel.zeile, regel.ereignis, regel.tage, regel.channel,
        text, kontext.watext || '(keiner)', kontext.walink || '(keiner)');
    });
  });

  Logger.log('=== %s Pipeline-%s-Deals, %s davon mit offenem CT, %s Meldung(en) wuerden heute rausgehen. ===',
    deals.length, PIPELINE_ID, mitCt, treffer);
  const warnungen = ctWarnungen();
  if (warnungen.length) {
    Logger.log('⚠️ %s Zweifelsfall/-faelle:', warnungen.length);
    warnungen.forEach(function (w) { Logger.log('   %s', w); });
  }

  // Ein Blick auf die Nummernqualitaet — ohne Nummer kein Link, und das faellt
  // sonst erst auf, wenn die Erinnerung ausbleibt.
  let ohneNummer = 0;
  deals.forEach(function (deal) {
    if (!ctFuerDeal(ctMap, deal)) return;
    const p = (deal.person_id && plzMap[deal.person_id]) || {};
    if (!waNummer(p.telefon)) {
      ohneNummer++;
      Logger.log('   ⚠️ Deal %s (%s): Telefonnummer "%s" ist fuer wa.me nicht verwertbar.',
        deal.id, deal.title, p.telefon || '');
    }
  });
  if (ohneNummer) Logger.log('%s von %s CT-Deals haben keine brauchbare Nummer.', ohneNummer, mitCt);
}

// Vorschau: welche CT-Erinnerungen gehen in den naechsten Tagen raus?
//
// testeCtLauf() beantwortet "was passiert heute". Diese Funktion spielt
// dieselbe Regelpruefung fuer jeden der naechsten Tage durch, indem sie
// pruefeRegel() ein simuliertes "heute" gibt. Damit steht die Wochenplanung im
// Log, bevor die erste Nachricht existiert.
//
// Liest nur. Verschickt nichts, schreibt keinen Snapshot, setzt keinen
// Doppelpost-Schluessel — der Livelauf merkt von diesem Aufruf nichts.
function vorschauCt(tageVoraus) {
  const tage = Number(tageVoraus) || 7;

  const regeln = leseRegeln().filter(function (r) { return r.feld === CT_PSEUDO_FELD; });
  if (!regeln.length) {
    Logger.log('Keine aktive CT-Regel im Regeln-Tab — es wuerde nichts rausgehen.');
    return;
  }
  Logger.log('%s aktive CT-Regel(n): %s', regeln.length,
    regeln.map(function (r) {
      return r.ereignis + (r.tage === '' ? '' : ' ' + r.tage) + ' -> ' + r.channel;
    }).join(' | '));

  const deals = holeFulfillmentDeals();
  const ctMap = holeCtMap();
  setzeCtMap(ctMap);
  setzeCtKalenderMap(holeCtKalenderMap());
  const plzMap = holePersonenPlzMap();
  const userMap = holeUserMap();
  const heute = heuteAlsText();

  // Die CTs einmal sammeln statt pro Tag neu zuzuordnen.
  const mitCt = [];
  deals.forEach(function (deal) {
    const ct = ctFuerDeal(ctMap, deal);
    if (ct) mitCt.push({ deal: deal, ct: ct });
  });

  Logger.log('=== Vorschau %s Tage ab %s — %s Deals mit offenem CT ===',
    tage, heute, mitCt.length);

  let gesamt = 0;
  const ohneNummer = [];

  for (let i = 0; i < tage; i++) {
    // tageVorher() mit negativem Wert rechnet drauf statt ab.
    const simTag = tageVorher(heute, -i);
    const heuteHinweis = i === 0 ? ' (heute)' : (i === 1 ? ' (morgen)' : '');
    const zeilen = [];

    mitCt.forEach(function (eintrag) {
      regeln.forEach(function (regel) {
        const befund = pruefeRegel(regel, '', eintrag.ct.datum, simTag, false);
        if (!befund) return;

        const kontext = baueKontext(eintrag.deal, plzMap, regel.feld,
          befund.altWert, befund.neuWert, regel.tage, userMap, regel.waText);
        const p = (eintrag.deal.person_id && plzMap[eintrag.deal.person_id]) || {};
        const nummerOk = !!waNummer(p.telefon);
        if (!nummerOk && ohneNummer.indexOf(eintrag.deal.id) === -1) {
          ohneNummer.push(eintrag.deal.id);
        }

        zeilen.push('   [' + regel.ereignis +
          (regel.tage === '' ? '' : ' ' + regel.tage) + '] ' +
          'CT ' + deutschesDatum(eintrag.ct.datum) +
          (eintrag.ct.uhrzeit ? ' ' + eintrag.ct.uhrzeit : '') +
          ' · ' + (eintrag.deal.title || '') +
          ' · Deal ' + eintrag.deal.id +
          ' · CC ' + (vornameVon(userMap[String(eintrag.ct.ownerId)] || '') || '?') +
          (nummerOk ? '' : ' · ⚠️ KEINE NUMMER') +
          '\n      an den Kunden: ' + (kontext.watext || '(kein Text)'));
        gesamt++;
      });
    });

    if (!zeilen.length) continue;
    Logger.log('--- %s%s — %s Nachricht(en) ---', deutschesDatum(simTag), heuteHinweis, zeilen.length);
    zeilen.forEach(function (z) { Logger.log('%s', z); });
  }

  Logger.log('=== %s Nachricht(en) in den naechsten %s Tagen. ===', gesamt, tage);
  if (ohneNummer.length) {
    Logger.log('⚠️ %s Deal(s) ohne verwertbare Nummer — dort kommt die DM, aber ohne Link: %s',
      ohneNummer.length, ohneNummer.join(', '));
  }

  // CTs, die im Zeitraum liegen, aber keine Regel ausloesen. Meist harmlos
  // (der Termin ist vorbei), aber genau hier wuerde auffallen, wenn eine
  // Regel nicht greift.
  const bisTag = tageVorher(heute, -(tage - 1));
  const stumm = mitCt.filter(function (e) {
    return e.ct.datum >= heute && e.ct.datum <= bisTag && !regeln.some(function (regel) {
      for (let i = 0; i < tage; i++) {
        if (pruefeRegel(regel, '', e.ct.datum, tageVorher(heute, -i), false)) return true;
      }
      return false;
    });
  });
  if (stumm.length) {
    Logger.log('… %s CT(s) im Zeitraum ohne jede Erinnerung:', stumm.length);
    stumm.forEach(function (e) {
      Logger.log('   %s %s · Deal %s — pruefen, ob eine Regel fehlt.',
        e.ct.datum, e.deal.title, e.deal.id);
    });
  }

  const warnungen = ctWarnungen();
  if (warnungen.length) {
    Logger.log('⚠️ %s Zweifelsfall/-faelle:', warnungen.length);
    warnungen.forEach(function (w) { Logger.log('   %s', w); });
  }
}

function installiereTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'sweep'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('sweep').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('sweep').timeBased().atHour(7).nearMinute(15).everyDays(1).create();

  // Nicht "installiert" behaupten, sondern nachsehen. Ein Trigger, den man
  // angelegt zu haben glaubt, ist der haeufigste stille Ausfall.
  const gesetzt = ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'sweep'; });
  Logger.log('%s Trigger aktiv fuer sweep():', gesetzt.length);
  gesetzt.forEach(function (t) {
    Logger.log('  - %s (%s)', t.getEventType(), t.getUniqueId());
  });
  if (gesetzt.length !== 2) {
    Logger.log('⚠️ Erwartet waren 2 (15-Minuten + taeglich 07:15). Bitte nachsehen.');
  }
  Logger.log('DRY_RUN=%s — %s', DRY_RUN,
    DRY_RUN ? 'die Trigger laufen, posten aber nichts.' : 'ab jetzt postet Ernst automatisch.');
}

// Zeigt, was aktuell haengt, ohne etwas zu aendern. Fuer die Frage
// "laeuft das Ding eigentlich noch?" — zusammen mit dem Tab "Laeufe".
function zeigeTrigger() {
  const alle = ScriptApp.getProjectTriggers();
  if (!alle.length) {
    Logger.log('❌ KEIN Trigger installiert. Das Script laeuft nur, wenn du hier auf Ausfuehren drueckst.');
    return;
  }
  alle.forEach(function (t) {
    Logger.log('%s -> %s (%s)', t.getEventType(), t.getHandlerFunction(), t.getUniqueId());
  });
}

function entferneTrigger() {
  const alle = ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'sweep'; });
  alle.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  Logger.log('%s Trigger entfernt.', alle.length);
}
