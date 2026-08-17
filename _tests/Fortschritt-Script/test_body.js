// ===== TESTS =====
let _ok = 0, _fail = 0;
function pruefe(name, ist, soll) {
  if (JSON.stringify(ist) === JSON.stringify(soll)) { _ok++; console.log(`  ok   ${name}`); }
  else { _fail++; console.log(`  FAIL ${name}\n       ist:  ${JSON.stringify(ist)}\n       soll: ${JSON.stringify(soll)}`); }
}

const T_HEUTE = heuteIso();
const T_GESTERN = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return Utilities.formatDate(d, '', 'yyyy-MM-dd'); })();
const T_MORGEN = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return Utilities.formatDate(d, '', 'yyyy-MM-dd'); })();

function tDeal(cf, extra) {
  return Object.assign({ id: 1, title: 'Testdeal', stage_id: 999, custom_fields: cf || {} }, extra || {});
}
function tErfuellte(d, betreffe) { return erledigtRegeln().filter(r => r.quelle(d, betreffe || [])); }
function tText(d, betreffe) { return baueFortschrittText(d, tErfuellte(d, betreffe)).text; }

console.log('\n=== Fortschritt-Text ===');
pruefe('0/11: kein letzter Schritt, kein wa:', tText(tDeal({})), '▱▱▱▱▱▱▱▱▱▱▱ 0/11');

pruefe('Beispiel aus dem Plan', tText(tDeal({
  [NETZSTATUS_FIELD_KEY]: NETZSTATUS_ZAEHLPUNKT_DA,  // Netz übergeben + Zählpunkt da
  [AR_VERSENDET_FIELD_KEY]: AR_VERSENDET_JA,
  [ZAHLUNGSEINGANG_FIELD_KEY]: ZAHLUNGSEINGANG_JA,
  [WARTET_AUF_FIELD_KEY]: 172
})), '▰▰▰▰▱▱▱▱▱▱▱ 4/11 · ✓ Anzahlung da · wa:Kunde');

const T_ALLE = {
  [NETZSTATUS_FIELD_KEY]: NETZSTATUS_FERTIGMELDUNG_RAUS,
  [AR_VERSENDET_FIELD_KEY]: AR_VERSENDET_JA,
  [ZAHLUNGSEINGANG_FIELD_KEY]: ZAHLUNGSEINGANG_JA,
  [LIEFERTERMIN_FIELD_KEY]: T_GESTERN,
  [AC_TERMIN_FIELD_KEY]: T_GESTERN,
  [IB_TERMIN_FIELD_KEY]: T_HEUTE,
  [FOERDERZUSAGE_FIELD_KEY]: FOERDERZUSAGE_JA,
  [FERTIGMELDUNG_AM_FIELD_KEY]: T_GESTERN
};
pruefe('11/11 bekommt Haken statt letztem Schritt',
  tText(tDeal(T_ALLE), ['Erstgespräch', 'Zweitgespräch']), '▰▰▰▰▰▰▰▰▰▰▰ 11/11 ✓');
pruefe('11/11 unterdrueckt auch wa:',
  tText(tDeal(Object.assign({ [WARTET_AUF_FIELD_KEY]: 172 }, T_ALLE)), ['Erstgespräch', 'Zweitgespräch']),
  '▰▰▰▰▰▰▰▰▰▰▰ 11/11 ✓');
pruefe('Hakerl markiert den letzten ERLEDIGTEN Meilenstein',
  tText(tDeal({ [NETZSTATUS_FIELD_KEY]: 183 })), '▰▱▱▱▱▱▱▱▱▱▱ 1/11 · ✓ Netz übergeben');
pruefe('bei 0/11 kein Hakerl (es gibt keinen erledigten Schritt)',
  /✓/.test(tText(tDeal({}))), false);
pruefe('Balken ist immer 11 Zeichen lang',
  [0, 4, 11].map(n => (BALKEN_VOLL.repeat(n) + BALKEN_LEER.repeat(11 - n)).length), [11, 11, 11]);

console.log('\n=== Sonderzustände (ein Stage 24, getrennt über die Grund-Felder) ===');
const S_STAGE = { stage_id: STAGE_ID_VERSCHOBEN_STORNIERT };
pruefe('Stornogrund gesetzt -> Storniert',
  tText(tDeal({ [STORNOGRUND_FIELD_KEY]: 213 }, S_STAGE)), '✖ Storniert');
