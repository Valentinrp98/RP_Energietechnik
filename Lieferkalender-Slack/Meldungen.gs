// ============================================================
// MELDUNGEN — Text bauen, Doppelposts verhindern, nach Slack schicken
// ============================================================
// Post-Muster uebernommen aus Geburtstagskalender-Sync/Geburtstagspost.gs:48.

const LOG_SPALTEN = ['Zeitpunkt', 'Deal-ID', 'Feld', 'Ereignis', 'Channel', 'Schluessel', 'Text'];

// Schluessel im Log aelter als das hier werden beim Schreiben verworfen, damit
// der Tab nicht unbegrenzt waechst. 120 Tage sind deutlich mehr als der
// laengste Vorlauf, den eine "vorher"-Regel sinnvoll haben kann.
const LOG_AUFBEWAHRUNG_TAGE = 120;

// ---------- Platzhalter ----------
// Was hier NICHT drin ist und bewusst nicht: kWp/Speicher (stehen in
// Anlagendetails, Fuellstand ungemessen) und Telefon (haengt an der Person,
// braucht einen Extra-Call). Beides schaut Valentin im Deal nach — dafuer ist
// {deallink} da.
function baueText(vorlage, kontext) {
  let text = vorlage;
  Object.keys(kontext).forEach(function (name) {
    const wert = kontext[name];
    text = text.split('{' + name + '}').join(wert === null || wert === undefined ? '' : String(wert));
  });
  // Nicht ersetzte Platzhalter sichtbar machen statt still stehen lassen —
  // sonst steht "{kwpp}" in der Slack-Nachricht und niemand weiss warum.
  const uebrig = text.match(/\{[a-zA-Z_]+\}/g);
  if (uebrig) {
    Logger.log('⚠️ Unbekannte Platzhalter in der Vorlage: %s', uebrig.join(', '));
  }

  // "\n" als zwei Zeichen in der Sheet-Zelle wird hier zum echten Umbruch.
  // Alt+Enter in der Zelle geht auch, ist aber beim Copy-Paste einer ganzen
  // Regel-Tabelle nicht durchzuhalten — mehrzeilige Zellen zerreissen dabei.
  text = text.split('\\n').join('\n');

  // Tabs und Mehrfach-Leerzeichen zusammenziehen, Umbrueche aber behalten.
  text = text.replace(/[ \t]+/g, ' ');

  return text.split('\n').map(raeumeZeileAuf).filter(function (z) { return z !== ''; }).join('\n');
}

// Ein leerer Platzhalter hinterlaesst sonst sein Trennzeichen: aus
// "{kunde} · {plz} · {partner}" wird bei fehlender PLZ "Muster ·  · ALE".
// Darum die Zeile an "·" zerlegen, leere Stuecke wegwerfen, neu zusammensetzen.
// Klammern um einen leeren Wert ("( )") faellt dieselbe Regel zum Opfer.
function raeumeZeileAuf(zeile) {
  let z = zeile.replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '');
  // Slack-Link mit leerer URL: aus "<{walink}|WhatsApp öffnen>" wird bei
  // unbrauchbarer Telefonnummer "<|WhatsApp öffnen>" — das rendert Slack als
  // sichtbaren Muell. Statt es still zu schlucken wird daraus ein Hinweis:
  // eine fehlende Nummer ist genau die Information, die Valentin braucht.
  z = z.replace(/<\|[^>]*>/g, '⚠️ keine WhatsApp-Nummer');
  if (z.indexOf('·') !== -1) {
    z = z.split('·')
      .map(function (teil) { return teil.trim(); })
      .filter(function (teil) { return teil !== ''; })
      .join(' · ');
  }
  return z.replace(/[ \t]+/g, ' ').trim();
}

