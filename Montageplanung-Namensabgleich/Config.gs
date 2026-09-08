// ============================================================
// KONFIGURATION — Montageplanung-Namensabgleich
// ============================================================
// Zweck: In einem "Montageplanung RP <Partner>"-Sheet stehen Kunden
// (Spalte B) ohne Deal-ID. Dieses Script sucht pro Kunde in Pipedrive
// (NUR LESEN) den passenden Deal und trägt Deal-ID/Adresse/PLZ/Telefon
// zurück ins Sheet ein — aber NUR wenn DRY_RUN=false.
//
// Ablauf:
//   1. pruefeKonfiguration() — prüft Ziel-Sheet + PLZ-Feld gegen echtes Pipedrive
//   2. testEinzelnerName() — prüft Rohformat der itemSearch-Antwort an 1 Namen
//   3. starteAbgleich() mit DRY_RUN=true — schreibt NUR den Log-Tab, rührt Datenzeilen nicht an
//   4. Log-Tab durchsehen (Kategorie WON = sicher, UNKLAR/MEHRDEUTIG/NICHT_GEFUNDEN = manuell)
//   5. DRY_RUN=false, LIMIT_PRO_LAUF klein lassen (Canary), starteAbgleich() — Ergebnis im Sheet prüfen
//   6. LIMIT_PRO_LAUF hoch/entfernen, starteAbgleich() für den Rest — bereits befüllte Deal-ID-Zeilen
//      werden automatisch übersprungen (idempotent), kein Risiko bei mehrfachem Start.

// PIPEDRIVE_DOMAIN war ungenutzt (die API laeuft ueber api.pipedrive.com) und ist entfernt --
// ungenutzte Konstanten sind in Apps Script nicht harmlos: zwei Dateien im selben Projekt mit
// demselben const starten gar nicht (CLAUDE.md), also je weniger davon herumliegt, desto besser.
const PIPEDRIVE_API_BASE = 'https://api.pipedrive.com/api/v2';

// Token liegt in Script Properties unter PIPEDRIVE_API_TOKEN (nicht hier eintragen)
function getApiToken() {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  if (!token) {
    throw new Error('PIPEDRIVE_API_TOKEN fehlt in den Script Properties (Projekteinstellungen > Script-Properties).');
  }
  return token;
}

// ---------- gemeinsamer HTTP-Helper mit Retry (4xx bricht sofort ab, 429/5xx mit Backoff) ----------
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
      Utilities.sleep(1000 * Math.pow(2, attempt)); // real 2s und 4s -- Versuch 3 wirft davor
      continue;
    }
    if (code >= 400) {
      throw new Error('Pipedrive-Fehler ' + code + ': ' + response.getContentText());
    }
    return JSON.parse(response.getContentText());
  }
}

// ---------- Ziel-Sheets je Partner (▷-Button-Falle: AKTUELLER_PARTNER hier umstellen, nicht als Parameter) ----------
const TARGET_SHEETS = {
  KREUZEDER: '19-TnTIXawgYrDGwMEJauNFRZZaxmzYNtnnIsY1M3MF4',
  ALE: '1j2NIi4zeTQlEhWqYlb3IXSjE_69J6ZPNQ1vK4-YiFgM',
  GREENSKY: '1pRHk5ITCUhMywUuyAn738hAcJ3oK9ZSxwC4EJ92yXnc',
  BERGER: '1agWue-J07hZpo-nRnyYzIxe1ow_QD9vaP61dyiT05G8',
  TIROL: '10jV4UC_w23l2hyhcDVwG5YyCy95vFtOr_stFBpLotXg',
  VORARLBERG: '1r7XorkWkmqOYc0aa_hcfncEOFaGOvxX6eLWYpOMQeRU'
};

// Vor jedem Lauf bewusst setzen — nie automatisch "alle Partner", damit ein Fehlgriff
// nicht gleich über sechs Sheets gleichzeitig passiert.
const AKTUELLER_PARTNER = 'GREENSKY';

const TARGET_SHEET_ID = TARGET_SHEETS[AKTUELLER_PARTNER];

// gid des tatsächlich befüllten Tabs je Partner (aus der URL nach "gid=") — Sheets legen bei
// Neuanlage nicht zwingend gid=0 an, und getSheets()[0] wäre sonst fragil, sobald mal ein Tab
// verschoben oder ein weiterer Log-Tab VOR dem Daten-Tab landet. null = noch nicht bekannt,
// dann fällt getTargetTab() unten auf getSheets()[0] zurück (mit Warnung im Log).
const TARGET_TAB_GID = {
  KREUZEDER: 1982585602,
  ALE: 128496518,
  GREENSKY: 1687611358,
  BERGER: 431429924,
  TIROL: 1639965930,
  VORARLBERG: 402568831
};

