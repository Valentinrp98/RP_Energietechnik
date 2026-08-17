// ==========================================================================================
// PROJEKT: "PLZ(GKZ)-->BL_Auto-Allocation"  (scriptId 1Rez1BwtFgGP4bzkSQiK8dTBiDCyCNP4vNlOWE6IPwJsd1fxk_U8sFVHy)
// DATEI IM EDITOR: Code.gs        --> kompletten Inhalt ersetzen
// Zweite Datei "Bundesland-lookup.gs" (PLZ_BUNDESLAND / PLZ_QUELLE) bleibt UNVERAENDERT.
//
// Stand 2026-08-12, Version 3 (nach dem ersten DRY-Vollauf ueber 1200 Deals).
//
// Ergebnis des DRY-Laufs, das zu dieser Version gefuehrt hat:
//   1151 von 1200 Deals waeren gesetzt worden (96 %), 49 uebersprungen, 9 Grenzfaelle.
//   Von den 49: ~11 ohne verknuepfte Person, ~32 "keine gueltige PLZ", 6 mit PLZ die es in
//   Oesterreich nicht gibt (6666, 1324, 7530, 5073, 2389, 9242 -- gegen das offizielle
//   Ortsverzeichnis geprueft, vermutlich auslaendische Kunden; Ungarn hat auch 4-stellige PLZ).
//   Laufzeit 4,5 Min fuer 1200 Deals, fast komplett durch die Einzelabrufe der Personen.
//
// Aenderungen ggue. Version 2:
//   NEU 1  PERSONEN-VORABLADUNG: statt 1 API-Call pro Deal werden alle Personen einmal
//          seitenweise geladen und in eine Map gelegt. Aus ~1200 Calls werden ~15.
//   NEU 2  PLZ-FALLBACK-KETTE: wenn das eigene "Postleitzahl"-Feld leer ist, wird die PLZ
//          aus dem Adressfeld gezogen. Duerfte einen guten Teil der ~32 "keine gueltige PLZ"
//          retten -- das separate PLZ-Feld ist neuer als viele Datensaetze.
//   NEU 3  ROHWERT WIRD GELOGGT: bei "keine gueltige PLZ" stand bisher nur, DASS es nicht
//          ging, nicht WAS drin stand. Jetzt steht der Originalinhalt im Log.
//   NEU 4  ORT + ADRESSE IM LOG: bei Grenzfall-PLZ entscheidet der Ort, nicht die PLZ.
//          Steht die Adresse im Log, klaert man die 9 Faelle im Sheet statt in Pipedrive.
//   NEU 5  GRENZFALL_MANUELL-Schalter (siehe grossen Kommentar unten).
//   NEU 6  Organisations-Fallback, wenn am Deal keine Person haengt.
//   FIX 9  status=all_not_deleted ist ein v1-Wert -> in v2 HTTP 400. Parameter faellt weg,
//          v2 liefert ohne ihn "all not deleted deals".
//
// Aus Version 2 uebernommen: Grenzfall-Detail-Log (quelle.detail), gecachtes + gebuendeltes
// Log-Sheet, Resume-Cursor mit Zeitbudget, Deal-Objekt aus der Liste wiederverwenden,
// FORCE_OVERWRITE, tolerantes extractPlz, pruefeKonfiguration().
// ==========================================================================================


// ===== KONFIGURATION =====

const PIPEDRIVE_DOMAIN = 'rp-energietechnik';

// Deal-Custom-Field "Bundesland" (siehe Feldkatalog-Doku)
const BUNDESLAND_FIELD_KEY = '43a5e2fa23f0659ac07ca499a629d5c391cfc440';
const BUNDESLAND_OPTION_IDS = {
  'Wien': 162, 'Niederösterreich': 163, 'Oberösterreich': 164, 'Salzburg': 165,
  'Kärnten': 166, 'Steiermark': 167, 'Tirol': 168, 'Vorarlberg': 169, 'Burgenland': 170
};

// "Postleitzahl" ist bei RP ein EIGENES varchar-Feld an der PERSON, kein Subfeld von "Adresse"
// (per logPersonFields()-Debug am 2026-08-12 bestaetigt).
const PLZ_FIELD_KEY = '5fef394025c936df4b58763b2b58c340fbb0d251';

// NEU 2: Adressfeld an der Person, als Fallback wenn das PLZ-Feld leer ist.
const ADRESSE_FIELD_KEY = '432e4e165de7e9f474643c3d3a5552e2ec976f55';

// Wenn true: nichts wird geschrieben, nur geloggt was passieren wuerde
const DRY_RUN = true;

