// ============================================================
// CT-TERMINE — Cash-Collection-Termine aus den Pipedrive-Activities
// ============================================================
// Der Rest dieses Projekts vergleicht DATUMSFELDER AM DEAL gegen den Snapshot.
// CT-Termine funktionieren anders: sie sind Activities. Deshalb hier eine
// eigene Quelle, die sich fuer die Regel-Maschine wie ein weiteres Terminfeld
// verhaelt ("Pseudo-Feld" CT-Termin). Alles danach — Regeln-Tab, Vorlagen,
// Doppelpost-Schutz, Ruhezeit, Log — bleibt unveraendert.
//
// Drei Befunde aus dem CT-Tracking (16./17.09.2026), die den Aufbau bestimmen:
//
// 1. Die Activities haengen bei vielen Deals an der PERSON, nicht am Deal
//    (deal_id: null, person_id gesetzt — belegt bei Deal 7500 und 7468).
//    Ein Abruf pro Deal findet sie deshalb NICHT. Hier wird einmal breit
//    gelesen und danach ueber person_id UND deal_id gejoint.
//
// 2. Der Activity-TYP ist uneinheitlich: fzweitgesprach, teils meeting.
//    Verlaesslich ist nur der BETREFF-Marker "(CT)" aus der
//    Kalender-Namenskonvention "PLZ Name (CT)". Der Typ wird bewusst NICHT als
//    Torwaechter benutzt — er dient nur einer Warnung.
//
// 3. Doppel-Deals sind bei RP der Normalfall (alter offener Deal in Pipeline 1
//    plus echter Deal in Pipeline 2). Weil dieses Projekt ausschliesslich ueber
//    Pipeline-2-Deals laeuft und der Join von dort ausgeht, kann der falsche
//    Deal hier nicht gewinnen — anders als bei searchDeals mit Relevanz-Score.
//
// Was dieses File NICHT kann und bewusst nicht kann: "CT gesetzt" und
// "CT verschoben" melden. Dafuer braeuchte der Snapshot-Tab eine eigene
// Spalte, und ein neu angehaengtes leeres Feld haette beim ersten Lauf jeden
// bestehenden CT als "gerade gesetzt" gemeldet — genau die Spam-Welle, gegen
// die es SNAPSHOT_INITIALISIEREN gibt. Erlaubt sind deshalb nur die
// datumsbasierten Ereignisse "vorher" und "am Tag", und die brauchen keinen
// Snapshot. Eine Verschiebung faellt trotzdem nicht durch: das Termindatum
// steckt im Doppelpost-Schluessel, ein neues Datum ergibt einen neuen
// Schluessel und damit eine neue Erinnerung.

// Der Name, den Valentin im Regeln-Tab in die Spalte "Feld" schreibt.
const CT_PSEUDO_FELD = 'CT-Termin';

// Feld-Namen, die nicht aus TERMIN_FELDER kommen. Regeln.gs laesst sie durch.
const PSEUDO_FELDER = { 'CT-Termin': true };

// Nur diese Ereignisse sind fuer ein Pseudo-Feld erlaubt — Begruendung oben.
const PSEUDO_EREIGNISSE_ERLAUBT = ['vorher', 'am Tag'];

// Der Torwaechter. "(CT)", "( CT )", "(ct)" — alles gleich.
const CT_BETREFF_MARKER = /\(\s*CT\s*\)/i;

// Typen, bei denen ein fehlender Betreff-Marker verdaechtig ist. Diese Faelle
// werden gezaehlt und protokolliert, aber nicht gemeldet: eine Erinnerung auf
// Verdacht an einen Kunden zu schicken ist schlimmer, als eine zu verpassen.
const CT_VERDACHTS_TYPEN = ['fzweitgesprach'];

// Harte Obergrenze fuer die Seitenzahl. 40 x 500 = 20.000 offene Activities.
// Wird die erreicht, ist etwas grundlegend anders als angenommen — dann soll
// der Lauf laut sein und nicht still die Haelfte uebersehen.
const CT_MAX_SEITEN = 40;

// /users ist v1 (Token als Query-Parameter), nicht v2. Steht so in
// docs/REFERENZ-Pipedrive-AppsScript.md, Abschnitt 1.
const PIPEDRIVE_BASE_V1 = 'https://rp-energietechnik.pipedrive.com/api/v1';

