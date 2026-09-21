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
  if (closerId === null || closerId === undefined) return 'niemanden (Feld leer)';
  try {
    const json = fetchPipedriveJson('/users/' + closerId, {}, PIPEDRIVE_BASE_V1);
    const name = json.data && json.data.name;
    const gemappt = CLOSER_SLACK_IDS[closerId] ? '' : ' — ⚠️ noch ohne Slack-Mapping, ginge also ebenfalls an dich';
    return (name || ('Pipedrive-User ' + closerId)) + gemappt;
  } catch (e) {
    return 'Pipedrive-User ' + closerId;
  }
}
