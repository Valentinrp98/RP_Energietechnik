// ============================================================================
// Lokaler Node-Test: WR-Zeile in der Verkaufte_Artikel_Summary (25.09.2026)
// Ausfuehren:  node _tests/Sevdesk-Pipdrive_sync/test-wr-summary.js
//
// Hintergrund: Die Summary zeigte nur "1x Sigenergy WR 20 kW". Fuer die Projektdoku braucht der
// Montagepartner Modell (Energy Controller vs. Hybrid-WR) und ob hybrid. Namen aus dem
// sevdesk-Katalog (06-08-2026_SEVDESK_Auszug_alle_Produkte-.csv).
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJEKT = path.join(__dirname, '..', '..', 'Sevdesk-Pipdrive_sync');
const ctx = vm.createContext({ Logger: { log: () => {} }, console });
vm.runInContext(fs.readFileSync(path.join(PROJEKT, 'fieldkeysandmapping.js'), 'utf8'), ctx);

let bestanden = 0, fehlgeschlagen = 0;
function pruefe(beschreibung, ist, soll) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  console.log(`  ${ok ? 'OK  ' : 'FEHL'} ${beschreibung}` +
              (ok ? '' : `\n       erwartet: ${JSON.stringify(soll)}\n       bekommen: ${JSON.stringify(ist)}`));
  ok ? bestanden++ : fehlgeschlagen++;
}

const agg = p => vm.runInContext('aggregatePositions', ctx)(p);
const wr = name => agg([{ name, quantity: 1, einzelpreisNetto: 1000 }]).summary;

console.log('\nWR-Kurzname je Hersteller');
pruefe('Sigenergy Energy Controller', wr('SIGENERGY Energy Controller 20kW'), '1x Sigenergy Energy Controller 20kW (Hybrid)');
pruefe('Sigenergy Hybrid-WR', wr('SIGENERGY Hybrid Wechselrichter 12.0 kW TP2 dreiphasig'), '1x Sigenergy Hybrid WR 12.0 kW TP2 3ph');
pruefe('Fronius GEN24', wr('FRONIUS Symo GEN24 10.0 Plus'), '1x Fronius WR Symo GEN24 10.0 Plus (Hybrid)');
pruefe('SolaX Hybrid', wr('SOLAX WR X3-HYBRID-12.0-D G4.2'), '1x SolaX WR X3-HYBRID-12.0-D G4.2');
pruefe('Sofar HYD', wr('SOFARSOLAR WR-HYD 20KTL-3PH'), '1x SofarSolar WR-HYD 20KTL-3PH (Hybrid)');
pruefe('Growatt MOD (kein Hybrid)', wr('GROWATT MOD 10KTL'), '1x Growatt WR MOD 10KTL');

console.log('\nWR-Felder bleiben unveraendert');
{
  const r = agg([{ name: 'SIGENERGY Energy Controller 20kW', quantity: 1, einzelpreisNetto: 3000 }]);
  pruefe('WR_Leistung_kW', r.fields.WR_Leistung_kW, '20 kW');
  pruefe('System_Marke', r.fields.System_Marke, 'Sigenergy');
}

console.log('\nRealer Fall (Summary vom 25.09.2026)');
{
  const r = agg([
    { name: 'AIKO NEOSTAR 490Wp GLAS-GLAS', quantity: 30, einzelpreisNetto: 100 },
    { name: 'SIGENERGY Energy Controller 20kW', quantity: 1, einzelpreisNetto: 3000 },
    { name: 'SIGENERGY Batteriemodul 10.0 kWh', quantity: 2, einzelpreisNetto: 3000 }
  ]);
  pruefe('Summary', r.summary, '30x Aiko 490Wp | 1x Sigenergy Energy Controller 20kW (Hybrid) | 2x Sigenergy Speicher 10.0 kWh (Σ20.0kWh)');
}

console.log(`\n${bestanden} OK, ${fehlgeschlagen} FEHL`);
process.exit(fehlgeschlagen ? 1 : 0);