// userMap/waText sind optional: die uebrigen Regeln dieses Projekts brauchen
// sie nicht und rufen baueKontext() weiter mit sechs Argumenten auf.
function baueKontext(deal, plzMap, feld, altWert, neuWert, tage, userMap, waText) {
  const person = (deal.person_id && plzMap[deal.person_id]) || {};
  const ct = feld === CT_PSEUDO_FELD ? ctFuerDeal(_ctMapAktuell, deal) : null;
  const ccName = ct && userMap ? (userMap[String(ct.ownerId)] || '') : '';

  const kontext = {
    dealId: deal.id,
    kunde: deal.title || '',
    plz: plzText(deal, plzMap),
    partner: leseMontagepartner(deal),
    stage: deal.stage_id || '',
    datum: deutschesDatum(neuWert || altWert),
    altdatum: deutschesDatum(altWert),
    neudatum: deutschesDatum(neuWert),
    tage: tage === null || tage === undefined ? '' : tage,
    feld: feld,
    liefertermin: deutschesDatum(leseTerminfeld(deal, 'Liefertermin')),
    dc: deutschesDatum(leseTerminfeld(deal, 'DC-Termin')),
    ac: deutschesDatum(leseTerminfeld(deal, 'AC-Termin')),
    ib: deutschesDatum(leseTerminfeld(deal, 'IB-Termin')),
    deallink: DEAL_URL_BASE + deal.id,
    ordnerlink: leseKundenordner(deal),
    bonus_brutto: BONUS_PRO_LIEFERUNG_BRUTTO + ' €',
    bonus_netto: bonusNettoText(),

    // ---- Person (aus demselben /persons-Sweep wie die PLZ) ----
    vorname: person.vorname || '',
    nachname: person.nachname || '',
    telefon: person.telefon || '',

    // ---- CT-Termin ----
    uhrzeit: ct ? ct.uhrzeit : '',
    // Fertige Wendung statt nackter Zahl: ohne due_time wuerde "um {uhrzeit}
    // Uhr" zu "um Uhr" — ein Satz, den kein Kunde lesen soll. {um} ist dann
    // einfach leer und raeumeZeileAuf() putzt die Luecke weg.
    um: ct && ct.uhrzeit ? 'um ' + ct.uhrzeit + ' Uhr' : '',
    cc: vornameVon(ccName),
    cc_voll: ccName
  };

  // Der wa.me-Link braucht den fertigen Kundentext, und der Kundentext benutzt
  // dieselben Platzhalter wie die Slack-Vorlage. Deshalb wird er hier ZWEITER
  // Schritt gebaut: erst Kontext, dann Text, dann Link, dann Link in den
  // Kontext zurueck. {walink} im Kundentext selbst waere eine Schleife und
  // bleibt deshalb leer.
  kontext.watext = '';
  kontext.walink = '';
  if (waText) {
    const kundentext = baueText(waText, kontext);
    kontext.watext = kundentext;
    kontext.walink = baueWaLink(kontext.telefon, kundentext);
    if (!kontext.walink && kundentext) {
      Logger.log('⚠️ Deal %s: kein wa.me-Link, Telefonnummer unbrauchbar ("%s").',
        deal.id, kontext.telefon);
    }
  }
  return kontext;
}

// Leerer String, solange BONUS_NETTO_FAKTOR nicht gesetzt ist. Die Vorlage
// haengt die Netto-Angabe deshalb hinter ein "·" — raeumeZeileAuf() wirft das
// leere Stueck samt Trennzeichen raus, statt "≈  netto" stehen zu lassen.
function bonusNettoText() {
  if (BONUS_NETTO_FAKTOR === null || BONUS_NETTO_FAKTOR === undefined) return '';
  const netto = BONUS_PRO_LIEFERUNG_BRUTTO * BONUS_NETTO_FAKTOR;
  return '≈ ' + Math.round(netto) + ' € netto';
}

// "2026-09-18" -> "Fr, 18.09.2026". Bewusst aus dem String gerechnet, nicht
// ueber new Date(String) — das interpretiert ISO-Datumsstrings als UTC und
// verschiebt in Wien je nach Uhrzeit auf den Vortag.
const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function deutschesDatum(isoText) {
  if (!isoText) return '';
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoText).slice(0, 10));
  if (!t) return String(isoText);
  const jahr = Number(t[1]), monat = Number(t[2]), tag = Number(t[3]);
  const wochentag = WOCHENTAGE[new Date(jahr, monat - 1, tag).getDay()];
  return wochentag + ', ' + t[3] + '.' + t[2] + '.' + t[1];
}