// Wenn true, wird ein bereits gesetztes Bundesland ueberschrieben. Normalfall false --
// nur einschalten, wenn z.B. PLZ nachtraeglich korrigiert wurden.
const FORCE_OVERWRITE = false;

// ------------------------------------------------------------------------------------------
// NEU 5 -- GRENZFALL_MANUELL
//
// 11 der 2232 PLZ liegen auf einer Landesgrenze, im DRY-Lauf betraf das 9 von 1200 Deals.
// Gegen das offizielle Ortsverzeichnis geprueft (2026-08-12):
//   2460  Bruck a.d. Leitha (NÖ, 2 Orte)  vs Bruckneudorf (Bgld, 2 Orte)   -> echtes 50:50
//   2413  Edelstal (Bgld, 1 Ort)          vs Berg (NÖ, 1 Ort)              -> echtes 50:50
//   5163  Palting (OÖ)                    vs Mattsee (Sbg), 20 Orte        -> fraglich
//   8292  Hackerberg (Bgld, 1 Ort)        vs Neudau (Stmk, 2 Orte)         -> Map sagt Bgld,
//         die Mehrheit der Orte liegt aber in der Steiermark -> vermutlich falsch
// Bei diesen PLZ entscheidet der ORT, nicht die PLZ -- automatisch nicht loesbar.
//
// true  = Grenzfall-PLZ werden NICHT gesetzt, sondern mit Adresse im Log ausgewiesen
//         (empfohlen: ein falsches Bundesland wird spaeter zum falschen Montagepartner,
//         also am Ende zum falschen Monteur beim Kunden -- bei 9 Deals lohnt Handarbeit)
// false = wie bisher setzen und nur mit [GRENZFALL] markieren
// ------------------------------------------------------------------------------------------
const GRENZFALL_MANUELL = true;

// Freiwilliger Abbruch vor dem harten Apps-Script-Limit (6 bzw. 30 Min)
const MAX_LAUFZEIT_MS = 4.5 * 60 * 1000;

const PROP_RESUME_CURSOR = 'BUNDESLAND_RESUME_CURSOR';
// V3, weil das Log-Sheet zwei neue Spalten hat -- altes Sheet bleibt unangetastet erhalten.
const PROP_LOG_SHEET_ID = 'BUNDESLAND_LOG_SHEET_ID_V3';

// Wenn true: Deals, die vor CUTOFF_DATE angelegt wurden (deal.add_time), werden uebersprungen
// und nicht angefasst -- z.B. um einen Altbestand bewusst unveraendert zu lassen.
const CUTOFF_ENABLED = false;
const CUTOFF_DATE = new Date('2026-07-01');


// ===== HAUPTFUNKTIONEN =====
// Im Apps-Script-Editor oben im Dropdown auswaehlen und ausfuehren (>-Button).

/**
 * Laeuft ueber alle Deals und befuellt das Bundesland-Feld aus der PLZ.
 * Bricht nach MAX_LAUFZEIT_MS freiwillig ab und merkt sich den Cursor -- einfach nochmal
 * starten, bis "DURCHGELAUFEN" im Log steht. resetVollauf() startet bewusst von vorne.
 */
