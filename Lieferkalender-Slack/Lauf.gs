// ============================================================
// LAUF — der Sweep. Das ist die Funktion, die am Trigger haengt.
// ============================================================
// Ablauf:
//   1. Regeln lesen (Tab "Regeln")
//   2. Snapshot lesen (Tab "Snapshot") = Stand vom letzten Lauf
//   3. Deals der Pipeline 2 holen (ein Call pro 100, custom_fields inklusive)
//   4. PLZ-Map aus den Personen holen — nur wenn eine Vorlage {plz} benutzt
//   5. pro Deal x Regel pruefen, ob etwas zu melden ist
//   6. posten, Log-Zeilen sammeln
//   7. Snapshot neu schreiben
//
// Schritt 7 kommt ZULETZT und nur bei einem vollstaendigen Lauf. Bricht der
// Lauf vorher ab, bleibt der alte Snapshot stehen und der naechste Lauf sieht
// dieselbe Aenderung wieder — verpasste Meldung ist besser als verlorene.

// Platzhalter, die Daten von der PERSON brauchen und damit den /persons-Sweep
// ausloesen. Fehlt hier einer, bleibt er in der Nachricht still leer — deshalb
// beim Ergaenzen eines Person-Platzhalters diese Liste mitpflegen.
const PERSON_PLATZHALTER = ['{plz}', '{vorname}', '{nachname}', '{telefon}', '{walink}'];

