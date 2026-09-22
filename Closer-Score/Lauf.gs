// ============================================================
// HAUPTLAUF — taeglicher Trigger
// ============================================================
// Ablauf:
//   1. Alle Deals der Fulfillment-Pipeline holen (nur GET).
//   2. Torwaechter: pipeline_id === 2 (implizit durch den Abruf) UND
//      Verkaufte_Artikel_Summary befuellt.
//   3. Neue Qualifizierte in den Zustand eintragen — OHNE DM (Reifezeit laeuft).
//   4. Wer die Reifezeit hinter sich hat und noch keine DM bekam: scoren, DM, s setzen.
//   5. Deals, die nicht mehr in Pipeline 2 liegen, aus dem Zustand entfernen.

function laufCloserScore() {
  const start = Date.now();
  Logger.log('=== Closer-Score — Modus "%s" %s ===', BETRIEBSMODUS,
             DRY_RUN ? '(DRY_RUN — es wird NICHTS verschickt)' : '(scharf)');

  const deals = holeFulfillmentDeals();
  Logger.log('%s Deals in Pipeline %s.', String(deals.length), String(PIPELINE_ID));

  const qualifizierte = deals.filter(function (d) {
    return istBefuellt((d.custom_fields || {})[FELD_SEVDESK_SUMMARY], 'text');
  });
  Logger.log('%s davon mit befülltem Verkaufte_Artikel_Summary (= sevdesk-Kunde stimmt).', String(qualifizierte.length));

  const zustand = ladeZustand();
  // Erstlauf = leerer Zustand. Dann ist ALLES, was gerade in der Pipeline liegt,
  // Bestand: Deals, bei denen 48 h spaeter niemand mehr etwas nachtraegt. Die
  // werden stumm als erledigt eingetragen statt beobachtet — sonst faellt zwei
  // Tage nach dem Scharfschalten eine Welle von ~86 DMs auf einmal an.
  // Gleiches Ergebnis wie seedeBestandOhneDM(), nur ohne dass man daran denken muss.
  const erstlauf = Object.keys(zustand).length === 0;
  if (erstlauf) Logger.log('Erstlauf (Zustand leer): der gesamte Bestand wird stumm als erledigt eingetragen, es geht dafür KEINE DM raus.');
  const neuerZustand = {};
  const jetzt = Date.now();
  let neuBeobachtet = 0, gesendet = 0, wartet = 0, schonErledigt = 0, gebestandet = 0, vorgelegt = 0, wartetAufFreigabe = 0;

  qualifizierte.forEach(function (deal) {
    if (Date.now() - start > MAX_LAUFZEIT_MS) return; // weicher Ausstieg, Rest kommt morgen
    const id = String(deal.id);
    const alt = zustand[id];

    // Neu gesichtet: Reifezeit starten, noch keine DM.
    if (!alt) {
      if (erstlauf) {
        neuerZustand[id] = { f: jetzt, s: jetzt };
        gebestandet++;
        return;
      }
      neuerZustand[id] = { f: jetzt };
      neuBeobachtet++;
      Logger.log('  neu beobachtet: Deal %s "%s" — DM frühestens in %s h', String(deal.id), deal.title, String(REIFEZEIT_MS / 3600000));
      return;
    }

    // Vorlage liegt zur Freigabe: unveraendert mitnehmen. Ueber sie entscheidet
    // pruefeFreigaben(), nicht dieser Lauf.
    if (alt.v && !alt.s) {
      neuerZustand[id] = alt;
      wartetAufFreigabe++;
      return;
    }

    // Schon gemeldet: nur den Eintrag mitnehmen, damit er nicht rausfaellt und
    // der Deal spaeter ein zweites Mal gemeldet wird.
    if (alt.s) {
      neuerZustand[id] = alt;
      schonErledigt++;
      return;
    }

    // Reifezeit laeuft noch.
    if (jetzt - alt.f < REIFEZEIT_MS) {
      neuerZustand[id] = alt;
      wartet++;
      return;
    }

    // Jetzt wird gescored.
    const ergebnis = bewerteDeal(deal);

    // Modus 'freigabe': die Nachricht geht als Vorlage an Valentin. Erst seine
    // Reaktion stellt sie zu - das erledigt pruefeFreigaben() in Freigabe.gs.
    if (BETRIEBSMODUS === 'freigabe') {
      Logger.log('  %s Deal %s "%s": %s/%s Punkte → Vorlage zur Freigabe',
                 ergebnis.ampel, String(deal.id), ergebnis.titel, String(ergebnis.punkte), String(ergebnis.maximum));
      if (DRY_RUN) { neuerZustand[id] = alt; return; }
      const marke = legeZurFreigabeVor(ergebnis);
      // Ohne ts waere die Reaktion nicht auffindbar - dann lieber den Eintrag
      // offen lassen und es morgen noch einmal versuchen.
      neuerZustand[id] = marke ? { f: alt.f, v: marke.v, c: marke.c } : alt;
      if (marke) vorgelegt++;
      return;
    }

    const empfaenger = bestimmeEmpfaenger(ergebnis);
    const text = baueNachricht(ergebnis) + empfaenger.zusatz;

    Logger.log('  %s Deal %s "%s": %s/%s Punkte → DM an %s',
               ergebnis.ampel, String(deal.id), ergebnis.titel, String(ergebnis.punkte), String(ergebnis.maximum), empfaenger.slackId);
    Logger.log('  ---- Nachricht ----\n%s\n  -------------------', text);

    if (DRY_RUN) {
      neuerZustand[id] = alt; // Zustand NICHT fortschreiben: beim scharfen Lauf soll es wirklich rausgehen
      return;
    }
    sendeDm(empfaenger.slackId, text);
    neuerZustand[id] = { f: alt.f, s: jetzt };
    gesendet++;
  });

  const entfallen = Object.keys(zustand).length - Object.keys(neuerZustand).length + neuBeobachtet;
  if (DRY_RUN) {
    Logger.log('DRY_RUN: Zustand bleibt unverändert.');
  } else {
    speichereZustand(neuerZustand);
  }

  if (gebestandet > 0) {
    Logger.log('%s Bestands-Deals stumm als erledigt eingetragen. Ab jetzt bekommt nur eine DM, wer neu im Fulfillment ankommt.', String(gebestandet));
  }
  if (BETRIEBSMODUS === 'freigabe') {
    Logger.log('Freigabe-Modus: %s neue Vorlagen an dich, %s warten noch auf deine Reaktion.', String(vorgelegt), String(wartetAufFreigabe));
  }
  Logger.log('Fertig: %s neu beobachtet, %s in Reifezeit, %s DMs verschickt, %s bereits gemeldet, %s aus dem Zustand entfallen (nicht mehr in Pipeline %s). Laufzeit %s s.',
             String(neuBeobachtet), String(wartet), String(gesendet), String(schonErledigt), String(Math.max(0, entfallen)), String(PIPELINE_ID), String(Math.round((Date.now() - start) / 1000)));
}

