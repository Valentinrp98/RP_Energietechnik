// ============================================================================
// Lokaler Node-Test für das Feld "Gesamtsumme Brutto" (09.09.2026)
// Ausführen:  node _tests/Sevdesk-Pipdrive_sync/test-gesamtsumme-brutto.js
//
// Lädt fieldkeysandmapping.js + syncengine.js in einen vm-Context mit Apps-Script-Stubs und
// prüft, WAS writeArticleFieldsToDeal() tatsächlich an Pipedrive schicken würde -- kein
// Netzwerk, kein Token, kein Schreibzugriff. Gleiches Muster wie _tests/Fortschritt-Script.
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJEKT = path.join(__dirname, '..', '..', 'Sevdesk-Pipdrive_sync');
const BRUTTO_KEY = '4af5a8d4ff079ac13a13b6de092748479fbe3d13';
// "Ausführungsart" (SM/FS) -- darf NIE im PATCH landen, siehe Test weiter unten.
const AUSFUEHRUNGSART_KEY = 'cc80ad5daf0788dba60b3da3931681edd3dd2c87';

// Realistischer Fullservice-Auftrag, von mehreren Tests genutzt.
const fsPositionen = [
  { name: 'AIKO SOLARMODUL 445W GLAS-GLAS', quantity: 20, einzelpreisNetto: 95 },
  { name: 'SIGENERGY WECHSELRICHTER 10kW', quantity: 1, einzelpreisNetto: 2100 },
  { name: 'SIGENERGY SPEICHERSYSTEM Batteriemodul 8.06', quantity: 2, einzelpreisNetto: 2400 },
  { name: 'MONTAGEARBEITEN (PAUSCHAL)', quantity: 1, einzelpreisNetto: 3200 },
  { name: 'ELEKTROINSTALLATION', quantity: 1, einzelpreisNetto: 1400 },
  { name: 'ELEKTROINSTALLATIONSMATERIAL', quantity: 1, einzelpreisNetto: 650 },
  { name: 'TECHNISCHE PROJEKTIERUNG', quantity: 1, einzelpreisNetto: 490 }
];

// --- Apps-Script-Stubs -------------------------------------------------------
const logs = [];

const ctx = {
  Logger: { log: (m) => logs.push(String(m)) },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => 'STUB_TOKEN',
      setProperty: () => {},
      deleteProperty: () => {}
    })
  },
  UrlFetchApp: { fetch: () => { throw new Error('Kein Netzwerk im Test!'); } },
  SpreadsheetApp: { openById: () => { throw new Error('Kein Sheet im Test!'); } },
  MailApp: { sendEmail: () => {} },
  Utilities: { sleep: () => {}, formatDate: () => '' },
  ScriptApp: { getProjectTriggers: () => [] },
  console
};
vm.createContext(ctx);

['fieldkeysandmapping.js', 'syncengine.js'].forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(PROJEKT, f), 'utf8'), ctx, { filename: f });
});

// pipedriveFetch abfangen, statt echt zu senden
vm.runInContext(
  'pipedriveFetch = function(p, o) { __patch = { path: p, options: o }; return { success: true, data: {} }; };',
  ctx
);

function patchFelder(dealId, aggregated, order) {
  ctx.__patch = null;
  ctx.__aggregated = aggregated;
  ctx.__order = order;
  vm.runInContext('writeArticleFieldsToDeal(' + dealId + ', __aggregated, __order)', ctx);
  return JSON.parse(ctx.__patch.options.payload).custom_fields;
}

// --- Mini-Assert -------------------------------------------------------------
let ok = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  OK   ' + name); ok++; }
  catch (e) { console.log('  FAIL ' + name + '\n         ' + e.message); fail++; }
}
function eq(ist, soll, was) {
  if (JSON.stringify(ist) !== JSON.stringify(soll)) {
    throw new Error((was || '') + ' erwartet ' + JSON.stringify(soll) + ', war ' + JSON.stringify(ist));
  }
}

// --- 1) Formatierer ---------------------------------------------------------
console.log('\nformatiereBruttoSumme()');
const fmt = (v) => { ctx.__v = v; return vm.runInContext('formatiereBruttoSumme(__v)', ctx); };