pruefe('Verschiebegrund gesetzt -> Verschoben',
  tText(tDeal({ [VERSCHIEBEGRUND_FIELD_KEY]: 219 }, S_STAGE)), '⏸ Verschoben');
pruefe('nur "Verschoben auf" gesetzt -> Verschoben',
  tText(tDeal({ [VERSCHOBEN_AUF_FIELD_KEY]: '2027-03-01' }, S_STAGE)), '⏸ Verschoben');
pruefe('kein Grund gesetzt -> neutraler Sammelzustand',
  tText(tDeal({}, S_STAGE)), '⏸✖ Verschoben/storniert');
pruefe('Storno schlägt Verschiebung',
  tText(tDeal({ [STORNOGRUND_FIELD_KEY]: 212, [VERSCHIEBEGRUND_FIELD_KEY]: 219 }, S_STAGE)), '✖ Storniert');
pruefe('Sonderzustand ersetzt den Balken komplett (auch bei erfüllten Regeln)',
  tText(tDeal({ [NETZSTATUS_FIELD_KEY]: 186, [STORNOGRUND_FIELD_KEY]: 213 }, S_STAGE)), '✖ Storniert');
pruefe('anderer Stage -> normaler Balken',
  tText(tDeal({ [STORNOGRUND_FIELD_KEY]: 213 }, { stage_id: 22 })), '▱▱▱▱▱▱▱▱▱▱▱ 0/11');
pruefe('istStage() mit String-Stage-ID vom Deal trifft auch', istStage(tDeal({}, { stage_id: '24' }), 24), true);

console.log('\n=== Datumsregeln ===');
pruefe('heute  -> greift', tErfuellte(tDeal({ [LIEFERTERMIN_FIELD_KEY]: T_HEUTE })).map(r => r.label), ['Geliefert']);
pruefe('morgen -> greift nicht', tErfuellte(tDeal({ [LIEFERTERMIN_FIELD_KEY]: T_MORGEN })).map(r => r.label), []);
pruefe('Datum+Uhrzeit wird gekuerzt',
  tErfuellte(tDeal({ [LIEFERTERMIN_FIELD_KEY]: T_GESTERN + ' 14:30:00' })).map(r => r.label), ['Geliefert']);
pruefe('deutsches Datumsformat wird nicht geraten',
  tErfuellte(tDeal({ [LIEFERTERMIN_FIELD_KEY]: '31.12.2026' })).map(r => r.label), []);
pruefe('leerer String greift nicht',
  tErfuellte(tDeal({ [LIEFERTERMIN_FIELD_KEY]: '   ' })).map(r => r.label), []);

console.log('\n=== ODER-Regeln ===');
pruefe('ZPN gefuellt -> Zaehlpunkt da ohne Netzstatus',
  tErfuellte(tDeal({ [ZPN_FIELD_KEY]: 'AT003000...' })).map(r => r.label), ['Zählpunkt da']);
pruefe('ZPN nur Leerzeichen -> greift nicht',
  tErfuellte(tDeal({ [ZPN_FIELD_KEY]: '  ' })).map(r => r.label), []);
pruefe('Netzstatus 183 -> nur Netz uebergeben',
  tErfuellte(tDeal({ [NETZSTATUS_FIELD_KEY]: 183 })).map(r => r.label), ['Netz übergeben']);
pruefe('Netzstatus 186 -> Netz uebergeben UND Zaehlpunkt da',
  tErfuellte(tDeal({ [NETZSTATUS_FIELD_KEY]: 186 })).map(r => r.label), ['Netz übergeben', 'Zählpunkt da']);
pruefe('Foerderstatus 193 allein -> Foerderzusage',
  tErfuellte(tDeal({ [FOERDERSTATUS_FIELD_KEY]: FOERDERSTATUS_ABGERECHNET })).map(r => r.label), ['Förderzusage']);
pruefe('Foerderstatus 192 (nicht hinterlegt) -> nichts',
  tErfuellte(tDeal({ [FOERDERSTATUS_FIELD_KEY]: 192 })).map(r => r.label), []);

console.log('\n=== Aktivitaets-Betreffe (Fulfillment, nicht Sales) ===');
pruefe('"Erstgespräch" trifft', tErfuellte(tDeal({}), ['Erstgespräch']).map(r => r.label), ['Erstgespräch']);
pruefe('"Erstgespräch Fulfillment" trifft (Teilstring)',
  tErfuellte(tDeal({}), ['Erstgespräch Fulfillment']).map(r => r.label), ['Erstgespräch']);
