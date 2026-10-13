// ============================================================
// ERSTTERMIN-CHECK — Slack-DM an den Setter, wenn er einen Ersttermin
// angelegt, aber die Setter-Info (Quali-Felder) nicht befuellt hat.
// ============================================================
// Warum: Die Setter-Info-Notiz (Ordnererstellung-bei-Gewonnen/SetterInfoNotiz.gs)
// laeuft seit 14.09. korrekt — aber nur 1 von 33 gewonnenen Deals hatte
// ueberhaupt Quali-Daten. Der Engpass ist das Befuellen, nicht das Script.
//
// Entscheidungen Valentin 08.10.2026:
//   - Empfaenger: der Setter, der die (E)-Activity ANGELEGT hat (creator_user_id)
//   - "befuellt" = mindestens 2 der 8 Quali-Felder
//   - genau EINE Erinnerung pro Activity
//   - nur in der Arbeitszeit (Mo-Fr 08-18); Nacht/Wochenende -> naechster Morgen
//   - Text endet mit "Fehlt dir was, dann bitte bei Valentin melden."
//   - Wartezeit nach Anlage: 30 min (Annahme, nicht explizit beantwortet)
//
// Ablauf pro Sweep (haengt in sweep(), eingekapselt):
//   1. /activities?updated_since=<Cursor> -> neue (E)-Activities in die Warteschlange
//   2. Warteschlange abarbeiten: was >= 30 min alt ist und in die Arbeitszeit
//      faellt, wird EINMAL bewertet und landet im Tab "Ersttermin-Check"
//   3. weniger als 2 Felder befuellt -> DM an den Setter (+ Kopie Valentin)
//
// Liest NUR aus Pipedrive. Schreibt nie dorthin.

// 'AUS'  = Modul laeuft nicht
// 'TEST' = DMs gehen NUR an Valentin, mit Hinweis, an wen sie gegangen waeren
// 'LIVE' = DM an den Setter (+ Kopie an Valentin, solange ET_KOPIE_AN_VALENTIN)
const ET_MODUS = 'LIVE'; // LIVE seit 08.10.2026 (VP)
const ET_KOPIE_AN_VALENTIN = true;

const ET_MIN_BEFUELLT = 2;
const ET_WARTEZEIT_MIN = 30;
// Activities, die laenger als das in der Warteschlange haengen (z.B. weil
// die Trigger tot waren), werden verworfen statt verspaetet angemahnt —
// eine Erinnerung nach einer Woche ist Laerm, kein Hinweis.
const ET_MAX_ALTER_TAGE = 3;
const ET_ARBEITSZEIT = { vonStunde: 8, bisStunde: 18 }; // Mo-Fr, Europe/Vienna
const ET_SALES_PIPELINE_ID = 1;

const TAB_ERSTTERMIN = 'Ersttermin-Check';
const ET_SPALTEN = ['Zeitpunkt', 'Activity', 'Betreff', 'Termin', 'Deal', 'Setter',
  'Befuellt', 'Ergebnis', 'Empfaenger', 'Detail'];

// Gleiche Erkennung wie CT-Funnel/Config.gs. Der Activity-Typ ist unzuverlaessig
// (call / ferstgesprach / angebot_nachrufen) — nur der Betreff-Marker zaehlt.
const ET_MARKER = /\(\s*E\s*\)/i;

// Die 8 Quali-Felder — Keys 1:1 aus Ordnererstellung-bei-Gewonnen/SetterInfoNotiz.gs.
// Wird dort ein Feld ergaenzt, hier mitziehen.
const ET_QUALI_FELDER = [
  { key: 'c108b937caf5aad0c2d48dbc3863a794ded9ec2e', label: 'Stromkosten' },
  { key: 'f5b1f9d0c9fb5779fbd5c2b32d9df474f938c41e', label: 'Verbrauch' },
  { key: 'b1f1969ced7c29cf0f566319dc9d5c0eb471c699', label: 'Montageart' },
  { key: '2f47be01059ed2c391b80fe2cf76477cb9fcc9bf', label: 'Umsetzung' },
  { key: 'e4c34197894538f20deed0a1ca0ce11304d93977', label: 'Montageort' },
  { key: 'bb4b8c59fa5891867170f6aeaba88cd294307cac', label: 'Interesse' },
  { key: 'f4948cce46f2b5a5ae168cf4ff20d092f2a2f94e', label: 'Einschränkung' },
  { key: '109e5a752dfc57a75aba31d96e87f6442f977e57', label: 'E-Auto' }
];

