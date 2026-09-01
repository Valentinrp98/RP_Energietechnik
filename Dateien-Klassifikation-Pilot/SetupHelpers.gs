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

  if (probleme.length === 0) {
    Logger.log('checkConfiguration: alles passt.');
  } else {
    Logger.log(`checkConfiguration: ${probleme.length} Problem(e):\n- ${probleme.join('\n- ')}`);
  }
  return probleme;
}

/**
 * Einmalig NACH Anlage des Pipedrive-Felds "Dokumente erkannt" (Mehrfachauswahl, Optionen
 * Stromrechnung/Dachfoto/Zählerpunkt) ausführen: sucht das Feld per Label und druckt field_code +
 * Options-IDs ins Log, zum manuellen Eintragen in Config.gs (DOKUMENTE_ERKANNT_FIELD_KEY /
 * DOKUMENTE_ERKANNT_OPTION_IDS). Options-Label-Abgleich case-insensitiv, siehe CLAUDE.md
 * "Enum-Options-Check muss case-insensitiv vergleichen" -- Schreibweise in Pipedrive muss nicht
 * exakt "stromrechnung" sein.
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
    const option = (feld.options || []).find(o => (o.label || '').toLowerCase() === gesuchteLabels[kategorie]);
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
  const summary = { verarbeitet: 0, unsicher: 0, fehler: 0 };
  // try/finally wie in testEinzelDeal(): ohne das verliert ein Fehler bei Deal 3 die bereits
  // bezahlten Kosten-Zeilen von Deal 1 und 2. Zusaetzlich wird jeder Deal einzeln gefangen, damit
  // ein kaputter Deal nicht die restlichen mitnimmt -- der Lauf soll durchlaufen und am Ende sagen,
  // was schiefging.
  try {
    PILOT_DEAL_IDS.forEach(dealId => {
      try {
        const ergebnisProDeal = processDeal(dealId);
        summary.verarbeitet += ergebnisProDeal.verarbeitet;
        summary.unsicher += ergebnisProDeal.unsicher;
        summary.fehler += ergebnisProDeal.fehler;
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
