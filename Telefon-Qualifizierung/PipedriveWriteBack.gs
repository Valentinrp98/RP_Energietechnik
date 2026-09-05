// ============================================================
// Phase 2 — Ergebnis auf die Person zurückschreiben (Pipedrive)
// ============================================================
// NUR aktiv wenn WRITE_TO_PIPEDRIVE = true (Config.gs) -- das ist seit 05.09.2026 der Fall.
// Bei false ist jeder Aufruf reine Simulation und vermerkt nur, was geschrieben WÜRDE.
// Geschrieben wird das PRÜFERGEBNIS, nie die korrigierte Nummer selbst: das Telefonfeld der
// Person bleibt unangetastet.
// Feld-Keys und Options-IDs werden zur Laufzeit über den Klartext-Namen aufgelöst
// (gleiches Muster wie getPersonFieldKeyByLabel() in Montageplanung-Namensabgleich/Abgleich.gs),
// nicht hartcodiert -- Pipedrive vergibt bei Feld-Neuanlage einen neuen field_code, auch wenn
// der Name gleich bleibt.

let personFieldCache = null;

function getPersonFields() {
  if (!personFieldCache) {
    // limit=500: v2 paginiert sonst bei 100, ein hinten liegendes Feld würde sonst lautlos fehlen.
    personFieldCache = fetchPipedrive('/personFields?limit=500').data || [];
  }
  return personFieldCache;
}

function getPersonFieldKeyByLabel(label) {
  const feld = getPersonFields().find(f =>
    (f.field_name || '').trim().toLowerCase() === label.trim().toLowerCase());
  return feld ? feld.field_code : null;
}

function getPersonFieldOptionId(fieldCode, optionLabel) {
  const feld = getPersonFields().find(f => f.field_code === fieldCode);
  if (!feld || !feld.options) return null;
  const option = feld.options.find(o => (o.label || '').trim().toLowerCase() === optionLabel.trim().toLowerCase());
  return option ? option.id : null;
}

// Diagnose-Helper: einmal ausführen, wenn ein Feldname plötzlich nicht mehr auflöst.
function listePersonFields() {
  getPersonFields().forEach(f => Logger.log('%s -> %s (%s)%s', f.field_name, f.field_code, f.field_type,
    f.options ? ' Optionen: ' + JSON.stringify(f.options) : ''));
}

// Wird von pruefeKonfiguration() aufgerufen -- wirft klaren Fehler statt stillem Leerlauf.
function pruefePersonFelder() {
  const existiertKey = getPersonFieldKeyByLabel(FIELD_LABEL_EXISTIERT);
  if (!existiertKey) {
    throw new Error('Kein Person-Feld "' + FIELD_LABEL_EXISTIERT + '" gefunden -- listePersonFields() ausführen und FIELD_LABEL_EXISTIERT in Config.gs abgleichen.');
  }
  const originalKey = getPersonFieldKeyByLabel(FIELD_LABEL_ORIGINAL);
  if (!originalKey) {
    throw new Error('Kein Person-Feld "' + FIELD_LABEL_ORIGINAL + '" gefunden -- listePersonFields() ausführen und FIELD_LABEL_ORIGINAL in Config.gs abgleichen.');
  }
  const zuletztKey = getPersonFieldKeyByLabel(FIELD_LABEL_ZULETZT_GEPRUEFT);
  if (!zuletztKey) {
    throw new Error('Kein Person-Feld "' + FIELD_LABEL_ZULETZT_GEPRUEFT + '" gefunden -- listePersonFields() ausführen und FIELD_LABEL_ZULETZT_GEPRUEFT in Config.gs abgleichen.');
  }
  Logger.log('Feld "%s" -> %s', FIELD_LABEL_EXISTIERT, existiertKey);
  Logger.log('Feld "%s" -> %s', FIELD_LABEL_ORIGINAL, originalKey);
  Logger.log('Feld "%s" -> %s', FIELD_LABEL_ZULETZT_GEPRUEFT, zuletztKey);

  [OPTION_JA, OPTION_JA_KORRIGIERT, OPTION_NEIN].forEach(text => {
    const id = getPersonFieldOptionId(existiertKey, text);
    if (!id) {
      Logger.log('WARNUNG: Option "%s" nicht auf Feld "%s" gefunden -- Text 1:1 mit Pipedrive abgleichen (Klammern/Leerzeichen zählen).', text, FIELD_LABEL_EXISTIERT);
    } else {
      Logger.log('Option "%s" -> ID %s', text, id);
    }
  });

  if (WRITE_TO_PIPEDRIVE) {
    Logger.log('WRITE_TO_PIPEDRIVE ist TRUE -- Script schreibt jetzt live nach Pipedrive.');
  } else {
    Logger.log('WRITE_TO_PIPEDRIVE ist false -- reine Simulation, es wird nichts geschrieben.');
  }
}

