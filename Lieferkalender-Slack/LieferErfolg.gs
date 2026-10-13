// ============================================================
// LIEFER-ERFOLG — Erfolgsmeldung in #sales, wenn ein Kunde beliefert wurde.
// ============================================================
// Wunsch Valentin 13.10.2026: "Material-Liefertermin = gestern" -> Kommentar
// unter dem Auftrags-Post des Kunden in #sales, Verkaeufer + Cash Collector
// erwaehnt, Ton: Erfolg. Bewusst KEINE Anlagendaten (kWp etc.) — nur
// "Geliefert, Material angekommen" + die @s (VP 13.10.2026).
//
// Entscheidungen (VP 13.10.2026):
//   - Ausloeser = Material-Liefertermin liegt in der Vergangenheit ("gestern
//     damit es fix ist"). Kein Bestaetigungsschritt: wird ein Termin
//     verschoben, steht das neue Datum drin und es feuert eben spaeter.
//   - Gepostet wird erst AM NACHMITTAG (LE_AB_STUNDE), nur Mo–Fr. Eine
//     Lieferung vom Freitag/Wochenende kommt also Montag nachmittag.
//   - Nur neu ab jetzt: Liefertermine vor LE_START werden nie gemeldet.
//   - Ort = Thread-Antwort unter dem "Auftrag …"-Post des Kunden in #sales,
//     mit reply_broadcast ("Auch an #sales senden") — Kommentar UND
//     Channel-Post in einem, der Kontext vom Abschluss steht gleich darueber.
//   - @Verkaeufer + @Cash Collector (Deal-Felder, befuellt von RollenFuellen.js).
//     Verkaeufer leer -> Autor des "Auftrag …"-Posts (VP 13.10.).
//   - Nur "Geliefert, Material angekommen" + @s — keine Anlagendaten (VP 13.10.).
//   - Dazu "Handelsspanne plan" aus der Deep Core List 2026, Tab Fulfillment
//     (VP 13.10.: "ONLY READ" — das Sheet gehoert Andre, hier wird es nur
//     gelesen). Kein eindeutiger Name-Treffer -> Zeile faellt weg, kein Raten.
//   - Bewusst getrennt von der Bonus-DM (Regeln-Tab "Liefertermin / am Tag").
//
// Kein Raten: findet sich der #sales-Post nicht eindeutig, geht der fertige
// Text als DM an Valentin, mit Grund + Kandidaten — er postet dann selbst.
//
// Gedaechtnis: ScriptProperty LE_GEMELDET_<MODUS> = { dealId: liefertermin }.
// Pro Deal genau eine Meldung. TEST und LIVE haben getrennte Gedaechtnisse,
// damit ein Probelauf den echten Post nicht "verbraucht".
//
// Liest NUR aus Pipedrive und der Deep Core List. Schreibt in keins von beiden.

// 'AUS'  = Modul laeuft nicht
// 'TEST' = Text geht NUR als DM an Valentin, mit Hinweis, wo er gelandet waere
// 'LIVE' = Thread-Antwort + Broadcast in #sales
const LE_MODUS = 'LIVE';   // LIVE seit 13.10.2026 23:00 (VP: "umsetzen und starten")

const LE_START = '2026-10-13';      // fruehester Liefertermin, der gemeldet wird
const LE_AB_STUNDE = 14;            // vorher wird nichts gepostet
const LE_MAX_TAGE_ZURUECK = 4;      // Fr-Lieferung -> Mo = 3 Tage, +1 Puffer fuer einen toten Trigger
const LE_SALES_CHANNEL_ID = 'C06SXQ67PFZ';   // #sales (wie Closer-Score/SalesKanal.gs)
const LE_SALES_TAGE_ZURUECK = 240;  // Abschluss -> Lieferung dauert Monate
const LE_SALES_MARKER = /^\s*auftrag\b/i;

// field_codes aus docs/REFERENZ-Pipedrive-AppsScript.md (Rollen + Anlage & sevdesk-Sync).
const LE_KEY = {
  verkaeufer: 'ce23b833e39b65d763eee46691aabcd692109f0b',
  cc:         '953f338a01b703a8a1f48468d3ecd37b4cdfffe5',
  storno:     'fee682d05bd3c8c3e052474b6729429c129e70fb',
  verschoben: '03d6f3287eadf5993282118a68eeb8bbbbfcf5dd'
};