pruefe('"ERSTGESPRAECH" ohne Umlaut trifft',
  tErfuellte(tDeal({}), ['ERSTGESPRAECH Kunde']).map(r => r.label), ['Erstgespräch']);
pruefe('"Zweitgespräch" trifft nur Regel 7',
  tErfuellte(tDeal({}), ['Zweitgespräch']).map(r => r.label), ['Zweitgespräch']);
pruefe('beide Gespräche -> beide Regeln',
  tErfuellte(tDeal({}), ['Erstgespräch', 'Zweitgespräch']).map(r => r.label), ['Erstgespräch', 'Zweitgespräch']);

// Regression: die real vorhandenen SALES-Betreffe (gemessen 2026-08-17, 405 verschiedene) duerfen
// den Fulfillment-Fortschritt NICHT beeinflussen. Ein Zwischenstand hat "Besichtigung" und
// "Abschlusstermin" gematcht -- das war falsch.
['Besichtigung', 'Abschlusstermin', 'Finalisierung', 'Ersttermin', 'Vorquali', 'Ausgehender Anruf',
 'Anrufen', 'Angebot nachrufen', 'Follow up call', 'Terminerinnerung', 'Termin vereinbaren',
 'Angebot senden', 'Projektübergabe/ Fulfillment', 'Auftragsübergabe'].forEach(b => {
  pruefe(`Sales-Betreff "${b}" zaehlt NICHT`, tErfuellte(tDeal({}), [b]).map(r => r.label), []);
});

pruefe('Beleg enthaelt den echten Betreff',
  belegAusAktivitaet(['Erstgespräch am 3.5. mit Herrn M.'], MUSTER_ERSTGESPRAECH),
  'Aktivität: "Erstgespräch am 3.5. mit Herrn M."');
pruefe('Einzelmuster als String funktioniert weiterhin',
  belegAusAktivitaet(['Erstgespräch'], 'erstgespräch'), 'Aktivität: "Erstgespräch"');

console.log('\n=== Optionswert-Formen ===');
pruefe('Zahl',               leseOptionIds(tDeal({ x: 183 }), 'x'), [183]);
pruefe('Array von Zahlen',   leseOptionIds(tDeal({ x: [183, 184] }), 'x'), [183, 184]);
pruefe('Objekt mit id',      leseOptionIds(tDeal({ x: { id: 183 } }), 'x'), [183]);
pruefe('Array von Objekten', leseOptionIds(tDeal({ x: [{ id: 183 }, { id: 184 }] }), 'x'), [183, 184]);
pruefe('Zahl als String',    leseOptionIds(tDeal({ x: '183' }), 'x'), [183]);
pruefe('null -> []',         leseOptionIds(tDeal({ x: null }), 'x'), []);
pruefe('fehlt -> []',        leseOptionIds(tDeal({}), 'x'), []);

console.log('\n=== unbekannte "Wartet auf"-Option blockiert den Write ===');
const T_WA = baueFortschrittText(tDeal({ [WARTET_AUF_FIELD_KEY]: 999 }), []);
pruefe('kein Text gebildet', T_WA.text, null);
pruefe('Konfigfehler nennt die ID', /999/.test(T_WA.konfigFehler || ''), true);

console.log('\n=== PATCH-Nutzlast-Guard ===');
pruefe('leeres Objekt -> Fehler', /leer/.test(pruefePatchNutzlast({}) || ''), true);
pruefe('undefined-Wert wird gefangen', /verloren/.test(pruefePatchNutzlast({ a: undefined }) || ''), true);
pruefe('null ist erlaubt (set leeren)', pruefePatchNutzlast({ a: null }), null);
pruefe('normale Nutzlast ok', pruefePatchNutzlast({ a: [223, 227], b: 'text' }), null);

console.log('\n=== DIFF-PFLICHT / Idempotenz (Testplan Schritt 9) ===');
function tLauf(cf, betreffe) {
  logs = []; _logBuffer = [];
  const ctx = neuerKontext('test');
  verarbeiteDeal(tDeal(cf), betreffe || [], ctx);
  return { ctx: ctx, zeilen: _logBuffer.length };
}
const T_KORREKT = {
  [NETZSTATUS_FIELD_KEY]: NETZSTATUS_ZAEHLPUNKT_DA,
  [AR_VERSENDET_FIELD_KEY]: AR_VERSENDET_JA,
  [ZAHLUNGSEINGANG_FIELD_KEY]: ZAHLUNGSEINGANG_JA,
  [WARTET_AUF_FIELD_KEY]: 172,
  [ERLEDIGT_FIELD_KEY]: [224, 225, 226, 227],
  [FORTSCHRITT_FIELD_KEY]: '▰▰▰▰▱▱▱▱▱▱▱ 4/11 · ✓ Anzahlung da · wa:Kunde'
};
const A = tLauf(T_KORREKT);
pruefe('unveraendert = 1', A.ctx.zaehler.unveraendert, 1);
pruefe('dryRun = 0 (kein Write)', A.ctx.zaehler.dryRun, 0);
pruefe('keine Log-Zeile', A.zeilen, 0);

