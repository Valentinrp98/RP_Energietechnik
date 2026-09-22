// ============================================================
// FREIGABE — Valentin sieht die Nachricht zuerst
// ============================================================
// Ablauf im Modus 'freigabe':
//   1. Der Tageslauf scored einen faelligen Deal und schickt die fertige
//      Nachricht als VORLAGE an Valentin, nicht an den Closer.
//   2. Slack liefert dabei channel + ts der Vorlage zurueck. Beides wandert in
//      den Zustand — ohne die kann man die Reaktion spaeter nicht wiederfinden.
//   3. pruefeFreigaben() schaut alle paar Minuten nach, ob eine Reaktion
//      draufliegt: Hakerl -> raus an den Closer, X -> verworfen, nichts -> warten.
//
// WARUM ABFRAGE UND KEIN EVENT: Slack koennte reaction_added als Event
// schicken, das braucht aber einen oeffentlich erreichbaren Endpunkt. Apps
// Script antwortet auf jeden Aufruf zuerst mit HTTP 302, Slack wertet das als
// Fehlschlag — dasselbe Problem, das bei den Pipedrive-Webhooks einen
// Cloudflare-Worker als Relay noetig gemacht hat. Fuer eine Freigabe, die auch
// eine Viertelstunde spaeter noch richtig ist, lohnt der Aufwand nicht.
//
// SCOPE: reactions.get braucht 'reactions:read' am Bot-Token. Fehlt der, nennt
// der Fehlertext von fetchSlackJson benoetigten und vorhandenen Scope.

// Schickt die Vorlage an Valentin und gibt zurueck, was man zum Wiederfinden
// der Reaktion braucht. null heisst: Vorlage ging nicht raus.
function legeZurFreigabeVor(ergebnis) {
  const kopf = '📋 *Freigabe* — so ginge die Rueckmeldung an ' + closerName(ergebnis.closerId) + ':\n\n';
  const fuss = '\n\n———\n' +
               '✅ draufsetzen = raus an den Closer  ·  ❌ = verwerfen\n' +
               '_Ohne Reaktion passiert nichts. Nach ' + Math.round(FREIGABE_FRIST_MS / 86400000) +
               ' Tagen verfaellt die Vorlage von selbst._';

  const antwort = sendeDm(VALENTIN_USER_ID, kopf + baueNachricht(ergebnis) + fuss);
  if (!antwort || !antwort.ts) {
    Logger.log('  ⚠️ Deal %s: Vorlage verschickt, aber Slack lieferte kein ts — Freigabe waere nicht nachverfolgbar.', String(ergebnis.dealId));
    return null;
  }
  // channel aus der Antwort, NICHT die User-ID: reactions.get will die
  // DM-Channel-ID (D...), und die kennt man erst nach dem Senden.
  return { v: antwort.ts, c: antwort.channel };
}