// Öffnet den tatsächlichen Daten-Tab für einen Partner — per gid, wenn bekannt. partner optional,
// Default AKTUELLER_PARTNER (bestehende Aufrufer wie pruefeKonfiguration()/starteAbgleich() bleiben
// unverändert); explizit übergeben für Funktionen, die über mehrere Partner loopen (FIX 31.08.2026,
// z.B. richteCheckboxenEin() für alle sechs statt nur AKTUELLER_PARTNER).
function getTargetTab(spreadsheet, partner) {
  const p = partner || AKTUELLER_PARTNER;
  const gid = TARGET_TAB_GID[p];
  if (gid) {
    const tab = spreadsheet.getSheets().find(s => s.getSheetId() === gid);
    if (!tab) {
      throw new Error('gid ' + gid + ' für "' + p + '" nicht gefunden — TARGET_TAB_GID prüfen.');
    }
    return tab;
  }
  Logger.log('WARNUNG: kein gid für "%s" in TARGET_TAB_GID hinterlegt — nehme getSheets()[0]. Bitte gid aus der Sheet-URL nachtragen.', p);
  return spreadsheet.getSheets()[0];
}

// Spalten im Ziel-Sheet, 1-indiziert (A=1) — Kopfzeile ist fix, siehe project_montage_sheets_migration
const COL = {
  DEAL_ID: 1,          // A
  KUNDEN: 2,            // B
  LINK: 9,               // I
  ANLAGENGROESSE: 11,    // K
  ADRESSE: 12,           // L
  PLZ: 13,               // M
  TELEFON: 14,            // N
  IB_ERLEDIGT: 15,        // O — Checkbox (checkbox_to_date), siehe richteCheckboxenEin()
  FERTIGMELDUNG: 16,      // P — Checkbox (checkbox_to_date), siehe richteCheckboxenEin()
  ERSTELLUNGSDATUM: 17,  // Q — kommt aus deal.add_time; Sortierschlüssel, siehe sortiereNachErstellungsdatum()
  NETZANMELDUNG: 3        // C — auch Checkbox (checkbox_to_option), siehe richteCheckboxenEin() —
                            // hier nachgetragen, ursprünglich übersehen (aus Sheet-Sync/Config.gs
                            // SYNC_FIELD_CONFIG verifiziert, nicht nur aus dem Gedächtnis)
};

// "Postleitzahl" ist bei RP ein eigenes Person-Custom-Field, nicht Teil des Adressfelds
// (siehe project_rp_energietechnik). Der frühere hartcodierte field_code vom 2026-08-12 war am
// 2026-08-28 bereits ungültig (Feld vermutlich neu angelegt statt umbenannt -- dabei ändert sich
// der key, auch wenn der Name gleich bleibt) -- deshalb jetzt NICHT mehr hartcodiert, sondern wie
// "Adresse" zur Laufzeit über den Feldnamen aufgelöst (getPersonFieldKeyByLabel() in Abgleich.gs).
// Falls sich auch der Feldname geändert hat: listePersonFields() (Abgleich.gs) ausführen und
// hier den aktuellen Namen eintragen.
const PLZ_FIELD_LABEL = 'Postleitzahl';

const DRY_RUN = true;        // erst true testen, Log-Tab prüfen, dann bewusst auf false stellen
const LIMIT_PRO_LAUF = 5;    // Canary: bei DRY_RUN=false nur die ersten N offenen Zeilen live schreiben
const FORCE_OVERWRITE = false; // true = auch Zeilen mit bereits gesetzter Deal-ID neu abgleichen

const MAX_LAUFZEIT_MS = 4.5 * 60 * 1000; // weicher Ausstieg vor dem 6-Min-Limit, nächster Lauf macht einfach weiter

// Vor jedem Vollauf einmal ausführen — prüft Ziel-Sheet-Zugriff + löst PLZ/Adresse-Feldnamen
// gegen echtes Pipedrive auf (wirft klaren Fehler statt stillem Leerlauf, falls einer fehlt).
function pruefeKonfiguration() {
  if (!TARGET_SHEET_ID) {
    throw new Error('AKTUELLER_PARTNER "' + AKTUELLER_PARTNER + '" ist kein bekannter Key in TARGET_SHEETS.');
  }
  const sheet = SpreadsheetApp.openById(TARGET_SHEET_ID);
  const tab = getTargetTab(sheet);
  const header = tab.getRange(1, 1, 1, 17).getValues()[0];
  Logger.log('Ziel-Sheet: %s, Tab "%s" (%s)', sheet.getName(), tab.getName(), sheet.getUrl());
  Logger.log('Kopfzeile: %s', JSON.stringify(header));

  const plzKey = getPersonFieldKeyByLabel(PLZ_FIELD_LABEL);
  if (!plzKey) {
    throw new Error('Kein Person-Feld mit Namen "' + PLZ_FIELD_LABEL + '" gefunden — listePersonFields() ausführen und PLZ_FIELD_LABEL aktualisieren.');
  }
  Logger.log('PLZ-Feld aufgelöst: "%s" -> key %s', PLZ_FIELD_LABEL, plzKey);

  const adresseKey = getPersonFieldKeyByLabel('Adresse');
  if (!adresseKey) {
    Logger.log('WARNUNG: kein Person-Feld "Adresse" gefunden — Adresse bleibt beim Abgleich leer.');
  } else {
    Logger.log('Adresse-Feld aufgelöst: "Adresse" -> key %s', adresseKey);
  }
  Logger.log('OK — Konfiguration passt.');
}