t('sevdesk-String wird österreichisch formatiert', () => eq(fmt('27140.39'), '27.140,39 €'));
t('eine Nachkommastelle wird auf zwei aufgefüllt', () => eq(fmt('1234.5'), '1.234,50 €'));
t('Zahl statt String funktioniert genauso', () => eq(fmt(22617), '22.617,00 €'));
t('Millionenbetrag bekommt zwei Tausenderpunkte', () => eq(fmt('1234567.89'), '1.234.567,89 €'));
t('unter 1000 ohne Tausenderpunkt', () => eq(fmt('850'), '850,00 €'));
t('null -> null (Feld wird geleert, kein "0,00")', () => eq(fmt(null), null));
t('undefined -> null', () => eq(fmt(undefined), null));
t('Leerstring -> null', () => eq(fmt(''), null));
t('"0.00" -> null (Null-Summe ist kein echter Wert)', () => eq(fmt('0.00'), null));
t('Muell -> null', () => eq(fmt('abc'), null));
t('negativ -> null', () => eq(fmt(-5), null));

// --- 2) Schreibpfad ---------------------------------------------------------
console.log('\nwriteArticleFieldsToDeal()');
const leer = { fields: {}, summary: '', montageSummary: '', unknownArticles: [] };

t('Brutto-Summe landet formatiert im PATCH', () => {
  const cf = patchFelder(7253, leer, { sumGross: '27140.39' });
  eq(cf[BRUTTO_KEY], '27.140,39 €');
});

t('fehlende sumGross -> Feld wird aktiv geleert (null), nicht ausgelassen', () => {
  const cf = patchFelder(7253, leer, { sumGross: null });
  if (!(BRUTTO_KEY in cf)) throw new Error('Key fehlt im PATCH -- alter Wert wuerde stehenbleiben');
  eq(cf[BRUTTO_KEY], null);
});

t('ohne order-Parameter wird das Feld gar nicht angefasst', () => {
  const cf = patchFelder(7253, leer, undefined);
  if (BRUTTO_KEY in cf) throw new Error('Key wurde trotz fehlendem order gesetzt');
});

t('Ausfuehrungsart wird NICHT geschrieben (Seller pflegt sie manuell, 09.09.2026)', () => {
  // Regressions-Schutz zu Valentins Entscheidung: das Script leitete SM/FS aus den Positionen ab
  // und haette die Handeingabe bei jedem Sync ueberschrieben. Weder der field_code noch der
  // FIELD_KEYS-Eintrag duerfen zurueckkommen.
  ctx.__pos = fsPositionen;
  const agg = vm.runInContext('aggregatePositions(__pos)', ctx);
  const cf = patchFelder(7253, agg, { sumGross: '27140.39' });
  if (AUSFUEHRUNGSART_KEY in cf) throw new Error('Ausfuehrungsart-Feld landet wieder im PATCH!');
  if ('SM_FS_Typ' in agg.fields) throw new Error('aggregatePositions leitet wieder SM/FS ab!');
  const keys = vm.runInContext('Object.keys(FIELD_KEYS).join(",")', ctx);
  if (keys.indexOf('SM_FS_Typ') !== -1) throw new Error('SM_FS_Typ steht wieder in FIELD_KEYS!');
});

t('kein PLACEHOLDER-Key rutscht in den PATCH', () => {
  const cf = patchFelder(7253, leer, { sumGross: '27140.39' });
  eq(Object.keys(cf).filter(k => k.indexOf('PLACEHOLDER') === 0), []);
});

t('FIELD_KEYS enthaelt ueberhaupt keinen PLACEHOLDER mehr', () => {
  // Solange irgendein Key ein Platzhalter ist, kann pruefeKonfiguration() nie gruen werden --
  // und ein dauerhaft roter Check wird irgendwann nicht mehr gelesen (Befund D5).
  const uebrig = vm.runInContext(
    "Object.keys(FIELD_KEYS).filter(k => String(FIELD_KEYS[k]).indexOf('PLACEHOLDER') === 0).join(',')", ctx);
  eq(uebrig, '', 'noch PLACEHOLDER:');
});

t('Montage_Elektro_Summary wird NICHT geschrieben (verworfen 09.09.2026)', () => {
  // Die vier Pauschalen stehen einzeln und strukturiert am Deal -- eine Textkopie derselben
  // Zahlen war Redundanz. Der String wird weiter gebaut, aber nur noch fuers Sync-Log.
  ctx.__pos = fsPositionen;
  const agg = vm.runInContext('aggregatePositions(__pos)', ctx);
  if (!agg.montageSummary) throw new Error('montageSummary fehlt -- die Log-Zeile braucht sie noch');
  const keys = vm.runInContext('Object.keys(FIELD_KEYS).join(",")', ctx);
  if (keys.indexOf('Montage_Elektro_Summary') !== -1) {
    throw new Error('Montage_Elektro_Summary steht wieder in FIELD_KEYS!');
  }
});