const WA_BASIS = 'https://wa.me/';

// Wird pro Sweep gesetzt, damit leseTerminfeld() ohne Signaturaenderung an die
// CT-Daten kommt. Apps Script fuehrt einen Lauf einzeln aus, und sweep() haelt
// zusaetzlich den LockService — ein zweiter Lauf kann hier nicht dazwischen.
var _ctMapAktuell = null;

// Sichtbare Zweifelsfaelle eines Laufs. Landen in der Hinweis-Spalte des
// Laeufe-Tabs: der Logger von Apps Script ist nach 7 Tagen weg, der Tab nicht.
var _ctWarnungen = [];

// Setzt NUR die Map. Die Warnliste wird hier absichtlich nicht geleert:
// holeCtMap() sammelt schon vorher (Seitenlimit!), und der Aufruf kommt
// danach — ein Leeren hier hat genau diese Warnung verschluckt.
// Zurueckgesetzt wird am Anfang von holeCtMap(); Apps Script startet jeden
// Lauf mit frischen Globals, ein zweites Zuruecksetzen braucht es nicht.
function setzeCtMap(ctMap) {
  _ctMapAktuell = ctMap;
}

// Jede Warnung nur EINMAL. ctFuerDeal() laeuft pro Deal x Regel und zusaetzlich
// in baueKontext() — derselbe Doppel-CT haette sonst "6 Zweifelsfaelle"
// gemeldet, wo es zwei sind.
function ctWarnung(text) {
  if (_ctWarnungen.indexOf(text) === -1) _ctWarnungen.push(text);
}

function ctWarnungen() {
  return _ctWarnungen;
}

// ---------- Abruf ----------
// Ein Sweep ueber die offenen Activities. Der Endpoint kennt KEINEN
// due_date-Filter (nachgesehen, nicht angenommen: filterbar sind nur deal_id,
// person_id, org_id, owner_id, done, filter_id und updated_since/until). Es
// wird deshalb breit gelesen und im Speicher gefiltert.
// done:false ist der eigentliche Sparfilter — erledigte CTs interessieren
// nicht, und eine Erinnerung an einen abgehakten Termin waere ein Fehler.
function holeCtMap() {
  const start = Date.now();
  _ctWarnungen = [];
  const proPerson = {};
  const proDeal = {};
  let cursor = null;
  let seiten = 0;
  let gesehen = 0;
  let gefunden = 0;
  let verdacht = 0;
  // Die Verdachtsfaelle werden aufbewahrt, nicht nur gezaehlt: der
  // Kalender-Abgleich kann zu jedem einzelnen sagen, ob am selben Tag ein
  // (CT)-Termin im Kalender steht — und damit aus einem Verdacht eine
  // Entscheidungsgrundlage machen.
  const verdachtsfaelle = [];

  do {
    if (Date.now() - start > MAX_LAUFZEIT_MS) {
      throw new Error('Zeitlimit beim CT-Abruf nach ' + seiten + ' Seiten. Lauf abgebrochen.');
    }
    const params = { done: false, limit: 500 };
    if (cursor) params.cursor = cursor;
    const json = fetchPipedriveJson('/activities', params);

    (json.data || []).forEach(function (a) {
      gesehen++;
      if (!a.due_date) return; // Aufgabe ohne Datum — kein Termin

      if (!CT_BETREFF_MARKER.test(String(a.subject || ''))) {
        if (CT_VERDACHTS_TYPEN.indexOf(a.type) !== -1) {
          verdacht++;
          verdachtsfaelle.push({
            activityId: a.id,
            betreff: String(a.subject || ''),
            datum: ctLokal(a).datum,
            uhrzeit: ctLokal(a).uhrzeit,
            typ: a.type || ''
          });
          Logger.log('… Typ "%s" ohne (CT) im Betreff: Activity %s "%s" (%s) — nicht gemeldet.',
            a.type, a.id, a.subject, a.due_date);
        }
        return;
      }

      const lokal = ctLokal(a);
      const treffer = {
        activityId: a.id,
        datum: lokal.datum,
        uhrzeit: lokal.uhrzeit,
        ownerId: a.owner_id || null,
        personId: a.person_id || null,
        dealId: a.deal_id || null,
        betreff: String(a.subject || ''),
        typ: a.type || ''
      };
      gefunden++;
      if (treffer.personId) haengeCtAn(proPerson, treffer.personId, treffer);
      if (treffer.dealId) haengeCtAn(proDeal, treffer.dealId, treffer);
    });

    cursor = json.additional_data && json.additional_data.next_cursor;
    seiten++;
  } while (cursor && seiten < CT_MAX_SEITEN);

  if (cursor) {
    const text = 'CT-Abruf am Seitenlimit abgebrochen (' + CT_MAX_SEITEN +
      ' Seiten). Es koennen CT-Termine fehlen.';
    Logger.log('⚠️ %s', text);
    ctWarnung(text);
  }

  Logger.log('CT-Abruf: %s offene Activities auf %s Seiten, %s davon mit (CT)-Marker%s.',
    gesehen, seiten, gefunden,
    verdacht ? ', ' + verdacht + ' Verdachtsfaelle ohne Marker (siehe oben)' : '');

  return {
    proPerson: proPerson,
    proDeal: proDeal,
    gesehen: gesehen,
    gefunden: gefunden,
    verdacht: verdacht,
    verdachtsfaelle: verdachtsfaelle
  };
}