// Pipedrive-User-ID -> Slack-ID. Kopie aus Closer-Score/Config.gs.
// Wer hier fehlt, wird ueber die E-Mail aus /users (v1) aufgeloest.
const ET_SLACK_PER_USER_ID = {
  21708253: 'U06TCB95A9Y',   // Marco Benhammadi
  21716129: 'U07030XUKJ8',   // Andre Rechberger
  26640642: 'U0BGM3RRYB0',   // Sergen Caf
  22609153: 'U08356D2VFU',   // Sean Golubovic
  27727277: 'U0BH9M1QTD1'    // Jonathan Roessner
};
// E-Mail -> Slack-ID. Kopie aus Closer-Score/Mapping.gs (dort steht auch Sven).
const ET_SLACK_PER_MAIL = {
  'valentin@rp-energietechnik.at': 'U0BM9J0KPQT',
  'marco@rp-energietechnik.at':    'U06TCB95A9Y',
  'andre@rp-energietechnik.at':    'U07030XUKJ8',
  'sean@rp-energietechnik.at':     'U08356D2VFU',
  'sergen@rp-energietechnik.at':   'U0BGM3RRYB0',
  'patryk@rp-energietechnik.at':   'U0BMM6A63LH',
  'ramon@rp-energietechnik.at':    'U0BHKLB6GUU',
  'jonathan@rp-energietechnik.at': 'U0BH9M1QTD1',
  'sven@rp-energietechnik.at':     'U0BPY5FKQ5C',
  'florian@rp-energietechnik.at':  'U0C27EY6KT5',
  'anja@rp-energietechnik.at':     'U06V006TH39'
};

// ScriptProperties
const ET_PROP_CURSOR = 'ET_CURSOR';       // ISO-Zeitpunkt fuer updated_since
const ET_PROP_START = 'ET_START';         // nur Activities, die NACH dem Start angelegt wurden
const ET_PROP_QUEUE = 'ET_QUEUE';         // { activityId: addTimeIso }
// Ueberlappung beim Cursor: lieber eine Activity doppelt sehen (Queue +
// Tab-Pruefung fangen das ab) als eine an der Kante verlieren.
const ET_UEBERLAPPUNG_MS = 5 * 60 * 1000;
const ET_MAX_SEITEN = 10;

