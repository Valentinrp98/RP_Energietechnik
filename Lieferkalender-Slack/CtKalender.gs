/**
 * CtKalender.gs — Gegenprobe der CT-Termine im Google Kalender.
 *
 * Warum ueberhaupt: die CT-Termine entstehen im Kalender und werden nach
 * Pipedrive uebertragen. Driften die zwei auseinander, merkt es niemand — bis
 * eine Erinnerung mit der falschen Uhrzeit beim Kunden landet. Genau das ist
 * der Fall, der weh tut, weil er nach draussen geht.
 *
 * Der Abgleich beantwortet drei Fragen:
 *   1. Steht der CT aus Pipedrive auch im Kalender, und mit derselben Uhrzeit?
 *   2. Gibt es Kalender-Termine mit (CT)-Marker, zu denen in Pipedrive keine
 *      Activity existiert? (Die bekaemen sonst nie eine Erinnerung.)
 *   3. Bei den Verdachtsfaellen ohne Marker: hilft der Kalender weiter?
 *
 * Standardmaessig AUS: CT_KALENDER_ID ist leer, weil ich die richtige
 * Kalender-ID nicht raten darf. listeKalender() zeigt alle zur Auswahl.
 */

// Leer = Abgleich aus. listeKalender() einmal laufen lassen und die passende
// ID hier eintragen.
const CT_KALENDER_ID = '';

// Bei einem echten WIDERSPRUCH (Pipedrive sagt 15:00, Kalender sagt 16:00)
// wird keine Erinnerung verschickt, sondern der Fall protokolliert. Lieber
// keine Nachricht als eine mit der falschen Uhrzeit — der Kunde richtet sich
// danach. Ein FEHLENDER Kalendereintrag stoppt dagegen nichts: dann ist
// wahrscheinlich der Kalender der falsche, nicht der Termin.
const CT_KALENDER_KONFLIKT_STOPPT = true;

const CT_KALENDER_TAGE_VOR = 7;
const CT_KALENDER_TAGE_NACH = 90;

var _ctKalMap = null;

// Diagnose: alle Kalender, auf die das Script zugreifen kann, mit ID.
// Die ID ist bei eigenen Kalendern die Mailadresse, bei fremden/geteilten eine
// lange Adresse auf @group.calendar.google.com.
function listeKalender() {
  const alle = CalendarApp.getAllCalendars();
  Logger.log('%s Kalender erreichbar:', alle.length);
  alle.forEach(function (k) {
    Logger.log('  %s%s\n      ID: %s',
      k.getName(),
      k.isMyPrimaryCalendar() ? '  (Hauptkalender)' : '',
      k.getId());
  });
  Logger.log('Die passende ID in CT_KALENDER_ID in CtKalender.gs eintragen, dann clasp push bzw. speichern.');
}

// ---------------------------------------------------------------------------
// Kalender einlesen
// ---------------------------------------------------------------------------

