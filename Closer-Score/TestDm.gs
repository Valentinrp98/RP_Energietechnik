// ============================================================
// ECHTE TEST-DM — geht immer an Valentin, an niemanden sonst
// ============================================================
// Das ist die einzige Funktion im Projekt, die auch bei DRY_RUN = true
// wirklich etwas verschickt. Der Zweck ist genau das: einmal sehen, wie die
// Nachricht in Slack tatsaechlich aussieht — Fettung, Umbrueche, Emojis und
// der Deal-Link zeigen sich erst im Client, nicht im Log.
//
// SICHERHEITSGURT: der Empfaenger ist hart VALENTIN_USER_ID. Diese Funktionen
// rufen bestimmeEmpfaenger() bewusst NICHT auf, koennen CLOSER_SLACK_IDS also
// gar nicht erreichen. Es ist technisch unmoeglich, dass hier eine Nachricht
// bei einem Kollegen landet — egal wie das Mapping aussieht.
//
// Es wird nichts nach Pipedrive geschrieben und kein Zustand fortgeschrieben.
// Die Deals bleiben danach also "noch nicht gemeldet".

// Schickt drei echte DMs: den besten, einen mittleren und den schlechtesten
// Deal. Drei, weil die Ampelfarben unterschiedlich formuliert sind — eine
// gruene Nachricht liest sich anders als eine rote, und beides willst du
// gesehen haben, bevor es an Kollegen geht.
function testeDmAnMich() {
  const deals = holeFulfillmentDeals().filter(function (d) {
    return istBefuellt((d.custom_fields || {})[FELD_SEVDESK_SUMMARY], 'text');
  });
  if (deals.length === 0) { Logger.log('Keine qualifizierten Deals — nichts zu verschicken.'); return; }

  const bewertet = deals.map(bewerteDeal).sort(function (a, b) { return b.anteil - a.anteil; });
  const auswahl = [
    { was: 'bester Deal',       e: bewertet[0] },
    { was: 'mittlerer Deal',    e: bewertet[Math.floor(bewertet.length / 2)] },
    { was: 'schlechtester Deal', e: bewertet[bewertet.length - 1] }
  ];

  Logger.log('Schicke %s echte Test-DMs an Valentin (%s).', String(auswahl.length), VALENTIN_USER_ID);
  auswahl.forEach(function (fall) {
    sendeTestDm(fall.e, fall.was);
  });
  Logger.log('\nFertig. Schau in Slack nach — der Bot "Ernst" schreibt dir direkt.');
  Logger.log('Es wurde nichts nach Pipedrive geschrieben und kein Zustand gesetzt.');
}

// Einzelner Deal nach ID, falls du einen bestimmten sehen willst.
// Deal-ID unten eintragen und ausfuehren.
function testeDmAnMichEinDeal() {
  const DEAL_ID = 7113; // <- hier die gewuenschte Deal-ID eintragen

  const deals = holeFulfillmentDeals().filter(function (d) { return d.id === DEAL_ID; });
  if (deals.length === 0) {
    Logger.log('Deal %s liegt nicht in Pipeline %s — nichts verschickt.', String(DEAL_ID), String(PIPELINE_ID));
    return;
  }
  sendeTestDm(bewerteDeal(deals[0]), 'Einzeltest');
}

// Der gemeinsame Kern. Haengt einen Kopf an, damit in Slack sofort erkennbar
// ist, dass das ein Test war und nicht der Echtbetrieb.
function sendeTestDm(ergebnis, was) {
  const kopf = '🧪 *TESTNACHRICHT* (' + was + ') — so wuerde die DM beim Closer ankommen:\n\n';
  const fuss = '\n\n_Test vom ' + Utilities.formatDate(new Date(), 'Europe/Vienna', 'dd.MM.yyyy HH:mm') +
               '. Im Echtbetrieb ginge das an ' + closerName(ergebnis.closerId) +
               ' — nicht an dich. Es wurde nichts in Pipedrive geaendert._';

  sendeDm(VALENTIN_USER_ID, kopf + baueNachricht(ergebnis) + fuss);
  Logger.log('  ✅ %s: Deal %s "%s" — %s %s/%s Punkte',
             was, String(ergebnis.dealId), ergebnis.titel,
             ergebnis.ampel, String(ergebnis.punkte), String(ergebnis.maximum));
}

// Nur fuer die Fussnote: wer waere im Echtbetrieb dran? Ein Namensaufruf ist
// den einen zusaetzlichen GET wert, "Pipedrive-User 12345678" sagt nichts.
function closerName(closerId) {
  if (closerId === null || closerId === undefined) return 'niemanden (' + CLOSER_FELD + ' ist leer)';
  const name = pipedriveUserName(closerId) || ('Pipedrive-User ' + closerId);
  const gemappt = CLOSER_SLACK_IDS[closerId] ? '' : ' — ⚠️ noch ohne Slack-Mapping, ginge also ebenfalls an dich';
  return name + gemappt;
}