// Laeuft als eigener Trigger. Holt fuer jede offene Vorlage die Reaktionen und
// entscheidet. Schreibt NUR den Zustand fort, nichts nach Pipedrive.
function pruefeFreigaben() {
  if (BETRIEBSMODUS !== 'freigabe') {
    Logger.log('BETRIEBSMODUS ist "%s" — es gibt keine Freigaben zu pruefen.', BETRIEBSMODUS);
    return;
  }
  const zustand = ladeZustand();
  const jetzt = Date.now();
  let freigegeben = 0, abgelehnt = 0, offen = 0, verfallen = 0;
  let geaendert = false;

  Object.keys(zustand).forEach(function (id) {
    const eintrag = zustand[id];
    if (!eintrag.v || eintrag.s) return;   // keine offene Vorlage

    const urteil = leseUrteil(eintrag.c, eintrag.v);

    if (urteil === 'ja') {
      const ergebnis = scoreNeu(id);
      if (!ergebnis) {
        // Deal nicht mehr in der Pipeline: nichts schicken, aber schliessen,
        // damit die Vorlage nicht ewig wiederkommt.
        Logger.log('  Deal %s freigegeben, liegt aber nicht mehr in Pipeline %s — nichts verschickt.', id, String(PIPELINE_ID));
        zustand[id] = { f: eintrag.f, s: jetzt };
        geaendert = true;
        return;
      }
      const ziel = CLOSER_SLACK_IDS[ergebnis.closerId];
      if (!ziel) {
        Logger.log('  ⚠️ Deal %s freigegeben, aber Pipedrive-User %s hat keinen CLOSER_SLACK_IDS-Eintrag. Nicht verschickt.', id, String(ergebnis.closerId));
        sendeDm(VALENTIN_USER_ID, '⚠️ Du hast Deal ' + id + ' freigegeben, aber fuer Pipedrive-User `' +
                ergebnis.closerId + '` steht keine Slack-ID in `Closer-Score/Config.gs` → `CLOSER_SLACK_IDS`. ' +
                'Die Nachricht ist deshalb nicht rausgegangen.');
        zustand[id] = { f: eintrag.f, s: jetzt };
        geaendert = true;
        return;
      }
      sendeDm(ziel, baueNachricht(ergebnis));
      zustand[id] = { f: eintrag.f, s: jetzt };
      geaendert = true;
      freigegeben++;
      Logger.log('  ✅ Deal %s "%s" freigegeben → raus an %s.', id, ergebnis.titel, ziel);
      return;
    }

    if (urteil === 'nein') {
      zustand[id] = { f: eintrag.f, s: jetzt };
      geaendert = true;
      abgelehnt++;
      Logger.log('  ❌ Deal %s verworfen — geht an niemanden.', id);
      return;
    }

    if (jetzt - eintrag.f > FREIGABE_FRIST_MS) {
      zustand[id] = { f: eintrag.f, s: jetzt };
      geaendert = true;
      verfallen++;
      Logger.log('  ⏳ Deal %s: keine Reaktion innerhalb der Frist — Vorlage verfallen.', id);
      return;
    }
    offen++;
  });

  if (geaendert) speichereZustand(zustand);
  Logger.log('Freigaben: %s raus, %s verworfen, %s verfallen, %s warten noch.',
             String(freigegeben), String(abgelehnt), String(verfallen), String(offen));
}

// 'ja' | 'nein' | null. Geprueft wird ausschliesslich der Emoji-Name.
// ⚠️ NICHT pruefen, WER reagiert hat: laut Slack-Doku enthaelt das users-Array
// immer den authentifizierten User (hier: den Bot) und nicht zwingend alle
// anderen. In einer 1:1-DM mit dem Bot kann ohnehin nur Valentin reagieren.
// Steht beides drauf, gewinnt das Nein — im Zweifel nicht verschicken.
function leseUrteil(channel, ts) {
  let reaktionen;
  try {
    const json = fetchSlackJson('reactions.get', { channel: channel, timestamp: ts, full: true });
    reaktionen = (json.message && json.message.reactions) || [];
  } catch (e) {
    // Eine kaputte Abfrage darf den Lauf nicht abbrechen — der Rest der
    // Vorlagen soll trotzdem drankommen.
    Logger.log('  ⚠️ Reaktionen zu %s/%s nicht lesbar: %s', channel, ts, e.message);
    return null;
  }
  const namen = reaktionen.map(function (r) { return r.name; });
  if (namen.some(function (n) { return FREIGABE_NEIN.indexOf(n) !== -1; })) return 'nein';
  if (namen.some(function (n) { return FREIGABE_JA.indexOf(n) !== -1; })) return 'ja';
  return null;
}

// Beim Freigeben wird neu gescored statt die alte Nachricht aufzuheben: was der
// Closer zwischenzeitlich nachgetragen hat, soll ihm zugutekommen. Weicht die
// Punktzahl von der Vorlage ab, faellt das im Log auf.
function scoreNeu(dealId) {
  const deal = holeEinenDeal(dealId);
  if (!deal) return null;
  if (deal.pipeline_id !== PIPELINE_ID) return null;
  return bewerteDeal(deal);
}
