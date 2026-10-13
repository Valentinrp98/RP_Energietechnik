// ============================================================
// STORNO / VERSCHOBEN — Slack-DM an den Verkaeufer, sobald an einem
// Fulfillment-Deal "Stornozeitpunkt" oder "Verschiebezeitpunkt" gesetzt wird.
// ============================================================
// Wunsch Valentin 13.10.2026: bei ALLEN Moeglichkeiten (ohne / vor / nach CT,
// Storno wie Verschoben) bekommt der Verkaeufer eine Nachricht von Ernst.
//
// Entscheidungen (VP 13.10.2026):
//   - Ausloeser = Feld geht von LEER auf einen Wert.
//   - Wechselt der Wert spaeter (z.B. "vor CT" -> "nach CT"), bekommt der
//     Verkaeufer eine Korrektur-DM ("jetzt nach CT, vorher vor CT"). Steht der
//     Wert beim Senden wieder auf dem alten, entfaellt sie.
//   - Empfaenger = Deal-Feld "Verkaeufer" (befuellt von RollenFuellen.js aus
//     dem #sales-Poster). Leer -> DM an Valentin mit "bitte weitergeben".
//   - Wartezeit SV_WARTEZEIT_MIN nach dem Erkennen: Zeitpunkt wird oft vor
//     Grund / "Verschoben auf" eingetragen. Gelesen wird beim Senden der
//     dann aktuelle Stand. Ist das Feld bis dahin wieder leer -> nichts.
//   - Kopie an Valentin wie beim Ersttermin-Check.
//
// Gedaechtnis in ScriptProperties (nicht im Snapshot-Tab, der gehoert der
// Liefer-Uebersicht): SV_STAND = { "dealId|Storno": optionId, ... } — nur
// befuellte Felder, ~120 Deals passen locker unter das 9-KB-Limit.
//
// Liest NUR aus Pipedrive. Schreibt nie dorthin.

// 'AUS'  = Modul laeuft nicht
// 'TEST' = DMs gehen NUR an Valentin, mit Hinweis, an wen sie gegangen waeren
// 'LIVE' = DM an den Verkaeufer (+ Kopie an Valentin, solange SV_KOPIE_AN_VALENTIN)
const SV_MODUS = 'LIVE'; // LIVE seit 13.10.2026 (VP)
const SV_KOPIE_AN_VALENTIN = true;
const SV_WARTEZEIT_MIN = 10;

// field_codes + Options-IDs aus docs/REFERENZ-Pipedrive-AppsScript.md (§2 + Options-Tabelle).
const SV_VERKAEUFER_KEY = 'ce23b833e39b65d763eee46691aabcd692109f0b';
const SV_FELDER = [
  {
    name: 'Storno',
    zeitKey: 'fee682d05bd3c8c3e052474b6729429c129e70fb',   // Stornozeitpunkt
    grundKey: '78f141d32919d24cc9e45f070f260bd421b984e3',  // Stornogrund
    datumKey: null,
    optionen: { 413: 'ohne CT', 414: 'vor CT', 415: 'nach CT' }
  },
  {
    name: 'Verschoben',
    zeitKey: '03d6f3287eadf5993282118a68eeb8bbbbfcf5dd',   // Verschiebezeitpunkt
    grundKey: 'ef68d654014dd173df185b4bb1fbf08bbc4d6c0d',  // Verschiebegrund
    datumKey: 'a6dc892da6e8a16eeef6e57e3530b903e0cf2f42',  // Verschoben auf
    optionen: { 416: 'ohne CT', 417: 'vor CT', 418: 'nach CT' }
  }
];
const SV_GRUENDE = {
  212: 'Preis', 213: 'Kunde abgesprungen', 214: 'Technisch nicht machbar',
  215: 'Finanzierung abgelehnt', 216: 'Förderung abgelehnt', 217: 'Sonstiges',
  218: 'Geld', 219: 'Jahreswechsel', 220: 'Kunde unsicher',
  221: 'technische Klärung', 222: 'Sonstiges'
};

const SV_PROP_STAND = 'SV_STAND';
// { "dealId|Storno": { t: erkanntIso, alt: optionId|'' } } — alt leer = neu gesetzt,
// sonst Korrektur. (Alt-Eintraege als blosser ISO-String werden noch gelesen.)
const SV_PROP_QUEUE = 'SV_QUEUE';

const TAB_STORNO_VERSCHOBEN = 'Storno-Verschoben';
const SV_SPALTEN = ['Zeitpunkt', 'Deal', 'Ereignis', 'Zeitpunkt-Wert', 'Verschoben auf',
  'Grund', 'Verkaeufer', 'Ergebnis', 'Empfaenger', 'Detail'];