// ---------- Einstieg aus sweep() ----------
// Gibt einen Kurztext fuer die Hinweis-Spalte im Laeufe-Tab zurueck ('' = nichts los).
function erstterminCheck() {
  if (ET_MODUS === 'AUS') return '';
  const props = PropertiesService.getScriptProperties();
  const jetzt = new Date();

  // Erster Lauf: Cursor auf jetzt setzen und NICHTS nachholen. Sonst kaemen
  // beim Scharfschalten alle (E)-Termine der letzten Wochen auf einmal.
  if (!props.getProperty(ET_PROP_CURSOR)) {
    props.setProperty(ET_PROP_CURSOR, jetzt.toISOString());
    props.setProperty(ET_PROP_START, jetzt.toISOString());
    Logger.log('Ersttermin-Check initialisiert ab %s.', jetzt.toISOString());
    return 'Ersttermin-Check initialisiert';
  }

  const queue = JSON.parse(props.getProperty(ET_PROP_QUEUE) || '{}');
  const startIso = props.getProperty(ET_PROP_START);
  const seitIso = new Date(new Date(props.getProperty(ET_PROP_CURSOR)).getTime() - ET_UEBERLAPPUNG_MS).toISOString();

  // 1. Neue (E)-Activities einsammeln
  const neu = holeErsttermineSeit(seitIso);
  neu.forEach(function (a) {
    if (a.add_time && a.add_time < startIso) return; // alt, nur bearbeitet
    if (!(String(a.id) in queue)) queue[String(a.id)] = a.add_time || jetzt.toISOString();
  });
  // Cursor erst NACH erfolgreichem Abruf weitersetzen. Wirft der Abruf,
  // bleibt der alte stehen und der naechste Lauf holt dasselbe Fenster.
  props.setProperty(ET_PROP_CURSOR, jetzt.toISOString());

  // 2. Warteschlange abarbeiten
  const bereitsBewertet = leseBewerteteActivities();
  const inArbeitszeit = istArbeitszeit(jetzt);
  const zeilen = [];
  let dms = 0;
  let verworfen = 0;
  const kontext = { userMap: null };

  Object.keys(queue).forEach(function (id) {
    if (bereitsBewertet[id]) { delete queue[id]; return; }
    const alterMs = jetzt.getTime() - new Date(queue[id]).getTime();
    if (alterMs > ET_MAX_ALTER_TAGE * 24 * 3600 * 1000) {
      zeilen.push([jetzt, id, '', '', '', '', '', 'verworfen (zu alt)', '',
        'Lag ' + Math.round(alterMs / 3600000) + ' h in der Warteschlange — Trigger tot gewesen?']);
      delete queue[id];
      verworfen++;
      return;
    }
    if (alterMs < ET_WARTEZEIT_MIN * 60 * 1000) return; // Setter hat noch Zeit
    if (!inArbeitszeit) return;                          // naechster Morgen

    const ergebnis = bewerteErsttermin(id, kontext, false);
    zeilen.push(ergebnis.zeile);
    if (ergebnis.dm) dms++;
    delete queue[id];
  });

  props.setProperty(ET_PROP_QUEUE, JSON.stringify(queue));
  schreibeErstterminZeilen(zeilen);

  const offen = Object.keys(queue).length;
  if (!zeilen.length && !neu.length) return '';
  return 'ET: ' + neu.length + ' neu, ' + zeilen.length + ' bewertet, ' + dms + ' DM'
    + (offen ? ', ' + offen + ' wartend' : '')
    + (verworfen ? ', ' + verworfen + ' verworfen' : '')
    + (ET_MODUS === 'TEST' ? ' (TEST)' : '');
}

