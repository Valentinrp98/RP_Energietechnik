// ============================================================
// HAUPTLAUF — taeglicher Trigger (09:00)
// ============================================================
// Ablauf (seit 25.09.2026 "Closes vom Vortag", vorher 48-h-Reifezeit):
//   1. Alle Deals der Fulfillment-Pipeline holen (nur GET).
//   2. Torwaechter: pipeline_id === 2 (implizit durch den Abruf) UND
//      Verkaufte_Artikel_Summary befuellt.
//   3. Close-Tag = Datum der "Auftrag …"-Meldung in #sales (SalesKanal.gs).
//   4. Vorgelegt wird, wessen Close-Tag VOR heute liegt, nicht aelter als
//      CLOSE_NACHHOL_TAGE und nicht vor CLOSE_STICHTAG — und der noch keine
//      Vorlage/DM bekam. Normalfall: die Closes von gestern.
//   5. Deals, die nicht mehr in Pipeline 2 liegen, fallen aus dem Zustand.

function laufCloserScore() {
  const start = Date.now();
  Logger.log('=== Closer-Score — Modus "%s" %s ===', BETRIEBSMODUS,
             DRY_RUN ? '(DRY_RUN — es wird NICHTS verschickt)' : '(scharf)');

  // Ohne #sales gibt es keinen Close-Tag — dann wuerde JEDER Deal still
  // uebersprungen. Das muss laut werden, nicht leise.
  try {
    salesIndex();
  } catch (e) {
    Logger.log('❌ #sales nicht lesbar: %s — Lauf abgebrochen, Zustand unveraendert.', e.message);
    if (!DRY_RUN) {
      sendeDm(VALENTIN_USER_ID, '⚠️ *Closer-Score:* #sales ist nicht lesbar, heute keine Vorlagen.\n_' +
              e.message + '_\npruefeSalesKanal() in SalesKanal.gs sagt, was fehlt.');
    }
    return;
  }

  const deals = holeFulfillmentDeals();
  Logger.log('%s Deals in Pipeline %s.', String(deals.length), String(PIPELINE_ID));

  const qualifizierte = deals.filter(function (d) {
    return istBefuellt((d.custom_fields || {})[FELD_SEVDESK_SUMMARY], 'text');
  });
  Logger.log('%s davon mit befülltem Verkaufte_Artikel_Summary (= sevdesk-Kunde stimmt).', String(qualifizierte.length));

  const jetzt = Date.now();
  const heute = tagesSchluessel(new Date(jetzt));
  const fensterStart = tagesSchluessel(new Date(jetzt - CLOSE_NACHHOL_TAGE * 86400000));
  const fruehestens = fensterStart > CLOSE_STICHTAG ? fensterStart : CLOSE_STICHTAG;
  Logger.log('Vorgelegt werden Closes vom %s bis gestern (heute = %s).', fruehestens, heute);

  const zustand = ladeZustand();
  const neuerZustand = {};
  let vorgelegt = 0, gesendet = 0, schonErledigt = 0, wartetAufFreigabe = 0;
  let heuteGeclosed = 0, zuAlt = 0, ohneMeldung = 0;

  qualifizierte.forEach(function (deal) {
    if (Date.now() - start > MAX_LAUFZEIT_MS) return; // weicher Ausstieg, Rest kommt morgen
    const id = String(deal.id);
    const alt = zustand[id];

    // Vorlage liegt zur Freigabe: unveraendert mitnehmen. Ueber sie entscheidet
    // pruefeFreigaben(), nicht dieser Lauf.
    if (alt && alt.v && !alt.s) {
      neuerZustand[id] = alt;
      wartetAufFreigabe++;
      return;
    }
    // Schon gemeldet/verworfen: mitnehmen, sonst kaeme er ein zweites Mal.
    if (alt && alt.s) {
      neuerZustand[id] = alt;
      schonErledigt++;
      return;
    }
    // Eintraege nur mit f (alte Reifezeit-Logik) werden nicht mitgenommen —
    // sie tragen keine Information mehr.

    const tag = closeTag(deal);
    if (!tag) { ohneMeldung++; return; }
    if (tag >= heute) {
      heuteGeclosed++;
      Logger.log('  Deal %s "%s": Close heute — Vorlage morgen früh.', id, deal.title);
      return;
    }
    if (tag < fruehestens) { zuAlt++; return; }

    const ergebnis = bewerteDeal(deal);

    // Modus 'freigabe': die Nachricht geht als Vorlage an Valentin. Erst seine
    // Reaktion stellt sie zu - das erledigt pruefeFreigaben() in Freigabe.gs.
    if (BETRIEBSMODUS === 'freigabe') {
      Logger.log('  %s Deal %s "%s" (Close %s): %s/%s Punkte → Vorlage zur Freigabe',
                 ergebnis.ampel, id, ergebnis.titel, tag, String(ergebnis.punkte), String(ergebnis.maximum));
      if (DRY_RUN) return;
      const marke = legeZurFreigabeVor(ergebnis);
      // Ohne ts waere die Reaktion nicht auffindbar - dann nichts eintragen und
      // es morgen noch einmal versuchen (liegt ja im Nachholfenster).
      // f = Zeitpunkt der Vorlage: ab da laeuft FREIGABE_FRIST_MS.
      if (marke) {
        neuerZustand[id] = { f: jetzt, v: marke.v, c: marke.c, p: marke.p };
        vorgelegt++;
      }
      return;
    }

    const empfaenger = bestimmeEmpfaenger(ergebnis);
    const text = baueNachricht(ergebnis) + empfaenger.zusatz;

    Logger.log('  %s Deal %s "%s" (Close %s): %s/%s Punkte → DM an %s',
               ergebnis.ampel, id, ergebnis.titel, tag, String(ergebnis.punkte), String(ergebnis.maximum), empfaenger.slackId);
    Logger.log('  ---- Nachricht ----\n%s\n  -------------------', text);

    if (DRY_RUN) return; // Zustand NICHT fortschreiben: beim scharfen Lauf soll es wirklich rausgehen
    sendeDm(empfaenger.slackId, text);
    // Kopie an Valentin, wenn die Nachricht wirklich bei einem Closer gelandet
    // ist - nicht, wenn sie mangels Mapping ohnehin schon bei ihm liegt.
    if (KOPIE_AN_VALENTIN && empfaenger.slackId !== VALENTIN_USER_ID) {
      sendeDm(VALENTIN_USER_ID, '📨 *Ging raus an ' +
              ((ergebnis.empfaenger || {}).name || empfaenger.slackId) + '*' +
              '\n\n' + text);
    }
    neuerZustand[id] = { f: jetzt, s: jetzt };
    gesendet++;
  });

  if (DRY_RUN) {
    Logger.log('DRY_RUN: Zustand bleibt unverändert.');
  } else {
    speichereZustand(neuerZustand);
  }

  if (BETRIEBSMODUS === 'freigabe') {
    Logger.log('Freigabe-Modus: %s neue Vorlagen an dich, %s warten noch auf deine Reaktion.', String(vorgelegt), String(wartetAufFreigabe));
  }
  Logger.log('Fertig: %s DMs verschickt, %s bereits gemeldet, %s Close heute (morgen dran), %s Close vor %s (ignoriert), %s ohne #sales-Meldung. Laufzeit %s s.',
             String(gesendet), String(schonErledigt), String(heuteGeclosed), String(zuAlt), fruehestens,
             String(ohneMeldung), String(Math.round((Date.now() - start) / 1000)));
}