// ---------- Einstieg aus sweep() ----------
// Bekommt die schon geholten Pipeline-2-Deals — kein eigener Abruf.
// Gibt einen Kurztext fuer die Hinweis-Spalte im Laeufe-Tab zurueck ('' = nichts los).
function stornoVerschobenCheck(deals) {
  if (SV_MODUS === 'AUS') return '';
  const props = PropertiesService.getScriptProperties();
  const jetzt = new Date();
  const neuStand = svStandAus(deals);

  // Erster Lauf: nur Gedaechtnis fuellen. Sonst bekaeme jeder Verkaeufer
  // sofort alle bestehenden Stornos/Verschiebungen nachgeschickt.
  const standText = props.getProperty(SV_PROP_STAND);
  if (!standText) {
    props.setProperty(SV_PROP_STAND, JSON.stringify(neuStand));
    Logger.log('Storno/Verschoben-Check initialisiert: %s befuellte Felder gemerkt, 0 DMs.', Object.keys(neuStand).length);
    return 'SV initialisiert (' + Object.keys(neuStand).length + ' Felder)';
  }
  const stand = JSON.parse(standText);
  const queue = JSON.parse(props.getProperty(SV_PROP_QUEUE) || '{}');
  const dealsById = {};
  deals.forEach(function (d) { dealsById[String(d.id)] = d; });
  const zeilen = [];

  // 1. Neu gesetzte und geaenderte Felder in die Warteschlange. Steht ein Feld
  //    schon drin (z.B. neu gesetzt, dann vor dem Senden umgestellt), bleibt
  //    der erste Eintrag — gesendet wird ohnehin der Stand beim Senden.
  Object.keys(neuStand).forEach(function (k) {
    if (k in queue) return;
    if (!stand[k]) {
      queue[k] = { t: jetzt.toISOString(), alt: '' };
    } else if (String(stand[k]) !== String(neuStand[k])) {
      queue[k] = { t: jetzt.toISOString(), alt: String(stand[k]) };
    }
  });

  // 2. Warteschlange abarbeiten
  const kontext = { userMap: null };
  let dms = 0;
  Object.keys(queue).forEach(function (k) {
    const eintrag = typeof queue[k] === 'string' ? { t: queue[k], alt: '' } : queue[k];
    const teile = k.split('|');
    const deal = dealsById[teile[0]];
    if (!deal || !neuStand[k] || (eintrag.alt && eintrag.alt === String(neuStand[k]))) {
      const grund = !deal ? 'Deal nicht mehr in Pipeline ' + PIPELINE_ID
        : !neuStand[k] ? 'Feld vor dem Senden wieder geleert'
        : 'Wert vor dem Senden auf den alten zurueckgestellt';
      zeilen.push([jetzt, svDealZelle(deal) || teile[0], teile[1], '', '', '', '',
        'zurueckgenommen', '', grund]);
      delete queue[k];
      return;
    }
    if (jetzt.getTime() - new Date(eintrag.t).getTime() < SV_WARTEZEIT_MIN * 60 * 1000) return;

    const ergebnis = svMelde(deal, svFeld(teile[1]), kontext, false, eintrag.alt);
    zeilen.push(ergebnis.zeile);
    if (ergebnis.dm) dms++;
    delete queue[k];
  });

  props.setProperty(SV_PROP_STAND, JSON.stringify(neuStand));
  props.setProperty(SV_PROP_QUEUE, JSON.stringify(queue));
  svSchreibeZeilen(zeilen);

  const offen = Object.keys(queue).length;
  if (!zeilen.length && !offen) return '';
  return 'SV: ' + dms + ' DM' + (offen ? ', ' + offen + ' wartend' : '') + (SV_MODUS === 'TEST' ? ' (TEST)' : '');
}

