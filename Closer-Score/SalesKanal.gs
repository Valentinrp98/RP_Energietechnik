// ============================================================
// SALES-KANAL — wer hat den Abschluss wirklich gemacht?
// ============================================================
// BEFUND 23.09.2026, und er kippt die bisherige Annahme:
// creator_user_id ist NICHT der Verkaeufer. Bei Deal 6777 (Glauninger) steht
// dort Marco, in #sales hat aber Sven Mlinar den Auftrag gepostet. Marco legt
// die Deals in Pipedrive an — deshalb hingen 84% aller Deals an ihm. Haetten
// wir scharf geschaltet, haette Marco 81 fremde Rueckmeldungen bekommen und
// die Closer selbst keine einzige. Der Freigabe-Modus hat das verhindert.
//
// Die verlaessliche Quelle ist #sales: jeder Closer postet seinen Abschluss
// selbst, seit Monaten im immer gleichen Format:
//
//   Auftrag Gerhard Glauninger 20.807€ OÖ (E) SM mit <@U…|Jonathan Rössner> 🕎
//   ^^^^^^^ ^^^^^^^^^^^^^^^^^^ ^^^^^^^
//   Marker  Kundenname          ab hier Betrag/Bundesland/Deko
//
// Der AUTOR dieser Nachricht ist der Closer — und sein Slack-User ist damit
// direkt die DM-Adresse. Kein Umweg ueber Pipedrive-User-IDs, kein Mapping,
// das bei jedem Personalwechsel nachgepflegt werden muss.
//
// Die @-Erwaehnung im Text ist NICHT der Empfaenger. Das ist der Setter bzw.
// der Kollege, mit dem gemeinsam abgeschlossen wurde. Die Rueckmeldung geht an
// den, der uebergeben hat — also an den Autor.
//
// Voraussetzungen (beides einmalig):
//   1. Bot-Scope `channels:history`
//   2. Ernst muss in #sales sein  →  dort  /invite @Ernst
// pruefeSalesKanal() sagt im Klartext, welches von beiden fehlt.

const SALES_CHANNEL_ID = 'C06SXQ67PFZ';   // #sales

// Wie weit zurueck wird gelesen. Deals werden 48 h nach der Uebernahme
// bewertet, die #sales-Meldung kommt am Abschlusstag — 180 Tage sind grosszuegig
// und kosten nur ein paar Seiten conversations.history pro Lauf.
const SALES_TAGE_ZURUECK = 180;

// Nur Nachrichten, die so beginnen, sind Abschlussmeldungen. Alles andere im
// Kanal ist Diskussion.
const SALES_MARKER = /^\s*auftrag\b/i;

let _salesIndex = null;   // pro Ausfuehrung einmal aufgebaut

// ---------- Index ----------

// Liefert [{ kunde, kundeNorm, autor, autorName, ts, zeit }], neueste zuerst.
function salesIndex() {
  if (_salesIndex) return _salesIndex;

  const aeltestens = Math.floor(Date.now() / 1000) - SALES_TAGE_ZURUECK * 86400;
  const treffer = [];
  let cursor = null;
  let seiten = 0;

  do {
    const params = { channel: SALES_CHANNEL_ID, limit: 200, oldest: aeltestens };
    if (cursor) params.cursor = cursor;
    const json = fetchSlackJson('conversations.history', params, null);

    (json.messages || []).forEach(function (m) {
      // Thread-Antworten stehen nicht in history, Bot-Posts haben kein `user`.
      if (!m.user || !m.text || !SALES_MARKER.test(m.text)) return;
      const kunde = kundeAusMeldung(m.text);
      if (!kunde) return;
      treffer.push({
        kunde: kunde,
        kundeNorm: normalisiereName(kunde),
        autor: m.user,
        ts: m.ts,
        zeit: new Date(Number(m.ts) * 1000)
      });
    });

    cursor = (json.response_metadata || {}).next_cursor || null;
    seiten++;
  } while (cursor && seiten < 20);   // Deckel gegen Endlosschleife

  _salesIndex = treffer;
  return treffer;
}

