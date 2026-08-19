// ============================================================
// PHASE 2 — Verschieben nach Fulfillment / 1_Übernommen
// ============================================================
// NUR Deal-IDs eintragen, die du nach Durchsicht des Log-Sheets aus
// Phase 1 selbst als "WON, wirklich Fulfillment-Übergabe" bestätigt hast.
// Kein automatisches Verschieben bei MEHRDEUTIG/FEHLER_STATUS/NICHT_GEFUNDEN.
//
// ---------- SCHALTER (in dieser Reihenfolge durchgehen) ----------
// 1) DRY_RUN = true, LIMIT_PRO_LAUF = 0  -> alle Deals nur simulieren, Log lesen
// 2) DRY_RUN = false, AUTOMATIONS_GEPRUEFT = true, LIMIT_PRO_LAUF = 1
//    -> EIN Deal echt verschieben, dann in Pipedrive nachsehen: Mail raus? Aktivität angelegt?
// 3) LIMIT_PRO_LAUF = 0 -> Rest verschieben. Schon verschobene Deals werden
//    automatisch übersprungen ("bereits in Zielstage"), Wiederholung ist gefahrlos.
const DRY_RUN = true;

// Muss für einen LIVE-Lauf bewusst auf true gesetzt werden. Bestätigt: in Pipedrive
// nachgesehen, welche Automations auf einen Stage-Wechsel nach "1_Übernommen" reagieren.
// Ein API-Write löst dieselben Automations aus wie ein Klick in der UI — sonst gehen
// im schlimmsten Fall 42 Kundenmails gleichzeitig raus.
const AUTOMATIONS_GEPRUEFT = false;

// 0 = alle. Für den ersten LIVE-Lauf auf 1 stellen (Canary).
const LIMIT_PRO_LAUF = 0;

// Deal-IDs aus Phase 1 hier eintragen (aus der Spalte "Deal-ID" im Log-Sheet, Kategorie WON)
// Eingetragen aus dem Lauf vom 2026-08-18 (30 WON-Treffer, 1:1 aus dem Log übernommen)
const DEAL_IDS_ZUM_VERSCHIEBEN = [
  7065, // Hilal Arac (Deal-Titel: "Metehan Hilal Arac" — ist zugleich "Opencarbox GmbH" aus der NICHT_GEFUNDEN-Liste, E-Mail @opencarbox.co.at bestätigt. Beide Namen = derselbe Deal, nur einmal zählen)
  6198, // Antonio Zivojin
  6037, // Harald Lamprecht
  6207, // Martin Gangl
  6970, // Joseph Barretto
  5237, // Hashim Sinani
  5829, // David Mihaila
  5587, // Jasmin Schieder
  6013, // Julia Brandtner
  5530, // Nadeem Raza
  6694, // Severin Weber
  5779, // Martin Pospisil
  6922, // Hidir Özdek
  6952, // Hajrulla Krasniqi
  5373, // Vasile Todoran
  5984, // Gerald Navara
  6439, // Manfred Kabelik
  5749, // Jürgen Pußwald
  4876, // Christoph Maier
  6027, // Johann Bogengruber
  6659, // Nabil El Sharif
  6084, // Martin Zimmer
  5837, // Martin Weghofer
  6591, // Mario Messiha
  6686, // Dietmar Schweiger
  6804, // Adolf Matschek
  5867, // Eleni Mika
  6971, // Franz Konrad
  6843, // Michael Pitschek
  7096, // Markus Liebl

  // Nachträglich aus den MEHRDEUTIG-Fällen aufgelöst (2026-08-18, per zeigeMehrdeutigeDeals()):
  // in allen drei Gruppen gab es genau einen "won"-Deal, Rest waren alte offene/verlorene Anläufe derselben Person
  6006, // Werner Kremser (von 5982/6006/3854 — nur dieser ist "won")
  6406, // Karl Heindl (von 6406/2859 — nur dieser ist "won")
  7129, // Josef Kassmannhuber (von 7109/2521/7129 — nur dieser ist "won")

  // Nachträglich aus den NICHT_GEFUNDEN-Fällen aufgelöst (2026-08-18, per ermittleNichtGefundeneNamenDetails()):
  // Titelsuche fand sie nicht, weil Deal-Titel vertauschte Namensreihenfolge/andere Schreibweise/Firmenname statt Kundenname hat
  5972, // Edin Hamzic (Deal-Titel "Hamzic Edin")
  5728, // George Pozderie (Deal-Titel "Pozderie George")
  6179, // Verena Pizzini (Deal-Titel "Farmento")
  6738, // Kamal El Nour (Deal-Titel "Kamal Abd El Nour")
  6219, // Zoltan Bobal (Deal-Titel "Zoltán Bobál")

  // Nachträglich per breiter itemSearch gefunden (2026-08-18, per breiteSucheUnklareFaelle()):
  // Titelsuche + Personen-/Org-Suche fanden sie nicht wegen abweichender Schreibweise
  6771, // Waldhaus GmbH (Deal-Titel "Rudy Waldhaus" — Notizen bestätigen "Pflegeheim Waldhaus", waldhausgmbh@aon.at)
  7059, // Christian van Dyk (Deal-Titel "Christian van Dyck" — ein "c" mehr)

  // Nachträglich manuell auf "won" gesetzt (2026-08-18, bestätigt von Sean/Team, waren vorher FEHLER_STATUS/unsicher)
  7072, // Ralph Hemetinger
  4945, // Ali Alsofi
  6454, // Johannes Moser
  5142, // Mehmet Ünsal
  7107, // Koptische Kirche Graz
  5307, // Kenan Kavlak
  7177, // Julia Linsmayr
  6908, // Hans Greml
  6018, // Martina Suppan
  5663, // Christian Seitz (= Johanna Seitz, bestätigt richtig)
  6493  // Canan Kalman (= Kalman KG, bestätigt richtig)
];