// ---------- Doppelpost-Schutz ----------
// Zwingend fuer die datumsbasierten Regeln: "1 Tag vorher" waere sonst bei
// einem 15-Minuten-Trigger 96 Posts am Tag. Das Termindatum steckt im
// Schluessel — wird der Termin verschoben, darf die Erinnerung fuer das NEUE
// Datum erneut feuern.
// Der CHANNEL gehoert in den Schluessel. Sonst blockieren sich zwei Regeln
// gegenseitig, die dasselbe Ereignis in verschiedene Channels melden sollen
// (genau der Fall "HEUTE Lieferung" nach #ernst-knows UND als Bonus-DM): die
// erste Regel setzt den Schluessel, die zweite haelt sich fuer ein Duplikat
// und postet nie. Still, ohne Warnung — der schlimmste Fehlertyp hier.
function baueSchluessel(dealId, feld, ereignis, tage, bezugsdatum, channel) {
  return [dealId, feld, ereignis, tage === null ? '' : tage, bezugsdatum || '', channel || ''].join('|');
}

// Vor dem Channel-Zusatz (16.09.2026) hatte der Schluessel ein Feld weniger.
// Ohne diese Bruecke gelten alle Eintraege im Log-Tab als "nie gesendet" und
// jede heute schon gemeldete Erinnerung kaeme ein zweites Mal. Gilt nur fuer
// den Channel, der damals als einziger in Benutzung war.
const LEGACY_CHANNEL = 'C0C0Q6JML23';

function schonGesendet(gesendet, schluessel, channel) {
  if (gesendet[schluessel]) return true;
  if (channel === LEGACY_CHANNEL) {
    const ohneChannel = schluessel.replace(/\|[^|]*$/, '');
    if (gesendet[ohneChannel]) return true;
  }
  return false;
}

function leseGesendeteSchluessel() {
  const blatt = holeOderLegeAn(TAB_LOG, LOG_SPALTEN);
  const werte = blatt.getDataRange().getValues();
  const set = {};
  if (werte.length < 2) return set;
  const spalte = spaltenIndex(werte[0], LOG_SPALTEN);
  for (let z = 1; z < werte.length; z++) {
    const s = String(werte[z][spalte['Schluessel']] || '').trim();
    if (s) set[s] = true;
  }
  return set;
}

function schreibeLogZeilen(neueZeilen) {
  if (!neueZeilen.length) return;
  const blatt = holeOderLegeAn(TAB_LOG, LOG_SPALTEN);
  const werte = blatt.getDataRange().getValues();
  const grenze = new Date(Date.now() - LOG_AUFBEWAHRUNG_TAGE * 24 * 60 * 60 * 1000);

  let behalten = [];
  if (werte.length > 1) {
    const spalte = spaltenIndex(werte[0], LOG_SPALTEN);
    for (let z = 1; z < werte.length; z++) {
      const zeitpunkt = werte[z][spalte['Zeitpunkt']];
      const datum = Object.prototype.toString.call(zeitpunkt) === '[object Date]'
        ? zeitpunkt
        : new Date(String(zeitpunkt));
      if (isNaN(datum.getTime()) || datum >= grenze) {
        behalten.push(LOG_SPALTEN.map(function (name) { return werte[z][spalte[name]]; }));
      }
    }
  }

  const alle = behalten.concat(neueZeilen);
  blatt.clearContents();
  blatt.getRange(1, 1, 1, LOG_SPALTEN.length).setValues([LOG_SPALTEN]);
  blatt.getRange(2, 1, alle.length, LOG_SPALTEN.length).setValues(alle);
  blatt.setFrozenRows(1);
}

// ---------- Senden ----------
// Gibt die Log-Zeile zurueck, damit der Aufrufer sie sammeln und in einem
// Rutsch schreiben kann (ein setValues statt einem pro Post).
function sendeMeldung(regel, text, schluessel, dealId) {
  if (DRY_RUN) {
    Logger.log('[DRY_RUN] -> %s | Deal %s | %s/%s\n%s', regel.channel, dealId, regel.feld, regel.ereignis, text);
    return null;
  }
  // not_in_channel heisst: der Bot ist nicht im Channel. In Slack
  // "/invite @Ernst" im Ziel-Channel ausfuehren. Ein einzelner Channel-Fehler
  // darf nicht den restlichen Lauf mitreissen.
  try {
    fetchSlackJson('chat.postMessage', null, {
      channel: regel.channel,
      text: text,
      unfurl_links: false
    });
  } catch (fehler) {
    Logger.log('❌ Slack-Post fehlgeschlagen (Deal %s, %s/%s, Channel %s): %s',
      dealId, regel.feld, regel.ereignis, regel.channel, fehler.message);
    return null; // nicht ins Log -> beim naechsten Lauf erneut versucht
  }
  return [new Date(), dealId, regel.feld, regel.ereignis, regel.channel, schluessel, text];
}
