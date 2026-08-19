// ============================================================
// KONFIGURATION — Namensabgleich + Übernahme in Fulfillment
// ============================================================
// Zweck: 55 Kunden aus der Sales-Pipeline auf "Gewonnen"-Deal
// abgleichen und (nach manueller Bestätigung) in die Pipeline
// "Fulfillment", Stage "1_Übernommen" verschieben.
//
// ACHTUNG PRODUKTIVDATEN. Ablauf:
//   1. pruefeKonfiguration() ausführen — prüft ob Pipeline/Stage existieren
//   2. testEinzelnerName() ausführen — prüft Suchergebnis-Format an 1 Namen
//   3. starteNamensabgleich() ausführen — NUR LESEN, schreibt Log-Sheet
//   4. Log-Sheet durchsehen, WON-Fälle in DEAL_IDS_ZUM_VERSCHIEBEN (Verschieben.gs) eintragen
//   5. verschiebeBestaetigteDeals() mit DRY_RUN=true testen, dann DRY_RUN=false scharf

const PIPEDRIVE_DOMAIN = 'rp-energietechnik.pipedrive.com';
const PIPEDRIVE_API_BASE = 'https://api.pipedrive.com/api/v2';

const PIPELINE_NAME = 'Fulfillment';
const STAGE_NAME = '1_Übernommen';

// Token liegt in Script Properties unter PIPEDRIVE_API_TOKEN (nicht hier eintragen)
function getApiToken() {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  if (!token) {
    throw new Error('PIPEDRIVE_API_TOKEN fehlt in den Script Properties (Projekteinstellungen > Script-Properties).');
  }
  return token;
}

// Die 55 Namen (5 bereits erledigte Kunden aus der Original-Liste sind rausgenommen:
// Christian Lehner, Benjamin Bauer WP, David Peter, Arnold Baumann, Christian Potocnik)
const NAMEN_LISTE = [
  { name: 'Ralph Hemetinger', verantwortlich: 'Marco' },
  { name: 'Leonardo Batista', verantwortlich: 'Marco' },
  { name: 'Opencarbox GmbH', verantwortlich: 'André' },
  { name: 'Hilal Arac', verantwortlich: 'André' },
  { name: 'Werner Kremser', verantwortlich: 'André' },
  { name: 'Antonio Zivojin', verantwortlich: 'Sean' },
  { name: 'Edin Hamzic', verantwortlich: 'André' },
  { name: 'Harald Lamprecht', verantwortlich: 'André' },
  { name: 'Martin Gangl', verantwortlich: 'André' },
  { name: 'Joseph Barretto', verantwortlich: 'André' },
  { name: 'Christian van Dyk', verantwortlich: 'André' },
  { name: 'George Pozderie', verantwortlich: 'Sean' },
  { name: 'Hashim Sinani', verantwortlich: 'André' },
  { name: 'David Mihaila', verantwortlich: 'Marco' },
  { name: 'Jasmin Schieder', verantwortlich: 'André' },
  { name: 'Julia Brandtner', verantwortlich: 'André' },
  { name: 'Nadeem Raza', verantwortlich: 'André' },
  { name: 'Ali Alsofi', verantwortlich: 'André' },
  { name: 'Severin Weber', verantwortlich: 'André' },
  { name: 'Martin Pospisil', verantwortlich: 'André' },
  { name: 'Hidir Özdek', verantwortlich: 'André' },
  { name: 'Sasa Usic', verantwortlich: 'André' },
  { name: 'Hajrulla Krasniqi', verantwortlich: 'Marco' },
  { name: 'Vasile Todoran', verantwortlich: 'Marco' },
  { name: 'Johannes Moser', verantwortlich: 'Marco' },
  { name: 'Gerald Navara', verantwortlich: 'André' },
  { name: 'Manfred Kabelik', verantwortlich: 'André' },
  { name: 'Jürgen Pußwald', verantwortlich: 'Marco' },
  { name: 'Christoph Maier', verantwortlich: 'André' },
  { name: 'Mehmet Ünsal', verantwortlich: 'André' },
  { name: 'Johann Bogengruber', verantwortlich: 'André' },
  { name: 'Verein HW', verantwortlich: 'André' },
  { name: 'Verena Pizzini', verantwortlich: 'André' },
  { name: 'Nabil El Sharif', verantwortlich: 'André' },
  { name: 'Martin Zimmer', verantwortlich: 'André' },
  { name: 'Martin Weghofer', verantwortlich: 'André' },
  { name: 'Karl Heindl', verantwortlich: 'André' },
  { name: 'Mario Messiha', verantwortlich: 'André' },
  { name: 'Dietmar Schweiger', verantwortlich: 'André' },
  { name: 'Adolf Matschek', verantwortlich: 'André' },
  { name: 'Kamal El Nour', verantwortlich: 'Sean' },
  { name: 'Eleni Mika', verantwortlich: 'Sean' },
  { name: 'Zoltan Bobal', verantwortlich: 'André' },
  { name: 'Waldhaus GmbH', verantwortlich: 'André' },
  { name: 'Franz Konrad', verantwortlich: 'André' },
  { name: 'Koptische Kirche', verantwortlich: 'André' },
  { name: 'Kenan Kavlak', verantwortlich: 'Sergen' },
  { name: 'Michael Pitschek', verantwortlich: 'André' },
  { name: 'Johanna Seitz', verantwortlich: 'André' },
  { name: 'Kalman KG', verantwortlich: 'André' },
  { name: 'Josef Kassmannhuber', verantwortlich: 'Marco' },
  { name: 'Julia Linsmayr', verantwortlich: 'André' },
  { name: 'Markus Liebl', verantwortlich: 'Manuel' },
  { name: 'Hans Greml', verantwortlich: 'Manuel' },
  { name: 'Martina Suppan', verantwortlich: 'André' }
];