// due_date + due_time einer Activity sind UTC, nicht Wiener Zeit (gemessen
// 23.09.2026, Activity 16910: due_time "14:30", Kalender 16:30 MESZ). Roh
// uebernommen stand in der Kundenerinnerung zwei Stunden zu frueh. Ohne
// Uhrzeit bleibt das Datum wie es ist — ganztaegig, nichts umzurechnen.
// Nach der Umrechnung kann auch das DATUM kippen (23:30 UTC = 01:30 am
// Folgetag), deshalb beides aus demselben Zeitpunkt.
function ctLokal(a) {
  const datum = String(a.due_date).slice(0, 10);
  // "10:30:00" kommt vor, in der Nachricht will niemand die Sekunden.
  const zeit = String(a.due_time || '').slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(zeit)) return { datum: datum, uhrzeit: '' };
  const d = new Date(datum + 'T' + zeit + ':00Z');
  if (isNaN(d.getTime())) return { datum: datum, uhrzeit: zeit };
  const tz = Session.getScriptTimeZone();
  return {
    datum: Utilities.formatDate(d, tz, 'yyyy-MM-dd'),
    uhrzeit: Utilities.formatDate(d, tz, 'HH:mm')
  };
}

function haengeCtAn(map, id, treffer) {
  const key = String(id);
  if (!map[key]) map[key] = [];
  // Dieselbe Activity kann ueber person_id und deal_id kommen — nicht doppeln.
  const schonDa = map[key].some(function (t) { return t.activityId === treffer.activityId; });
  if (!schonDa) map[key].push(treffer);
}

// ---------- Join ----------
// deal_id zuerst, person_id als Rueckfall. Genau diese Reihenfolge, weil die
// deal_id — wenn gesetzt — die Aussage der Activity selbst ist und nicht
// hergeleitet.
function ctFuerDeal(ctMap, deal) {
  if (!ctMap || !deal) return null;

  let treffer = ctMap.proDeal[String(deal.id)] || null;
  if (!treffer && deal.person_id) treffer = ctMap.proPerson[String(deal.person_id)] || null;
  if (!treffer || !treffer.length) return null;

  if (treffer.length > 1) {
    // Zwei offene CTs zum selben Kunden sind ein Datenproblem, keine
    // Terminlage. Hier wird nicht geraten (CLAUDE.md: mehrdeutige Faelle
    // entscheidbar machen) — alle Kandidaten kommen ins Protokoll, der Mensch
    // raeumt in Pipedrive auf.
    const liste = treffer.map(function (t) {
      return '#' + t.activityId + ' ' + t.datum + ' ' + (t.uhrzeit || '') + ' "' + t.betreff + '"';
    }).join(' | ');
    const text = 'Deal ' + deal.id + ' hat ' + treffer.length +
      ' offene CT-Termine — keine Erinnerung verschickt: ' + liste;
    Logger.log('⚠️ UNSICHER: %s', text);
    ctWarnung(text);
    return null;
  }

  const ct = treffer[0];

  // Gegenprobe im Kalender. Widersprechen sich die Uhrzeiten, geht keine
  // Nachricht raus — eine Erinnerung auf die falsche Stunde ist schlimmer als
  // keine, weil der Kunde sich danach richtet. Ein fehlender Kalendereintrag
  // stoppt dagegen nichts (dann ist eher der Kalender der falsche).
  const kal = pruefeCtKalender(ct, deal, null);
  if (kal.status === 'konflikt') {
    Logger.log('⚠️ KALENDER-KONFLIKT: %s', kal.text);
    ctWarnung(kal.text);
    if (CT_KALENDER_KONFLIKT_STOPPT) return null;
  } else if (kal.status === 'kein_eintrag') {
    Logger.log('… %s', kal.text);
  }

  return ct;
}