// ---------- Meldung fuer EINEN Deal + EIN Feld ----------
// trocken=true: nur loggen, nichts senden. altId gesetzt = Korrektur-Meldung.
// Gibt { zeile, dm, text, vk } zurueck.
function svMelde(deal, feld, kontext, trocken, altId) {
  const jetzt = new Date();
  const cf = deal.custom_fields || {};
  const zeitpunkt = feld.optionen[svOptionId(cf[feld.zeitKey])] || svLabel(cf[feld.zeitKey]);
  const vorher = altId ? (feld.optionen[altId] || String(altId)) : '';
  const grund = svGrund(cf[feld.grundKey]);
  const datum = feld.datumKey && cf[feld.datumKey] ? formatiereEtDatum(cf[feld.datumKey]) + String(cf[feld.datumKey]).slice(0, 4) : '';
  const vkId = svUserId(cf[SV_VERKAEUFER_KEY]);
  const vk = vkId ? setterInfo(vkId, kontext) : { name: '', vorname: '', slackId: '' };
  const basis = [jetzt, svDealZelle(deal), feld.name + (vorher ? ' (Korrektur)' : ''),
    (vorher ? vorher + ' -> ' : '') + zeitpunkt, datum, grund, vk.name];

  const text = svText(vk, deal, feld, zeitpunkt, datum, grund, vorher, svKontakt(deal, kontext));
  const empfaenger = [];
  let detail = '';

  if (trocken) {
    Logger.log('[TROCKEN] -> %s (%s)\n%s', vk.name || 'KEIN Verkaeufer', vk.slackId || 'keine Slack-ID', text);
  } else if (SV_MODUS === 'LIVE' && vk.slackId) {
    if (sendeEtDm(vk.slackId, text)) empfaenger.push(vk.name);
    if (SV_KOPIE_AN_VALENTIN && vk.slackId !== VALENTIN_USER_ID) {
      if (sendeEtDm(VALENTIN_USER_ID, '📋 Kopie — an ' + vk.name + ' gesendet:\n\n' + text)) {
        empfaenger.push('Kopie Valentin');
      }
    }
  } else {
    // TEST-Modus, oder kein Verkaeufer / keine Slack-ID: nur Valentin, mit Klartext warum.
    let grundZeile;
    if (SV_MODUS !== 'LIVE') {
      grundZeile = '🧪 TEST — waere an ' + (vk.name || 'NIEMANDEN (Verkaeufer leer)')
        + (vk.name && !vk.slackId ? ' (KEINE Slack-ID!)' : '') + ' gegangen:';
    } else if (!vkId) {
      grundZeile = '⚠️ Feld „Verkäufer“ ist leer — bitte selbst weitergeben:';
      detail = 'Verkaeufer leer';
    } else {
      grundZeile = '⚠️ Keine Slack-ID fuer ' + vk.name + ' (Pipedrive-User ' + vkId + ') — bitte selbst weitergeben:';
      detail = 'Keine Slack-ID';
    }
    if (sendeEtDm(VALENTIN_USER_ID, grundZeile + '\n\n' + text)) empfaenger.push('Valentin');
  }

  return { dm: empfaenger.length > 0, text: text, vk: vk, zeile: basis.concat([
    trocken ? 'wuerde melden' : (empfaenger.length ? 'gemeldet' : 'DM fehlgeschlagen'),
    empfaenger.join(', '), detail]) };
}

function svText(vk, deal, feld, zeitpunkt, datum, grund, vorher, kontakt) {
  // Kundenname als eingebetteter Slack-Link auf den Deal. & < > muessen
  // escaped werden, | wuerde den Link-Text abschneiden.
  const name = String(deal.title || 'Deal ' + deal.id)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '/');
  const kunde = '*<' + DEAL_URL_BASE + deal.id + '|' + name + '>*';
  let kopf;
  if (vorher) {
    kopf = '✏️ *Korrektur ' + feld.name + '* — dein Kunde ' + kunde + ': jetzt *' + zeitpunkt
      + '* (vorher ' + vorher + ').';
  } else if (feld.name === 'Storno') {
    kopf = '❌ *Storno* — dein Kunde ' + kunde + ' wurde storniert (*' + zeitpunkt + '*).';
  } else {
    kopf = '↪️ *Verschoben* — dein Kunde ' + kunde + ' wurde verschoben (*' + zeitpunkt + '*).';
  }
  const zeilen = [
    vk.vorname ? 'Hallo ' + vk.vorname + ' 👋' : 'Hallo 👋',
    '',
    kopf
  ];
  if (feld.datumKey) zeilen.push('Verschoben auf: ' + (datum ? '*' + datum + '*' : '_noch offen_'));
  if (grund) zeilen.push('Grund: ' + grund);
  if (kontakt && (kontakt.tel || kontakt.mail)) {
    zeilen.push('📞 ' + (kontakt.tel || '–') + '   ✉️ ' + (kontakt.mail || '–'));
  } else {
    zeilen.push('📞 keine Kontaktdaten in Pipedrive');
  }
  zeilen.push('', 'Fragen bzw. Neuigkeiten bitte an Valentin.');
  return zeilen.join('\n');
}

// Telefon + Mail der Kontaktperson. Eigener Abruf /persons/{id} pro Meldung —
// Meldungen sind selten, der Bulk-Sweep (holePersonenPlzMap) laeuft nicht
// immer und hat keine Mail. emails/phones in v2: Array mit value/primary.
function svKontakt(deal, kontext) {
  const pid = deal.person_id && typeof deal.person_id === 'object'
    ? deal.person_id.value || deal.person_id.id : deal.person_id;
  if (!pid) return { tel: '', mail: '' };
  kontext.personen = kontext.personen || {};
  if (!kontext.personen[pid]) {
    try {
      const p = fetchPipedriveJson('/persons/' + pid, {}).data || {};
      kontext.personen[pid] = { tel: primaereNummer(p.phones), mail: primaereNummer(p.emails) };
    } catch (e) {
      Logger.log('SV: Person %s nicht lesbar: %s', pid, e.message);
      kontext.personen[pid] = { tel: '', mail: '' };
    }
  }
  return kontext.personen[pid];
}

