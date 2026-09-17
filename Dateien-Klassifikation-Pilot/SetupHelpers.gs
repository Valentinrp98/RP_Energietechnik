// ===== SETUP / EINSTIEGSPUNKTE =====
// Der ▷-Button im Apps-Script-Editor ruft Funktionen immer ohne Argumente auf -- deshalb hier
// nur parameterlose Einstiegspunkte, echte Parameter (z.B. eine einzelne Deal-ID zum Debuggen)
// gehören in Konstanten (siehe PILOT_DEAL_IDS in Config.gs).

/**
 * Prüft die hartcodierten IDs/Keys gegen die echte Pipedrive-API und ob die nötigen Script
 * Properties gesetzt sind -- OHNE deren Werte zu loggen (siehe Sicherheitsvorgabe in Config.gs).
 * Läuft ohne Seiteneffekte, kein DRY_RUN nötig.
 */
function checkConfiguration() {
  const probleme = [];

  if (!PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN')) {
    probleme.push('PIPEDRIVE_API_TOKEN fehlt in den Script Properties.');
  }
  if (!PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY')) {
    probleme.push('ANTHROPIC_API_KEY fehlt in den Script Properties.');
  }

  if (probleme.length === 0) {
    try {
      // FIX 27.08.2026, zwei Fehler in zwei Zeilen, beide erzeugten denselben Scheinfehler
      // ("Feld existiert nicht (mehr)"), obwohl das Feld intakt ist:
      //   1. Der Identifier heisst in v2 "field_code", nicht "key" (key ist die v1-Schreibweise).
      //      "name" ist bei Pipedrive-Feldern uebrigens immer undefined, das Label steht in
      //      "field_name" -- siehe die Schwesterprojekte, die das seit 17.08. richtig machen.
      //   2. Ohne limit paginiert v2 bei 100 Feldern; RP hat deutlich mehr, das gesuchte Feld lag
      //      also womoeglich gar nicht in der Antwort.
      // Da das der EINZIGE Pre-Flight-Check ist, gewoehnt man sich sonst an, ihn zu ignorieren.
      const dealFields = fetchPipedrive('dealFields?limit=500');
      const gefunden = dealFields.some(f => f.field_code === KUNDENORDNER_LINK_FIELD_KEY);
      if (!gefunden) {
        probleme.push(`KUNDENORDNER_LINK_FIELD_KEY "${KUNDENORDNER_LINK_FIELD_KEY}" existiert nicht (mehr) in dealFields.`);
      }
    } catch (e) {
      probleme.push(`Pipedrive-API-Check fehlgeschlagen: ${e}`);
    }
  }

  // AUSGEBAUT 17.09.2026. Vorher prueften diese Zeilen genau eine Sache: ob ein Pipedrive-Feldcode
  // existiert. Alles andere -- ob der Anthropic-Key gueltig ist, ob die Modell-ID stimmt, ob die
  // Kundenordner ueberhaupt die Zielunterordner haben -- fiel erst im Lauf auf, dateiweise, nach
  // dem Bezahlen. Ein Preflight, der den haeufigsten Ausfall nicht sieht, erzieht dazu, ihn zu
  // ueberspringen. Die folgenden Bloecke pruefen deshalb genau die Pfade, die im Lauf Geld kosten.

  // (a) Das Checklisten-Feld, falls konfiguriert. Ein falscher field_code oder eine Options-ID aus
  // einem geloeschten Feld faellt sonst erst LIVE auf -- also genau dann, wenn geschrieben wird.
  if (probleme.length === 0 && DOKUMENTE_ERKANNT_FIELD_KEY) {
    try {
      const dealFields = fetchPipedrive('dealFields?limit=500');
      const feld = dealFields.find(f => f.field_code === DOKUMENTE_ERKANNT_FIELD_KEY);
      if (!feld) {
        probleme.push(`DOKUMENTE_ERKANNT_FIELD_KEY "${DOKUMENTE_ERKANNT_FIELD_KEY}" existiert nicht in dealFields.`);
      } else {
        const gueltigeIds = (feld.options || []).map(o => String(o.id));
        Object.keys(DOKUMENTE_ERKANNT_OPTION_IDS).forEach(kategorie => {
          if (gueltigeIds.indexOf(String(DOKUMENTE_ERKANNT_OPTION_IDS[kategorie])) === -1) {
            probleme.push(`Options-ID ${DOKUMENTE_ERKANNT_OPTION_IDS[kategorie]} (${kategorie}) gehoert nicht zu "${feld.field_name}" -- findeDokumenteFeldKonfiguration() nochmal laufen lassen.`);
          }
        });
        Object.keys(ZIEL_UNTERORDNER).forEach(kategorie => {
          if (!DOKUMENTE_ERKANNT_OPTION_IDS[kategorie]) {
            probleme.push(`Kategorie "${kategorie}" hat keine Options-ID -- sie wuerde LIVE stillschweigend nicht in der Checkliste landen.`);
          }
        });
      }
    } catch (e) {
      probleme.push(`Check "Dokumente erkannt" fehlgeschlagen: ${e}`);
    }
  }

  // (b) Die Ordnerstruktur der Pilot-Deals, lesend. Fehlt "3_Stromrechnung", laeuft der Deal seit
  // dem Preflight in processDeal() zwar nicht mehr ins Geld -- aber hier sieht man es, BEVOR man
  // den Lauf startet, und bekommt gesagt, welcher Deal gemeint ist.
  if (probleme.length === 0) {
    PILOT_DEAL_IDS.forEach(dealId => {
      try {
        const deal = fetchPipedrive(`deals/${dealId}`);
        const link = (deal.custom_fields || {})[KUNDENORDNER_LINK_FIELD_KEY];
        if (!link) {
          probleme.push(`Deal ${dealId}: Kundenordner-Link ist nicht gesetzt.`);
          return;
        }
        const ordner = oeffneOrdnerAusLink(link);
        const cache = baueZielOrdnerCache(ordner);
        const fehlend = Object.keys(cache).filter(n => !cache[n]);
        if (fehlend.length > 0) {
          probleme.push(`Deal ${dealId} ("${ordner.getName()}"): Zielunterordner fehlen -- ${fehlend.join(', ')}.`);
        }
      } catch (e) {
        probleme.push(`Deal ${dealId}: Kundenordner nicht lesbar -- ${e}`);
      }
    });
  }

  // (c) Der Anthropic-Pfad, echt statt vermutet. Ein Text-Call mit erzwungenem Tool-Use kostet
  // Bruchteile eines Cents und beweist vier Dinge auf einmal: Key gueltig, Modell-ID existiert,
  // das Modell macht erzwungene Tool-Calls mit, Antwortformat parsebar. Der Key selbst wird dabei
  // nirgends ausgegeben -- nur, dass er funktioniert.
  if (probleme.length === 0) {
    try {
      const test = anthropicSelbsttest();
      const kosten = berechneKosten(test.usage);
      Logger.log(`Anthropic-Selbsttest OK -- Modell "${test.modell}", ${test.usage.input_tokens}/${test.usage.output_tokens} Token, ${kosten.eur.toFixed(5)} EUR.`);
    } catch (e) {
      probleme.push(`Anthropic-Selbsttest fehlgeschlagen (Key/Modell "${CLAUDE_MODEL}" pruefen): ${e}`);
    }
  }

  if (probleme.length === 0) {
    Logger.log(`checkConfiguration: alles passt. Modus: ${DRY_RUN ? 'DRY (schreibt nichts)' : 'LIVE (schreibt nach Drive' + (DOKUMENTE_ERKANNT_FIELD_KEY ? ' UND Pipedrive' : '') + ')'}.`);
  } else {
    Logger.log(`checkConfiguration: ${probleme.length} Problem(e):\n- ${probleme.join('\n- ')}`);
  }
  return probleme;
}