// Deep Core List 2026 (Original, Besitzer andre@nova-energietechnik.at) — NUR LESEN.
// ZIEHT DIE LISTE UM (neue Datei, z.B. "Deep Core List 2027"): neue ID in die
// ScriptProperty LE_DEEPCORE_ID eintragen — die schlaegt diese Konstante,
// kein Code-Push noetig. Verschieben in einen anderen Ordner aendert die ID nicht.
// Ist die Liste nicht lesbar oder fehlt die Spanne, bekommt Valentin eine DM
// (pro Lauf eine Sammel-DM) — der Post geht trotzdem raus, nur ohne Spanne.
const LE_DEEPCORE_ID = '19XVBUNKNkMsi1pvFsfBh-pgd2ik8Vh1nIPpvR-XHq3s';
const LE_DEEPCORE_TAB = 'Fulfillment';
const LE_DEEPCORE_SPALTE_KUNDE = 'Kundenname';
const LE_DEEPCORE_SPALTE_SPANNE = 'Handelsspanne plan';

const TAB_LIEFER_ERFOLG = 'Liefer-Erfolg';
const LE_SPALTEN = ['Zeitpunkt', 'Deal', 'Liefertermin', 'Ergebnis', 'Ziel', 'Detail', 'Text'];

let _leSalesIndex = null;   // pro Ausfuehrung einmal aufgebaut
let _leDeepCore = null;     // dito
let _leDeepCoreFehler = null;   // Lesefehler auch nur einmal pro Ausfuehrung

// ---------- Einstieg aus sweep() ----------
// Bekommt die schon geholten Pipeline-2-Deals. Gibt einen Kurztext fuer die
// Hinweis-Spalte im Laeufe-Tab zurueck ('' = nichts los).
function lieferErfolgCheck(deals) {
  if (LE_MODUS === 'AUS') return '';
  const jetzt = new Date();
  const tz = Session.getScriptTimeZone();
  if (Number(Utilities.formatDate(jetzt, tz, 'H')) < LE_AB_STUNDE) return '';
  if (Number(Utilities.formatDate(jetzt, tz, 'u')) > 5) return '';   // Sa/So

  const props = PropertiesService.getScriptProperties();
  const propName = 'LE_GEMELDET_' + LE_MODUS;
  const gemeldet = JSON.parse(props.getProperty(propName) || '{}');

  const faellig = leFaellige(deals, gemeldet);
  if (!faellig.length) return '';

  const kontext = { userMap: null };
  const zeilen = [];
  const ohneSpanne = [];   // in #sales gepostet, aber ohne Spanne -> Sammel-DM an VP
  let gepostet = 0, anValentin = 0;
  faellig.forEach(function (f) {
    const e = leMelde(f.deal, f.datum, kontext, false);
    zeilen.push(e.zeile);
    if (e.ok) {
      gemeldet[String(f.deal.id)] = f.datum;
      if (e.ziel === 'sales') gepostet++; else anValentin++;
    }
    // Bei ziel 'valentin' steht der Spanne-Grund schon in dessen DM.
    if (e.ok && e.ziel === 'sales' && e.spanneFehler) ohneSpanne.push('• ' + f.deal.title + ' — ' + e.spanneFehler);
  });

  props.setProperty(propName, JSON.stringify(leAufraeumen(gemeldet)));
  leSchreibeZeilen(zeilen);
  if (ohneSpanne.length) {
    const kopf = _leDeepCoreFehler
      ? '⚠️ Liefer-Erfolg: Deep Core List nicht lesbar (' + _leDeepCoreFehler + ').\n'
        + 'Umgezogen? Neue Sheet-ID in ScriptProperty LE_DEEPCORE_ID (Ernst) eintragen. Gepostet wurde ohne Spanne:'
      : 'ℹ️ Liefer-Erfolg ohne Handelsspanne gepostet (kein eindeutiger Treffer in der Deep Core List):';
    sendeEtDm(VALENTIN_USER_ID, kopf + '\n' + ohneSpanne.join('\n'));
  }
  return 'LE: ' + gepostet + ' in #sales' + (anValentin ? ', ' + anValentin + ' an VP' : '')
    + (LE_MODUS === 'TEST' ? ' (TEST)' : '');
}