// ---------- Werte lesen ----------
// Mit include_option_labels kommt ein enum als { id, label }, sonst als Zahl.
function svOptionId(wert) {
  if (wert === null || wert === undefined || wert === '') return '';
  if (typeof wert === 'object') return wert.id !== undefined ? String(wert.id) : '';
  return String(wert);
}
function svLabel(wert) {
  return wert && typeof wert === 'object' && wert.label ? String(wert.label) : svOptionId(wert);
}
function svGrund(wert) {
  const id = svOptionId(wert);
  return id ? (SV_GRUENDE[id] || svLabel(wert)) : '';
}
// User-Feld: Zahl, oder Objekt mit id/value — beides abfangen.
function svUserId(wert) {
  if (!wert) return null;
  if (typeof wert === 'object') return Number(wert.id || wert.value) || null;
  return Number(wert) || null;
}

function svStandAus(deals) {
  const stand = {};
  deals.forEach(function (d) {
    const cf = d.custom_fields || {};
    SV_FELDER.forEach(function (f) {
      const id = svOptionId(cf[f.zeitKey]);
      if (id) stand[d.id + '|' + f.name] = id;
    });
  });
  return stand;
}

function svFeld(name) {
  return SV_FELDER.filter(function (f) { return f.name === name; })[0];
}

function svDealZelle(deal) {
  return deal ? deal.id + ' ' + String(deal.title || '') : '';
}

function svSchreibeZeilen(zeilen) {
  if (!zeilen.length) return;
  const blatt = holeOderLegeAn(TAB_STORNO_VERSCHOBEN, SV_SPALTEN);
  blatt.getRange(blatt.getLastRow() + 1, 1, zeilen.length, SV_SPALTEN.length).setValues(zeilen);
}

// ============================================================
// MANUELL im Editor
// ============================================================

// Trockenlauf: zeigt fuer ALLE Pipeline-2-Deals mit gesetztem Storno-/
// Verschiebezeitpunkt, wer die DM bekaeme und wie sie aussieht.
// Kein Versand, kein Tab, Gedaechtnis bleibt unberuehrt.
function testeStornoVerschoben() {
  const deals = holeFulfillmentDeals();
  const kontext = { userMap: null };
  let n = 0, ohneVk = 0, ohneSlack = 0;
  deals.forEach(function (d) {
    SV_FELDER.forEach(function (f) {
      if (!svOptionId((d.custom_fields || {})[f.zeitKey])) return;
      const e = svMelde(d, f, kontext, true);
      n++;
      if (!e.vk.name) ohneVk++;
      else if (!e.vk.slackId) ohneSlack++;
    });
  });
  Logger.log('=> %s Meldungen moeglich, davon %s ohne Verkaeufer, %s ohne Slack-ID. Modus: %s. Gedaechtnis gesetzt: %s',
    n, ohneVk, ohneSlack, SV_MODUS, !!PropertiesService.getScriptProperties().getProperty(SV_PROP_STAND));
}

// Schickt die Meldung zu EINEM Deal als Probe NUR an Valentin.
function testeStornoVerschobenDm() {
  const DEAL_ID = 7350; // <- hier Deal-ID eintragen
  const deal = fetchPipedriveJson('/deals/' + DEAL_ID, { include_option_labels: true }).data;
  const kontext = { userMap: null };
  SV_FELDER.forEach(function (f) {
    if (!svOptionId((deal.custom_fields || {})[f.zeitKey])) return;
    const e = svMelde(deal, f, kontext, true);
    const ziel = (e.vk.name || 'NIEMAND (Verkaeufer leer)') + (e.vk.name && !e.vk.slackId ? ' (KEINE Slack-ID!)' : '');
    sendeEtDm(VALENTIN_USER_ID, '🧪 Probe — ginge an ' + ziel + ':\n\n' + e.text);
  });
}

// Loescht Gedaechtnis + Warteschlange. Beim naechsten Sweep wird neu
// initialisiert (ohne DMs). Der Tab bleibt stehen.
function setzeStornoVerschobenZurueck() {
  const props = PropertiesService.getScriptProperties();
  [SV_PROP_STAND, SV_PROP_QUEUE].forEach(function (k) { props.deleteProperty(k); });
  Logger.log('Storno/Verschoben-Check zurueckgesetzt.');
}