pruefe('Ist-Reihenfolge egal -> weiterhin unveraendert',
  tLauf(Object.assign({}, T_KORREKT, { [ERLEDIGT_FIELD_KEY]: [227, 224, 226, 225] })).ctx.zaehler.unveraendert, 1);
pruefe('Ist-Werte als Objekte -> weiterhin unveraendert',
  tLauf(Object.assign({}, T_KORREKT, {
    [ERLEDIGT_FIELD_KEY]: [{ id: 224 }, { id: 225 }, { id: 226 }, { id: 227 }]
  })).ctx.zaehler.unveraendert, 1);

const B = tLauf(Object.assign({}, T_KORREKT, { [ERLEDIGT_FIELD_KEY]: [224, 225, 226] }));
pruefe('fehlender Haken -> dryRun = 1', B.ctx.zaehler.dryRun, 1);
pruefe('fehlender Haken -> genau 1 Log-Zeile', B.zeilen, 1);
pruefe('"ausgeloest durch" nennt Regel + Beleg',
  _logBuffer[0][8], '+ Anzahlung da ← Zahlungseingang erhalten=207');
pruefe('vorher/nachher als Labels', [_logBuffer[0][4], _logBuffer[0][5]],
  ['Netz übergeben, Zählpunkt da, AR raus', 'Netz übergeben, Zählpunkt da, AR raus, Anzahlung da']);

tLauf(Object.assign({}, T_KORREKT, { [ERLEDIGT_FIELD_KEY]: [224, 225, 226, 227, 233] }));
pruefe('entfallener Haken wird als "−" ausgewiesen', /− Fertigmeldung/.test(_logBuffer[0][8]), true);

tLauf(Object.assign({}, T_KORREKT, { [FORTSCHRITT_FIELD_KEY]: 'alter Mist' }));
pruefe('nur Text abweichend -> eigener Hinweis', _logBuffer[0][8], 'nur Fortschritt-Text neu berechnet');

const C = tLauf({ [ERLEDIGT_FIELD_KEY]: [224], [FORTSCHRITT_FIELD_KEY]: 'irgendwas' });
pruefe('alle Quellen leer -> Haken wird entfernt, 1 Aenderung', C.ctx.zaehler.dryRun, 1);
pruefe('leerer Soll-Set fuehrt zu 0/11-Text', _logBuffer[0][7], '▱▱▱▱▱▱▱▱▱▱▱ 0/11');

console.log('\n=== autocomplete-Felder: Werte kommen als Label-String ===');
// Lehre aus Sheet-Sync (2026-08-17): eine Options-Liste beweist nicht, dass es ein enum ist.
// autocomplete-Felder liefern das Label. Ohne Registry-Auflösung würde Number("Zählpunkt da")
// NaN ergeben, die Regel nie greifen -- und der Lauf sähe mit lauter 0/11 gesund aus.
setzeOptionRegistry({
  [NETZSTATUS_FIELD_KEY]: {
    name: 'Netzstatus',
    labels: { 182: 'offen', 183: 'übergeben', 184: 'eingereicht', 185: 'Zählpunkt da', 186: 'Fertigmeldung raus' }
  },
  [WARTET_AUF_FIELD_KEY]: { name: 'Wartet auf', labels: { 172: 'Kunde' } }
});
pruefe('Label "Zählpunkt da" -> Netz übergeben UND Zählpunkt da',
  tErfuellte(tDeal({ [NETZSTATUS_FIELD_KEY]: 'Zählpunkt da' })).map(r => r.label),
  ['Netz übergeben', 'Zählpunkt da']);
pruefe('Label "übergeben" -> nur Netz übergeben',
  tErfuellte(tDeal({ [NETZSTATUS_FIELD_KEY]: 'übergeben' })).map(r => r.label), ['Netz übergeben']);