// Geschaetzte Output-Token pro Klassifikation: das Tool-Schema hat vier Felder, davon zwei kurze
// Freitexte. Gemessene Laeufe liegen bei 100-200; 150 ist die Mitte. Der Output faellt gegenueber
// dem Input kaum ins Gewicht (ein Bild sind ~1.600 Input-Token), die Schaetzung muss hier also
// nicht genauer sein als die Groessenordnung.
const GESCHAETZTE_OUTPUT_TOKENS = 150;

/**
 * Was wuerde ein Echtlauf kosten? Beantwortet die Frage, OHNE einen einzigen bezahlten Call zu
 * machen: laeuft dieselbe Auswahl-Logik wie processDeal() (Format, Groesse, schon einsortiert)
 * und schickt die uebrigen Dateien an /v1/messages/count_tokens -- laut Doku kostenlos und mit
 * eigenem Rate-Limit-Topf.
 *
 * Das ist der Schritt, der bisher gefehlt hat: "erst messen, dann scharf schalten" ging vorher nur
 * ueber einen DRY-Lauf, und der kostet dasselbe wie der Echtlauf, weil er klassifiziert. Hier
 * kostet das Messen nichts.
 *
 * Schreibt nichts -- nicht nach Drive, nicht nach Pipedrive.
 */