// Deals mit Liefertermin in [max(LE_START, heute-N) .. gestern], noch nicht
// gemeldet, nicht storniert/verschoben/verloren.
function leFaellige(deals, gemeldet) {
  const heute = heuteAlsText();
  const fruehestens = [LE_START, tageVorher(heute, LE_MAX_TAGE_ZURUECK)].sort()[1];
  const liste = [];
  deals.forEach(function (d) {
    const datum = leseTerminfeld(d, 'Liefertermin');
    if (!datum || datum >= heute || datum < fruehestens) return;
    if (gemeldet[String(d.id)]) return;
    if (d.status === 'lost' || d.status === 'deleted') return;
    const cf = d.custom_fields || {};
    if (svOptionId(cf[LE_KEY.storno]) || svOptionId(cf[LE_KEY.verschoben])) return;
    liste.push({ deal: d, datum: datum });
  });
  return liste;
}

// ---------- Meldung fuer EINEN Deal ----------
// trocken=true: nur loggen. Gibt { ok, ziel: 'sales'|'valentin', text, zeile }.
function leMelde(deal, datum, kontext, trocken) {
  const jetzt = new Date();
  const spanne = leSpanne(deal);
  const post = leSalesPost(deal);
  const text = leText(deal, datum, kontext, spanne, post);
  const dealZelle = svDealZelle(deal);
  const ohneSpanne = spanne.fehler ? ' | ohne Spanne: ' + spanne.fehler : '';

  if (trocken) {
    Logger.log('[TROCKEN] Deal %s -> %s%s\n%s\n', deal.id,
      post.ts ? '#sales-Thread von "' + post.kunde + '" (' + post.sicherheit + ')' : 'DM Valentin: ' + post.fehler,
      ohneSpanne, text);
    return { ok: true, ziel: post.ts ? 'sales' : 'valentin', text: text,
      zeile: [jetzt, dealZelle, datum, 'trocken', post.ts ? 'sales' : 'valentin', (post.fehler || post.kunde) + ohneSpanne, text] };
  }

  if (post.ts && LE_MODUS === 'LIVE') {
    try {
      fetchSlackJson('chat.postMessage', null, {
        channel: LE_SALES_CHANNEL_ID, thread_ts: post.ts, reply_broadcast: true,
        text: text, unfurl_links: false
      });
      return { ok: true, ziel: 'sales', text: text, spanneFehler: spanne.fehler || '',
        zeile: [jetzt, dealZelle, datum, 'gepostet', '#sales-Thread ' + post.ts, post.kunde + ' (' + post.sicherheit + ')' + ohneSpanne, text] };
    } catch (fehler) {
      // Post fehlgeschlagen (z.B. Ernst nicht im Kanal) -> wenigstens Valentin.
      post.fehler = 'Post in #sales fehlgeschlagen: ' + fehler.message;
    }
  }

  const kopf = LE_MODUS !== 'LIVE' && post.ts
    ? '🧪 TEST — ginge als Thread-Antwort (+ an #sales) unter „Auftrag ' + post.kunde + '“ (' + post.sicherheit + '):'
    : '⚠️ Liefer-Erfolg nicht automatisch gepostet — ' + post.fehler + '\nBitte selbst in #sales posten:';
  const ok = sendeEtDm(VALENTIN_USER_ID, kopf + (spanne.fehler ? '\n(ohne Handelsspanne — ' + spanne.fehler + ')' : '') + '\n\n' + text);
  return { ok: ok, ziel: 'valentin', text: text,
    zeile: [jetzt, dealZelle, datum, ok ? (post.ts ? 'TEST an VP' : 'an VP (kein Post)') : 'DM fehlgeschlagen',
      'DM Valentin', (post.fehler || post.kunde) + ohneSpanne, text] };
}

