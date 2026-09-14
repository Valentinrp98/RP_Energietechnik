// ============================================================================
// Lokaler Node-Test: REGIE-Positionen duerfen die Pauschale-Felder NICHT fuellen (11.09.2026)
// Ausfuehren:  node _tests/Sevdesk-Pipdrive_sync/test-regie-vs-pauschale.js
//
// Hintergrund: sevdesk verrechnet Montage entweder pauschal ("2.400 EUR, fertig") oder nach
// Aufwand ("89 EUR pro Stunde, Summe offen"). Im Positionspreis sieht man den Unterschied
// NICHT -- nur in der Einheit (unity.id 9 = Stunde) bzw. im Namen ("(REGIE)").
// Vor dem Fix schrieb der Sync den Stundensatz als Pauschalbetrag ins Deal-Feld: Order
// 30321086 bekam "Montage Pauschale EUR = 89", gemeint waren 89 EUR/Stunde.
// Diese Tests halten die Regel fest: im Zweifel LEER statt falsch.
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

// --- 1. Der reale Fall aus Order 30321086 -----------------------------------
console.log('\nREGIE erkannt ueber unity.id = 9 (Stunde)');
{
  const r = agg([
    { name: 'MONTAGEARBEITEN (REGIE)', quantity: 1, einzelpreisNetto: 89, einheitId: 9 },
    { name: 'ELEKTROINSTALLATION (REGIE)', quantity: 1, einzelpreisNetto: 89, einheitId: 9 },
    { name: 'ELEKTROINSTALLATIONSMATERIAL (PAUSCHAL)', quantity: 1, einzelpreisNetto: 890, einheitId: 7 },
    { name: 'TECHNISCHE PROJEKTIERUNG', quantity: 1, einzelpreisNetto: 990, einheitId: 1 }
  ]);
  pruefe('Montage bleibt leer statt 89 (Stundensatz)', r.fields.Montage_Pauschale_EUR, null);
  pruefe('Elektroinstallation bleibt leer statt 89', r.fields.Elektroinstallation_Pauschale_EUR, null);
  pruefe('Elektromaterial (Pauschale) wird normal geschrieben', r.fields.Elektromaterial_Pauschale_EUR, 890);
  pruefe('Projektierung (Stueck) wird normal geschrieben', r.fields.Technische_Projektierung_Pauschale_EUR, 990);
  pruefe('Stundensatz geht nicht verloren, sondern steht in der Summary',
         /Montage REGIE 89€\/Std/.test(r.montageSummary), true);
}

// --- 2. Der Name allein reicht auch, falls die Einheit fehlt ----------------
console.log('\nREGIE erkannt ueber den Namen, wenn unity fehlt');
{
  const r = agg([{ name: 'MONTAGEARBEITEN (REGIE)', quantity: 1, einzelpreisNetto: 89, einheitId: null }]);
  pruefe('ohne Einheit greift das Namensmuster', r.fields.Montage_Pauschale_EUR, null);
}

// --- 3. Gegenprobe: Pauschalen duerfen NICHT mitgesperrt werden -------------
console.log('\nPauschale bleibt unveraendert (keine Uebersperrung)');
{
  const r = agg([
    { name: 'MONTAGEARBEITEN (PAUSCHAL)', quantity: 1, einzelpreisNetto: 2400, einheitId: 7 },
    { name: 'ELEKTROINSTALLATION', quantity: 1, einzelpreisNetto: 1400, einheitId: 1 }
  ]);
  pruefe('Montage-Pauschale wird geschrieben', r.fields.Montage_Pauschale_EUR, 2400);
  pruefe('Elektroinstallation wird geschrieben', r.fields.Elektroinstallation_Pauschale_EUR, 1400);
  pruefe('Summary ohne REGIE-Zusatz', /REGIE/.test(r.montageSummary), false);
}

// --- 4. "PAUSCHAL PRO KW": Menge x Preis, muss weiter multipliziert werden --
console.log('\nPauschal pro kWp rechnet weiter mit Menge');
{
  const r = agg([{ name: 'MONTAGEARBEITEN (PAUSCHAL PRO KW)', quantity: 19.6, einzelpreisNetto: 120, einheitId: 1 }]);
  pruefe('19.6 kWp x 120 EUR = 2352', r.fields.Montage_Pauschale_EUR, 2352);
}

// --- 5. Der zuvor unbekannte Artikel aus Order 30321086 ---------------------
console.log('\nSIGENERGY EMS Integration ist kein "[?]" mehr');
{
  const r = agg([{ name: 'SIGENERGY EMS Integration', quantity: 1, einzelpreisNetto: 1200, einheitId: 1 }]);
  pruefe('landet nicht mehr in unknownArticles', r.unknownArticles, []);
  pruefe('taucht nicht mehr als [?] in der Summary auf', /\[\?\]/.test(r.summary), false);
}
// Gegenprobe: die Unbekannt-Erkennung als solche muss weiter funktionieren
{
  const r = agg([{ name: 'VOELLIG NEUES BAUTEIL XY', quantity: 1, einzelpreisNetto: 100, einheitId: 1 }]);
  pruefe('echte Unbekannte werden weiterhin gemeldet', r.unknownArticles.length, 1);
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);
