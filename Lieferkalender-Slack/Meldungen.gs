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
  if (z.indexOf('·') !== -1) {
    z = z.split('·')
      .map(function (teil) { return teil.trim(); })
      .filter(function (teil) { return teil !== ''; })
      .join(' · ');
  }
  return z.replace(/[ \t]+/g, ' ').trim();
}

function baueKontext(deal, plzMap, feld, altWert, neuWert, tage) {
  return {
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
    ordnerlink: leseKundenordner(deal)
  };
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
function baueSchluessel(dealId, feld, ereignis, tage, bezugsdatum) {
  return [dealId, feld, ereignis, tage === null ? '' : tage, bezugsdatum || ''].join('|');
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