// Liefert { 'YYYY-MM-DD': [ {titel, von, bis, ganztags, istCt, id} ] }
// oder null, wenn der Abgleich aus ist bzw. der Kalender nicht erreichbar ist.
function holeCtKalenderMap() {
  if (!CT_KALENDER_ID) return null;

  const kalender = CalendarApp.getCalendarById(CT_KALENDER_ID);
  if (!kalender) {
    ctWarnung('Kalender "' + CT_KALENDER_ID + '" ist nicht erreichbar — Abgleich entfaellt. ' +
      'listeKalender() zeigt die gueltigen IDs.');
    return null;
  }

  const von = new Date();
  von.setDate(von.getDate() - CT_KALENDER_TAGE_VOR);
  const bis = new Date();
  bis.setDate(bis.getDate() + CT_KALENDER_TAGE_NACH);

  const map = {};
  let anzahl = 0;
  kalender.getEvents(von, bis).forEach(function (e) {
    const start = e.getStartTime();
    const tag = Utilities.formatDate(start, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (!map[tag]) map[tag] = [];
    map[tag].push({
      titel: String(e.getTitle() || ''),
      von: e.isAllDayEvent() ? '' : Utilities.formatDate(start, Session.getScriptTimeZone(), 'HH:mm'),
      ganztags: e.isAllDayEvent(),
      istCt: CT_BETREFF_MARKER.test(String(e.getTitle() || '')),
      id: e.getId()
    });
    anzahl++;
  });

  Logger.log('Kalender-Abgleich: %s Termine aus "%s" (%s bis %s).',
    anzahl, kalender.getName(),
    Utilities.formatDate(von, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    Utilities.formatDate(bis, Session.getScriptTimeZone(), 'yyyy-MM-dd'));
  return map;
}

function setzeCtKalenderMap(map) {
  _ctKalMap = map;
}

function ctKalenderMap() {
  return _ctKalMap;
}

// ---------------------------------------------------------------------------
// Zuordnung Kalender-Termin <-> Deal
// ---------------------------------------------------------------------------

// Titel vergleichbar machen: Kleinschreibung, Umlaute aufgeloest, alles ausser
// Buchstaben/Ziffern zu Leerzeichen. "Peter/petre Palinceac" und
// "2340 Palinceac (CT)" sollen sich finden.
function normTitel(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Namensbestandteile ab 4 Zeichen. Kuerzere ("van", "el", "dr") treffen zu
// leicht auf fremde Termine.
function namensTeile(text) {
  return normTitel(text).split(' ').filter(function (w) { return w.length >= 4; });
}

// Alle Kalender-Termine eines Tages, deren Titel zum Deal passt.
function kalenderTrefferFuer(datum, deal, plzMap) {
  const map = ctKalenderMap();
  if (!map) return null;
  const amTag = map[datum];
  if (!amTag) return [];

  const teile = namensTeile(deal.title);
  const p = (deal.person_id && plzMap && plzMap[deal.person_id]) || {};
  namensTeile((p.vorname || '') + ' ' + (p.nachname || '')).forEach(function (w) {
    if (teile.indexOf(w) === -1) teile.push(w);
  });
  if (!teile.length) return [];

  return amTag.filter(function (e) {
    const t = normTitel(e.titel);
    return teile.some(function (w) { return t.indexOf(w) !== -1; });
  });
}

// ---------------------------------------------------------------------------
// Die eigentliche Pruefung
// ---------------------------------------------------------------------------

// Gibt { status, text } zurueck. status ist:
//   'aus'          — kein Kalender konfiguriert
//   'ok'           — Kalender bestaetigt Datum und Uhrzeit
//   'ohne_uhrzeit' — Termin gefunden, aber ganztags / keine Uhrzeit zu pruefen
//   'kein_eintrag' — nichts Passendes im Kalender (Hinweis, kein Stopper)
//   'konflikt'     — Uhrzeit widerspricht sich (Stopper, s. Konstante)
function pruefeCtKalender(ct, deal, plzMap) {
  if (!ctKalenderMap()) return { status: 'aus', text: '' };

  const treffer = kalenderTrefferFuer(ct.datum, deal, plzMap);
  if (!treffer || !treffer.length) {
    return {
      status: 'kein_eintrag',
      text: 'Deal ' + deal.id + ' (' + deal.title + '): CT am ' + ct.datum +
        ' steht in Pipedrive (Activity #' + ct.activityId +
        '), im Kalender findet sich am Tag kein passender Termin.'
    };
  }

  if (!ct.uhrzeit) {
    return { status: 'ohne_uhrzeit', text: '' };
  }

  // Stimmt irgendein passender Termin in der Uhrzeit, ist gut. Mehrere
  // Eintraege am Tag sind normal (Vor- und Nachbesprechung, Doppelbuchung).
  const gleich = treffer.filter(function (e) { return e.von === ct.uhrzeit; });
  if (gleich.length) return { status: 'ok', text: '' };

  const nurGanztags = treffer.every(function (e) { return e.ganztags || !e.von; });
  if (nurGanztags) return { status: 'ohne_uhrzeit', text: '' };

  return {
    status: 'konflikt',
    text: 'Deal ' + deal.id + ' (' + deal.title + '): Pipedrive sagt ' + ct.datum +
      ' ' + ct.uhrzeit + ' (Activity #' + ct.activityId + '), der Kalender sagt ' +
      treffer.map(function (e) { return (e.von || 'ganztags') + ' "' + e.titel + '"'; }).join(' / ') +
      '. Welche Uhrzeit gilt?'
  };
}

// Umgekehrte Richtung: Kalender-Termine mit (CT)-Marker, zu denen keine offene
// Pipedrive-Activity gefunden wurde. Die bekaemen sonst nie eine Erinnerung,
// und zwar ohne dass irgendwo etwas auffaellt.
function pruefeKalenderOhnePipedrive(ctMap, deals, plzMap) {
  const map = ctKalenderMap();
  if (!map || !ctMap) return;

  // Alle (Datum, Uhrzeit)-Paare, die Pipedrive kennt.
  const bekannt = {};
  [ctMap.proDeal, ctMap.proPerson].forEach(function (teil) {
    Object.keys(teil).forEach(function (k) {
      teil[k].forEach(function (t) { bekannt[t.datum + ' ' + (t.uhrzeit || '')] = true; });
    });
  });

  const heute = heuteAlsText();
  const offen = [];
  Object.keys(map).forEach(function (tag) {
    if (tag < heute) return;   // Vergangenes interessiert hier nicht
    map[tag].forEach(function (e) {
      if (!e.istCt) return;
      if (bekannt[tag + ' ' + e.von]) return;
      // Auch ohne Uhrzeit-Treffer: steht am selben Tag ueberhaupt ein CT in
      // Pipedrive, ist es wahrscheinlich derselbe Termin mit abweichender
      // Uhrzeit — den Fall meldet schon pruefeCtKalender().
      const irgendeinerAmTag = Object.keys(bekannt).some(function (k) { return k.indexOf(tag) === 0; });
      if (irgendeinerAmTag) return;
      offen.push(tag + ' ' + (e.von || 'ganztags') + ' "' + e.titel + '"');
    });
  });

  if (!offen.length) return;
  ctWarnung(offen.length + ' CT-Termin(e) stehen im Kalender, aber nicht als offene Activity in ' +
    'Pipedrive — dafuer kommt keine Erinnerung: ' + offen.slice(0, 5).join(' | ') +
    (offen.length > 5 ? ' (+' + (offen.length - 5) + ' weitere)' : ''));
  offen.forEach(function (z) { Logger.log('   ⚠️ nur im Kalender: %s', z); });
}

// Hilft bei den Verdachtsfaellen ohne (CT)-Marker: steht im Kalender zur selben
// Zeit ein Termin, dessen Titel den Marker traegt, ist der Verdacht so gut wie
// bestaetigt — und der Betreff in Pipedrive einfach nur schlampig. Entschieden
// wird trotzdem von Hand; die Funktion liefert nur die Begruendung dazu.
function pruefeVerdachtGegenKalender(verdachtsfaelle) {
  const map = ctKalenderMap();
  if (!map || !verdachtsfaelle || !verdachtsfaelle.length) return;

  Logger.log('--- Verdachtsfaelle gegen den Kalender ---');
  verdachtsfaelle.forEach(function (v) {
    const amTag = map[v.datum] || [];
    const mitMarker = amTag.filter(function (e) { return e.istCt; });
    if (!mitMarker.length) {
      Logger.log('   #%s "%s" (%s): am Tag kein (CT)-Termin im Kalender — eher kein CT.',
        v.activityId, v.betreff, v.datum);
      return;
    }
    Logger.log('   #%s "%s" (%s): im Kalender am Tag %s → %s',
      v.activityId, v.betreff, v.datum,
      mitMarker.length === 1 ? 'ein (CT)-Termin' : mitMarker.length + ' (CT)-Termine',
      mitMarker.map(function (e) { return (e.von || 'ganztags') + ' "' + e.titel + '"'; }).join(' / '));
  });
}