const VERSCHIEBEN_LOG_SHEET_PROP = 'VERSCHIEBEN_LOG_SHEET_ID';
const VERSCHIEBEN_LOG_KOPF = ['Zeitstempel', 'Modus', 'Deal-ID', 'Deal-Titel', 'Status',
  'Alte Pipeline', 'Alte Stage', 'Neue Stage', 'Ergebnis'];

function getOderErstelleVerschiebenLogSheet() {
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty(VERSCHIEBEN_LOG_SHEET_PROP);
  if (sheetId) {
    try {
      return SpreadsheetApp.openById(sheetId);
    } catch (e) {
      // ID war ungültig, neu anlegen
    }
  }
  const sheet = SpreadsheetApp.create('LOG_Verschieben nach Fulfillment');
  props.setProperty(VERSCHIEBEN_LOG_SHEET_PROP, sheet.getId());
  const tab = sheet.getSheets()[0];
  tab.setName('Log');
  tab.appendRow(VERSCHIEBEN_LOG_KOPF);
  Logger.log('Neues Log-Sheet angelegt: ' + sheet.getUrl());
  return sheet;
}

// Alle Stages/Pipelines einmal vorladen -> lesbare Namen im Log statt nackter IDs (kein N+1).
function ladeStageMap() {
  const stages = fetchPipedrive('/stages?limit=500').data || [];
  const pipelines = fetchPipedrive('/pipelines?limit=500').data || [];
  const pipelineNamen = {};
  pipelines.forEach(p => { pipelineNamen[p.id] = p.name; });
  const map = {};
  stages.forEach(s => {
    map[s.id] = {
      stageName: s.name,
      pipelineName: pipelineNamen[s.pipeline_id] || String(s.pipeline_id)
    };
  });
  return map;
}

// Doppelte IDs entfernen: 7065 deckt zwei Namen der Ursprungsliste ab (Hilal Arac /
// Opencarbox). Ein zweiter Eintrag würde denselben Deal zweimal patchen und damit
// hängende Automations doppelt auslösen.
function eindeutigeDealIds() {
  const gesehen = {};
  const eindeutig = [];
  const doppelte = [];
  DEAL_IDS_ZUM_VERSCHIEBEN.forEach(id => {
    if (gesehen[id]) { doppelte.push(id); return; }
    gesehen[id] = true;
    eindeutig.push(id);
  });
  if (doppelte.length) {
    Logger.log('HINWEIS: %s doppelte Deal-ID(s) übersprungen: %s', doppelte.length, doppelte.join(', '));
  }
  return eindeutig;
}