// ============================================================
// ZUSTAND
// ============================================================
// Eine ScriptProperty, JSON: { "<dealId>": { f: <erstSichtungMs>, s: <gesendetMs> } }
// Deals, die nicht mehr in Pipeline 2 liegen, tauchen im Abruf nicht mehr auf und
// fallen damit automatisch raus. Der Zustand bleibt auf Pipeline-Groesse begrenzt
// (~60 Eintraege a ~35 Byte), weit unter dem 9-KB-Limit einer ScriptProperty.

function ladeZustand() {
  const roh = PropertiesService.getScriptProperties().getProperty(STATE_PROPERTY);
  if (!roh) return {};
  try {
    return JSON.parse(roh);
  } catch (e) {
    // Lieber bei null anfangen als den Lauf abbrechen — im schlimmsten Fall
    // startet die Reifezeit fuer alle neu, es geht nichts doppelt raus.
    Logger.log('⚠️ Zustand nicht lesbar (%s). Starte mit leerem Zustand.', e.message);
    return {};
  }
}

function speichereZustand(zustand) {
  const roh = JSON.stringify(zustand);
  if (roh.length > 8000) {
    Logger.log('⚠️ Zustand ist %s Byte groß — das 9-KB-Limit einer ScriptProperty rückt näher.', String(roh.length));
  }
  PropertiesService.getScriptProperties().setProperty(STATE_PROPERTY, roh);
}

// ============================================================
// EINRICHTUNG
// ============================================================

// EINMALIG vor dem Scharfschalten. Ohne das wuerden ~55 Bestands-Deals
// gleichzeitig in den Zustand wandern und 48 h spaeter gleichzeitig eine DM
// ausloesen — eine Spam-Welle zum Start, noch dazu fuer Deals, bei denen
// niemand mehr etwas nachtragen wuerde.
// Traegt alle aktuell qualifizierten Deals als "bereits gemeldet" ein und
// verschickt NICHTS. Danach bekommt nur noch, wer neu ankommt, eine DM.
function seedeBestandOhneDM() {
  const deals = holeFulfillmentDeals().filter(function (d) {
    return istBefuellt((d.custom_fields || {})[FELD_SEVDESK_SUMMARY], 'text');
  });
  const jetzt = Date.now();
  const zustand = {};
  deals.forEach(function (d) { zustand[String(d.id)] = { f: jetzt, s: jetzt }; });
  speichereZustand(zustand);
  Logger.log('%s Bestands-Deals als "bereits gemeldet" eingetragen. Es wurde nichts verschickt.', String(deals.length));
  Logger.log('Ab jetzt bekommt nur noch eine DM, wer neu im Fulfillment ankommt.');
}

