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
  const zeilen = startRegeln();

  const blatt = holeOderLegeAn(TAB_REGELN, REGEL_SPALTEN);
  if (blatt.getLastRow() > 1) {
    Logger.log('⚠️ Regeln-Tab enthaelt schon %s Zeilen — es wird NICHTS ueberschrieben. Bei Bedarf manuell leeren.', blatt.getLastRow() - 1);
    Logger.log('   -> Nur die Texte auffrischen: setzeVorlagenNeu()');
    return;
  }
  blatt.getRange(2, 1, zeilen.length, REGEL_SPALTEN.length).setValues(zeilen);
  Logger.log('%s Regel-Zeilen angelegt. Jetzt die Channel-ID(s) in Spalte "Channel-ID" eintragen.', zeilen.length);
}

// Ueberschreibt NUR die Spalte "Vorlage", passend zu Feld+Ereignis+Tage.
// Aktiv-Schalter, Channel-IDs und selbst angelegte Zusatzzeilen bleiben stehen.
// Die alten Texte wandern vorher ins Log — wer eigene Formulierungen drin
// hatte, holt sie von dort zurueck, statt sie zu verlieren.
function setzeVorlagenNeu() {
  const vorgabe = {};
  startRegeln().forEach(function (z) {
    vorgabe[[z[1], z[2], z[3] === '' ? '' : String(z[3])].join('|')] = z[5];
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
    const neu = vorgabe[[feld, ereignis, tage].join('|')];
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

  return zeilen;
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