// ---------- Bewertung EINER Activity ----------
// trocken=true: nur loggen, nichts senden. Gibt { zeile, dm } zurueck.
function bewerteErsttermin(activityId, kontext, trocken) {
  const jetzt = new Date();
  let a;
  try {
    a = fetchPipedriveJson('/activities/' + activityId, {}).data;
  } catch (fehler) {
    // 404 = geloescht. Kein Termin mehr, keine Erinnerung.
    return { dm: false, zeile: [jetzt, activityId, '', '', '', '', '', 'uebersprungen', '',
      'Activity nicht abrufbar (geloescht?): ' + fehler.message.slice(0, 120)] };
  }
  const betreff = String(a.subject || '');
  const termin = [a.due_date || '', a.due_time ? String(a.due_time).slice(0, 5) + ' UTC' : ''].join(' ').trim();
  const basis = [jetzt, a.id, betreff, termin];

  if (!ET_MARKER.test(betreff)) {
    return { dm: false, zeile: basis.concat(['', '', '', 'uebersprungen', '', '(E) nicht mehr im Betreff']) };
  }

  const setter = setterInfo(a.creator_user_id, kontext);
  const dealErmittlung = findeDeal(a);
  const deal = dealErmittlung.deal;

  if (!deal) {
    // Ohne Deal gibt es keine Felder zu pruefen. Nicht raten — Valentin
    // bekommt den Fall mit allen Angaben und entscheidet.
    const text = '⚠️ Ersttermin ohne zuordenbaren Deal: "' + betreff + '" (Activity ' + a.id
      + ', angelegt von ' + setter.name + '). ' + dealErmittlung.detail;
    const gesendet = trocken ? false : sendeEtDm(VALENTIN_USER_ID, text);
    return { dm: gesendet, zeile: basis.concat(['', setter.name, '', 'kein Deal',
      gesendet ? 'Valentin' : '', dealErmittlung.detail]) };
  }

  const pruefung = pruefeQualiFelder(deal);
  const dealZelle = deal.id + ' ' + String(deal.title || '');
  if (pruefung.befuellt >= ET_MIN_BEFUELLT) {
    return { dm: false, zeile: basis.concat([dealZelle, setter.name,
      pruefung.befuellt + '/' + ET_QUALI_FELDER.length, 'ok', '', dealErmittlung.detail]) };
  }

  const text = baueErstterminText(setter, deal, a, pruefung);
  const empfaenger = [];
  let detail = dealErmittlung.detail;

  if (trocken) {
    Logger.log('[TROCKEN] -> %s (%s)\n%s', setter.name, setter.slackId || 'keine Slack-ID', text);
  } else if (ET_MODUS === 'LIVE' && setter.slackId) {
    if (sendeEtDm(setter.slackId, text)) empfaenger.push(setter.name);
    if (ET_KOPIE_AN_VALENTIN && setter.slackId !== VALENTIN_USER_ID) {
      if (sendeEtDm(VALENTIN_USER_ID, '📋 Kopie — an ' + setter.name + ' gesendet:\n\n' + text)) {
        empfaenger.push('Kopie Valentin');
      }
    }
  } else {
    // TEST-Modus, oder LIVE ohne Slack-ID: nur Valentin, mit Klartext warum.
    const grund = ET_MODUS === 'LIVE'
      ? '⚠️ Keine Slack-ID fuer ' + setter.name + ' (Pipedrive-User ' + a.creator_user_id + ') — bitte selbst weitergeben:'
      : '🧪 TEST — waere an ' + setter.name + (setter.slackId ? '' : ' (KEINE Slack-ID!)') + ' gegangen:';
    if (sendeEtDm(VALENTIN_USER_ID, grund + '\n\n' + text)) empfaenger.push('Valentin');
    if (!setter.slackId) detail = 'Keine Slack-ID. ' + detail;
  }

  return { dm: empfaenger.length > 0, zeile: basis.concat([dealZelle, setter.name,
    pruefung.befuellt + '/' + ET_QUALI_FELDER.length,
    trocken ? 'wuerde erinnern' : (empfaenger.length ? 'erinnert' : 'DM fehlgeschlagen'),
    empfaenger.join(', '), detail]) };
}

// ---------- Deal finden ----------
// Ersttermine haengen oft nur an der PERSON (deal_id leer). Dann: offener
// Deal dieser Person in der Sales-Pipeline. Bei mehreren der zuletzt angelegte
// — und das steht im Detail, damit es nachpruefbar ist.
function findeDeal(a) {
  if (a.deal_id) {
    const d = fetchPipedriveJson('/deals/' + a.deal_id, {}).data;
    return { deal: d, detail: '' };
  }
  if (!a.person_id) {
    return { deal: null, detail: 'Activity haengt weder an Deal noch an Person.' };
  }
  const json = fetchPipedriveJson('/deals', {
    person_id: a.person_id, pipeline_id: ET_SALES_PIPELINE_ID, status: 'open', limit: 50
  });
  const deals = (json.data || []).sort(function (x, y) {
    return String(y.add_time).localeCompare(String(x.add_time));
  });
  if (!deals.length) {
    return { deal: null, detail: 'Person ' + a.person_id + ' hat keinen offenen Deal in Pipeline ' + ET_SALES_PIPELINE_ID + '.' };
  }
  const detail = 'Deal ueber Person ' + a.person_id + ' gefunden'
    + (deals.length > 1 ? ' (' + deals.length + ' offene — neuester genommen)' : '') + '.';
  return { deal: deals[0], detail: detail };
}

// ---------- Felder pruefen ----------
function pruefeQualiFelder(deal) {
  const cf = deal.custom_fields || {};
  const fehlend = [];
  let befuellt = 0;
  ET_QUALI_FELDER.forEach(function (f) {
    if (etIstLeer(cf[f.key])) fehlend.push(f.label);
    else befuellt++;
  });
  return { befuellt: befuellt, fehlend: fehlend };
}

