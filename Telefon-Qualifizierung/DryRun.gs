// ============================================================
// Täglicher Lauf über Pipedrive-Personen
// ============================================================
// Schreibt über schreibePersonStatus() (PipedriveWriteBack.gs) auf die Person zurück, sobald
// WRITE_TO_PIPEDRIVE = true ist -- das ist seit 05.09.2026 der Fall (von Valentin freigegeben).
// Bei false bleibt alles Simulation; die Sheet-Spalte "Pipedrive-Status" zeigt dann, was
// geschrieben WÜRDE. Sie zeigt im Live-Fall genauso, was tatsächlich geschrieben wurde.
//
// Vorgabe (Valentin, 05.09.2026): Existenz-Checks sind knapp (AbstractAPI-Freiplan: 100/Monat,
// siehe Config.gs), deshalb immer zuerst die Personen mit dem Pipedrive-Label "new" -- so
// kommen bei RP tatsächlich neue Leads rein (per Screenshot verifiziert, nicht per add_time
// geraten). Label-ID 49 = Text "new" per getPersons(include_labels=true) am 05.09.2026
// bestätigt, wird trotzdem zur Laufzeit über den Text aufgelöst statt hartcodiert (Label-IDs
// sind pro Pipedrive-Account fix, aber falls RP das Label je neu anlegt statt umbenennt,
// ändert sich die ID wie bei jedem anderen Feld schon einmal passiert -- siehe
// Montageplanung-Namensabgleich/Config.gs zum PLZ-Feld).
//
// Zwei Kontingent-Grenzen (Config.gs): MAX_EXISTENZ_CHECKS_PRO_LAUF verhindert, dass ein
// einzelner Trigger-Lauf gleich das ganze Monatskontingent verbraucht (AbstractAPI hat --
// anders als IPQS -- KEINEN Tages-Deckel, ein Lauf könnte sonst am 1. des Monats alles
// leerräumen). MAX_EXISTENZ_CHECKS_PRO_MONAT ist die harte Obergrenze fürs ganze Monat.
//
// Ablauf pro Lauf:
//   1. Alle noch nicht erledigten Personen (nicht in Spalte A des Ergebnis-Sheets) werden
//      in zwei Warteschlangen sortiert: "new"-Label zuerst, Rest danach. Innerhalb jeder
//      Warteschlange neueste zuerst (add_time).
//   2. Verarbeitet wird in dieser Reihenfolge, bis eine der beiden Kontingent-Grenzen
//      erreicht ist. Mehrere manuelle Starts am selben Tag summieren sich, statt das
//      Monatskontingent jedes Mal neu zu gewähren.
//   3. Da "erledigt" immer frisch aus dem Sheet gelesen wird, ist ein Absturz mittendrin
//      unkritisch -- der nächste Lauf baut die Warteschlangen einfach neu auf und lässt
//      bereits geschriebene Zeilen automatisch aus.
//
// richteTaeglichenTriggerEin() einmalig ausführen, dann läuft taeglicherTelefonCheck()
// von selbst -- siehe README.md.

const MONAT_PROPERTY = 'TELEFON_CHECK_MONAT';
const MONATSZAEHLER_PROPERTY = 'TELEFON_CHECK_MONATSZAEHLER';
const NEU_LABEL_TEXT = 'new'; // Pipedrive-Person-Label, das RP für frische Leads verwendet

function aktuellerMonat() {
  return Utilities.formatDate(new Date(), 'Europe/Vienna', 'yyyy-MM');
}

function getPersonsPage(cursor) {
  let path = '/persons?limit=500&sort_by=add_time&sort_direction=desc';
  if (cursor) path += '&cursor=' + encodeURIComponent(cursor);
  return fetchPipedrive(path);
}

