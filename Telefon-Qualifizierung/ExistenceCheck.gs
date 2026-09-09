// ============================================================
// Existenz-Check — AbstractAPI "Phone Intelligence" (100 Lookups/Monat kostenlos)
// ============================================================
// GET https://phoneintelligence.abstractapi.com/v1/?api_key={KEY}&phone={NUMMER}
// Auth über Query-Param. Antwort ist VERSCHACHTELT (nicht flach wie in der älteren
// "Phone Validation API"-Doku beschrieben) -- verifiziert gegen eine echte Antwort vom
// 05.09.2026, nicht gegen die (veraltete) offizielle Doku-Seite:
//   phone_validation.is_valid (bool), phone_validation.line_status ("active"/...)
//   phone_carrier.name, phone_carrier.line_type ("mobile"/"landline"/...)
//   phone_risk.risk_level ("low"/"medium"/"high", KEIN Zahlenwert), phone_risk.is_abuse_detected
// "line_status" ist die eigentliche Existenzaussage -- "is_valid" heißt nur "syntaktisch
// plausibel" (das leistet unser eigener Format-Check schon kostenlos).

// Die Doku nennt nur Beispiele ("e.g. active, inactive"), keine vollständige Werteliste.
// Deshalb DREI Zustände statt zwei: nur ein explizit negativer Status ergibt "existiert nicht",
// alles Unbekannte (fehlendes Feld, "unknown", ein künftiger neuer Wert) ergibt null = unklar
// und wird von ermittleStatusOptionText() bewusst NICHT nach Pipedrive geschrieben.
// Vorher stand hier `line_status === 'active'`, womit jeder unbekannte Status zu einem harten
// "nein" wurde -- ein falsches "nein" ist teurer als kein Wert, weil der Setter einen echten
// Lead dann gar nicht anruft.
const LINE_STATUS_NEGATIV = ['inactive', 'disconnected', 'unallocated', 'invalid', 'not_in_service'];

function deuteLineStatus(status) {
  if (typeof status !== 'string') return null;
  const s = status.trim().toLowerCase();
  if (s === 'active') return true;
  if (LINE_STATUS_NEGATIV.indexOf(s) !== -1) return false;
  return null; // unklar -- lieber nichts behaupten
}

function checkPhoneExistence(e164Nummer) {
  const url = ABSTRACT_API_BASE + '?api_key=' + getAbstractApiKey() + '&phone=' + encodeURIComponent(e164Nummer);

  let antwort;
  try {
    antwort = fetchJsonWithRetry(url);
  } catch (err) {
    return { existiert: null, valide: null, lineType: null, carrier: null, riskLevel: null, abuseErkannt: null, fehler: err.message, rohantwort: null };
  }

  const validation = antwort.phone_validation || {};
  const carrier = antwort.phone_carrier || {};
  const risk = antwort.phone_risk || {};

  return {
    existiert: deuteLineStatus(validation.line_status),
    valide: validation.is_valid === true,
    lineType: carrier.line_type || null,
    carrier: carrier.name || null,
    riskLevel: risk.risk_level || null,
    abuseErkannt: risk.is_abuse_detected === true,
    fehler: null,
    rohantwort: antwort
  };
}

// ▷-Button-Falle (steht in RP-Google-Scripts/CLAUDE.md): der Editor ruft Funktionen ohne
// Parameter auf. Deshalb hier zum Ändern statt als Funktionsargument -- vor dem Start eintragen.
const TEST_NUMMER = '+436769013373';

// Einzelfall-Test vor dem Vollauf -- 1 echter, kostenloser (Freikontingent) API-Call, Rohantwort
// komplett ins Log. Erst hiermit prüfen, ob der Key funktioniert und die Antwortfelder wirklich
// so heißen wie oben angenommen, dann erst richteTaeglichenTriggerEin() laufen lassen.
function testEinzelneNummer() {
  if (!TEST_NUMMER) {
    throw new Error('TEST_NUMMER in ExistenceCheck.gs ist leer -- oben eine echte Nummer eintragen (z.B. "+43664...."), dann nochmal starten.');
  }
  const format = normalizeAustrianPhone(TEST_NUMMER);
  Logger.log('Format-Check: %s', JSON.stringify(format));
  if (!format.formatOk) {
    Logger.log('Format nicht OK -- Existenz-Check trotzdem versucht, aber Ergebnis mit Vorsicht lesen.');
  }
  const existenz = checkPhoneExistence(format.normalized || TEST_NUMMER);
  Logger.log('Existenz-Check (verarbeitet): %s', JSON.stringify(existenz));
}