// null = unklar (Existenz-Check nicht gelaufen oder fehlgeschlagen) -- dann bewusst NICHTS
// schreiben statt zu raten (CLAUDE.md: "bei mehrdeutigen Daten nicht raten, sondern
// entscheidbar machen"). Valentin hat aktuell nur 3 Optionen definiert, keine für "unklar".
function ermittleStatusOptionText(format, existenz) {
  if (!existenz || existenz.fehler || existenz.existiert === null) return null;
  if (existenz.existiert === false) return OPTION_NEIN;
  return format.wurdeVeraendert ? OPTION_JA_KORRIGIERT : OPTION_JA;
}

// Gibt einen kurzen Text für die Sheet-Spalte "Pipedrive-Status" zurück. Schreibt nur dann
// wirklich (PATCH), wenn WRITE_TO_PIPEDRIVE = true -- sonst reine Simulation.
function schreibePersonStatus(personId, rawValue, format, existenz) {
  const statusText = ermittleStatusOptionText(format, existenz);
  if (statusText === null) {
    return 'übersprungen (Existenz-Check unklar, kein Options-Text bestimmbar)';
  }

  const existiertKey = getPersonFieldKeyByLabel(FIELD_LABEL_EXISTIERT);
  const originalKey = getPersonFieldKeyByLabel(FIELD_LABEL_ORIGINAL);
  const zuletztKey = getPersonFieldKeyByLabel(FIELD_LABEL_ZULETZT_GEPRUEFT);
  if (!existiertKey) {
    return 'übersprungen (Person-Feld "' + FIELD_LABEL_EXISTIERT + '" nicht gefunden -- pruefeKonfiguration() laufen lassen)';
  }
  const optionId = getPersonFieldOptionId(existiertKey, statusText);
  if (!optionId) {
    return 'übersprungen (Option "' + statusText + '" nicht auf Pipedrive-Feld gefunden -- pruefePersonFelder() prüfen)';
  }
  const heute = Utilities.formatDate(new Date(), 'Europe/Vienna', 'yyyy-MM-dd');

  // Nur Felder ins Payload, die es wirklich gibt. Ein nicht auflösbarer Name ergab vorher den
  // Objekt-Schlüssel "null" im custom_fields-Payload -- Pipedrive antwortet darauf mit 400 und
  // JEDE Person wäre als "FEHLER bei Verarbeitung" im Sheet gelandet, statt dass wenigstens
  // das Hauptergebnis geschrieben wird. Fehlende Felder stehen jetzt im Status-Text.
  const felder = {};
  felder[existiertKey] = [optionId];
  const fehlendeFelder = [];
  if (originalKey) { felder[originalKey] = rawValue; } else { fehlendeFelder.push(FIELD_LABEL_ORIGINAL); }
  if (zuletztKey) { felder[zuletztKey] = heute; } else { fehlendeFelder.push(FIELD_LABEL_ZULETZT_GEPRUEFT); }
  const fehlendHinweis = fehlendeFelder.length ? ' | Feld fehlt in Pipedrive: ' + fehlendeFelder.join(', ') : '';

  if (!WRITE_TO_PIPEDRIVE) {
    return 'DRY-RUN -- würde schreiben: "' + statusText + '", Original: "' + rawValue + '", Zuletzt geprüft: ' + heute + fehlendHinweis;
  }

  // "Telefonnummer existiert?" ist ein "set"-Feld (Mehrfachoption, Pipedrive erlaubt hier
  // theoretisch mehrere gleichzeitige Werte) -- die v2-API will dafür ein Array von Options-IDs,
  // auch wenn wir hier immer nur genau eine Option setzen. Ein nackter Integer würde entweder
  // abgelehnt oder falsch interpretiert. Verifiziert gegen developers.pipedrive.com/tutorials/
  // update-custom-field-pipedrive-api, nicht geraten.
  patchPipedrive('/persons/' + personId, { custom_fields: felder });
  return 'geschrieben: "' + statusText + '", Zuletzt geprüft: ' + heute + fehlendHinweis;
}