function verschiebeBestaetigteDeals() {
  const alleIds = eindeutigeDealIds();
  if (alleIds.length === 0) {
    Logger.log('DEAL_IDS_ZUM_VERSCHIEBEN ist leer — erst aus dem Phase-1-Log-Sheet befüllen.');
    return;
  }
  if (!DRY_RUN && !AUTOMATIONS_GEPRUEFT) {
    throw new Error('LIVE-Lauf blockiert: AUTOMATIONS_GEPRUEFT ist false. Erst in Pipedrive prüfen, '
      + 'welche Automations auf einen Stage-Wechsel nach "1_Übernommen" reagieren (Mails/Aktivitäten), '
      + 'dann AUTOMATIONS_GEPRUEFT = true setzen.');
  }

  // Parallel-Lauf verhindern (Doppelklick auf ▷, zwei offene Editor-Tabs)
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log('Ein anderer Lauf ist noch aktiv — abgebrochen, damit nichts doppelt verschoben wird.');
    return;
  }

  try {
    const ziel = pruefeKonfiguration(); // wirft, falls Pipeline/Stage nicht existieren
    const stageMap = ladeStageMap();
    const sheet = getOderErstelleVerschiebenLogSheet();
    const tab = sheet.getSheetByName('Log') || sheet.getSheets()[0];
    const modus = DRY_RUN ? 'DRY_RUN' : 'LIVE';
    const ids = LIMIT_PRO_LAUF > 0 ? alleIds.slice(0, LIMIT_PRO_LAUF) : alleIds;
    if (LIMIT_PRO_LAUF > 0) {
      Logger.log('LIMIT_PRO_LAUF = %s -> nur die ersten %s von %s Deals in diesem Lauf.',
        LIMIT_PRO_LAUF, ids.length, alleIds.length);
    }

    const zusammenfassung = {};

    // Jede Zeile SOFORT schreiben (nicht gesammelt am Ende). Bei Absturz oder
    // Timeout mitten im Lauf ist damit trotzdem dokumentiert, welche Deals
    // bereits verschoben wurden — sonst weiß man hinterher nichts.
    ids.forEach(dealId => {
      const jetzt = new Date();
      let ergebnis;
      let zeile;
      try {
        const deal = fetchPipedrive('/deals/' + dealId).data;
        if (!deal) throw new Error('Deal ' + dealId + ' nicht gefunden');

        const alt = stageMap[deal.stage_id] || { stageName: String(deal.stage_id), pipelineName: '?' };
        const basis = [jetzt, modus, dealId, deal.title, deal.status, alt.pipelineName, alt.stageName];

        if (deal.status !== 'won') {
          ergebnis = 'ÜBERSPRUNGEN — Status ist nicht "won"';
          zeile = basis.concat(['', ergebnis]);
        } else if (deal.stage_id === ziel.stageId) {
          ergebnis = 'ÜBERSPRUNGEN — bereits in Zielstage';
          zeile = basis.concat([ziel.stageName, ergebnis]);
        } else if (DRY_RUN) {
          ergebnis = 'WÜRDE VERSCHOBEN WERDEN';
          zeile = basis.concat([ziel.stageName, ergebnis]);
        } else {
          // pipeline_id explizit mitschicken, statt darauf zu vertrauen, dass Pipedrive
          // sie aus der stage_id ableitet — der Wechsel geht über eine Pipeline-Grenze.
          const antwort = fetchPipedrive('/deals/' + dealId, {
            method: 'patch',
            payload: JSON.stringify({ stage_id: ziel.stageId, pipeline_id: ziel.pipelineId })
          });
          // Pipedrive antwortet auch 200, wenn effektiv nichts geschrieben wurde ->
          // gegen die Antwortdaten verifizieren, nicht dem Statuscode glauben.
          const neu = antwort && antwort.data;
          if (neu && neu.stage_id === ziel.stageId) {
            ergebnis = 'VERSCHOBEN (verifiziert)';
          } else {
            ergebnis = 'FEHLGESCHLAGEN — API meldete OK, stage_id ist aber '
              + (neu ? neu.stage_id : '(keine Daten)') + ' statt ' + ziel.stageId;
          }
          zeile = basis.concat([ziel.stageName, ergebnis]);
        }
      } catch (e) {
        ergebnis = 'HARD_ERROR: ' + e.message;
        zeile = [jetzt, modus, dealId, '', '', '', '', '', ergebnis];
      }

      const kategorie = ergebnis.split(' —')[0].split(':')[0];
      zusammenfassung[kategorie] = (zusammenfassung[kategorie] || 0) + 1;
      tab.appendRow(zeile);
    });

    SpreadsheetApp.flush();
    Logger.log('Fertig (%s). %s Deals verarbeitet: %s', modus, ids.length, JSON.stringify(zusammenfassung));
    Logger.log('Log-Sheet: ' + sheet.getUrl());
  } finally {
    lock.releaseLock();
  }
}

// Kontrolle NACH dem Lauf: liest jeden Deal frisch aus Pipedrive und zählt,
// wie viele wirklich in der Zielstage stehen. Schreibt nichts.
function pruefeErgebnisNachLauf() {
  const ziel = pruefeKonfiguration();
  const ids = eindeutigeDealIds();
  let drin = 0;
  const offen = [];
  ids.forEach(dealId => {
    try {
      const deal = fetchPipedrive('/deals/' + dealId).data;
      if (deal && deal.stage_id === ziel.stageId) {
        drin++;
      } else {
        offen.push(dealId + ' (stage ' + (deal ? deal.stage_id : '?')
          + ', status ' + (deal ? deal.status : '?') + ')');
      }
    } catch (e) {
      offen.push(dealId + ' (Fehler: ' + e.message + ')');
    }
  });
  Logger.log('%s von %s Deals stehen in "%s".', drin, ids.length, ziel.stageName);
  if (offen.length) Logger.log('Noch offen:\n' + offen.join('\n'));
}