function sweep() {
  const start = Date.now();
  const sperre = LockService.getScriptLock();
  // Kurz, nicht 30s: laeuft der Vorgaenger noch, ist Ueberspringen richtig —
  // der naechste Trigger kommt in 15 Minuten.
  if (!sperre.tryLock(5000)) {
    Logger.log('Ein anderer Lauf ist noch aktiv. Uebersprungen.');
    return;
  }

  // Wird im finally ins Lauf-Protokoll geschrieben — auch wenn der Lauf
  // mitten drin auf die Nase faellt. Ein Lauf, der nur im
  // Ausfuehrungsprotokoll von Apps Script steht, ist nach 7 Tagen weg.
  const bilanz = { deals: 0, meldungen: 0, hinweis: '' };

  try {
    Logger.log('=== Lieferkalender-Sweep gestartet — DRY_RUN=%s, SNAPSHOT_INITIALISIEREN=%s ===',
      DRY_RUN, SNAPSHOT_INITIALISIEREN);

    const regeln = leseRegeln();
    const snapshot = leseSnapshot();
    const deals = holeFulfillmentDeals();
    bilanz.deals = deals.length;
    Logger.log('%s Deals in Pipeline %s.', deals.length, PIPELINE_ID);

    // Der Personen-Sweep kostet Calls, also nur holen, wenn ihn eine Vorlage
    // wirklich braucht. Seit der CT-Erinnerung haengen dort auch Name und
    // Telefon dran — die Liste der Ausloeser ist deshalb laenger als {plz}.
    const brauchtPerson = regeln.some(function (r) {
      return PERSON_PLATZHALTER.some(function (p) {
        return r.vorlage.indexOf(p) !== -1 || (r.waText && r.waText.indexOf(p) !== -1);
      });
    });
    const plzMap = brauchtPerson ? holePersonenPlzMap() : {};
    if (brauchtPerson) Logger.log('Personen-Map: %s Personen.', Object.keys(plzMap).length);

    // CT-Termine stecken in den Activities, nicht am Deal. Nur abrufen, wenn
    // ueberhaupt eine Regel darauf zeigt.
    // Der CT-Abruf ist EINGEKAPSELT: faellt /activities aus (Timeout, 5xx nach
    // drei Versuchen, Seitenlimit-Fehler), darf das nicht die seit 11.09.
    // laufenden Liefertermin-Meldungen mitreissen. Ohne CT-Map liefert
    // leseTerminfeld('CT-Termin') schlicht '' und die CT-Regeln feuern nicht —
    // sichtbar im Laeufe-Tab, nicht still.
    const brauchtCt = regeln.some(function (r) { return r.feld === CT_PSEUDO_FELD; });
    let ctMap = null;
    if (brauchtCt) {
      try {
        ctMap = holeCtMap();
      } catch (ctFehler) {
        Logger.log('⚠️ CT-Abruf fehlgeschlagen: %s — CT-Erinnerungen entfallen diesen Lauf.', ctFehler.message);
        bilanz.hinweis = bilanz.hinweis
          ? bilanz.hinweis + ' | CT-Abruf fehlgeschlagen: ' + ctFehler.message
          : 'CT-Abruf fehlgeschlagen: ' + ctFehler.message;
      }
    }
    setzeCtMap(ctMap);

    // Der Kalender-Abgleich ist ein Zusatz zum Zusatz und wird genauso
    // eingekapselt: faellt CalendarApp aus, laeuft alles Uebrige weiter.
    let kalMap = null;
    if (ctMap) {
      try {
        kalMap = holeCtKalenderMap();
      } catch (kalFehler) {
        Logger.log('⚠️ Kalender-Abgleich fehlgeschlagen: %s — CT-Erinnerungen laufen ohne Gegenprobe.',
          kalFehler.message);
        ctWarnung('Kalender-Abgleich fehlgeschlagen: ' + kalFehler.message);
      }
    }
    setzeCtKalenderMap(kalMap);

    if (ctMap) {
      pruefeCtOhneDeal(ctMap, deals);
      pruefeDoppelDeals(ctMap, deals);
      if (kalMap) pruefeKalenderOhnePipedrive(ctMap, deals, plzMap);
    }

    // Der Cash Collector ist der owner der CT-ACTIVITY, nicht der des Deals —
    // der Deal haengt nach der Fulfillment-Uebernahme auf Valentin.
    const brauchtUser = regeln.some(function (r) {
      return r.vorlage.indexOf('{cc') !== -1 || (r.waText && r.waText.indexOf('{cc') !== -1);
    });
    const userMap = brauchtUser ? holeUserMap() : null;

    const gesehenIds = {};
    deals.forEach(function (d) { gesehenIds[String(d.id)] = true; });

    // Erster Lauf: nur Gedaechtnis fuellen, nichts melden. Ohne das kaemen die
    // bereits eingetragenen Termine alle als "gerade gesetzt" rein.
    if (SNAPSHOT_INITIALISIEREN) {
      if (DRY_RUN) {
        Logger.log('[DRY_RUN] Initialisierung: es WUERDEN %s Snapshot-Zeilen geschrieben und 0 Meldungen gesendet.', deals.length);
      } else {
        schreibeSnapshot(deals, plzMap, gesehenIds);
        Logger.log('✅ Snapshot initialisiert, 0 Meldungen gesendet. Jetzt SNAPSHOT_INITIALISIEREN auf false setzen.');
      }
      return;
    }

    const gesendet = leseGesendeteSchluessel();
    const neueLogZeilen = [];
    const heute = heuteAlsText();
    let treffer = 0;

    // Nachtsperre fuer die datumsbasierten Regeln — siehe RUHEZEIT_BIS_STUNDE
    // in Config.gs. Ohne das kaeme "HEUTE Lieferung" um 00:07.
    const stunde = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'H'));
    const datumsregelnErlaubt = stunde >= RUHEZEIT_BIS_STUNDE;
    if (!datumsregelnErlaubt) {
      Logger.log('Ruhezeit (%s Uhr, erst ab %s Uhr): "vorher" und "am Tag" werden uebersprungen. Aenderungen werden normal gemeldet.',
        stunde, RUHEZEIT_BIS_STUNDE);
      bilanz.hinweis = 'Ruhezeit — Datumsregeln pausiert';
    }

    deals.forEach(function (deal) {
      const alt = snapshot[String(deal.id)] || null;

      regeln.forEach(function (regel) {
        const istDatumsregel = regel.ereignis === 'vorher' || regel.ereignis === 'am Tag';
        if (istDatumsregel && !datumsregelnErlaubt) return;

        const neuWert = leseTerminfeld(deal, regel.feld);
        const altWert = alt ? (alt[regel.feld] || '') : '';

        const befund = pruefeRegel(regel, altWert, neuWert, heute, alt === null);
        if (!befund) return;

        const schluessel = baueSchluessel(deal.id, regel.feld, regel.ereignis, regel.tage, befund.bezugsdatum, regel.channel);
        if (schonGesendet(gesendet, schluessel, regel.channel)) return;

        const kontext = baueKontext(deal, plzMap, regel.feld, befund.altWert, befund.neuWert,
          regel.tage, userMap, regel.waText);
        const text = baueText(regel.vorlage, kontext);
        const logZeile = sendeMeldung(regel, text, schluessel, deal.id);
        if (logZeile) neueLogZeilen.push(logZeile);
        gesendet[schluessel] = true;
        treffer++;
      });
    });

    bilanz.meldungen = treffer;
    Logger.log('%s Meldungen %s.', treffer, DRY_RUN ? 'WUERDEN gesendet' : 'gesendet');

    // Zweifelsfaelle aus dem CT-Join in die Hinweis-Spalte des Laeufe-Tabs.
    // Nur im Logger waeren sie nach 7 Tagen weg — und ein uebersehener
    // Doppel-CT heisst, dass ein Kunde keine Erinnerung bekommt.
    const warnungen = ctWarnungen();
    if (warnungen.length) {
      const zusatz = warnungen.length + ' CT-Zweifelsfall/-faelle: ' + warnungen[0];
      bilanz.hinweis = bilanz.hinweis ? bilanz.hinweis + ' | ' + zusatz : zusatz;
    }

    if (!DRY_RUN) {
      schreibeLogZeilen(neueLogZeilen);
      schreibeSnapshot(deals, plzMap, gesehenIds);
    } else {
      Logger.log('[DRY_RUN] Snapshot und Log bleiben unveraendert.');
    }

    Logger.log('=== Fertig in %s s ===', Math.round((Date.now() - start) / 1000));
  } catch (fehler) {
    // Fehler wird protokolliert UND weitergeworfen: im Lauf-Protokoll steht
    // dann eine Zeile mit dem Grund, und Apps Script schickt trotzdem seine
    // Fehlermail. Nur protokollieren waere ein stiller Ausfall.
    bilanz.hinweis = 'FEHLER: ' + fehler.message;
    throw fehler;
  } finally {
    schreibeLaufZeile(start, bilanz);
    sperre.releaseLock();
  }
}

