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
      const dealFields = fetchPipedrive('dealFields');
      const gefunden = dealFields.some(f => f.key === KUNDENORDNER_LINK_FIELD_KEY);
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

/** Manueller Testlauf für einen einzelnen Deal (siehe PILOT_DEAL_IDS in Config.gs). */
function testEinzelDeal() {
  starteLauf('testEinzelDeal');
  const dealId = PILOT_DEAL_IDS[0];
  const summary = processDeal(dealId);
  logLaufEnde('OK', summary);
  flushLog();
  Logger.log(`testEinzelDeal (Deal ${dealId}): ${JSON.stringify(summary)}`);
  return summary;
}

/** Iteriert alle Pilot-Deals (siehe PILOT_DEAL_IDS in Config.gs). Respektiert DRY_RUN. */
function pilotLauf() {
  starteLauf('pilotLauf');
  const summary = { verarbeitet: 0, unsicher: 0, fehler: 0 };
  PILOT_DEAL_IDS.forEach(dealId => {
    const ergebnisProDeal = processDeal(dealId);
    summary.verarbeitet += ergebnisProDeal.verarbeitet;
    summary.unsicher += ergebnisProDeal.unsicher;
    summary.fehler += ergebnisProDeal.fehler;
  });
  logLaufEnde('OK', summary);
  flushLog();
  Logger.log(`pilotLauf: ${JSON.stringify(summary)}`);
  return summary;
}