// ---------- gemeinsamer HTTP-Helper mit Retry ----------
function fetchPipedrive(path, options) {
  const url = PIPEDRIVE_API_BASE + path;
  const opts = Object.assign({
    method: 'get',
    headers: { 'x-api-token': getApiToken() },
    muteHttpExceptions: true,
    contentType: 'application/json'
  }, options || {});

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = UrlFetchApp.fetch(url, opts);
    const code = response.getResponseCode();
    if (code === 429 || code >= 500) {
      if (attempt === 3) throw new Error('Pipedrive-Fehler ' + code + ' nach 3 Versuchen: ' + response.getContentText());
      Utilities.sleep(1000 * Math.pow(2, attempt)); // 2s, 4s, 8s
      continue;
    }
    if (code >= 400) {
      throw new Error('Pipedrive-Fehler ' + code + ': ' + response.getContentText());
    }
    return JSON.parse(response.getContentText());
  }
}

// ---------- Pipeline/Stage-Auflösung (Namen -> IDs, nie hartcodiert) ----------
function findePipelineUndStage() {
  const pipelines = fetchPipedrive('/pipelines').data || [];
  const pipeline = pipelines.find(p => p.name.trim().toLowerCase() === PIPELINE_NAME.trim().toLowerCase());
  if (!pipeline) {
    throw new Error('Pipeline "' + PIPELINE_NAME + '" nicht gefunden. Vorhandene Pipelines: '
      + pipelines.map(p => p.name).join(', '));
  }

  const stages = fetchPipedrive('/stages?pipeline_id=' + pipeline.id).data || [];
  const stage = stages.find(s => s.name.trim().toLowerCase() === STAGE_NAME.trim().toLowerCase());
  if (!stage) {
    throw new Error('Stage "' + STAGE_NAME + '" in Pipeline "' + PIPELINE_NAME + '" nicht gefunden. Vorhandene Stages: '
      + stages.map(s => s.name).join(', '));
  }

  return { pipelineId: pipeline.id, pipelineName: pipeline.name, stageId: stage.id, stageName: stage.name };
}

// Vor jedem Lauf einmal ausführen — vergleicht Konfiguration gegen echtes Pipedrive
function pruefeKonfiguration() {
  const ziel = findePipelineUndStage();
  Logger.log('OK — Ziel-Pipeline "%s" (id %s), Ziel-Stage "%s" (id %s)',
    ziel.pipelineName, ziel.pipelineId, ziel.stageName, ziel.stageId);
  return ziel;
}