// Close-Tag (yyyy-MM-dd, Europe/Vienna) = Datum der #sales-Meldung zum Deal.
// null = keine Meldung gefunden → der Deal wird nie vorgelegt.
// Passen mehrere Meldungen von VERSCHIEDENEN Leuten, liefert closerAusSales()
// einen Fehler mit Kandidaten. Das Datum ist dann trotzdem bestimmbar (die
// neueste Meldung) — vorgelegt wird mit "kein Empfänger"-Hinweis, damit du
// in 30 Sekunden entscheidest, statt dass der Deal still verschwindet.
function closeTag(deal) {
  const r = closerAusSales(deal);
  if (r.zeit) return tagesSchluessel(r.zeit);
  if (r.kandidaten && r.kandidaten.length) {
    const neueste = r.kandidaten.reduce(function (a, b) { return a.zeit > b.zeit ? a : b; });
    return tagesSchluessel(neueste.zeit);
  }
  return null;
}

// Nur lesen: welche Deals legt der naechste 09:00-Lauf vor? Kein Versand,
// kein Zustand. Zaehlt ausserdem die qualifizierten Deals ohne #sales-Meldung.
function vorschauVortag() {
  const zustand = ladeZustand();
  const morgenMs = Date.now() + 86400000;
  const morgen = tagesSchluessel(new Date(morgenMs));
  const fensterStart = tagesSchluessel(new Date(morgenMs - CLOSE_NACHHOL_TAGE * 86400000));
  const fruehestens = fensterStart > CLOSE_STICHTAG ? fensterStart : CLOSE_STICHTAG;
  Logger.log('Lauf morgen (%s) legt Closes vom %s bis heute vor:', morgen, fruehestens);

  let n = 0, ohne = 0;
  holeFulfillmentDeals().forEach(function (d) {
    if (!istBefuellt((d.custom_fields || {})[FELD_SEVDESK_SUMMARY], 'text')) return;
    const alt = zustand[String(d.id)];
    if (alt && (alt.v || alt.s)) return;
    const tag = closeTag(d);
    if (!tag) { ohne++; return; }
    if (tag < fruehestens || tag >= morgen) return;
    const e = bewerteDeal(d);
    n++;
    Logger.log('  %s Deal %s "%s" · Close %s · %s/%s · an %s', e.ampel, String(d.id), d.title, tag,
               String(e.punkte), String(e.maximum), (e.empfaenger || {}).name || '⚠️ kein Empfänger');
  });
  Logger.log('→ %s Vorlagen. %s qualifizierte Deals ohne #sales-Meldung (werden nie vorgelegt).', String(n), String(ohne));
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
                ' | ' + ((e.empfaenger || {}).name || '—') + ' | ' + emp.slackId + ' |');
    Logger.log('\n===== Deal %s =====\n%s', String(e.dealId), baueNachricht(e) + emp.zusatz);
  });
  Logger.log('\n| Deal | Titel | Ampel | Punkte | Closer laut #sales | DM an |');
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
  try {
    Logger.log('#sales lesbar: ✅ %s Auftrags-Meldungen der letzten %s Tage',
               String(salesIndex().length), String(SALES_TAGE_ZURUECK));
  } catch (e) {
    Logger.log('#sales lesbar: ❌ %s', e.message);
    Logger.log('   → Ohne den Kanal geht JEDE Meldung an Valentin. pruefeSalesKanal() sagt, was fehlt.');
  }
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