// --- 3) Realistischer FS-Auftrag, Positionen + Order zusammen ---------------
console.log('\nEnd-to-End (aggregatePositions + Schreibpfad)');
t('Pauschalen UND Brutto-Summe stehen gemeinsam im PATCH', () => {
  ctx.__pos = fsPositionen;
  const agg = vm.runInContext('aggregatePositions(__pos)', ctx);
  const cf = patchFelder(7253, agg, { sumGross: '27140.39' });
  // FIELD_KEYS ist ein `const` im Script -- landet als lexikalische Bindung im vm-Context,
  // NICHT als Property von ctx. Deshalb über runInContext lesen, nicht über ctx.FIELD_KEYS.
  const key = (name) => vm.runInContext('FIELD_KEYS.' + name, ctx);
  eq(cf[key('Montage_Pauschale_EUR')], 3200, 'Montage-Pauschale:');
  eq(cf[key('Elektromaterial_Pauschale_EUR')], 650, 'E-Material-Pauschale:');
  eq(cf[key('Module_Anzahl')], 20, 'Module_Anzahl:');
  eq(cf[BRUTTO_KEY], '27.140,39 €', 'Brutto:');
});

t('Log-Zeile nennt die Brutto-Summe', () => {
  ctx.__pos = fsPositionen;
  ctx.__agg = vm.runInContext('aggregatePositions(__pos)', ctx);
  ctx.__o = { sumGross: '27140.39' };
  const zeile = vm.runInContext('formatiereErkannteFelder(__agg, __o)', ctx);
  if (zeile.indexOf('Gesamtsumme Brutto: 27.140,39 €') === -1) throw new Error('fehlt in: ' + zeile);
});

t('Log-Zeile enthaelt die Montage/Elektro-Summary weiterhin', () => {
  // Einziger verbleibender Ort fuer diese Zusammenfassung, seit das Pipedrive-Feld verworfen ist.
  ctx.__pos = fsPositionen;
  ctx.__agg = vm.runInContext('aggregatePositions(__pos)', ctx);
  ctx.__o = { sumGross: '27140.39' };
  const zeile = vm.runInContext('formatiereErkannteFelder(__agg, __o)', ctx);
  if (zeile.indexOf('Montage/Elektro-Summary: Montage 3200') === -1) throw new Error('fehlt in: ' + zeile);
});

t('Log-Zeile ohne order zeigt "-" statt zu werfen', () => {
  ctx.__agg = vm.runInContext('aggregatePositions([])', ctx);
  const zeile = vm.runInContext('formatiereErkannteFelder(__agg, undefined)', ctx);
  if (zeile.indexOf('Gesamtsumme Brutto: -') === -1) throw new Error('fehlt in: ' + zeile);
});

// --- 4) fetchOrderFromSevdesk gibt sumGross weiter --------------------------
console.log('\nfetchOrderFromSevdesk()');
t('sumGross aus der sevdesk-Antwort wird durchgereicht', () => {
  vm.runInContext([
    'sevdeskFetch = function(p) {',
    "  if (p.indexOf('/Order/') === 0) return { objects: [{ id: 30218946, orderNumber: '2026-644-A', update: '2026-09-09', sumGross: '27140.39', sumNet: '22617', contact: { id: 111 } }] };",
    "  if (p.indexOf('/OrderPos') === 0) return { objects: [{ name: 'MONTAGEARBEITEN (PAUSCHAL)', quantity: 1, price: 3200 }] };",
    "  if (p.indexOf('/Contact/') === 0) return { objects: [{ customerNumber: '4010' }] };",
    "  throw new Error('unerwarteter Pfad ' + p);",
    '};',
    '__o2 = fetchOrderFromSevdesk(30218946);'
  ].join('\n'), ctx);
  eq(ctx.__o2.sumGross, '27140.39', 'sumGross:');
  eq(ctx.__o2.customerId, '4010', 'Kundennummer:');
  eq(ctx.__o2.positions[0].einzelpreisNetto, 3200, 'Positionspreis:');
});

t('fehlt sumGross in der Antwort, wird null durchgereicht (kein undefined)', () => {
  vm.runInContext([
    'sevdeskFetch = function(p) {',
    "  if (p.indexOf('/Order/') === 0) return { objects: [{ id: 1, orderNumber: 'X', contact: null }] };",
    "  if (p.indexOf('/OrderPos') === 0) return { objects: [] };",
    "  throw new Error('unerwarteter Pfad ' + p);",
    '};',
    '__o3 = fetchOrderFromSevdesk(1);'
  ].join('\n'), ctx);
  eq(ctx.__o3.sumGross, null);
});

console.log('\n' + ok + ' bestanden, ' + fail + ' fehlgeschlagen');
process.exit(fail === 0 ? 0 : 1);