// null, '', [] und Waehrungsobjekte ohne Betrag ({value: null, currency}) gelten als leer.
function etIstLeer(wert) {
  if (wert === null || wert === undefined || wert === '') return true;
  if (Array.isArray(wert)) return wert.length === 0;
  if (typeof wert === 'object' && 'value' in wert) return etIstLeer(wert.value);
  return false;
}

// ---------- Nachricht ----------
function baueErstterminText(setter, deal, a, pruefung) {
  const zeilen = [
    'Hallo ' + setter.vorname + ' 👋',
    '',
    'Du hast einen Ersttermin angelegt — *' + String(deal.title || 'Deal ' + deal.id) + '*'
      + (a.due_date ? ' (' + formatiereEtDatum(a.due_date) + ')' : '') + '.',
    'Die Setter-Info ist aber noch fast leer: *' + pruefung.befuellt + ' von ' + ET_QUALI_FELDER.length + '* Feldern befüllt.',
    '',
    'Bitte im Deal nachtragen: ' + pruefung.fehlend.join(', '),
    '👉 ' + DEAL_URL_BASE + deal.id,
    '',
    'Die Infos landen beim Gewinnen automatisch als Notiz am Deal — damit Closer und Fulfillment nicht nochmal nachfragen müssen.',
    '',
    'Fehlt dir was, dann bitte bei Valentin melden.'
  ];
  return zeilen.join('\n');
}

function formatiereEtDatum(iso) {
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).slice(0, 10));
  return t ? t[3] + '.' + t[2] + '.' : String(iso);
}

// ---------- Slack ----------
// chat.postMessage mit User-ID als channel = DM vom Bot. chat:write reicht
// (gleiches Muster wie Closer-Score/Slack.gs).
function sendeEtDm(slackId, text) {
  try {
    fetchSlackJson('chat.postMessage', null, { channel: slackId, text: text, unfurl_links: false });
    return true;
  } catch (fehler) {
    Logger.log('❌ Ersttermin-DM an %s fehlgeschlagen: %s', slackId, fehler.message);
    return false;
  }
}

// Name + Slack-ID des Setters. /users wird pro Lauf hoechstens einmal geholt.
function setterInfo(userId, kontext) {
  if (!kontext.userMap) kontext.userMap = holeUserMitMail();
  const u = kontext.userMap[String(userId)] || { name: 'User ' + userId, mail: '' };
  const slackId = ET_SLACK_PER_USER_ID[userId] || ET_SLACK_PER_MAIL[u.mail] || '';
  return { name: u.name, vorname: String(u.name).split(' ')[0], slackId: slackId };
}

// /users ist v1. Eigene Variante von holeUserMap() (CtTermine.gs), weil
// hier zusaetzlich die E-Mail gebraucht wird.
function holeUserMitMail() {
  const map = {};
  try {
    const url = PIPEDRIVE_BASE_V1 + '/users?api_token=' + encodeURIComponent(getPipedriveToken());
    const response = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) throw new Error('HTTP ' + response.getResponseCode());
    (JSON.parse(response.getContentText()).data || []).forEach(function (u) {
      map[String(u.id)] = { name: String(u.name || '').trim(), mail: String(u.email || '').toLowerCase().trim() };
    });
  } catch (fehler) {
    Logger.log('⚠️ /users nicht abrufbar (%s) — Slack-Zuordnung nur ueber die ID-Liste.', fehler.message);
  }
  return map;
}

// ---------- Pipedrive-Abruf ----------
function holeErsttermineSeit(seitIso) {
  const treffer = [];
  let cursor = null;
  let seiten = 0;
  do {
    if (++seiten > ET_MAX_SEITEN) throw new Error('Ersttermin-Check: mehr als ' + ET_MAX_SEITEN + ' Seiten seit ' + seitIso);
    const params = { updated_since: seitIso.replace(/\.\d{3}Z$/, 'Z'), limit: 500 };
    if (cursor) params.cursor = cursor;
    const json = fetchPipedriveJson('/activities', params);
    (json.data || []).forEach(function (a) {
      if (ET_MARKER.test(String(a.subject || ''))) treffer.push(a);
    });
    cursor = json.additional_data && json.additional_data.next_cursor;
  } while (cursor);
  return treffer;
}