// spanne = Ergebnis von leSpanne(); ohne Wert faellt die Zeile weg.
// post   = Ergebnis von leSalesPost(); dessen Autor springt ein, wenn das
//          Verkaeufer-Feld leer ist (VP 13.10.2026, wie Closer-Score).
function leText(deal, datum, kontext, spanne, post) {
  const cf = deal.custom_fields || {};
  const name = String(deal.title || 'Deal ' + deal.id)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '/');
  const kunde = '*<' + DEAL_URL_BASE + deal.id + '|' + name + '>*';
  const tag = datum === tageVorher(heuteAlsText(), 1) ? 'gestern' : 'am ' + formatiereEtDatum(datum);

  // Bewusst nur die Erfolgsmeldung, keine Anlagendaten (VP 13.10.2026).
  const zeilen = ['🎉🚚 *Geliefert!* Das Material für ' + kunde + ' ist ' + tag + ' angekommen.'];
  if (spanne && spanne.wert) {
    zeilen.push('💰 Handelsspanne (plan): *' + spanne.wert.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '*');
  }

  // @Verkaeufer + @CC, dieselbe Person nur einmal. Ohne Slack-ID der Name.
  // Verkaeufer leer -> Autor des "Auftrag …"-Posts (nur bei eindeutigem Treffer).
  const leute = [];
  if (!svUserId(cf[LE_KEY.verkaeufer]) && post && post.ts && post.autor) leute.push('<@' + post.autor + '>');
  [LE_KEY.verkaeufer, LE_KEY.cc].forEach(function (key) {
    const id = svUserId(cf[key]);
    if (!id) return;
    const p = setterInfo(id, kontext);
    const wer = p.slackId ? '<@' + p.slackId + '>' : p.name;
    if (leute.indexOf(wer) === -1) leute.push(wer);
  });
  // Kein "nächster Schritt Montage" (VP 13.10.2026).
  if (leute.length) zeilen.push('', 'Danke ' + leute.join(' & ') + '! 💪');
  return zeilen.join('\n');
}

// ---------- #sales-Post finden ----------
// Logik wie Closer-Score/SalesKanal.gs (dort ausfuehrlich begruendet):
// genau > Vor+Nachname > nur Nachname, Nachname muss immer passen. Mehrere
// Treffer von VERSCHIEDENEN Autoren -> kein Raten.
// Rueckgabe { ts, kunde, sicherheit } oder { fehler }.
function leSalesPost(deal) {
  let index;
  try {
    index = leSalesIndex();
  } catch (e) {
    return { fehler: '#sales nicht lesbar (' + e.message + ')' };
  }
  const ziel = leTokens(deal.title);
  if (!ziel.length) return { fehler: 'Deal-Titel ergibt keinen Namen' };
  const zielNorm = ziel.join(' ');
  const zielNach = ziel[ziel.length - 1];
  const genau = [], stark = [], schwach = [];
  index.forEach(function (m) {
    const t = leTokens(m.kunde);
    if (!t.length) return;
    if (t.join(' ') === zielNorm) { genau.push(m); return; }
    const mNach = t[t.length - 1];
    if (!(mNach === zielNach || ziel.indexOf(mNach) !== -1 || t.indexOf(zielNach) !== -1)) return;
    const gemeinsam = t.filter(function (x) { return ziel.indexOf(x) !== -1; });
    (gemeinsam.length >= 2 ? stark : schwach).push(m);
  });
  const auswahl = genau.length ? genau : (stark.length ? stark : schwach);
  const sicherheit = genau.length ? 'genau' : (stark.length ? 'Vor+Nachname' : 'nur Nachname');
  if (!auswahl.length) return { fehler: 'kein „Auftrag …“-Post zu „' + deal.title + '“ in #sales (' + LE_SALES_TAGE_ZURUECK + ' Tage)' };
  // "nur Nachname" reicht fuer einen oeffentlichen Post nicht.
  if (sicherheit === 'nur Nachname') {
    return { fehler: 'nur Nachname passt: ' + auswahl.map(function (m) { return '„' + m.kunde + '“'; }).join(', ') };
  }
  // Mehrere Posts zum selben Kunden (z.B. Zweitbestellung) -> kein Raten.
  if (auswahl.length > 1) {
    return { fehler: auswahl.length + ' passende Posts: ' + auswahl.map(function (m) {
      return '„' + m.kunde + '“ ' + Utilities.formatDate(m.zeit, 'Europe/Vienna', 'dd.MM.');
    }).join(', ') };
  }
  return { ts: auswahl[0].ts, kunde: auswahl[0].kunde, autor: auswahl[0].autor, sicherheit: sicherheit };
}