// Wie viele CT-Termine hat der Sweep gefunden, die zu KEINEM Pipeline-2-Deal
// gehoeren? Das ist die Frage, die ein stiller Channel nicht beantwortet:
// "es gibt heute nichts" sieht genauso aus wie "der Join geht ins Leere".
// Gleiche Lehre wie beim Cloudflare-Relay, das immer 200 gemeldet hat.
function pruefeCtOhneDeal(ctMap, deals) {
  if (!ctMap) return;

  const erreichbareDeals = {};
  const erreichbarePersonen = {};
  deals.forEach(function (d) {
    if (d.id) erreichbareDeals[String(d.id)] = true;
    if (d.person_id) erreichbarePersonen[String(d.person_id)] = true;
  });

  const verwaist = {};
  ['proDeal', 'proPerson'].forEach(function (welche) {
    Object.keys(ctMap[welche]).forEach(function (id) {
      ctMap[welche][id].forEach(function (t) {
        const perDeal = t.dealId && erreichbareDeals[String(t.dealId)];
        const perPerson = t.personId && erreichbarePersonen[String(t.personId)];
        if (perDeal || perPerson) return;
        verwaist[t.activityId] = t;
      });
    });
  });

  const anzahl = Object.keys(verwaist).length;
  if (!anzahl) return;
  const beispiele = Object.keys(verwaist).slice(0, 3).map(function (id) {
    const t = verwaist[id];
    return '#' + id + ' ' + t.datum + ' "' + t.betreff + '"';
  }).join(' | ');
  const text = anzahl + ' CT-Termin(e) gehoeren zu keinem Deal der Pipeline ' + PIPELINE_ID +
    ' — dafuer kommt keine Erinnerung: ' + beispiele;
  Logger.log('⚠️ %s', text);
  ctWarnung(text);
}

// FIX 4 (Review 21.09.2026): der Join laeuft ueber person_id. Hat EINE Person
// zwei Deals in Pipeline 2, haengt derselbe CT an beiden — und weil die
// deal_id im Doppelpost-Schluessel steckt, kommt die Erinnerung zweimal.
// Der Doppelpost-Schutz kann das nicht abfangen, er sieht zwei verschiedene
// Deals. Also melden statt hoffen: der Mensch raeumt den Doppel-Deal auf.
// Siehe auch die Doppel-Deal-Falle im CT-Tracking.
function pruefeDoppelDeals(ctMap, deals) {
  if (!ctMap) return;

  const proPerson = {};
  deals.forEach(function (d) {
    if (!d.person_id) return;
    const k = String(d.person_id);
    if (!proPerson[k]) proPerson[k] = [];
    proPerson[k].push(d);
  });

  Object.keys(ctMap.proPerson).forEach(function (personId) {
    const dealsDerPerson = proPerson[personId];
    if (!dealsDerPerson || dealsDerPerson.length < 2) return;
    // Haengt der CT direkt an einem Deal, entscheidet die deal_id und der
    // Person-Rueckfall greift gar nicht — dann ist nichts doppelt.
    const nurUeberPerson = ctMap.proPerson[personId].filter(function (t) { return !t.dealId; });
    if (!nurUeberPerson.length) return;

    const text = 'Person ' + personId + ' hat ' + dealsDerPerson.length +
      ' Deals in Pipeline ' + PIPELINE_ID + ' (' +
      dealsDerPerson.map(function (d) { return d.id; }).join(', ') +
      ') und einen CT ohne deal_id — die Erinnerung geht pro Deal einmal raus. ' +
      'Doppel-Deal in Pipedrive aufraeumen oder die Activity an einen Deal haengen.';
    Logger.log('⚠️ %s', text);
    ctWarnung(text);
  });
}