// ---------- Arbeitszeit ----------
function istArbeitszeit(datum) {
  const tz = Session.getScriptTimeZone();
  const wochentag = Number(Utilities.formatDate(datum, tz, 'u')); // 1 = Mo ... 7 = So
  const stunde = Number(Utilities.formatDate(datum, tz, 'H'));
  return wochentag <= 5 && stunde >= ET_ARBEITSZEIT.vonStunde && stunde < ET_ARBEITSZEIT.bisStunde;
}

// ---------- Tab ----------
// Spalte B = Activity-ID. Was dort steht, wurde bewertet — und wird nie wieder
// angemahnt. Das ist die "nur einmal erinnern"-Garantie, sichtbar im Sheet.
function leseBewerteteActivities() {
  const blatt = holeOderLegeAn(TAB_ERSTTERMIN, ET_SPALTEN);
  const map = {};
  const n = blatt.getLastRow() - 1;
  if (n < 1) return map;
  blatt.getRange(2, 2, n, 1).getValues().forEach(function (r) {
    if (r[0] !== '') map[String(r[0])] = true;
  });
  return map;
}

function schreibeErstterminZeilen(zeilen) {
  if (!zeilen.length) return;
  const blatt = holeOderLegeAn(TAB_ERSTTERMIN, ET_SPALTEN);
  blatt.getRange(blatt.getLastRow() + 1, 1, zeilen.length, ET_SPALTEN.length).setValues(zeilen);
}

// ============================================================
// MANUELL im Editor
// ============================================================

// Trockenlauf: bewertet alle (E)-Activities, die in den letzten 3 Tagen
// angelegt wurden — ohne DM, ohne Tab, ohne Queue/Cursor zu beruehren.
// Ergebnis im Ausfuehrungsprotokoll.
function testeErstterminCheck() {
  const seit = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const kandidaten = holeErsttermineSeit(seit).filter(function (a) { return a.add_time >= seit; });
  Logger.log('%s (E)-Activities seit %s angelegt.', kandidaten.length, seit);
  const kontext = { userMap: null };
  let wuerde = 0;
  kandidaten.forEach(function (a) {
    const e = bewerteErsttermin(a.id, kontext, true);
    if (e.zeile[7] === 'wuerde erinnern') wuerde++;
    Logger.log('%s | %s | Deal %s | %s | %s | %s', e.zeile[1], e.zeile[2], e.zeile[4], e.zeile[5], e.zeile[6], e.zeile[7] + (e.zeile[9] ? ' — ' + e.zeile[9] : ''));
  });
  Logger.log('=> %s wuerden erinnert werden. Modus aktuell: %s. Arbeitszeit jetzt: %s',
    wuerde, ET_MODUS, istArbeitszeit(new Date()));
}

// Schickt EINE Beispiel-DM an Valentin — prueft, ob der Ernst-Bot DMs darf.
function testeErstterminDm() {
  const ok = sendeEtDm(VALENTIN_USER_ID, '🧪 Test Ersttermin-Check: wenn du das liest, darf Ernst DMs schicken.');
  Logger.log(ok ? '✅ DM an Valentin gesendet.' : '❌ DM fehlgeschlagen — siehe Fehler oben.');
}

// Setzt Cursor/Queue zurueck. Danach startet der Check beim naechsten Sweep
// frisch ab "jetzt" (keine Altlasten). Der Tab bleibt stehen.
function setzeErstterminCheckZurueck() {
  const props = PropertiesService.getScriptProperties();
  [ET_PROP_CURSOR, ET_PROP_START, ET_PROP_QUEUE].forEach(function (k) { props.deleteProperty(k); });
  Logger.log('Ersttermin-Check zurueckgesetzt.');
}