// Löst NEU_LABEL_TEXT zur Laufzeit auf eine Label-ID auf, statt die 49 hartzucodieren.
// Quelle sind die Feld-Metadaten (/personFields -> Label-Feld mit allen Optionen), nicht mehr
// eine 500er-Personenseite: die Metadaten enthalten ALLE Labels des Accounts, auch wenn gerade
// keine der neuesten Personen das Label trägt, sind schon von getPersonFields() gecacht und
// kosten damit keinen zusätzlichen 500er-Abruf pro Lauf.
//
// Das Label-Feld wird NICHT über einen hartcodierten field_code gesucht (09.09.2026):
// Am Personen-OBJEKT heißt das Attribut in v2 `label_ids` (live geprüft), aber bei
// Pipedrive-Built-ins weicht der field_code in den Metadaten davon ab -- die Telefonnummern
// stehen am Objekt unter `phones`, das Feld heißt `phone`. Ob das Label-Feld also `label_ids`
// oder (v1-Erbe) `label` heißt, ist nicht dokumentiert. Ein falscher Name hätte hier nicht nur
// ungenau gearbeitet, sondern den ganzen Lauf geworfen (siehe Aufrufer unten). Deshalb beide
// Namen probieren und als letzten Ausweg das einzige Optionsfeld nehmen, dessen Optionen den
// gesuchten Label-Text enthalten.
const LABEL_FELD_CODES = ['label_ids', 'label'];

function resolveNeuLabelId() {
  const felder = getPersonFields();
  const gesucht = NEU_LABEL_TEXT.trim().toLowerCase();
  const hatGesuchtesLabel = f => (f.options || []).some(o =>
    (o.label || '').trim().toLowerCase() === gesucht);

  let labelFeld = felder.find(f => LABEL_FELD_CODES.indexOf(f.field_code) !== -1 && f.options);
  // Fallback: Feld unbekannt benannt -- dann über den Label-Text selbst finden.
  if (!labelFeld || !hatGesuchtesLabel(labelFeld)) {
    labelFeld = felder.find(hatGesuchtesLabel) || labelFeld;
  }
  if (!labelFeld || !labelFeld.options) return null;

  const option = labelFeld.options.find(o =>
    (o.label || '').trim().toLowerCase() === gesucht);
  return option ? option.id : null;
}

function ermittleVerdacht(format, existenz) {
  if (format.platzhalterVerdacht) return 'Sieht nach Platzhalter/Fake-Nummer aus (Ziffernfolge) -- manuell prüfen, auch wenn Existenz-Check "aktiv" sagt';
  if (!format.formatOk) return 'Formatfehler: ' + format.reason;
  if (existenz && existenz.fehler) return 'Existenz-Check fehlgeschlagen: ' + existenz.fehler;
  if (existenz && existenz.existiert === false) return 'Existenz-Check meldet Nummer als NICHT aktiv';
  // existiert === null heißt: Anbieter hat einen Status geliefert, den wir nicht als klares
  // ja/nein deuten (siehe deuteLineStatus in ExistenceCheck.gs). Sichtbar machen, sonst sieht
  // die Zeile wie ein sauberes Ergebnis aus, obwohl nichts nach Pipedrive geschrieben wurde.
  if (existenz && existenz.existiert === null) return 'Line-Status unklar (' + (existenz.rohantwort && existenz.rohantwort.phone_validation ? existenz.rohantwort.phone_validation.line_status : 'kein Wert') + ') -- nichts nach Pipedrive geschrieben';
  if (existenz && existenz.abuseErkannt === true) return 'Abuse erkannt (AbstractAPI)';
  if (existenz && existenz.riskLevel === 'high') return 'Hohes Risk-Level';
  return '';
}