function kostenVoranschlag() {
  starteLauf('kostenVoranschlag');
  try {
    let summeInput = 0, dateienZuZahlen = 0, uebersprungen = 0, unbekannt = 0;

    PILOT_DEAL_IDS.forEach(dealId => {
      const deal = fetchPipedrive(`deals/${dealId}`);
      const link = (deal.custom_fields || {})[KUNDENORDNER_LINK_FIELD_KEY];
      if (!link) {
        logRow(dealId, null, null, 'SOFT_ERROR', 'Kundenordner-Link fehlt -- nicht schaetzbar');
        return;
      }
      const zielOrdnerCache = baueZielOrdnerCache(oeffneOrdnerAusLink(link));

      holeDealFiles(dealId).forEach(datei => {
        if (laufzeitFastAufgebraucht()) return;

        const mimeType = ermittleMimeTyp(datei.name);
        if (!mimeType) {
          uebersprungen++;
          logRow(dealId, datei.name, null, 'übersprungen', begruendeNichtUnterstuetzt(datei.name));
          return;
        }
        const groesse = Number(datei.file_size);
        if (Number.isFinite(groesse) && groesse > MAX_DATEI_BYTES) {
          uebersprungen++;
          logRow(dealId, datei.name, null, 'übersprungen', `${(groesse / 1048576).toFixed(1)} MB -- ueber MAX_DATEI_BYTES`);
          return;
        }
        const schonIn = findeBereitsEinsortiert(zielOrdnerCache, `${datei.name} (Pipedrive-Datei ${datei.id})`);
        if (schonIn) {
          uebersprungen++;
          logRow(dealId, datei.name, null, 'übersprungen', `liegt bereits in "${schonIn}" -- wuerde im Echtlauf nichts kosten`);
          return;
        }

        const blob = downloadPipedriveFile(datei.id, datei.name);
        const tokens = schaetzeInputTokens(Utilities.base64Encode(blob.getBytes()), mimeType, datei.name);
        if (tokens === null) {
          unbekannt++;
          logRow(dealId, datei.name, null, 'SOFT_ERROR', 'Token-Zaehlung fehlgeschlagen -- nicht in der Summe enthalten');
          return;
        }
        summeInput += tokens;
        dateienZuZahlen++;
        const kosten = berechneKostenAusTokens(tokens, GESCHAETZTE_OUTPUT_TOKENS);
        const warnung = tokens > MAX_INPUT_TOKENS_PRO_DATEI
          ? ` -- ueber MAX_INPUT_TOKENS_PRO_DATEI (${MAX_INPUT_TOKENS_PRO_DATEI}), wuerde im Echtlauf NICHT klassifiziert`
          : '';
        logRow(dealId, datei.name, null, 'SCHAETZUNG', `${tokens} Input-Token, ~${kosten.eur.toFixed(4)} EUR${warnung}`);
      });
    });

    const gesamt = berechneKostenAusTokens(summeInput, dateienZuZahlen * GESCHAETZTE_OUTPUT_TOKENS);
    const text = `${dateienZuZahlen} Dateien wuerden klassifiziert, ${uebersprungen} nicht (Format/Groesse/schon abgelegt)` +
      (unbekannt ? `, ${unbekannt} nicht schaetzbar` : '') +
      ` | ~${summeInput} Input-Token | ~${gesamt.eur.toFixed(4)} EUR fuer einen Echtlauf`;
    logRow(null, null, null, 'VORANSCHLAG', text);
    Logger.log(`kostenVoranschlag: ${text}`);
    Logger.log('Kosten dieser Schaetzung selbst: 0 EUR (count_tokens ist laut Anthropic-Doku kostenlos).');
    return { dateien: dateienZuZahlen, inputTokens: summeInput, eur: gesamt.eur };
  } finally {
    flushLog();
  }
}

/**
 * Einmalig NACH Anlage des Pipedrive-Felds "Dokumente erkannt" (Mehrfachauswahl, Optionen
 * Stromrechnung/Dachfoto/Zählerpunkt) ausführen: sucht das Feld per Label und druckt field_code +
 * Options-IDs ins Log, zum manuellen Eintragen in Config.gs (DOKUMENTE_ERKANNT_FIELD_KEY /
 * DOKUMENTE_ERKANNT_OPTION_IDS). Options-Label-Abgleich case-insensitiv UND per Substring, siehe
 * CLAUDE.md "Enum-Options-Check muss case-insensitiv vergleichen" -- Schreibweise in Pipedrive muss
 * nicht exakt "stromrechnung" sein, Labels dürfen ein Präfix-Symbol haben (z.B. "☐ Stromrechnung").
 */