pruefe('Label case/Umlaut-tolerant',
  tErfuellte(tDeal({ [NETZSTATUS_FIELD_KEY]: 'ZAEHLPUNKT DA' })).map(r => r.label),
  ['Netz übergeben', 'Zählpunkt da']);
pruefe('Wartet-auf als Label wird aufgelöst',
  tText(tDeal({ [NETZSTATUS_FIELD_KEY]: 'übergeben', [WARTET_AUF_FIELD_KEY]: 'Kunde' })),
  '▰▱▱▱▱▱▱▱▱▱▱ 1/11 · ✓ Netz übergeben · wa:Kunde');
starteDatenqualitaet();
pruefe('unbekanntes Label -> nicht erfüllt',
  tErfuellte(tDeal({ [NETZSTATUS_FIELD_KEY]: 'Voll kaputt' })).map(r => r.label), []);
pruefe('unbekanntes Label wird als Datenqualität gemeldet',
  /Netzstatus: Wert "Voll kaputt"/.test((holeDatenqualitaet()[0] || '')), true);
pruefe('numerische IDs funktionieren weiterhin',
  tErfuellte(tDeal({ [NETZSTATUS_FIELD_KEY]: 185 })).map(r => r.label), ['Netz übergeben', 'Zählpunkt da']);
setzeOptionRegistry({}); // zurücksetzen, damit die folgenden Tests unbeeinflusst laufen

console.log('\n=== CUTOFF (Altbestand nicht anfassen) ===');
function tCutoffLauf(addTime, dealId) {
  logs = []; _logBuffer = [];
  const ctx = neuerKontext('test');
  const d = tDeal({ [NETZSTATUS_FIELD_KEY]: 183 }, { add_time: addTime, id: dealId || 999999 });
  verarbeiteDeal(d, [], ctx);
  return { zaehler: ctx.zaehler, zeilen: _logBuffer.length };
}
const T_ALT = '2024-01-01 10:00:00';
const T_NEU = '2026-08-01 10:00:00';

pruefe('Deal vor CUTOFF -> uebersprungen', tCutoffLauf(T_ALT).zaehler.vorCutoff, 1);
pruefe('vor CUTOFF -> nichts geschrieben', tCutoffLauf(T_ALT).zaehler.dryRun, 0);
pruefe('vor CUTOFF -> keine Log-Zeile', tCutoffLauf(T_ALT).zeilen, 0);
pruefe('Deal nach CUTOFF -> normal verarbeitet', tCutoffLauf(T_NEU).zaehler.dryRun, 1);
pruefe('ohne add_time -> normal verarbeitet (nicht stillschweigend ausschliessen)',
  tCutoffLauf(undefined).zaehler.dryRun, 1);

// Ausnahmeliste muss den Cutoff schlagen -- sonst kann man laufende Altprojekte nicht dazunehmen.
pruefe('Ausnahme-Deal laeuft trotz CUTOFF mit',
  tCutoffLauf(T_ALT, CUTOFF_AUSNAHMEN[0]).zaehler.dryRun, 1);
pruefe('Ausnahme wird als solche gezaehlt',
  tCutoffLauf(T_ALT, CUTOFF_AUSNAHMEN[0]).zaehler.viaAusnahme, 1);
pruefe('Ausnahme zaehlt NICHT als vorCutoff',
  tCutoffLauf(T_ALT, CUTOFF_AUSNAHMEN[0]).zaehler.vorCutoff, 0);
pruefe('Ausnahme-ID als String eingetragen trifft auch',
  istCutoffAusnahme(String(CUTOFF_AUSNAHMEN[0])), true);
pruefe('fremde ID ist keine Ausnahme', istCutoffAusnahme(123456), false);

console.log('\n=== SOFT_ERROR: unlesbare Quellwerte ===');
const S1 = tLauf({ [LIEFERTERMIN_FIELD_KEY]: '31.12.2026' });
pruefe('deutsches Datum -> softError = 1', S1.ctx.zaehler.softError, 1);
pruefe('kein hardError daraus', S1.ctx.zaehler.hardError, 0);
pruefe('Rohwert wird mitgemeldet', /31\.12\.2026/.test(S1.ctx.datenqualitaet[0] || ''), true);
pruefe('Feldname wird genannt', /Liefertermin/.test(S1.ctx.datenqualitaet[0] || ''), true);
pruefe('Deal wird trotzdem verarbeitet', S1.ctx.zaehler.dryRun, 1);
pruefe('gueltiges Datum -> kein softError',
  tLauf({ [LIEFERTERMIN_FIELD_KEY]: T_GESTERN }).ctx.zaehler.softError, 0);

