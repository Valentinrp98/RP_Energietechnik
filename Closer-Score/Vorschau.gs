// ============================================================
// VORSCHAU — einen einzelnen Deal sofort zur Freigabe vorlegen
// ============================================================
// Der Tageslauf wartet 48 h und pruefe den Torwaechter. Beides ist richtig,
// macht aber das Ausprobieren muehsam: man will einen konkreten Deal jetzt
// sehen und den Freigabe-Weg einmal ganz durchgehen.
//
// legeDealVor() tut genau das fuer VORSCHAU_DEAL_ID:
//   scoren → als Vorlage an Valentin → in den Zustand eintragen.
// Danach greift pruefeFreigaben() ganz normal. Ein Hakerl schickt die
// Nachricht also WIRKLICH an den Closer — das ist kein Trockenlauf.
// Wer nur den Wortlaut sehen will, nimmt testeDmAnMichEinDeal() (TestDm.gs):
// das schickt hart an Valentin und ruehrt den Zustand nicht an.
//
// Der Torwaechter wird hier bewusst nur GEMELDET und nicht angewandt. Sonst
// koennte man ausgerechnet die Deals nicht anschauen, bei denen etwas klemmt.

const VORSCHAU_DEAL_ID = 6777;   // Gerhard Glauninger

function legeDealVor() {
  if (BETRIEBSMODUS !== 'freigabe') {
    Logger.log('⚠️ BETRIEBSMODUS ist "%s". Diese Funktion ist fuer den Freigabe-Modus gedacht.', BETRIEBSMODUS);
    return;
  }

  const deal = holeEinenDeal(VORSCHAU_DEAL_ID);
  if (!deal) { Logger.log('❌ Deal %s nicht gefunden.', String(VORSCHAU_DEAL_ID)); return; }

  Logger.log('=== Deal %s "%s" ===', String(deal.id), deal.title);

  if (deal.pipeline_id !== PIPELINE_ID) {
    Logger.log('⚠️ Liegt in Pipeline %s, nicht in %s. Der Tageslauf wuerde ihn nie sehen.',
               String(deal.pipeline_id), String(PIPELINE_ID));
  }
  if (!istBefuellt((deal.custom_fields || {})[FELD_SEVDESK_SUMMARY], 'text')) {
    Logger.log('⚠️ Verkaufte_Artikel_Summary ist LEER — der Torwaechter waere nicht erfuellt.');
    Logger.log('   Der Deal faellt damit still aus dem Score, bis der sevdesk-Sync einen');
    Logger.log('   Auftrag zuordnen kann. Fuer diese Vorschau wird das uebergangen.');
  }

  const ergebnis = bewerteDeal(deal);
  const ziel = CLOSER_SLACK_IDS[ergebnis.closerId];
  const name = pipedriveUserName(ergebnis.closerId) || ('Pipedrive-User ' + ergebnis.closerId);
  Logger.log('%s %s von %s Punkten · Closer laut %s: %s',
             ergebnis.ampel, String(ergebnis.punkte), String(ergebnis.maximum), CLOSER_FELD, name);
  Logger.log(ziel ? '→ Bei ✅ geht die Nachricht an ' + name + ' (' + ziel + ').'
                  : '→ ⚠️ Kein Slack-Mapping fuer ' + name + '. Bei ✅ bekommst du nur eine Warnung.');

  const zustand = ladeZustand();
  const schluessel = String(deal.id);
  if (zustand[schluessel] && zustand[schluessel].s) {
    Logger.log('\n⚠️ Fuer diesen Deal ist schon einmal etwas rausgegangen (oder er wurde verworfen).');
    Logger.log('   Die Vorlage kommt trotzdem — der Eintrag wird dabei ueberschrieben.');
  }

  const marke = legeZurFreigabeVor(ergebnis);
  if (!marke) { Logger.log('❌ Vorlage konnte nicht zugestellt werden. Zustand unveraendert.'); return; }

  // erstSichtung auf jetzt: die 48-h-Frist ist hier schon bewusst uebersprungen.
  zustand[schluessel] = { f: Date.now(), v: marke.v, c: marke.c, p: marke.p };
  speichereZustand(zustand);

  Logger.log('\n✅ Vorlage liegt in deiner DM. pruefeFreigaben() laeuft alle %s Minuten.',
             String(FREIGABE_PRUEFUNG_MINUTEN));
  Logger.log('   Wer nicht warten will, ruft pruefeFreigaben() von Hand auf.');
}