function findeDokumenteFeldKonfiguration() {
  const dealFields = fetchPipedrive('dealFields?limit=500');
  const feld = dealFields.find(f => (f.field_name || '').toLowerCase() === 'dokumente erkannt');
  if (!feld) {
    Logger.log('Feld "Dokumente erkannt" nicht gefunden -- erst in Pipedrive anlegen (Mehrfachauswahl, Optionen Stromrechnung/Dachfoto/Zählerpunkt), dann nochmal ausführen.');
    return;
  }
  const gesuchteLabels = { stromrechnung: 'stromrechnung', dachfoto: 'dachfoto', zaehlerpunkt: 'zählerpunkt' };
  const optionIds = {};
  const fehlend = [];
  Object.keys(gesuchteLabels).forEach(kategorie => {
    const option = (feld.options || []).find(o => (o.label || '').toLowerCase().includes(gesuchteLabels[kategorie]));
    if (option) optionIds[kategorie] = option.id;
    else fehlend.push(gesuchteLabels[kategorie]);
  });
  Logger.log(`field_code: ${feld.field_code}`);
  Logger.log(`Zum Eintragen in Config.gs:\nconst DOKUMENTE_ERKANNT_FIELD_KEY = '${feld.field_code}';\nconst DOKUMENTE_ERKANNT_OPTION_IDS = ${JSON.stringify(optionIds)};`);
  if (fehlend.length > 0) {
    Logger.log(`Achtung, Optionen nicht gefunden: ${fehlend.join(', ')} -- Label in Pipedrive prüfen.`);
  }
}

/** Manueller Testlauf für einen einzelnen Deal (siehe PILOT_DEAL_IDS in Config.gs). */
function testEinzelDeal() {
  starteLauf('testEinzelDeal');
  const dealId = PILOT_DEAL_IDS[0];
  // FIX 27.08.2026: flushLog() lief linear am Ende. Jede Exception davor (kaputter
  // Kundenordner-Link, Pipedrive-4xx, 6-Min-Limit) hat den kompletten Log-Puffer verworfen --
  // inklusive der Token-/Kosten-Zeilen fuer Claude-Calls, die bereits abgerechnet waren. Genau das
  // Muster, das die Schwesterprojekte ueberall als try/finally haben; beim Kopieren fehlte es.
  try {
    const summary = processDeal(dealId);
    logLaufEnde('OK', summary);
    Logger.log(`testEinzelDeal (Deal ${dealId}): ${JSON.stringify(summary)}`);
    return summary;
  } catch (e) {
    logLaufEnde('HARD_ERROR', { fehler: e.message });
    throw e;
  } finally {
    flushLog();
  }
}

/** Iteriert alle Pilot-Deals (siehe PILOT_DEAL_IDS in Config.gs). Respektiert DRY_RUN. */
function pilotLauf() {
  starteLauf('pilotLauf');
  const summary = { verarbeitet: 0, unsicher: 0, fehler: 0, uebersprungen: 0, abgebrochen: 0 };
  // try/finally wie in testEinzelDeal(): ohne das verliert ein Fehler bei Deal 3 die bereits
  // bezahlten Kosten-Zeilen von Deal 1 und 2. Zusaetzlich wird jeder Deal einzeln gefangen, damit
  // ein kaputter Deal nicht die restlichen mitnimmt -- der Lauf soll durchlaufen und am Ende sagen,
  // was schiefging.
  try {
    PILOT_DEAL_IDS.forEach(dealId => {
      // Bei erschoepfter Laufzeit gar nicht erst den naechsten Deal anfangen: ein mittendrin
      // hart abgebrochener Deal hinterlaesst halb einsortierte Dateien und einen verlorenen
      // Log-Puffer. Lieber sauber aussteigen und im Log sagen, was offen blieb.
      if (laufzeitFastAufgebraucht()) {
        summary.abgebrochen++;
        logRow(dealId, null, null, 'ABBRUCH', 'Laufzeit-Limit erreicht -- Deal nicht begonnen');
        return;
      }
      try {
        const ergebnisProDeal = processDeal(dealId);
        summary.verarbeitet += ergebnisProDeal.verarbeitet;
        summary.unsicher += ergebnisProDeal.unsicher;
        summary.fehler += ergebnisProDeal.fehler;
        summary.uebersprungen += ergebnisProDeal.uebersprungen || 0;
        if (ergebnisProDeal.abgebrochen) summary.abgebrochen++;
      } catch (e) {
        summary.fehler++;
        logRow(dealId, null, null, 'HARD_ERROR', `Deal abgebrochen: ${e.message}`);
        Logger.log(`pilotLauf: Deal ${dealId} abgebrochen -- ${e.message}`);
      }
    });
    logLaufEnde(summary.fehler > 0 ? 'HARD_ERROR' : 'OK', summary);
    Logger.log(`pilotLauf: ${JSON.stringify(summary)}`);
    return summary;
  } finally {
    flushLog();
  }
}