// Sammler muss pro Deal zurueckgesetzt werden, sonst schleppt Deal 2 die Meldung von Deal 1 mit.
const S3 = neuerKontext('test');
verarbeiteDeal(tDeal({ [LIEFERTERMIN_FIELD_KEY]: 'Bauer' }), [], S3);
verarbeiteDeal(tDeal({ [LIEFERTERMIN_FIELD_KEY]: T_GESTERN }), [], S3);
pruefe('Sammler wird pro Deal geleert (nur 1 softError)', S3.zaehler.softError, 1);
pruefe('Zusammenfassung erwaehnt SOFT_ERROR',
  /SOFT_ERROR \(unlesbare Quellwerte\)/.test(baueZusammenfassung(S3, false, 1, 'SOFT_ERROR').langtext), true);
pruefe('softError allein -> Status SOFT_ERROR', (() => {
  const c = neuerKontext('t'); c.zaehler.geprueft = 10; c.zaehler.softError = 2; c.verteilung = { 3: 10 };
  return bestimmeStatus(c, false);
})(), 'SOFT_ERROR');

console.log('\n=== Statistik / Ampel ===');
function tStatus(verteilung, geprueft, hardError) {
  const ctx = neuerKontext('test');
  ctx.verteilung = verteilung; ctx.zaehler.geprueft = geprueft; ctx.zaehler.hardError = hardError || 0;
  return bestimmeStatus(ctx, false);
}
pruefe('95% auf 0/11 -> KETTE_BLOCKIERT', tStatus({ 0: 95, 3: 5 }, 100), 'KETTE_BLOCKIERT');
pruefe('50% auf 0/11 -> OK', tStatus({ 0: 50, 3: 50 }, 100), 'OK');
pruefe('gar keine Deals -> KETTE_BLOCKIERT', tStatus({}, 0), 'KETTE_BLOCKIERT');
pruefe('HARD_ERROR schlaegt alles', tStatus({ 0: 95 }, 100, 1), 'HARD_ERROR');

// Regression: die Ampel muss gegen die AUSGEWERTETEN Deals rechnen, nicht gegen die geprueften.
// Vorher wurde durch geprueft geteilt -- bei aktivem CUTOFF konnte ein kompletter Nulllauf
// dadurch als OK durchgehen (genau der Montagepartner-Vorfall).
function tStatusCutoff(verteilung, geprueft, vorCutoff, abgebrochen) {
  const ctx = neuerKontext('test');
  ctx.verteilung = verteilung;
  ctx.zaehler.geprueft = geprueft;
  ctx.zaehler.vorCutoff = vorCutoff;
  return bestimmeStatus(ctx, abgebrochen || false);
}
pruefe('alle Deals per CUTOFF weg -> KETTE_BLOCKIERT (nicht OK)',
  tStatusCutoff({}, 440, 440), 'KETTE_BLOCKIERT');
pruefe('CUTOFF darf den 0/11-Anteil nicht verwaessern',
  tStatusCutoff({ 0: 38, 3: 2 }, 440, 400), 'KETTE_BLOCKIERT');
pruefe('CUTOFF aktiv, ausgewertete Deals gesund -> OK',
  tStatusCutoff({ 0: 5, 4: 35 }, 440, 400), 'OK');
pruefe('nichts ausgewertet, aber Lauf nur pausiert -> OK (noch nicht beurteilbar)',
  tStatusCutoff({}, 440, 440, true), 'OK');

const D = neuerKontext('test');
[0, 4, 4, 11].forEach(() => {});
verarbeiteDeal(tDeal({}), [], D);
verarbeiteDeal(tDeal(T_ALLE), ['Erstgespräch', 'Zweitgespräch'], D);
pruefe('Verteilung zaehlt beide Zaehlerstaende', [D.verteilung[0], D.verteilung[11]], [1, 1]);
pruefe('Regel-Treffer werden gezaehlt', D.regelTreffer['Fertigmeldung'], 1);
pruefe('Zusammenfassung nennt Verteilung',
  /Verteilung 0\/11:1, 11\/11:1/.test(baueZusammenfassung(D, false, 3, 'OK').kurztext), true);

console.log(`\n${_ok} ok, ${_fail} fehlgeschlagen\n`);
process.exit(_fail ? 1 : 0);