// ---------- Lauf-Protokoll ----------
// Eine Zeile pro Lauf, IMMER — auch bei 0 Meldungen und auch bei Absturz.
// Beantwortet die Frage, die ein stiller Channel nicht beantwortet:
// laeuft das Ding ueberhaupt noch?
const LAUF_SPALTEN = ['Zeitpunkt', 'Dauer s', 'Deals', 'Meldungen', 'Modus', 'Hinweis'];
const LAUF_ZEILEN_MAX = 500;

function schreibeLaufZeile(start, bilanz) {
  try {
    const blatt = holeOderLegeAn(TAB_LAEUFE, LAUF_SPALTEN);
    const zeile = [
      new Date(),
      Math.round((Date.now() - start) / 1000),
      bilanz.deals,
      bilanz.meldungen,
      DRY_RUN ? 'DRY' : 'live',
      bilanz.hinweis
    ];
    blatt.appendRow(zeile);

    // Aelteste Zeilen abschneiden, damit der Tab nicht unbegrenzt waechst.
    // 500 Zeilen sind bei 96 Laeufen pro Tag gut fuenf Tage Historie — genug,
    // um "seit wann ist es kaputt?" zu beantworten.
    const ueberhang = blatt.getLastRow() - 1 - LAUF_ZEILEN_MAX;
    if (ueberhang > 0) blatt.deleteRows(2, ueberhang);
  } catch (fehler) {
    // Das Protokoll darf den Lauf nie mitreissen — es ist Diagnose, nicht Zweck.
    Logger.log('⚠️ Lauf-Protokoll nicht schreibbar: %s', fehler.message);
  }
}

// Entscheidet fuer EINE Regel und EINEN Deal, ob gemeldet wird.
// Rueckgabe null = nichts zu melden.
// "istNeuerDeal" = der Deal stand im letzten Snapshot nicht drin. Dann ist ein
// vorhandenes Datum NICHT "gerade gesetzt" — der Deal ist nur neu in der
// Pipeline. Sonst meldet jeder frisch uebernommene Deal seine Alt-Termine.
function pruefeRegel(regel, altWert, neuWert, heute, istNeuerDeal) {
  switch (regel.ereignis) {

    case 'gesetzt':
      if (istNeuerDeal) return null;
      if (!altWert && neuWert) {
        return { altWert: '', neuWert: neuWert, bezugsdatum: neuWert };
      }
      return null;

    case 'verschoben':
      if (istNeuerDeal) return null;
      if (altWert && neuWert && altWert !== neuWert) {
        return { altWert: altWert, neuWert: neuWert, bezugsdatum: neuWert };
      }
      return null;

    case 'geloescht':
      if (istNeuerDeal) return null;
      if (altWert && !neuWert) {
        return { altWert: altWert, neuWert: '', bezugsdatum: altWert };
      }
      return null;

    // Datumsbasiert: nicht der Vergleich entscheidet, sondern der Kalender.
    // Diese beiden feuern auch dann, wenn sich nichts geaendert hat — der
    // Doppelpost-Schutz ueber den Log-Schluessel ist hier zwingend.
    case 'vorher': {
      if (!neuWert) return null;
      const ziel = tageVorher(neuWert, regel.tage);
      if (ziel !== heute) return null;
      return { altWert: altWert, neuWert: neuWert, bezugsdatum: neuWert };
    }

    case 'am Tag':
      if (!neuWert) return null;
      if (neuWert !== heute) return null;
      return { altWert: altWert, neuWert: neuWert, bezugsdatum: neuWert };

    default:
      return null;
  }
}

// "2026-09-18" minus 2 Tage -> "2026-09-16".
// Bewusst mit lokalem Date-Konstruktor (Jahr, Monat, Tag) statt new Date(iso):
// letzteres wird als UTC gelesen und kippt in Wien auf den Vortag.
function tageVorher(isoText, tage) {
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoText).slice(0, 10));
  if (!t) return '';
  const d = new Date(Number(t[1]), Number(t[2]) - 1, Number(t[3]));
  d.setDate(d.getDate() - Number(tage));
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