// Aus "Auftrag Gerhard Glauninger 20.807€ OÖ (E) SM mit <@U…>" wird
// "Gerhard Glauninger". Abgebrochen wird beim ersten Token, das
//   - mit einer Ziffer beginnt (der Betrag),
//   - "mit" ist ("Auftrag Ehepaar Klösch mit <@…> 37.423€"),
//   - eine Erwaehnung oder Klammer ist.
// Lieber ein Wort zu wenig als den halben Betrag im Namen: verglichen wird
// ohnehin tokenweise.
function kundeAusMeldung(text) {
  const ohneMarker = text.replace(SALES_MARKER, '').trim();
  const woerter = ohneMarker.split(/\s+/);
  const name = [];
  for (let i = 0; i < woerter.length; i++) {
    const w = woerter[i];
    if (/^[\d(<:]/.test(w)) break;
    if (/^mit$/i.test(w)) break;
    name.push(w);
    if (name.length >= 5) break;   // laenger ist kein Kundenname mehr
  }
  return name.join(' ').replace(/[,;.]+$/, '').trim() || null;
}

// Umlaute falten, Satzzeichen weg, klein. "Schönewolf" und "Schoenewolf"
// sollen sich treffen — im Kanal wird frei getippt, in Pipedrive steht der
// Name aus dem Formular.
function normalisiereName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function nameTokens(s) {
  return normalisiereName(s).split(' ').filter(function (t) { return t.length >= 3; });
}

// ---------- Zuordnung ----------

// Sucht die #sales-Meldung zum Deal. Rueckgabe:
//   { slackId, kunde, zeit, sicherheit: 'genau'|'teilweise' }  oder
//   { fehler: '<Klartext>' , kandidaten: [...] }
// Bewusst kein Raten: bei mehreren gleich guten Treffern kommt der Fall mit
// allen Kandidaten ins Log, damit ein Mensch in 30 Sekunden entscheiden kann.
function closerAusSales(deal) {
  const titel = deal.title || '';
  const zielNorm = normalisiereName(titel);
  const zielTokens = nameTokens(titel);
  if (zielTokens.length === 0) return { fehler: 'Deal-Titel "' + titel + '" ergibt keinen vergleichbaren Namen.' };

  const genau = [];
  const teilweise = [];

  salesIndex().forEach(function (m) {
    if (m.kundeNorm === zielNorm) { genau.push(m); return; }
    // Jedes Token des kuerzeren Namens muss im laengeren vorkommen. Damit
    // trifft "Ehepaar Klösch" auf "Klösch" und "SEL Bekmez" auf "Bekmez",
    // ohne dass ein einzelner Vorname zwei Kunden verbindet.
    const mTokens = nameTokens(m.kunde);
    if (mTokens.length === 0) return;
    const kurz = mTokens.length <= zielTokens.length ? mTokens : zielTokens;
    const lang = mTokens.length <= zielTokens.length ? zielTokens : mTokens;
    const alleDrin = kurz.every(function (t) { return lang.indexOf(t) !== -1; });
    if (alleDrin) teilweise.push(m);
  });

  const auswahl = genau.length ? genau : teilweise;
  const sicherheit = genau.length ? 'genau' : 'teilweise';

  if (auswahl.length === 0) {
    return { fehler: 'Keine #sales-Meldung zu "' + titel + '" in den letzten ' + SALES_TAGE_ZURUECK + ' Tagen.' };
  }

  // Mehrere Treffer: der zeitlich naechste am Abschluss gewinnt — aber nur,
  // wenn sie sich auf denselben Autor einigen. Sonst wird nicht geraten.
  if (auswahl.length > 1) {
    const autoren = {};
    auswahl.forEach(function (m) { autoren[m.autor] = true; });
    if (Object.keys(autoren).length > 1) {
      return {
        fehler: auswahl.length + ' #sales-Meldungen passen auf "' + titel + '", von verschiedenen Leuten.',
        kandidaten: auswahl
      };
    }
  }

  const abschluss = deal.won_time ? new Date(deal.won_time).getTime() : Date.now();
  auswahl.sort(function (a, b) {
    return Math.abs(a.zeit.getTime() - abschluss) - Math.abs(b.zeit.getTime() - abschluss);
  });
  const m = auswahl[0];
  return { slackId: m.autor, kunde: m.kunde, zeit: m.zeit, sicherheit: sicherheit };
}

// ---------- Messinstrument ----------

// Laeuft vor dem Umstellen. Zeigt fuer jeden qualifizierten Deal nebeneinander,
// was Pipedrive behauptet und was #sales sagt. Schreibt nichts und verschickt
// nichts.
function pruefeSalesKanal() {
  let index;
  try {
    index = salesIndex();
  } catch (e) {
    Logger.log('❌ Der Kanal ist nicht lesbar: %s', e.message);
    if (/missing_scope/.test(e.message)) {
      Logger.log('   → Dem Bot fehlt der Scope `channels:history`.');
      Logger.log('     api.slack.com → deine App → OAuth & Permissions → Bot Token Scopes');
      Logger.log('     → channels:history ergaenzen → "Reinstall to Workspace".');
    } else if (/not_in_channel/.test(e.message)) {
      Logger.log('   → Ernst ist nicht in #sales. Dort einmal  /invite @Ernst  tippen.');
    }
    return;
  }

  Logger.log('=== %s Auftrags-Meldungen in #sales (letzte %s Tage) ===',
             String(index.length), String(SALES_TAGE_ZURUECK));
  index.slice(0, 5).forEach(function (m) {
    Logger.log('  %s · %s → %s',
               Utilities.formatDate(m.zeit, 'Europe/Vienna', 'dd.MM.'),
               m.kunde, slackName(m.autor));
  });

  const deals = holeFulfillmentDeals().filter(function (d) {
    return istBefuellt((d.custom_fields || {})[FELD_SEVDESK_SUMMARY], 'text');
  });

  Logger.log('\n=== Abgleich auf %s qualifizierten Deals ===\n', String(deals.length));

  let gleich = 0, anders = 0, offen = 0;
  const ungeklaert = [];

  deals.forEach(function (d) {
    const sales = closerAusSales(d);
    const pdName = pipedriveUserName(closerAus(d)) || ('User ' + closerAus(d));
    if (sales.fehler) {
      offen++;
      ungeklaert.push({ deal: d, grund: sales.fehler });
      return;
    }
    const salesName = slackName(sales.slackId);
    const pdSlack = CLOSER_SLACK_IDS[closerAus(d)];
    if (pdSlack === sales.slackId) {
      gleich++;
    } else {
      anders++;
      Logger.log('  ⚠️ %s "%s"', String(d.id), d.title);
      Logger.log('      Pipedrive sagt: %s   ·   #sales sagt: %s  (%s)',
                 pdName, salesName, sales.sicherheit);
    }
  });

  Logger.log('\n--- Bilanz ---');
  Logger.log('  ✅ gleich:        %s', String(gleich));
  Logger.log('  ⚠️ widersprechen: %s', String(anders));
  Logger.log('  ❔ ohne Meldung:  %s', String(offen));

  if (ungeklaert.length) {
    Logger.log('\n=== Ohne #sales-Meldung — hier ginge die DM an dich ===');
    ungeklaert.slice(0, 25).forEach(function (u) {
      Logger.log('  %s "%s" — %s', String(u.deal.id), u.deal.title, u.grund);
      if (u.grund.indexOf('von verschiedenen') !== -1) { /* Kandidaten folgen unten */ }
    });
    if (ungeklaert.length > 25) Logger.log('  … und %s weitere.', String(ungeklaert.length - 25));
    Logger.log('\n  Das sind meist Deals von VOR der #sales-Gewohnheit, oder der Kunde');
    Logger.log('  heisst in Pipedrive anders als im Kanal. Beides kein Fehler im Score —');
    Logger.log('  die Meldung landet dann mit Hinweis bei dir statt beim Falschen.');
  }
}

// Name zu einer Slack-ID, nur fuers Log. Umgekehrter Blick in SLACK_NACH_MAIL,
// damit dafuer kein users.info und kein `users:read` noetig ist.
function slackName(slackId) {
  for (const mail in SLACK_NACH_MAIL) {
    if (SLACK_NACH_MAIL[mail] === slackId) return mail.split('@')[0];
  }
  return slackId;
}
