// Throwaway-Test der reinen Funktionen aus PhoneFormat.gs + ExistenceCheck.gs.
// Kein Apps-Script-API nötig, läuft in node.
const fs = require('fs');
const BASE = 'C:/Users/valen/OneDrive/Documents/RP/Claude_Work_RP/RP-Google-Scripts/Telefon-Qualifizierung/';

// PhoneFormat komplett laden
eval(fs.readFileSync(BASE + 'PhoneFormat.gs', 'utf8'));
// Aus ExistenceCheck nur die reine Statusdeutung herausschneiden (Rest braucht Apps-Script-APIs)
const ec = fs.readFileSync(BASE + 'ExistenceCheck.gs', 'utf8');
eval(ec.slice(ec.indexOf('const LINE_STATUS_NEGATIV'), ec.indexOf('function checkPhoneExistence')));

let fehler = 0;
function pruefe(bezeichnung, ist, soll) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log((ok ? 'OK   ' : 'FEHLT') + ' | ' + bezeichnung + ' | ist=' + JSON.stringify(ist) + (ok ? '' : ' | soll=' + JSON.stringify(soll)));
}

console.log('--- Platzhalter-Erkennung ---');
pruefe('Hakenschmidt 01234565649 -> Fake', wirktPlatzhalterhaft('01234565649'), true);
pruefe('0000000000 -> Fake', wirktPlatzhalterhaft('0000000000'), true);
pruefe('1111111111 -> Fake', wirktPlatzhalterhaft('1111111111'), true);
pruefe('9876543210 -> Fake', wirktPlatzhalterhaft('9876543210'), true);
pruefe('Firmenzentrale +43 1 500 0000 (6 Nullen) -> KEIN Fake', wirktPlatzhalterhaft('+43 1 500 0000'), false);
pruefe('echte Mobil +436769013373 -> KEIN Fake', wirktPlatzhalterhaft('+436769013373'), false);
pruefe('echte Mobil +436644301661 -> KEIN Fake', wirktPlatzhalterhaft('+436644301661'), false);
pruefe('DE-Lead +4917683201565 -> KEIN Fake', wirktPlatzhalterhaft('+4917683201565'), false);
pruefe('leer -> KEIN Fake', wirktPlatzhalterhaft(''), false);
pruefe('null -> KEIN Fake', wirktPlatzhalterhaft(null), false);

console.log('\n--- Normalisierung / wurdeVeraendert ---');
let r = normalizeAustrianPhone('+436769013373');
pruefe('sauber +43: formatOk', r.formatOk, true);
pruefe('sauber +43: nicht veraendert', r.wurdeVeraendert, false);
pruefe('sauber +43: mobil erkannt', r.lineTypeGuess, 'mobil');

r = normalizeAustrianPhone('0676 9013373');
pruefe('national 0676: formatOk', r.formatOk, true);
pruefe('national 0676: normalisiert', r.normalized, '+436769013373');
pruefe('national 0676: als korrigiert markiert', r.wurdeVeraendert, true);

r = normalizeAustrianPhone('+43 676 901 33 73');
pruefe('nur Leerzeichen: NICHT als korrigiert markiert', r.wurdeVeraendert, false);

r = normalizeAustrianPhone('+43');
pruefe('Michael-Fall "+43": formatOk=false', r.formatOk, false);
pruefe('Michael-Fall "+43": Grund nennt Laenge', /Länge unplausibel/.test(r.reason), true);

r = normalizeAustrianPhone('+4917683201565');
pruefe('DE-Lead: formatOk (Ausland)', r.formatOk, true);
pruefe('DE-Lead: lineType Ausland', r.lineTypeGuess, 'Ausland');
pruefe('DE-Lead: nicht umgeschrieben', r.normalized, '+4917683201565');

r = normalizeAustrianPhone('0043 0664 1234567');
pruefe('0043 + nationale Null: normalisiert', r.normalized, '+436641234567');
pruefe('0043 + nationale Null: als korrigiert markiert', r.wurdeVeraendert, true);

r = normalizeAustrianPhone('01234565649');
pruefe('Hakenschmidt: platzhalterVerdacht gesetzt', r.platzhalterVerdacht, true);

r = normalizeAustrianPhone('');
pruefe('leere Nummer: formatOk=false', r.formatOk, false);
r = normalizeAustrianPhone('keine Ahnung');
pruefe('Text ohne Ziffern: formatOk=false', r.formatOk, false);

console.log('\n--- Line-Status-Deutung ---');
pruefe('active -> true', deuteLineStatus('active'), true);
pruefe('Active (Grossschreibung) -> true', deuteLineStatus('Active'), true);
pruefe('inactive -> false', deuteLineStatus('inactive'), false);
pruefe('disconnected -> false', deuteLineStatus('disconnected'), false);
pruefe('unknown -> null (unklar)', deuteLineStatus('unknown'), null);
pruefe('undefined -> null (unklar)', deuteLineStatus(undefined), null);
pruefe('kuenftiger neuer Wert -> null (unklar)', deuteLineStatus('ported_out'), null);

console.log('\n' + (fehler === 0 ? 'ALLE TESTS OK' : fehler + ' TEST(S) FEHLGESCHLAGEN'));