function leSalesIndex() {
  if (_leSalesIndex) return _leSalesIndex;
  const aeltestens = Math.floor(Date.now() / 1000) - LE_SALES_TAGE_ZURUECK * 86400;
  const treffer = [];
  let cursor = null, seiten = 0;
  do {
    const params = { channel: LE_SALES_CHANNEL_ID, limit: 200, oldest: aeltestens };
    if (cursor) params.cursor = cursor;
    const json = fetchSlackJson('conversations.history', params, null);
    (json.messages || []).forEach(function (m) {
      if (!m.user || !m.text || !LE_SALES_MARKER.test(m.text)) return;
      const kunde = leKundeAusPost(m.text);
      if (kunde) treffer.push({ kunde: kunde, ts: m.ts, autor: m.user, zeit: new Date(Number(m.ts) * 1000) });
    });
    cursor = (json.response_metadata || {}).next_cursor || null;
    seiten++;
  } while (cursor && seiten < 20);
  _leSalesIndex = treffer;
  return treffer;
}

// ---------- Handelsspanne aus der Deep Core List (NUR LESEN) ----------
// Gleiche Namenslogik wie beim #sales-Post: genau oder Vor+Nachname, genau
// EINE Zeile. "nur Nachname" oder mehrere Zeilen (Zweitauftrag) -> kein Wert.
// Klammerzusatz im Sheet ("Martina Hutterer (H. Schrollenberger)") zaehlt nicht.
// Rueckgabe { wert, kunde, sicherheit } oder { fehler }.
function leSpanne(deal) {
  let index;
  try {
    index = leDeepCoreIndex();
  } catch (e) {
    return { fehler: 'Deep Core nicht lesbar (' + e.message + ')' };
  }
  const ziel = leTokens(deal.title);
  if (!ziel.length) return { fehler: 'Deal-Titel ergibt keinen Namen' };
  const zielNorm = ziel.join(' ');
  const zielNach = ziel[ziel.length - 1];
  const genau = [], stark = [];
  index.forEach(function (z) {
    const t = leTokens(z.kunde.replace(/\(.*?\)/g, ' '));
    if (!t.length) return;
    if (t.join(' ') === zielNorm) { genau.push(z); return; }
    const mNach = t[t.length - 1];
    if (!(mNach === zielNach || ziel.indexOf(mNach) !== -1 || t.indexOf(zielNach) !== -1)) return;
    const gemeinsam = t.filter(function (x) { return ziel.indexOf(x) !== -1; });
    if (gemeinsam.length >= 2) stark.push(z);
  });
  const auswahl = genau.length ? genau : stark;
  if (!auswahl.length) return { fehler: 'kein eindeutiger Name in Deep Core/' + LE_DEEPCORE_TAB };
  if (auswahl.length > 1) {
    return { fehler: auswahl.length + ' Zeilen in Deep Core: ' + auswahl.map(function (z) { return '„' + z.kunde + '“'; }).join(', ') };
  }
  const wert = auswahl[0].spanne.replace(/,00(?=\s*€|$)/, '').trim();
  if (!wert || /^[-–]?\s*0\s*€?$/.test(wert)) return { fehler: 'Spanne leer bei „' + auswahl[0].kunde + '“' };
  if (/^#/.test(wert)) return { fehler: 'Formelfehler ' + wert + ' bei „' + auswahl[0].kunde + '“' };   // #REF!, #N/A …
  return { wert: wert, kunde: auswahl[0].kunde, sicherheit: genau.length ? 'genau' : 'Vor+Nachname' };
}

// Spalten ueber die Kopfzeilen (1+2, teils verbunden) suchen statt fest
// verdrahten — Andre schiebt dort Spalten. Nur getDisplayValues, nie schreiben.
function leDeepCoreIndex() {
  if (_leDeepCore) return _leDeepCore;
  if (_leDeepCoreFehler) throw new Error(_leDeepCoreFehler);
  try {
    _leDeepCore = leDeepCoreLaden();
    return _leDeepCore;
  } catch (e) {
    _leDeepCoreFehler = e.message;
    throw e;
  }
}

function leDeepCoreLaden() {
  const id = PropertiesService.getScriptProperties().getProperty('LE_DEEPCORE_ID') || LE_DEEPCORE_ID;
  const blatt = SpreadsheetApp.openById(id).getSheetByName(LE_DEEPCORE_TAB);
  if (!blatt) throw new Error('Tab „' + LE_DEEPCORE_TAB + '“ fehlt');
  const werte = blatt.getDataRange().getDisplayValues();
  const spalte = function (name) {
    for (let r = 0; r < Math.min(2, werte.length); r++) {
      const i = werte[r].map(function (x) { return String(x).replace(/\s+/g, ' ').trim(); }).indexOf(name);
      if (i !== -1) return i;
    }
    throw new Error('Spalte „' + name + '“ nicht gefunden');
  };
  const sK = spalte(LE_DEEPCORE_SPALTE_KUNDE), sS = spalte(LE_DEEPCORE_SPALTE_SPANNE);
  const zeilen = werte.slice(2)
    .filter(function (z) { return String(z[sK]).trim(); })
    .map(function (z) { return { kunde: String(z[sK]).trim(), spanne: String(z[sS]).trim() }; });
  if (!zeilen.length) throw new Error('Tab „' + LE_DEEPCORE_TAB + '“ ist leer');
  return zeilen;
}

// "Auftrag Gerhard Glauninger 20.807€ OÖ (E) SM mit <@U…>" -> "Gerhard Glauninger"
function leKundeAusPost(text) {
  const woerter = text.replace(LE_SALES_MARKER, '').trim().split(/\s+/);
  const name = [];
  for (let i = 0; i < woerter.length && name.length < 5; i++) {
    if (/^[\d(<:]/.test(woerter[i]) || /^mit$/i.test(woerter[i])) break;
    name.push(woerter[i]);
  }
  return name.join(' ').replace(/[,;.]+$/, '').trim() || null;
}

// Umlaute ZUERST falten, dann restliche Diakritika weg (Begruendung in
// Closer-Score/SalesKanal.gs, Fall "Božena").
function leTokens(s) {
  return String(s || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').filter(function (t) { return t.length >= 3; });
}

// ---------- Ablage ----------
// Eintraege aelter als 60 Tage fliegen raus (9-KB-Limit pro Property).
function leAufraeumen(gemeldet) {
  const grenze = tageVorher(heuteAlsText(), 60);
  Object.keys(gemeldet).forEach(function (k) { if (gemeldet[k] < grenze) delete gemeldet[k]; });
  return gemeldet;
}

function leSchreibeZeilen(zeilen) {
  if (!zeilen.length) return;
  const blatt = holeOderLegeAn(TAB_LIEFER_ERFOLG, LE_SPALTEN);
  blatt.getRange(blatt.getLastRow() + 1, 1, zeilen.length, LE_SPALTEN.length).setValues(zeilen);
}

// ============================================================
// MANUELL im Editor
// ============================================================

// Trockenlauf: alle Pipeline-2-Deals mit Liefertermin in den letzten TAGE
// Tagen (LE_START egal), Text + wohin er ginge. Kein Versand, kein Gedaechtnis.
function testeLieferErfolg() {
  const TAGE = 30;
  const heute = heuteAlsText();
  const ab = tageVorher(heute, TAGE);
  const kontext = { userMap: null };
  let n = 0, sales = 0;
  holeFulfillmentDeals().forEach(function (d) {
    const datum = leseTerminfeld(d, 'Liefertermin');
    if (!datum || datum >= heute || datum < ab) return;
    const e = leMelde(d, datum, kontext, true);
    n++;
    if (e.ziel === 'sales') sales++;
  });
  Logger.log('=> %s Lieferungen in %s Tagen, %s mit eindeutigem #sales-Post, %s gingen an Valentin. Modus: %s',
    n, TAGE, sales, n - sales, LE_MODUS);
}

// Schickt den Text zu EINEM Deal als Probe NUR an Valentin.
function testeLieferErfolgDm() {
  const DEAL_ID = 3878; // <- hier Deal-ID eintragen (3878 = Sieglinde Moser)
  const deal = fetchPipedriveJson('/deals/' + DEAL_ID, { include_option_labels: true }).data;
  const datum = leseTerminfeld(deal, 'Liefertermin') || heuteAlsText();
  const post = leSalesPost(deal);
  const ziel = post.ts ? 'Thread „Auftrag ' + post.kunde + '“ (' + post.sicherheit + ')' : 'DM an dich — ' + post.fehler;
  const spanne = leSpanne(deal);
  sendeEtDm(VALENTIN_USER_ID, '🧪 Probe Liefer-Erfolg — ginge an: ' + ziel
    + '\nSpanne: ' + (spanne.wert ? spanne.wert + ' aus „' + spanne.kunde + '“ (' + spanne.sicherheit + ')' : spanne.fehler)
    + '\n\n' + leText(deal, datum, { userMap: null }, spanne, post));
}