// ---------- Cash Collector ----------
// Der Deal-owner ist hier NICHT brauchbar: die Fulfillment-Uebernahme haengt
// den Deal auf Valentin um (85 von 86 Deals, Befund 17.09.2026). Der
// Activity-owner wird dabei nicht umgehaengt und ueberlebt die Uebernahme — er
// ist die einzige verlaessliche Quelle dafuer, wer den Termin tatsaechlich
// haelt.
function holeUserMap() {
  const map = {};
  try {
    const url = PIPEDRIVE_BASE_V1 + '/users?api_token=' + encodeURIComponent(getPipedriveToken());
    const response = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      throw new Error('HTTP ' + response.getResponseCode());
    }
    const json = JSON.parse(response.getContentText());
    (json.data || []).forEach(function (u) {
      map[String(u.id)] = String(u.name || '').trim();
    });
    Logger.log('User-Map: %s Pipedrive-Nutzer.', Object.keys(map).length);
  } catch (fehler) {
    // Ein fehlender Name darf keine Erinnerung verhindern — der Platzhalter
    // bleibt dann leer und raeumeZeileAuf() wirft das Trennzeichen mit raus.
    Logger.log('⚠️ User-Map nicht abrufbar (%s). {cc} bleibt leer.', fehler.message);
  }
  return map;
}

// Nur der Vorname des Cash Collectors. In einer Kundennachricht steht
// "Beste Gruesse, Sean" und nicht der volle Name samt Nachname.
function vornameVon(vollerName) {
  if (!vollerName) return '';
  return String(vollerName).trim().split(/\s+/)[0];
}

// ---------- wa.me-Link ----------
// Der Kern von "Weg A": keine WhatsApp-Automatik, kein Browser-Bot, kein
// Bann-Risiko auf der Firmennummer. Der Link oeffnet WhatsApp Desktop mit dem
// fertigen Text im Eingabefeld — Absenden bleibt eine Menschenentscheidung.
//
// Rufnummer -> reine Landesvorwahl+Nummer ohne Zeichen, wie wa.me es braucht.
// Dieselbe AT-Regel wie in Telefon-Qualifizierung/PhoneFormat.gs: RPs
// Kundenbasis ist praktisch nur Oesterreich, eine fuehrende 0 ohne
// Landesvorwahl ist deshalb AT und keine Rateentscheidung.
// Rueckgabe null = Nummer nicht verwertbar -> {walink} bleibt leer, statt
// einen Link zu bauen, der bei einem fremden Menschen landet.
function waNummer(rohe) {
  if (!rohe) return null;
  const s = String(rohe).trim();
  const plus = s.charAt(0) === '+';
  let ziffern = s.replace(/\D/g, '');
  if (!ziffern) return null;

  if (plus) {
    // schon international, nichts zu tun
  } else if (ziffern.indexOf('00') === 0) {
    ziffern = ziffern.slice(2);
  } else if (ziffern.indexOf('0') === 0) {
    ziffern = '43' + ziffern.slice(1);
  } else if (ziffern.indexOf('43') !== 0) {
    // Weder +, noch 00, noch fuehrende 0, noch schon 43 vorne: unklar, was das
    // sein soll. Nicht raten.
    return null;
  }

  // 43 + Vorwahl + Nummer ergibt mindestens 11 Stellen; ueber 15 erlaubt die
  // E.164-Norm nicht. Der Puffer nach unten ist bewusst grosszuegig (10),
  // damit kurze Festnetznummern nicht rausfallen.
  if (ziffern.length < 10 || ziffern.length > 15) return null;
  return ziffern;
}

function baueWaLink(rohe, text) {
  const nummer = waNummer(rohe);
  if (!nummer) return '';
  const nutztext = String(text || '').trim();
  if (!nutztext) return WA_BASIS + nummer;
  return WA_BASIS + nummer + '?text=' + kodiereWaText(nutztext);
}

// encodeURIComponent() laesst ( ) ' ! * durch. In Slacks <url|label> stoert das
// nicht, aber der Link wird auch aus dem Log kopiert — und Terminals, Editoren
// und Markdown-Parser schneiden an einer ")" gern ab. Also mitkodieren.
function kodiereWaText(text) {
  return encodeURIComponent(text).replace(/[()'!*]/g, function (z) {
    return '%' + z.charCodeAt(0).toString(16).toUpperCase();
  });
}