// Zeigt fuer JEDEN qualifizierten Deal Score, Ampel und die DM im Wortlaut —
// ohne Reifezeit, ohne Zustand, ohne irgendetwas zu verschicken. Das ist der
// DRY-Vollauf als Messinstrument: erst messen, dann scharf schalten.
function testeLauf() {
  const deals = holeFulfillmentDeals().filter(function (d) {
    return istBefuellt((d.custom_fields || {})[FELD_SEVDESK_SUMMARY], 'text');
  });
  Logger.log('%s qualifizierte Deals. Verteilung und Nachrichten:', String(deals.length));
  const verteilung = { '🟢': 0, '🟡': 0, '🔴': 0 };
  const zeilen = [];
  deals.forEach(function (d) {
    const e = bewerteDeal(d);
    verteilung[e.ampel]++;
    const emp = bestimmeEmpfaenger(e);
    zeilen.push('| ' + String(e.dealId) + ' | ' + e.titel + ' | ' + e.ampel + ' | ' + String(e.punkte) + '/' + String(e.maximum) +
                ' | ' + String(e.closerId) + ' | ' + emp.slackId + ' |');
    Logger.log('\n===== Deal %s =====\n%s', String(e.dealId), baueNachricht(e) + emp.zusatz);
  });
  Logger.log('\n| Deal | Titel | Ampel | Punkte | Closer | DM an |');
  Logger.log('|---|---|---|---|---|---|');
  for (let i = 0; i < zeilen.length; i += 40) Logger.log(zeilen.slice(i, i + 40).join('\n'));
  Logger.log('\nVerteilung: 🟢 %s · 🟡 %s · 🔴 %s', String(verteilung['🟢']), String(verteilung['🟡']), String(verteilung['🔴']));
}

// Prueft, ob beide Tokens da sind — ohne sie zu loggen.
function pruefeTokens() {
  const props = PropertiesService.getScriptProperties();
  ['PIPEDRIVE_API_TOKEN', 'SLACK_BOT_TOKEN'].forEach(function (name) {
    const wert = props.getProperty(name);
    Logger.log('%s: %s', name, wert ? '✅ gesetzt (' + wert.length + ' Zeichen)' : '❌ FEHLT');
  });
  Logger.log('CLOSER_SLACK_IDS: %s Einträge%s', String(Object.keys(CLOSER_SLACK_IDS).length),
             Object.keys(CLOSER_SLACK_IDS).length === 0 ? ' — ⚠️ alle DMs gehen an Valentin' : '');
  Logger.log('DRY_RUN: %s | BETRIEBSMODUS: %s', String(DRY_RUN), BETRIEBSMODUS);
  if (DRY_RUN) {
    Logger.log('→ Es geht gar nichts raus.');
  } else if (BETRIEBSMODUS === 'test') {
    Logger.log('→ Alles geht an dich (' + VALENTIN_USER_ID + '), niemals an einen Closer.');
  } else if (BETRIEBSMODUS === 'freigabe') {
    Logger.log('→ Du bekommst jede Nachricht zuerst als Vorlage. Erst ✅ schickt sie an den Closer.');
  } else {
    Logger.log('→ ⚠️ ECHTBETRIEB: DMs gehen direkt an die Closer.');
  }
}

// Taeglicher Trigger. Uhrzeit bewusst am Vormittag: die DM soll im Arbeitstag
// ankommen, nicht nachts.
function installiereTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'laufCloserScore') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pruefeFreigaben') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('laufCloserScore').timeBased().atHour(9).everyDays(1).create();
  Logger.log('Trigger installiert: laufCloserScore, täglich gegen 09:00 (Europe/Vienna).');
  if (BETRIEBSMODUS === 'freigabe') {
    ScriptApp.newTrigger('pruefeFreigaben').timeBased().everyMinutes(FREIGABE_PRUEFUNG_MINUTEN).create();
    Logger.log('Trigger installiert: pruefeFreigaben, alle %s Minuten.', String(FREIGABE_PRUEFUNG_MINUTEN));
  } else {
    Logger.log('Kein Freigabe-Trigger — BETRIEBSMODUS ist "%s".', BETRIEBSMODUS);
  }
}