// Liest die Person-ID-Spalte aus dem Ergebnis-Sheet -- alles was hier schon drinsteht gilt
// als erledigt und wird beim Scan übersprungen.
// ⚠️ Hier stand bis 05.09.2026 Spalte 1 -- das ist aber "Geprüft am" (ein Datum), die
// Person-ID steht in Spalte 2. Number(Datum) ergibt NaN, das Set enthielt also nur NaN und
// erledigt.has(id) war immer false: der Doppel-Lauf-Schutz hat nie gegriffen, jeder Lauf
// hätte dieselben Personen erneut geprüft und das Monatskontingent verbrannt. Spalte wird
// jetzt aus ERGEBNIS_HEADER abgeleitet (PERSON_ID_SPALTE in Config.gs).
function getBereitsErledigteIds(tab) {
  const letzteZeile = tab.getLastRow();
  const erledigt = new Set();
  if (letzteZeile < 2) return erledigt;
  const werte = tab.getRange(2, PERSON_ID_SPALTE, letzteZeile - 1, 1).getValues();
  werte.forEach(r => {
    const id = Number(r[0]);
    if (r[0] !== '' && !isNaN(id)) erledigt.add(id);
  });
  return erledigt;
}

function taeglicherTelefonCheck() {
  if (!ERGEBNIS_SHEET_ID) {
    throw new Error('ERGEBNIS_SHEET_ID ist leer -- zuerst pruefeKonfiguration() laufen lassen und die ID eintragen.');
  }

  // Zwei Läufe gleichzeitig (Tages-Trigger um 6:00 + manueller Start im Editor) würden dieselbe
  // "erledigt"-Liste lesen, dieselben Personen doppelt prüfen (doppeltes Kontingent) und
  // doppelte Zeilen ins Sheet schreiben. Genau der D2-Fehler aus RP-Google-Scripts/CLAUDE.md.
  // tryLock statt waitLock: wenn schon einer läuft, ist der zweite Lauf schlicht unnötig.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log('Ein anderer Lauf ist gerade aktiv (Trigger + manueller Start?) -- dieser Lauf beendet sich ohne etwas zu tun.');
    return;
  }
  try {
    fuehreTelefonCheckAus();
  } finally {
    lock.releaseLock();
  }
}

