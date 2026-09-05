// ============================================================
// Format-Check — kostenlos, offline, deterministisch korrigierbar
// ============================================================
// Deckt nur Formatfehler ab (fehlendes +43, führende Null, Tippfehler in der
// Struktur), NICHT ob die Nummer wirklich existiert -- das macht ExistenceCheck.gs.
// Bewusst kein libphonenumber-Import: die RP-Kundenbasis ist praktisch
// ausschließlich AT, ein schlankes Regelwerk reicht und bleibt wartbar.

// Österreichische Mobilvorwahlen (national, ohne +43) -- Stand 2026, Quelle RTR-Nummernplan.
// Reicht für den Format-Guess, nicht für eine Rechtsprüfung.
const AT_MOBIL_PRAEFIXE = ['650', '651', '652', '653', '654', '655', '656', '657', '658', '659',
  '660', '661', '663', '664', '665', '666', '667', '668', '669',
  '670', '676', '677', '678', '679',
  '680', '681', '688', '699'];

function ergebnis(raw, normalized, formatOk, reason, lineTypeGuess) {
  return {
    raw: raw,
    normalized: normalized,
    formatOk: formatOk,
    reason: reason,
    lineTypeGuess: lineTypeGuess,
    // true nur, wenn an der NUMMER etwas geändert wurde (Ländervorwahl ergänzt, führende
    // Null ersetzt, 0043 -> +43) -- steuert die Pipedrive-Rückmeldung "ja +(+43) ergänzt"
    // vs. schlichtes "ja".
    wurdeVeraendert: istInhaltlichVeraendert(raw, normalized)
  };
}

// Hier stand bis 05.09.2026 nur "normalized !== raw". Damit galt jede sauber, aber hübsch
// geschriebene Nummer ("+43 664 123 45 67") als korrigiert, weil beim Normalisieren die
// Leerzeichen wegfallen -- in Pipedrive wäre bei einem Großteil der Personen "ja +(+43)
// ergänzt" gelandet, obwohl an der Nummer nichts zu korrigieren war. Kosmetik zählt nicht.
function istInhaltlichVeraendert(raw, normalized) {
  if (normalized === null || typeof raw !== 'string') return false;
  const rohZiffern = raw.replace(/[^0-9]/g, '');
  const neueZiffern = normalized.replace(/[^0-9]/g, '');
  if (rohZiffern !== neueZiffern) return true; // Vorwahl ergänzt oder führende Null ersetzt
  return !raw.trim().startsWith('+');          // gleiche Ziffern, aber das "+" fehlte
}

function normalizeAustrianPhone(raw) {
  if (!raw || typeof raw !== 'string') {
    return ergebnis(raw, null, false, 'leer', 'unbekannt');
  }

  let digits = raw.trim();
  const hatPlus = digits.startsWith('+');
  digits = digits.replace(/[^\d]/g, ''); // Leerzeichen, Klammern, Bindestriche etc. raus

  if (!digits) {
    return ergebnis(raw, null, false, 'keine Ziffern enthalten', 'unbekannt');
  }

  // 00-Vorwahl ist gleichbedeutend mit +
  if (!hatPlus && digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (hatPlus) {
    // digits hat das + schon durch den Regex verloren, war aber vorhanden -> Ländercode direkt am Anfang
  } else if (digits.startsWith('0')) {
    // nationale Schreibweise: führende 0 durch Landescode ersetzen
    digits = '43' + digits.slice(1);
  } else if (!digits.startsWith('43')) {
    // weder 0 noch 43 noch + -> keine erkennbare AT-Nummer, evtl. Ausland ohne Präfix
    return ergebnis(raw, '+' + digits, false, 'kein AT-Präfix erkennbar (0, +43, 0043) -- evtl. Ausland oder unvollständig', 'unbekannt');
  }

  // Hier kommt nur an, wer mit + oder 00 geschrieben wurde (der Fall ohne beides ist oben
  // schon abgefangen) -- also eine formal saubere Auslandsnummer, z.B. ein DE-Lead. Das ist
  // KEIN Formatfehler, nur nichts, was wir nach AT-Regeln korrigieren könnten. Bis 05.09.2026
  // landeten solche Nummern als "Formatfehler" im Verdacht-Feld (der Setter liest das als
  // "Nummer kaputt") und bekamen nie einen Existenz-Check. Jetzt: durchlassen, prüfen lassen.
  if (!digits.startsWith('43')) {
    if (digits.length >= 8 && digits.length <= 15) {
      return ergebnis(raw, '+' + digits, true, 'ok (Auslandsnummer, keine AT-Regeln angewandt)', 'Ausland');
    }
    return ergebnis(raw, '+' + digits, false, 'kein AT-Präfix erkennbar und Länge unplausibel', 'unbekannt');
  }

  let national = digits.slice(2); // Rufnummer ohne Landescode
  // "+43 0664 ..." bzw. "0043 0664 ...": nach dem Landescode steht nochmal die nationale
  // Verkehrsausscheidungsziffer. Keine österreichische Vorwahl beginnt mit 0, die Null ist
  // also sicher überflüssig -- deterministisch entfernbar und zählt als echte Korrektur.
  if (national.startsWith('0')) {
    national = national.replace(/^0+/, '');
  }
  const normalized = '+43' + national;

  if (national.length < 6 || national.length > 12) {
    return ergebnis(raw, normalized, false, 'Länge unplausibel (' + national.length + ' Stellen nach +43)', 'unbekannt');
  }

  const praefix3 = national.slice(0, 3);
  const istMobilPraefix = AT_MOBIL_PRAEFIXE.indexOf(praefix3) !== -1;
  const lineTypeGuess = istMobilPraefix ? 'mobil' : (national.startsWith('1') ? 'festnetz (Wien)' : 'festnetz (Annahme)');

  return ergebnis(raw, normalized, true, 'ok', lineTypeGuess);
}