function fillBundeslandForAllDeals() {
  const props = PropertiesService.getScriptProperties();
  const start = Date.now();
  let cursor = props.getProperty(PROP_RESUME_CURSOR) || null;
  let processed = 0;
  let abgebrochen = false;
  const summary = { gesetzt: 0, uebersprungen: 0, dryRun: 0, grenzfaelle: 0, ausAdresse: 0 };

  if (cursor) Logger.log(`Setze abgebrochenen Lauf fort (Cursor ${cursor}). Fuer Neustart von vorne: resetVollauf()`);

  try {
    // NEU 1: einmal alle Personen holen statt pro Deal einzeln. Das war im letzten Lauf
    // praktisch die gesamte Laufzeit (1200 Einzelabrufe a ~200 ms).
    ladePersonenIndex();

    do {
      // FIX 9: KEIN status-Parameter. Der v1-Wert "all_not_deleted" ist in v2 ungueltig
      // (HTTP 400 ERR_SCHEMA_VALIDATION_FAILED); ohne Parameter liefert v2 laut Doku
      // "all not deleted deals", also offene UND gewonnene/verlorene.
      const path = `deals?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const response = callPipedriveWithRetryRaw(`https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`);
      const deals = response.data || [];
      cursor = (response.additional_data && response.additional_data.next_cursor) || null;

      for (const deal of deals) {
        const result = fillBundeslandForDeal(deal.id, deal);
        processed++;
        if (result.startsWith('gesetzt')) summary.gesetzt++;
        else if (result.startsWith('DRY-RUN')) summary.dryRun++;
        else summary.uebersprungen++;
        if (result.indexOf('GRENZFALL') !== -1) summary.grenzfaelle++;
        if (result.indexOf('via Adresse') !== -1) summary.ausAdresse++;
      }

      if (cursor) props.setProperty(PROP_RESUME_CURSOR, cursor);
      else props.deleteProperty(PROP_RESUME_CURSOR);

      if (cursor && Date.now() - start > MAX_LAUFZEIT_MS) {
        abgebrochen = true;
        break;
      }
    } while (cursor);
  } finally {
    flushLog();
  }

  if (processed === 0 && !abgebrochen) {
    Logger.log('WARNUNG: 0 Deals von der Pipedrive-API zurueckbekommen. Pruefe PIPEDRIVE_API_TOKEN und ob im Account ueberhaupt Deals existieren.');
  }
  Logger.log(`${abgebrochen ? 'PAUSIERT (Zeitbudget) -- nochmal starten, macht automatisch weiter.' : 'DURCHGELAUFEN.'} ` +
             `${processed} Deals in diesem Lauf. ${JSON.stringify(summary)}`);
  if (summary.ausAdresse > 0) {
    Logger.log(`${summary.ausAdresse} Deals haben die PLZ nur ueber das Adressfeld bekommen (PLZ-Feld war leer) -- dort lohnt sich Datenpflege.`);
  }
  if (summary.grenzfaelle > 0) {
    Logger.log(`${summary.grenzfaelle} Grenzfall-PLZ dabei -- im Sheet nach "GRENZFALL" filtern. ` +
               (GRENZFALL_MANUELL ? 'Sie wurden NICHT gesetzt, die Adresse steht im Log.' : 'Sie wurden gesetzt, bitte fachlich gegenpruefen.'));
  }
}

/** Vollauf bewusst von vorne starten (loescht den gemerkten Cursor). */
function resetVollauf() {
  PropertiesService.getScriptProperties().deleteProperty(PROP_RESUME_CURSOR);
  Logger.log('Resume-Cursor geloescht. Naechster fillBundeslandForAllDeals()-Lauf startet bei Deal 1.');
}

/** Wrapper ohne Parameter, damit man im Apps-Script-Dropdown direkt einen Einzeldeal testen kann. */
function testEinzelDeal() {
  try {
    Logger.log(fillBundeslandForDeal(7253)); // Test-Deal-ID aus dem sevdesk-Sync-Projekt
  } finally {
    flushLog();
  }
}

/**
 * Fuer kontrolliertes Testen: nur die hier eingetragenen Deal-IDs befuellen (statt alle Deals).
 * Praktisch fuer die 9 Grenzfall-Deals aus dem DRY-Lauf.
 */
function fillBundeslandForAusgewaehlteDeals() {
  const dealIds = [277, 367, 504, 639, 823, 1008, 1055, 1342, 1402]; // die 9 Grenzfall-Deals
  try {
    dealIds.forEach(dealId => Logger.log(`Deal ${dealId}: ${fillBundeslandForDeal(dealId)}`));
  } finally {
    flushLog();
  }
}

/**
 * Befuellt das Bundesland-Feld fuer EINEN Deal. Gibt einen Ergebnis-String zurueck.
 * @param {number} dealId
 * @param {Object} [dealVorab] Deal-Objekt aus der Listenabfrage (spart einen API-Call).
 */
function fillBundeslandForDeal(dealId, dealVorab) {
  const deal = (dealVorab && dealVorab.custom_fields) ? dealVorab : fetchPipedrive(`deals/${dealId}`);
  const cf = deal.custom_fields || {};

  if (CUTOFF_ENABLED && deal.add_time && new Date(deal.add_time) < CUTOFF_DATE) {
    logRow(dealId, deal.title, null, 'übersprungen', null, {}, `Deal vor CUTOFF_DATE (${CUTOFF_DATE.toISOString().slice(0, 10)}) angelegt, bewusst nicht angefasst`);
    return 'übersprungen (vor CUTOFF_DATE)';
  }

  if (cf[BUNDESLAND_FIELD_KEY] && !FORCE_OVERWRITE) {
    logRow(dealId, deal.title, null, 'übersprungen', null, {}, 'Bundesland bereits gesetzt');
    return 'übersprungen (bereits gesetzt)';
  }

  // NEU 2 + NEU 6: PLZ ueber die Fallback-Kette holen (PLZ-Feld -> Adressfeld -> Organisation).
  const fund = ermittlePlz(deal);

  if (!fund.plz) {
    logRow(dealId, deal.title, null, 'übersprungen', null, fund, fund.grund);
    return `übersprungen (${fund.grund})`;
  }

  const bundesland = PLZ_BUNDESLAND[fund.plz];
  if (!bundesland) {
    // Im DRY-Lauf waren das 6 Deals mit PLZ, die es in Oesterreich nicht gibt.
    logRow(dealId, deal.title, fund.plz, 'übersprungen', null, fund, `PLZ ${fund.plz} existiert nicht in Österreich (ausländischer Kunde oder Tippfehler)`);
    return `übersprungen (PLZ ${fund.plz} unbekannt)`;
  }

  const optionId = BUNDESLAND_OPTION_IDS[bundesland];
  if (!optionId) {
    logRow(dealId, deal.title, fund.plz, 'FEHLER', bundesland, fund, `KONFIG-FEHLER: keine Option-ID für "${bundesland}" -- pruefeKonfiguration() ausfuehren`);
    return `FEHLER (Option-ID für ${bundesland} fehlt)`;
  }

  const quelle = PLZ_QUELLE[fund.plz];
  const istGrenzfall = !!(quelle && /Tiebreak/.test(quelle.methode));
  const herkunft = fund.quelle === 'adresse' ? ' (PLZ via Adresse)' : '';

  // NEU 5: Bei Grenzfall-PLZ entscheidet der Ort. Statt zu raten wird die Adresse ausgewiesen.
  if (istGrenzfall && GRENZFALL_MANUELL) {
    logRow(dealId, deal.title, fund.plz, 'GRENZFALL', bundesland, fund,
      `NICHT gesetzt -- PLZ liegt auf einer Landesgrenze. Adresse pruefen und Bundesland manuell setzen. Vorschlag laut Verzeichnis: ${bundesland}`);
    return `übersprungen [GRENZFALL] (PLZ ${fund.plz}, Vorschlag ${bundesland})${herkunft}`;
  }
  const marker = istGrenzfall ? ' [GRENZFALL - bitte prüfen]' : '';

  if (DRY_RUN) {
    logRow(dealId, deal.title, fund.plz, 'DRY-RUN', bundesland, fund, 'würde gesetzt werden' + marker + herkunft);
    return `DRY-RUN: würde ${bundesland} setzen (PLZ ${fund.plz})${marker}${herkunft}`;
  }

  patchPipedrive(`deals/${dealId}`, { custom_fields: { [BUNDESLAND_FIELD_KEY]: optionId } });
  logRow(dealId, deal.title, fund.plz, 'gesetzt', bundesland, fund, (marker + herkunft).trim());
  return `gesetzt: ${bundesland} (PLZ ${fund.plz})${marker}${herkunft}`;
}


// ===== PLZ-ERMITTLUNG (NEU 2 / NEU 3 / NEU 6) =====

/**
 * Sucht die PLZ eines Deals ueber mehrere Quellen, in dieser Reihenfolge:
 *   1. Person, eigenes Feld "Postleitzahl"   (der Normalfall)
 *   2. Person, Adressfeld                    (rettet Altdatensaetze ohne gepflegtes PLZ-Feld)
 *   3. Organisation, Adresse                 (fuer Deals ohne verknuepfte Person)
 * Gibt immer ein Objekt zurueck, auch im Misserfolgsfall -- inklusive Rohwert und Adresse
 * fuers Log, damit man im Sheet sieht WORAN es lag statt nur DASS es nicht ging.
 */
function ermittlePlz(deal) {
  const fund = { plz: null, quelle: null, rohwert: '', adresse: '', grund: '' };

  if (deal.person_id) {
    const personId = deal.person_id.value || deal.person_id;
    const person = holePerson(personId);
    if (person) {
      const pcf = person.custom_fields || {};
      fund.rohwert = pcf[PLZ_FIELD_KEY] === undefined || pcf[PLZ_FIELD_KEY] === null ? '' : String(pcf[PLZ_FIELD_KEY]);
      fund.adresse = adressAlsText(pcf[ADRESSE_FIELD_KEY]);

      const ausFeld = extractPlz(pcf[PLZ_FIELD_KEY]);
      if (ausFeld) { fund.plz = ausFeld; fund.quelle = 'plz_feld'; return fund; }

      const ausAdresse = plzAusAdresse(pcf[ADRESSE_FIELD_KEY]);
      if (ausAdresse) { fund.plz = ausAdresse; fund.quelle = 'adresse'; return fund; }

      fund.grund = fund.rohwert
        ? `PLZ-Feld enthält "${fund.rohwert}" -- keine 4-stellige PLZ erkennbar, auch nicht in der Adresse`
        : 'PLZ-Feld leer und in der Adresse keine PLZ gefunden';
      return fund;
    }
  }

  // NEU 6: kein Person-Datensatz -> ueber die Organisation versuchen.
  const orgId = deal.org_id ? (deal.org_id.value || deal.org_id) : null;
  if (orgId) {
    const org = holeOrganisation(orgId);
    if (org) {
      fund.adresse = adressAlsText(org.address);
      const ausOrg = plzAusAdresse(org.address);
      if (ausOrg) { fund.plz = ausOrg; fund.quelle = 'organisation'; return fund; }
      fund.grund = 'keine verknüpfte Person, Organisationsadresse enthält keine PLZ';
      return fund;
    }
  }

  fund.grund = 'keine verknüpfte Person und keine Organisation';
  return fund;
}

/**
 * Validiert/normalisiert einen Rohwert auf eine 4-stellige AT-PLZ. "Postleitzahl" ist ein
 * freies Textfeld, das Menschen befuellen -- "A-1180", "AT 1180" oder "1180 Wien" gelten
 * deshalb als gueltig, "118", "11800" oder "1 180" weiterhin nicht.
 */
function extractPlz(plzRaw) {
  if (plzRaw === undefined || plzRaw === null) return null;
  const trimmed = String(plzRaw).trim();
  const treffer = trimmed.match(/^(?:A|AT)?[-\s]?(\d{4})(?:[\s,].*)?$/i);
  return treffer ? treffer[1] : null;
}

/**
 * Zieht eine PLZ aus einem Adressfeld.
 *
 * Bei RP entstehen Adressen auf zwei Wegen (Valentin, 2026-08-12): zuerst wird Google-Maps-
 * Autocomplete versucht, klappt das nicht, tippt man Freitext. Beide Sorten liegen im selben
 * Feld, sehen aber unterschiedlich aus:
 *   - ueber Maps angelegt: postal_code / locality / formatted_address sind befuellt
 *   - frei getippt:        nur "value" enthaelt Text, alle Subfelder sind null
 * Deshalb der Reihe nach: postal_code -> formatted_address -> value. Erst wenn alle drei
 * nichts hergeben, gilt die Adresse als unbrauchbar.
 */
function plzAusAdresse(adrRaw) {
  if (!adrRaw) return null;
  if (typeof adrRaw !== 'object') return plzAusFreitext(String(adrRaw));

  const direkt = extractPlz(adrRaw.postal_code);
  if (direkt) return direkt;

  // Beide Textfelder einzeln probieren -- frueher wurde "value" uebersprungen, sobald
  // formatted_address existierte, auch wenn dort keine PLZ drinstand.
  for (const text of [adrRaw.formatted_address, adrRaw.value]) {
    const treffer = plzAusFreitext(text);
    if (treffer) return treffer;
  }
  return null;
}

/** Sucht in einem Adress-Freitext eine 4-stellige Zahl, die als oesterreichische PLZ taugt. */
function plzAusFreitext(text) {
  if (!text) return null;
  // Nur Zahlen, die frei stehen (nicht Teil einer Hausnummer wie "Weg 12345") und die im
  // oesterreichischen PLZ-Bereich 1000-9999 liegen. Erster Treffer, der im Verzeichnis steht.
  const kandidaten = String(text).match(/\b\d{4}\b/g) || [];
  for (const k of kandidaten) {
    if (PLZ_BUNDESLAND[k]) return k;
  }
  return null;
}

/** Adressfeld als lesbaren Text fuers Log (egal ob Objekt oder String). */
function adressAlsText(adrRaw) {
  if (!adrRaw) return '';
  if (typeof adrRaw === 'object') {
    return String(adrRaw.formatted_address || adrRaw.value || JSON.stringify(adrRaw));
  }
  return String(adrRaw);
}


// ===== PERSONEN-VORABLADUNG (NEU 1) =====

let _personenIndex = null;   // person_id -> Personenobjekt, null solange nicht geladen
let _orgCache = {};          // org_id -> Organisationsobjekt (nur die wenigen Faelle ohne Person)

/**
 * Laedt alle Personen einmal seitenweise in den Speicher. Im letzten Vollauf waren die
 * Einzelabrufe der Personen praktisch die gesamte Laufzeit -- aus ~1200 Calls werden so ~15.
 * Faellt still auf Einzelabrufe zurueck, falls die Listenantwort keine custom_fields enthaelt.
 */
function ladePersonenIndex() {
  const start = Date.now();
  const index = {};
  let cursor = null;
  let seiten = 0;
  let ohneCustomFields = 0;

  do {
    const path = `persons?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const response = callPipedriveWithRetryRaw(`https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`);
    const personen = response.data || [];
    cursor = (response.additional_data && response.additional_data.next_cursor) || null;
    seiten++;
    personen.forEach(p => {
      if (!p.custom_fields) ohneCustomFields++;
      index[p.id] = p;
    });
  } while (cursor);

  _personenIndex = index;
  const anzahl = Object.keys(index).length;
  Logger.log(`${anzahl} Personen in ${seiten} Seitenabrufen vorgeladen (${Math.round((Date.now() - start) / 1000)} s).`);
  if (ohneCustomFields > 0) {
    Logger.log(`Hinweis: ${ohneCustomFields} Personen kamen ohne custom_fields -- fuer die wird einzeln nachgeladen.`);
  }
}

/** Person aus dem Index, sonst Einzelabruf. Funktioniert auch ohne vorherige Vorabladung. */
function holePerson(personId) {
  if (_personenIndex) {
    const treffer = _personenIndex[personId];
    if (treffer && treffer.custom_fields) return treffer;
  }
  try {
    return fetchPipedrive(`persons/${personId}`);
  } catch (e) {
    Logger.log(`Person ${personId} nicht abrufbar: ${e.message}`);
    return null;
  }
}

/** Organisation mit kleinem Cache -- betrifft nur die wenigen Deals ohne Person. */
function holeOrganisation(orgId) {
  if (_orgCache[orgId] !== undefined) return _orgCache[orgId];
  try {
    _orgCache[orgId] = fetchPipedrive(`organizations/${orgId}`);
  } catch (e) {
    Logger.log(`Organisation ${orgId} nicht abrufbar: ${e.message}`);
    _orgCache[orgId] = null;
  }
  return _orgCache[orgId];
}


// ===== PRUEF- / DEBUG-FUNKTIONEN =====

/**
 * Gleicht die oben hinterlegten Option-IDs mit dem echten Pipedrive-Feld ab.
 * Einmal vor jedem Vollauf laufen lassen.
 */
function pruefeKonfiguration() {
  const felder = fetchPipedrive('dealFields?limit=500');
  const feld = felder.filter(f => f.field_code === BUNDESLAND_FIELD_KEY)[0];
  if (!feld) {
    Logger.log(`FEHLER: Deal-Feld ${BUNDESLAND_FIELD_KEY} existiert nicht (mehr). Feldkatalog pruefen.`);
    return;
  }
  Logger.log(`Feld gefunden: "${feld.field_name}" (Typ ${feld.field_type})`);
  if (feld.field_type !== 'enum') {
    Logger.log(`WARNUNG: erwartet wurde ein Einfachauswahl-Feld (enum), ist aber "${feld.field_type}".`);
  }

  const live = {};
  (feld.options || []).forEach(o => { live[o.label] = o.id; });
  let fehler = 0;
  Object.keys(BUNDESLAND_OPTION_IDS).forEach(name => {
    const soll = BUNDESLAND_OPTION_IDS[name];
    if (live[name] === undefined) { Logger.log(`FEHLER: Option "${name}" existiert in Pipedrive nicht.`); fehler++; }
    else if (live[name] !== soll) { Logger.log(`FEHLER: "${name}" -- Script sagt ${soll}, Pipedrive sagt ${live[name]}.`); fehler++; }
  });
  Object.keys(live).forEach(label => {
    if (BUNDESLAND_OPTION_IDS[label] === undefined) Logger.log(`Hinweis: Pipedrive kennt zusaetzlich die Option "${label}" (id ${live[label]}), im Script nicht hinterlegt.`);
  });
  Logger.log(fehler === 0 ? 'Konfiguration OK -- alle 9 Bundesland-Option-IDs stimmen.' : `${fehler} Abweichung(en) -- BUNDESLAND_OPTION_IDS korrigieren, BEVOR DRY_RUN=false gesetzt wird.`);
}

/**
 * Debug fuer NEU 2: zeigt fuer einen Deal alle PLZ-Quellen im Rohzustand. Damit laesst sich
 * pruefen, ob die Annahmen ueber das Adressfeld stimmen, bevor man dem Fallback vertraut.
 */
function zeigePlzQuellenFuerDeal() {
  // Deals aus dem DRY-Lauf, die durchgefallen sind -- hier beliebig anpassen.
  // Erste Gruppe: "keine gueltige PLZ". Letzte zwei: "keine verknuepfte Person".
  const dealIds = [68, 161, 201, 275, 411, 449, 585, 1416, 63, 1120];

  dealIds.forEach(dealId => {
    let deal;
    try {
      deal = fetchPipedrive(`deals/${dealId}`);
    } catch (e) {
      Logger.log(`--- Deal ${dealId}: nicht abrufbar (${e.message})`);
      return;
    }
    Logger.log(`--- Deal ${dealId}: "${deal.title}", person_id=${JSON.stringify(deal.person_id)}, org_id=${JSON.stringify(deal.org_id)}`);
    if (deal.person_id) {
      const person = fetchPipedrive(`persons/${deal.person_id.value || deal.person_id}`);
      const pcf = person.custom_fields || {};
      Logger.log(`    PLZ-Feld roh:   ${JSON.stringify(pcf[PLZ_FIELD_KEY])}`);
      Logger.log(`    Adressfeld roh: ${JSON.stringify(pcf[ADRESSE_FIELD_KEY])}`);
    }
    Logger.log(`    Kette: ${JSON.stringify(ermittlePlz(deal))}`);
  });
}

/**
 * Diagnose: woher kommen die 6568 Deals? Zaehlt nach Status und Pipeline und zeigt, wie viele
 * Deals sich eine Person teilen (Duplikate). Schreibt nichts, dauert ~15 s.
 *
 * Hintergrund: im DRY-Lauf sind mehrere Kunden mit 3-4 Deals aufgetaucht (z.B. Mario Bauer als
 * Deal 141/142/183/199) sowie Paerchen "Name" / "Name Deal" -- Verdacht auf Import-Duplikate.
 * Fuer die Bundesland-Befuellung egal, aber Ordnererstellung und Sheet-Sync wuerden pro Deal
 * einen Ordner bzw. eine Zeile anlegen, also pro Duplikat einen zu viel.
 */
function zaehleDeals() {
  const nachStatus = {};
  const nachPipeline = {};
  const proPerson = {};
  let cursor = null;
  let gesamt = 0;
  let ohnePerson = 0;

  do {
    const path = `deals?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const response = callPipedriveWithRetryRaw(`https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`);
    const deals = response.data || [];
    cursor = (response.additional_data && response.additional_data.next_cursor) || null;

    deals.forEach(d => {
      gesamt++;
      const st = d.status || '(kein Status)';
      nachStatus[st] = (nachStatus[st] || 0) + 1;
      const pl = d.pipeline_id === undefined || d.pipeline_id === null ? '(keine Pipeline)' : String(d.pipeline_id);
      nachPipeline[pl] = (nachPipeline[pl] || 0) + 1;
      const pid = d.person_id ? (d.person_id.value || d.person_id) : null;
      if (pid) proPerson[pid] = (proPerson[pid] || 0) + 1;
      else ohnePerson++;
    });
  } while (cursor);

  Logger.log(`GESAMT: ${gesamt} Deals`);
  Logger.log(`Nach Status: ${JSON.stringify(nachStatus)}`);
  Logger.log(`Nach Pipeline-ID: ${JSON.stringify(nachPipeline)}`);

  const personen = Object.keys(proPerson);
  const mehrfach = personen.filter(p => proPerson[p] > 1);
  const dealsInDuplikaten = mehrfach.reduce((s, p) => s + proPerson[p], 0);
  Logger.log(`${personen.length} verschiedene Personen, ${ohnePerson} Deals ohne Person.`);
  Logger.log(`${mehrfach.length} Personen haben MEHR als einen Deal -- zusammen ${dealsInDuplikaten} Deals ` +
             `(${dealsInDuplikaten - mehrfach.length} mehr als noetig, falls es echte Duplikate sind).`);

  // Die zehn Personen mit den meisten Deals, zum gezielten Nachschauen in Pipedrive.
  mehrfach.sort((a, b) => proPerson[b] - proPerson[a]).slice(0, 10)
    .forEach(p => Logger.log(`   person_id ${p}: ${proPerson[p]} Deals`));
}

/** EINMALIG ausfuehren: listet alle Person-Custom-Fields mit Name + field_code im Log. */
function logPersonFields() {
  const fields = fetchPipedrive('personFields?limit=200');
  Logger.log('Beispiel-Feld komplett: ' + JSON.stringify(fields[0]));
  fields
    .filter(f => f.field_code && f.field_code.length > 20)
    .forEach(f => Logger.log(JSON.stringify(f)));
}


// ===== HILFSFUNKTIONEN =====

/** Holt den API-Token aus Script Properties, wirft klaren Fehler wenn er fehlt. */
function getApiToken() {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN fehlt in den Script Properties (Projekteinstellungen pruefen).');
  return token;
}

/** LIEST: Pipedrive-GET mit Token im Header, Statuspruefung + Retry bei 429/5xx. */
function fetchPipedrive(path) {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`;
  return callPipedriveWithRetry(() => UrlFetchApp.fetch(url, {
    headers: { 'x-api-token': getApiToken() },
    muteHttpExceptions: true
  }), path);
}

/** SCHREIBT: Pipedrive-PATCH mit Token im Header, Statuspruefung + Retry bei 429/5xx. */
function patchPipedrive(path, payload) {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`;
  return callPipedriveWithRetry(() => UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { 'x-api-token': getApiToken() },
    muteHttpExceptions: true
  }), path);
}

/** Retry-Wrapper: bei 429/5xx bis zu 3x mit steigender Wartezeit, bei 4xx sofort abbrechen. */
function callPipedriveWithRetry(doFetch, path) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = doFetch();
    const code = response.getResponseCode();
    if (code === 200) return JSON.parse(response.getContentText()).data;
    if (code === 429 || code >= 500) {
      if (attempt === maxAttempts) {
        throw new Error(`Pipedrive API-Fehler ${code} bei "${path}" nach ${maxAttempts} Versuchen: ${response.getContentText()}`);
      }
      Utilities.sleep(1000 * Math.pow(2, attempt)); // 2s, dann 4s (der 3. Fehlschlag wirft)
      continue;
    }
    throw new Error(`Pipedrive API-Fehler ${code} bei "${path}": ${response.getContentText()}`);
  }
}

/** Wie callPipedriveWithRetry, aber gibt die volle Response (inkl. additional_data) zurueck. */
function callPipedriveWithRetryRaw(url) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = UrlFetchApp.fetch(url, {
      headers: { 'x-api-token': getApiToken() },
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code === 200) return JSON.parse(response.getContentText());
    if (code === 429 || code >= 500) {
      if (attempt === maxAttempts) {
        throw new Error(`Pipedrive API-Fehler ${code} bei "${url}" nach ${maxAttempts} Versuchen: ${response.getContentText()}`);
      }
      Utilities.sleep(1000 * Math.pow(2, attempt));
      continue;
    }
    throw new Error(`Pipedrive API-Fehler ${code} bei "${url}": ${response.getContentText()}`);
  }
}


// ===== LOGGING =====

const LOG_HEADER = [
  'Zeitstempel', 'Deal-ID', 'Deal-Titel', 'PLZ', 'Ergebnis', 'Bundesland',
  'PLZ-Quelle', 'Rohwert PLZ-Feld', 'Adresse',
  'Zuordnungs-Methode', 'Quell-Gemeinde', 'GKZ', 'Grenzfall-Detail', 'Detail'
];

let _logSheet = null;
let _logBuffer = [];

/** Self-bootstrapping Log-Sheet. */
function getLogSheet() {
  if (_logSheet) return _logSheet;
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty(PROP_LOG_SHEET_ID);
  let ss = null;
  if (sheetId) {
    try { ss = SpreadsheetApp.openById(sheetId); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('LOG_Bundesland aus PLZ (V3)');
    props.setProperty(PROP_LOG_SHEET_ID, ss.getId());
    ss.getActiveSheet().appendRow(LOG_HEADER);
    Logger.log(`Neues Log-Sheet angelegt: ${ss.getUrl()}`);
  }
  _logSheet = ss.getActiveSheet();
  return _logSheet;
}

/**
 * Puffert eine Log-Zeile. Neben der Zuordnung (Gemeinde/GKZ/Methode aus PLZ_QUELLE) stehen
 * jetzt auch Herkunft der PLZ, der Rohwert des PLZ-Felds und die Adresse drin -- damit sieht
 * man im Sheet, WORAN ein Fall gescheitert ist, und kann Grenzfaelle ohne Pipedrive entscheiden.
 */
function logRow(dealId, dealTitle, plz, ergebnis, bundesland, fund, detail) {
  const quelle = plz ? PLZ_QUELLE[plz] : null;
  const f = fund || {};
  _logBuffer.push([
    new Date(), dealId, dealTitle || '', plz || '', ergebnis, bundesland || '',
    f.quelle || '',
    f.rohwert || '',
    f.adresse || '',
    quelle ? quelle.methode : '',
    quelle ? quelle.gemeinde : '',
    quelle ? quelle.gkz : '',
    quelle && quelle.detail ? quelle.detail : '',
    detail || ''
  ]);
}

/** Schreibt alle gepufferten Zeilen in einem einzigen Range-Write ins Sheet. */
function flushLog() {
  if (_logBuffer.length === 0) return;
  const sheet = getLogSheet();
  sheet.getRange(sheet.getLastRow() + 1, 1, _logBuffer.length, LOG_HEADER.length).setValues(_logBuffer);
  SpreadsheetApp.flush();
  Logger.log(`${_logBuffer.length} Log-Zeilen geschrieben: ${sheet.getParent().getUrl()}`);
  _logBuffer = [];
}