// NICHT direkt per ▷ starten -- das umgeht den Lock oben. Einstiegspunkt ist immer
// taeglicherTelefonCheck().
function fuehreTelefonCheckAus() {
  const start = Date.now();
  const props = PropertiesService.getScriptProperties();
  const monat = aktuellerMonat();

  let existenzChecksMonat = Number(props.getProperty(MONATSZAEHLER_PROPERTY) || 0);
  if (props.getProperty(MONAT_PROPERTY) !== monat) {
    existenzChecksMonat = 0; // neuer Kalendermonat -- Kontingent zurücksetzen
    props.setProperty(MONAT_PROPERTY, monat);
    props.setProperty(MONATSZAEHLER_PROPERTY, '0');
  }

  if (existenzChecksMonat >= MAX_EXISTENZ_CHECKS_PRO_MONAT) {
    Logger.log('Monatskontingent bereits ausgeschöpft (%s/%s) -- nächsten Monat geht es weiter.', existenzChecksMonat, MAX_EXISTENZ_CHECKS_PRO_MONAT);
    return;
  }

  const neuLabelId = resolveNeuLabelId();
  if (!neuLabelId) {
    throw new Error('Kein Person-Label mit Text "' + NEU_LABEL_TEXT + '" gefunden -- Label umbenannt? listePersonFields() ausführen und NEU_LABEL_TEXT in DryRun.gs abgleichen.');
  }

  const spreadsheet = SpreadsheetApp.openById(ERGEBNIS_SHEET_ID);
  const tab = spreadsheet.getSheetByName(ERGEBNIS_TAB_NAME);
  if (!tab) throw new Error('Tab "' + ERGEBNIS_TAB_NAME + '" fehlt -- pruefeKonfiguration() nochmal laufen lassen.');

  const erledigt = getBereitsErledigteIds(tab);

  // Phase 1: komplett durchpaginieren und in zwei Warteschlangen einsortieren -- kostet
  // nur Pipedrive-Lesezugriffe (unlimitiert), keine Existenz-Check-Kontingent.
  const neuQueue = [];
  const restQueue = [];
  let cursor = null;
  while (true) {
    if (Date.now() - start > MAX_LAUFZEIT_MS) {
      Logger.log('WARNUNG: Laufzeit-Grenze schon beim Einsortieren erreicht -- verarbeite nur die bis hierhin gefundenen %s "new" + %s restlichen Personen.', neuQueue.length, restQueue.length);
      break;
    }
    const seite = getPersonsPage(cursor);
    const personen = seite.data || [];
    for (const person of personen) {
      if (erledigt.has(person.id)) continue;
      const istNeu = (person.label_ids || []).indexOf(neuLabelId) !== -1;
      (istNeu ? neuQueue : restQueue).push(person);
    }
    cursor = seite.additional_data && seite.additional_data.next_cursor;
    if (!cursor) break;

    // Sobald allein die "new"-Warteschlange das Lauf-Kontingent füllt, bringt Weiterpaginieren
    // nichts mehr: "new" wird zuerst abgearbeitet, mehr als MAX_EXISTENZ_CHECKS_PRO_LAUF geht
    // in diesem Lauf sowieso nicht. Ohne diesen Abbruch werden bei ~7.000 Personen jeden Tag
    // ~14 Seiten geladen, um am Ende 5 Nummern zu prüfen. Personen ohne Telefonnummer zählen
    // nicht gegen das Kontingent, deshalb ein kleiner Puffer obendrauf.
    if (neuQueue.length >= MAX_EXISTENZ_CHECKS_PRO_LAUF * 3) {
      Logger.log('Genug "new"-Kandidaten für diesen Lauf gefunden (%s) -- Pagination hier abgebrochen, restlicher Bestand wird erst geladen wenn "new" abgearbeitet ist.', neuQueue.length);
      break;
    }
  }
  Logger.log('Einsortiert: %s Personen mit Label "new", %s im übrigen Bestand (jeweils noch nicht erledigt).', neuQueue.length, restQueue.length);

  // Phase 2: abarbeiten -- "new" zuerst, dann der Rest, jeweils neueste zuerst.
  const warteschlange = neuQueue.concat(restQueue);
  let pufferZeilen = [];
  let heuteGeprueft = 0;
  let existenzChecksDiesLauf = 0;

  function flush() {
    if (!pufferZeilen.length) return;
    tab.getRange(tab.getLastRow() + 1, 1, pufferZeilen.length, ERGEBNIS_HEADER.length).setValues(pufferZeilen);
    pufferZeilen = [];
  }

  for (const person of warteschlange) {
    if (Date.now() - start > MAX_LAUFZEIT_MS) {
      Logger.log('Laufzeit-Grenze erreicht -- %s Personen heute geprüft (%s/%s Existenz-Checks diesen Monat). Nächster Start macht weiter.', heuteGeprueft, existenzChecksMonat, MAX_EXISTENZ_CHECKS_PRO_MONAT);
      break;
    }
    if (existenzChecksMonat >= MAX_EXISTENZ_CHECKS_PRO_MONAT) {
      Logger.log('Monatskontingent erreicht (%s/%s) -- %s Personen heute geprüft. Rest bleibt bis nächsten Monat offen ("new"-Label zuerst).', existenzChecksMonat, MAX_EXISTENZ_CHECKS_PRO_MONAT, heuteGeprueft);
      break;
    }
    if (existenzChecksDiesLauf >= MAX_EXISTENZ_CHECKS_PRO_LAUF) {
      Logger.log('Lauf-Kontingent erreicht (%s/%s für diesen Lauf) -- %s Personen heute geprüft. Nächster Trigger-Lauf macht weiter, spart Kontingent für neue Leads an anderen Tagen.', existenzChecksDiesLauf, MAX_EXISTENZ_CHECKS_PRO_LAUF, heuteGeprueft);
      break;
    }

    const jetzt = new Date();

    try {
      const phones = person.phones || [];
      const primary = phones.find(p => p.primary) || phones[0];

      if (!primary || !primary.value) {
        pufferZeilen.push([jetzt, person.id, person.name, '', '', false, 'keine Telefonnummer hinterlegt', '', false, '', '', '', '', '', 'keine Nummer', 'übersprungen (keine Nummer)']);
        heuteGeprueft++;
        if (pufferZeilen.length >= 200) flush();
        continue;
      }

      const format = normalizeAustrianPhone(primary.value);

      // AbstractAPI berechnet 1 Credit pro Anfrage, AUCH bei erkennbar ungültigen Nummern
      // (laut Doku: "if you submit ... an invalid phone number ... that still counts as
      // 1 credit"). Bei Formatfehlern bringt der Existenz-Check ohnehin kaum verlässliche
      // Aussage -- deshalb nur bei formatOk aufrufen, sonst wird das knappe Monatskontingent
      // für Nummern verbrannt, die schon als Format-Problem geflaggt sind. Bei Platzhalter-
      // Verdacht ebenfalls überspringen -- das Ergebnis wird eh verworfen (siehe
      // PipedriveWriteBack.gs), also lohnt sich der Credit nicht (Fall Hakenschmidt, 08.09.2026).
      let existenz = null;
      if (format.formatOk && !format.platzhalterVerdacht) {
        existenz = checkPhoneExistence(format.normalized);
        existenzChecksMonat++;
        existenzChecksDiesLauf++;
        props.setProperty(MONATSZAEHLER_PROPERTY, String(existenzChecksMonat)); // sofort persistieren, nicht erst am Ende
        Utilities.sleep(1100); // Freiplan-Limit lt. Doku: 1 Anfrage/Sekunde, sonst 429
      }

      const verdacht = ermittleVerdacht(format, existenz);
      const pipedriveStatus = schreibePersonStatus(person.id, primary.value, format, existenz);
      pufferZeilen.push([
        jetzt, person.id, person.name, primary.value, format.normalized || '', format.formatOk, format.reason,
        format.lineTypeGuess, existenz !== null,
        existenz ? existenz.existiert : '', existenz ? existenz.valide : '', existenz ? existenz.lineType : '',
        existenz ? existenz.carrier : '', existenz ? existenz.riskLevel : '', verdacht,
        pipedriveStatus
      ]);
      heuteGeprueft++;
    } catch (err) {
      pufferZeilen.push([jetzt, person.id, person.name || '', '', '', '', '', '', false, '', '', '', '', '', 'FEHLER bei Verarbeitung: ' + err.message, '']);
      heuteGeprueft++;
      Logger.log('Fehler bei Person %s: %s', person.id, err.message);
    }

    if (pufferZeilen.length >= 200) flush();
  }

  flush();
  Logger.log('Fertig für heute -- %s Personen geprüft, %s/%s Existenz-Checks diesen Monat verbraucht.', heuteGeprueft, existenzChecksMonat, MAX_EXISTENZ_CHECKS_PRO_MONAT);
}

// Einmalig ausführen -- richtet den täglichen Trigger ein, verhindert Duplikate bei Mehrfachaufruf.
function richteTaeglichenTriggerEin() {
  const bestehende = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'taeglicherTelefonCheck');
  if (bestehende.length) {
    Logger.log('Trigger existiert bereits (%s Stück) -- nichts geändert.', bestehende.length);
    return;
  }
  ScriptApp.newTrigger('taeglicherTelefonCheck').timeBased().everyDays(1).atHour(6).create();
  Logger.log('Täglicher Trigger für taeglicherTelefonCheck() um ca. 6 Uhr (Europe/Vienna) eingerichtet.');
}

// Setzt NUR das Monatskontingent zurück (nicht die Sheet-Historie) -- z.B. zum Testen.
function setzeMonatskontingentZurueck() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(MONAT_PROPERTY, '');
  props.setProperty(MONATSZAEHLER_PROPERTY, '0');
  Logger.log('Monatskontingent zurückgesetzt -- nächster taeglicherTelefonCheck() darf wieder das volle Kontingent verbrauchen.');
}