// ============================================================
// HEUTIGE CLOSES — Testlauf fuer die Deals von heute
// ============================================================
// Warum eine eigene Funktion: der Echtbetrieb wartet 48 h Reifezeit ab und
// merkt sich im Zustand, wer schon dran war. Fuer "zeig mir die von heute"
// ist beides im Weg. Diese Funktion umgeht Reifezeit UND Zustand komplett
// und schickt sofort — Empfaenger wie ueberall in dieser Datei hart Valentin.
//
// ⚠️ WELCHER ZEITSTEMPEL "heute geclosed" bedeutet, ist NICHT eindeutig:
//   won_time          unbrauchbar, wird bei RP schon bei der Anlage gesetzt (Befund D20)
//   update_time       jede Feldaenderung zaehlt, also auch ein Nachtrag an einem alten Deal
//   stage_change_time der Stufenwechsel in der Fulfillment-Pipeline
//   add_time          Anlage des Deals
// Deshalb wird NICHT geraten: als Treffer gilt, wenn IRGENDEINER davon auf den
// gesuchten Tag faellt, und das Log zeigt fuer jeden Deal alle vier nebeneinander.
// Damit siehst du in 30 Sekunden, welcher Zeitstempel der richtige Marker ist —
// und der kann dann fest verdrahtet werden.

function testeHeutigeCloses() {
  const TAGE_ZURUECK = 0;   // 0 = heute, 1 = gestern, 2 = vorgestern ...
  const MAX_DMS = 10;       // Sicherheitsgrenze, damit ein weiter Rueckblick kein Slack-Bombardement wird

  const stichtag = new Date();
  stichtag.setDate(stichtag.getDate() - TAGE_ZURUECK);
  const tag = tagesSchluessel(stichtag);
  Logger.log('Suche qualifizierte Deals mit einem Zeitstempel am %s (Europe/Vienna).', tag);

  const qualifiziert = holeFulfillmentDeals().filter(function (d) {
    return istBefuellt((d.custom_fields || {})[FELD_SEVDESK_SUMMARY], 'text');
  });
  Logger.log('%s qualifizierte Deals insgesamt.', String(qualifiziert.length));

  const treffer = qualifiziert.filter(function (d) {
    return zeitstempelFelder(d).some(function (z) { return z.tag === tag; });
  });

  if (treffer.length === 0) {
    Logger.log('Kein einziger qualifizierter Deal hat am %s einen Zeitstempel.', tag);
    Logger.log('Entweder ist heute noch nichts durchgelaufen, oder der sevdesk-Sync hat');
    Logger.log('Verkaufte_Artikel_Summary noch nicht geschrieben — ohne das Feld zaehlt ein');
    Logger.log('Deal hier nicht als Close. Zum Gegenpruefen: TAGE_ZURUECK auf 1 setzen.');
    return;
  }

  Logger.log('\n%s Treffer. Zeitstempel im Vergleich (fett waere der, der auf %s passt):', String(treffer.length), tag);
  Logger.log('| Deal | Titel | add_time | update_time | stage_change_time | won_time |');
  Logger.log('|---|---|---|---|---|---|');
  treffer.forEach(function (d) {
    const z = zeitstempelFelder(d);
    const zelle = function (name) {
      const f = z.filter(function (x) { return x.name === name; })[0];
      if (!f || !f.roh) return '—';
      return (f.tag === tag ? '**' + f.roh + '**' : f.roh);
    };
    Logger.log('| %s | %s | %s | %s | %s | %s |', String(d.id), d.title,
               zelle('add_time'), zelle('update_time'), zelle('stage_change_time'), zelle('won_time'));
  });

  const verschickt = treffer.slice(0, MAX_DMS);
  if (treffer.length > MAX_DMS) {
    Logger.log('\n⚠️ %s Treffer, aber nur die ersten %s werden verschickt (MAX_DMS).', String(treffer.length), String(MAX_DMS));
  }
  Logger.log('\nSchicke %s echte DMs an Valentin (%s):', String(verschickt.length), VALENTIN_USER_ID);
  verschickt.forEach(function (d) {
    sendeTestDm(bewerteDeal(d), 'Close vom ' + tag);
  });
  Logger.log('\nFertig. Kein Zustand gesetzt — der Echtbetrieb meldet diese Deals spaeter trotzdem.');
}

// Alle vier Zeitstempel eines Deals, jeweils roh und als Tagesschluessel.
function zeitstempelFelder(deal) {
  return ['add_time', 'update_time', 'stage_change_time', 'won_time'].map(function (name) {
    const roh = deal[name] || null;
    return { name: name, roh: roh, tag: roh ? tagesSchluessel(alsDatum(roh)) : null };
  });
}

// Pipedrive liefert je nach Endpunkt "2026-09-22T08:15:00Z" oder
// "2026-09-22 08:15:00". Das zweite Format parst JS nicht zuverlaessig —
// deshalb wird es vorher auf ISO gebracht.
function alsDatum(wert) {
  if (!wert) return null;
  let s = String(wert);
  if (s.indexOf('T') === -1) s = s.replace(' ', 'T');
  if (!/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function tagesSchluessel(datum) {
  if (!datum) return null;
  return Utilities.formatDate(datum, 'Europe/Vienna', 'yyyy-MM-dd');
}
