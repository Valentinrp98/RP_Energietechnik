// ==========================================================================================
// PROJEKT: "Fortschritt-Script"
// DATEI IM EDITOR: Regeln.gs      --> kompletten Inhalt ersetzen
//
// Die Ableitungsregeln als DATENTABELLE, nicht als if-Kaskade: ein neuer Meilenstein ist eine
// Zeile in der Tabelle, kein Umbau. Dazu die Textbildung fuer das Fortschritt-Feld.
// ==========================================================================================


// ===== ABLEITUNGSREGELN "Erledigt" =====
//
// Modus SPIEGEL: bei jedem Lauf wird die komplette Menge neu berechnet und gesetzt. Haken
// verschwinden also auch wieder, wenn ein Quellfeld zurueckgesetzt wird -- damit ist das Script
// idempotent und selbstheilend.
//
// Aufbau einer Regel:
//   optionId           Option-ID im Feld "Erledigt"
//   label              Klartext; erscheint in der Fortschritt-Zeile und im Log
//   aktivitaetsMuster  (optional) Betreff-Muster. Nur Regeln MIT diesem Feld brauchen ueberhaupt
//                      Aktivitaeten; ladeAktivitaetenIndex() leitet daraus ab, welche Betreffe
//                      gemerkt werden muessen -- eine neue Gespraechsregel erweitert den Filter
//                      damit automatisch mit, ohne dass man den Lader anfassen muss.
//   quelle(deal, betreffe)
//                      gibt einen BELEG-STRING zurueck wenn die Regel greift, sonst null.
//                      Bewusst kein nacktes true/false: der Beleg landet als "ausgeloest durch"
//                      im Log, damit nachvollziehbar ist WORAUF gematcht wurde (Rohwert des
//                      Quellfelds bzw. der tatsaechliche Aktivitaets-Betreff). Ein String ist
//                      truthy -- die Regel bleibt damit genauso auswertbar wie ein boolean.
//
// Die Reihenfolge ist FACHLICH: "letzter erledigter Schritt" ist die hoechste erfuellte Regel.
// Nicht umsortieren, ohne das mitzudenken -- die Quellfelder tragen keinen Zeitstempel, aus dem
// sich die tatsaechlich letzte Aenderung ableiten liesse.
//
// WARUM die Tabelle in einer Funktion steckt und nicht als top-level const:
// Apps Script wertet die .gs-Dateien eines Projekts in einer nicht garantierten Reihenfolge aus.
// Eine top-level `const ERLEDIGT_REGELN = [{ optionId: ERLEDIGT_OPTION_IDS.X }]` wuerde die
// Konstanten aus Config.gs bereits beim Laden auflesen -- wird Regeln.gs zuerst ausgewertet, ist
// das ein ReferenceError beim Projektstart und NICHTS laeuft mehr. In der Funktion werden die
// Konstanten erst beim Aufruf aufgeloest, also nach dem Laden aller Dateien. Inhaltlich bleibt es
// eine flache Datentabelle.
// ===== BETREFF-MUSTER DER GESPRAECHS-REGELN =====
//
// Diese beiden Regeln lesen FULFILLMENT-Aktivitaeten -- nicht die Sales-Termine anderer
// Abteilungen. Ein Zwischenstand, der kurz drinstand, hat "Besichtigung" (1751x) und
// "Abschlusstermin" (218x) gematcht: das sind Sales-Aktivitaeten und im Fulfillment-Fortschritt
// falsch. Zurueckgenommen (Valentin, 2026-08-17).
//
// GEMESSEN am 2026-08-17 mit listAktivitaetsBetreffe(): 13.632 erledigte Aktivitaeten, 405
// verschiedene Betreffe -- und KEIN EINZIGER enthaelt "Erstgespräch" oder "Zweitgespräch".
// Das ist das beste Argument fuer genau diese Muster: die Woerter sind im Bestand kollisionsfrei,
// ein Treffer kann also nur aus einer bewusst so benannten Fulfillment-Aktivitaet kommen.
//
// VORAUSSETZUNG: Die Aktivitaeten muessen erst existieren. Bis dahin greifen Regel 1 und 7 nie --
// das ist erwartetes Verhalten, kein Bug, und im Lauf an "Regel-Treffer: Erstgespräch=0" sichtbar.
// Anzulegen entweder ueber Automation A1 oder haendisch, Betreff muss das Wort enthalten.
//
// Gematcht wird als Teilstring (case- und umlauttolerant): "Erstgespräch Fulfillment",
// "Erstgespraech Kunde" oder nur "Erstgespräch" treffen alle. Deshalb bewusst ganze Woerter --
// ein Muster "termin" wuerde "Terminerinnerung" und "Termin vereinbaren" mitfangen.
const MUSTER_ERSTGESPRAECH = ['erstgespräch'];
const MUSTER_ZWEITGESPRAECH = ['zweitgespräch'];

let _erledigtRegelnCache = null;

function erledigtRegeln() {
  if (_erledigtRegelnCache) return _erledigtRegelnCache;

  _erledigtRegelnCache = [
    {
      optionId: ERLEDIGT_OPTION_IDS.Erstgespraech,
      label: 'Erstgespräch',
      aktivitaetsMuster: MUSTER_ERSTGESPRAECH,
      quelle: (deal, betreffe) => belegAusAktivitaet(betreffe, MUSTER_ERSTGESPRAECH)
    },
    {
      optionId: ERLEDIGT_OPTION_IDS.NetzUebergeben,
      label: 'Netz übergeben',
      quelle: (deal) => belegAusEnum(deal, NETZSTATUS_FIELD_KEY, 'Netzstatus', [
        NETZSTATUS_UEBERGEBEN, NETZSTATUS_EINGEREICHT, NETZSTATUS_ZAEHLPUNKT_DA, NETZSTATUS_FERTIGMELDUNG_RAUS
      ])
    },
    {
      optionId: ERLEDIGT_OPTION_IDS.ZaehlpunktDa,
      label: 'Zählpunkt da',
      quelle: (deal) =>
        belegAusEnum(deal, NETZSTATUS_FIELD_KEY, 'Netzstatus', [NETZSTATUS_ZAEHLPUNKT_DA, NETZSTATUS_FERTIGMELDUNG_RAUS])
        || belegAusText(deal, ZPN_FIELD_KEY, 'ZPN')
    },
    {
      optionId: ERLEDIGT_OPTION_IDS.ArRaus,
      label: 'AR raus',
      quelle: (deal) => belegAusEnum(deal, AR_VERSENDET_FIELD_KEY, 'AR versendet', [AR_VERSENDET_JA])
    },
    {
      optionId: ERLEDIGT_OPTION_IDS.AnzahlungDa,
      label: 'Anzahlung da',
      quelle: (deal) => belegAusEnum(deal, ZAHLUNGSEINGANG_FIELD_KEY, 'Zahlungseingang erhalten', [ZAHLUNGSEINGANG_JA])
    },
    {
      optionId: ERLEDIGT_OPTION_IDS.Geliefert,
      label: 'Geliefert',
      // OFFENE ANNAHME (im DRY-Vollauf zu pruefen, nicht vorab wegzudiskutieren): unterstellt,
      // dass ein verschobener Liefertermin auch im Feld korrigiert wird. Sind auffaellig viele
      // alte Deals "geliefert", obwohl sie es nicht sind, muss die Regel auf die Stage umgestellt
      // werden.
      quelle: (deal) => belegAusDatum(deal, LIEFERTERMIN_FIELD_KEY, 'Liefertermin')
    },
    {
      optionId: ERLEDIGT_OPTION_IDS.Zweitgespraech,
      label: 'Zweitgespräch',
      aktivitaetsMuster: MUSTER_ZWEITGESPRAECH,
      quelle: (deal, betreffe) => belegAusAktivitaet(betreffe, MUSTER_ZWEITGESPRAECH)
    },
    {
      optionId: ERLEDIGT_OPTION_IDS.Montiert,
      label: 'Montiert',
      // OFFENE ANNAHME (im DRY-Vollauf zu pruefen): funktioniert bei Full Service. Bei
      // Ausfuehrungsart "Selbstmontage" gibt es evtl. gar keinen AC-Termin -- diese Deals haengen
      // dann dauerhaft auf "nicht montiert". Deshalb schluesselt der Vollauf die Verteilung
      // zusaetzlich nach Ausfuehrungsart auf (AUSFUEHRUNGSART_FIELD_KEY in Config.gs).
      quelle: (deal) => belegAusDatum(deal, AC_TERMIN_FIELD_KEY, 'AC-Termin')
    },
    {
      optionId: ERLEDIGT_OPTION_IDS.IbErfolgt,
      label: 'IB erfolgt',
      // "IB erledigt am" zuerst: das ist die tatsaechliche Bestaetigung des Montagepartners.
      // "IB-Termin" ist nur der GEPLANTE Termin und damit die schwaechere Quelle -- er bleibt als
      // Fallback drin, damit Altdeals ohne das neue Feld weiter funktionieren. Solange
      // IB_ERLEDIGT_AM_FIELD_KEY auf TODO_ steht, ist der erste Teil wirkungslos.
      quelle: (deal) =>
        belegAusDatum(deal, IB_ERLEDIGT_AM_FIELD_KEY, 'IB erledigt am')
        || belegAusDatum(deal, IB_TERMIN_FIELD_KEY, 'IB-Termin (geplant)')
    },
    {
      optionId: ERLEDIGT_OPTION_IDS.Foerderzusage,
      label: 'Förderzusage',
      quelle: (deal) =>
        belegAusEnum(deal, FOERDERZUSAGE_FIELD_KEY, 'Förderzusage erhalten', [FOERDERZUSAGE_JA])
        || belegAusEnum(deal, FOERDERSTATUS_FIELD_KEY, 'Förderstatus', [FOERDERSTATUS_ZUGESAGT, FOERDERSTATUS_ABGERECHNET])
    },
    {
      optionId: ERLEDIGT_OPTION_IDS.Fertigmeldung,
      label: 'Fertigmeldung',
      quelle: (deal) => belegAusDatum(deal, FERTIGMELDUNG_AM_FIELD_KEY, 'Fertigmeldung am')
    }
  ];

  return _erledigtRegelnCache;
}


// ===== FORTSCHRITT-TEXT =====

// Quellfeld "Wartet auf" -> Kuerzel am Ende der Fortschritt-Zeile.
const WARTET_AUF_KURZ = {
  171: 'RP',
  172: 'Kunde',
  173: 'Partner',
  174: 'Lieferant',
  175: 'Netz',
  176: 'Förder',
  177: 'Leasing'
};

// Blockzeichen statt Emoji: Emoji rendern in Pipedrive-Listen inkonsistent und kosten Spaltenbreite.
const BALKEN_VOLL = '▰'; // U+25B0
const BALKEN_LEER = '▱'; // U+25B1
const TRENNER = ' · ';   // U+00B7
const HAKERL = '✓';      // U+2713 -- markiert den letzten ERLEDIGTEN Meilenstein

/**
 * Baut die Fortschritt-Zeile, z.B.:
 *   ▰▰▰▰▱▱▱▱▱▱▱ 4/11 · ✓ Anzahlung da · wa:Kunde
 *
 * Der Balken steht bewusst ZUERST -- dann sortiert die Pipedrive-Listenansicht alphabetisch
 * automatisch nach Fortschritt.
 *
 * @param {Object} deal            Deal aus der Listenabfrage
 * @param {Array}  erfuellteRegeln erfuellte Regeln, in der Reihenfolge von erledigtRegeln()
 * @return {{text: string|null, konfigFehler: string|null}}
 *         Ist konfigFehler gesetzt, ist text null und der Deal wird NICHT geschrieben. Lieber gar
 *         nichts schreiben als eine Zeile, die stillschweigend eine Information weglaesst -- sie
 *         ist zugleich Sortierschluessel in der Listenansicht.
 */
function baueFortschrittText(deal, erfuellteRegeln) {
  // Sonderzustaende ERSETZEN den Balken komplett (nicht anhaengen), damit tote Deals in der Liste
  // sofort auffallen. Beide haengen am SELBEN Stage 24 "Verschoben/storniert" -- getrennt wird
  // ueber die Grund-Felder (siehe Kommentar in Config.gs).
  if (istStage(deal, STAGE_ID_VERSCHOBEN_STORNIERT)) {
    if (leseEnumId(deal, STORNOGRUND_FIELD_KEY) !== null) {
      return { text: '✖ Storniert', konfigFehler: null };
    }
    if (leseEnumId(deal, VERSCHIEBEGRUND_FIELD_KEY) !== null
        || belegAusText(deal, VERSCHOBEN_AUF_FIELD_KEY, 'Verschoben auf')) {
      return { text: '⏸ Verschoben', konfigFehler: null };
    }
    // Weder Storno- noch Verschiebegrund gesetzt: nicht raten. Der Deal ist trotzdem aus dem
    // laufenden Prozess raus und soll in der Liste als solcher erkennbar sein.
    return { text: '⏸✖ Verschoben/storniert', konfigFehler: null };
  }

  const gesamt = erledigtRegeln().length;
  const anzahl = erfuellteRegeln.length;
  const balken = BALKEN_VOLL.repeat(anzahl) + BALKEN_LEER.repeat(gesamt - anzahl);

  if (anzahl === gesamt) return { text: `${balken} ${anzahl}/${gesamt} ${HAKERL}`, konfigFehler: null };

  const teile = [`${balken} ${anzahl}/${gesamt}`];

  // Letzter erledigter Schritt = die HOECHSTE erfuellte Regel (nicht die zuletzt gesetzte).
  // Bei 0/11 gibt es keinen -- das Segment entfaellt dann.
  //
  // Das Hakerl davor beantwortet die Frage, die der nackte Name offen laesst: ist dieser Schritt
  // ERLEDIGT oder ist er der naechste, der dran ist? Ohne das liest sich "4/11 · Anzahlung da"
  // zweideutig. Mit "✓ Anzahlung da" ist klar: das ist der letzte, der erledigt wurde.
  if (anzahl > 0) teile.push(`${HAKERL} ${erfuellteRegeln[erfuellteRegeln.length - 1].label}`);

  const wartetAufId = leseEnumId(deal, WARTET_AUF_FIELD_KEY);
  if (wartetAufId !== null) {
    const kurz = WARTET_AUF_KURZ[wartetAufId];
    if (!kurz) {
      return {
        text: null,
        konfigFehler: `"Wartet auf"-Option-ID ${wartetAufId} ist in WARTET_AUF_KURZ nicht hinterlegt`
      };
    }
    teile.push(`wa:${kurz}`);
  }

  return { text: teile.join(TRENNER), konfigFehler: null };
}


// ===== BELEG-HILFSFUNKTIONEN =====
// Jede gibt einen Beleg-String zurueck (Regel greift) oder null (greift nicht). Der Beleg enthaelt
// immer den ROHWERT -- so ist im Log nachvollziehbar, worauf gematcht wurde.

/** Enum-/Set-Feld enthaelt eine der erlaubten Option-IDs. */
function belegAusEnum(deal, fieldKey, feldName, erlaubteIds) {
  const ids = leseOptionIds(deal, fieldKey);
  const treffer = ids.filter(id => erlaubteIds.indexOf(id) !== -1);
  return treffer.length ? `${feldName}=${treffer.join(',')}` : null;
}

/** Textfeld ist nicht leer. */
function belegAusText(deal, fieldKey, feldName) {
  const wert = leseCustomField(deal, fieldKey);
  if (wert === null || wert === undefined) return null;
  const text = String(wert).trim();
  return text === '' ? null : `${feldName}="${text}"`;
}

/** Datumsfeld ist gesetzt UND liegt nicht in der Zukunft (<= heute). */
function belegAusDatum(deal, fieldKey, feldName) {
  const roh = leseCustomField(deal, fieldKey);
  if (roh === null || roh === undefined || String(roh).trim() === '') return null;

  // Pipedrive liefert Datumsfelder als "YYYY-MM-DD" (bei Datum+Zeit mit angehaengter Uhrzeit).
  // ISO-Datumsstrings lassen sich direkt lexikografisch vergleichen -- bewusst kein Date-Parsing,
  // damit keine Zeitzonen-Verschiebung um einen Tag entstehen kann.
  const datum = String(roh).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    // Bewusst NICHT raten -- aber auch nicht stillschweigend als "nicht erfuellt" durchgehen
    // lassen: ein unlesbares Datum ist ein fachlicher Grenzfall (SOFT_ERROR) und wird MIT ROHWERT
    // gemeldet. Genau so kam heraus, dass in einem PLZ-Feld eine Telefonnummer stand.
    meldeDatenqualitaet(`${feldName}: Wert "${String(roh).trim()}" ist kein Datum im Format YYYY-MM-DD -- Regel greift nicht`);
    return null;
  }
  return datum <= heuteIso() ? `${feldName}=${datum}` : null;
}


// ===== DATENQUALITAET =====
// Kleiner Sammler pro Deal. Die Regelfunktionen bekommen den Laufkontext nicht durchgereicht
// (sie sollen eine schlanke Signatur behalten), melden Auffaelligkeiten aber hierher. verarbeiteDeal()
// setzt den Sammler vor jedem Deal zurueck und holt das Ergebnis danach ab.

let _datenqualitaet = [];

function starteDatenqualitaet() { _datenqualitaet = []; }
function meldeDatenqualitaet(text) { _datenqualitaet.push(text); }
function holeDatenqualitaet() { return _datenqualitaet; }

/**
 * Am Deal haengt eine erledigte Aktivitaet, deren Betreff EINES der Muster enthaelt.
 * @param {string[]} betreffe
 * @param {string[]|string} muster ein Muster oder eine Liste (RP nennt denselben Termin
 *        unterschiedlich, siehe MUSTER_ERSTGESPRAECH)
 */
function belegAusAktivitaet(betreffe, muster) {
  if (!betreffe || !betreffe.length) return null;
  const gesucht = musterListe(muster);
  const treffer = betreffe.filter(b => {
    const norm = normalisiere(b);
    return gesucht.some(m => norm.indexOf(m) !== -1);
  })[0];
  // Betreff-Matching ist per Definition fragil -- deshalb steht der TATSAECHLICHE Betreff im
  // Beleg und damit im Log, nicht nur "Regel hat gegriffen".
  return treffer ? `Aktivität: "${treffer}"` : null;
}

/** Normalisiert ein einzelnes Muster oder eine Musterliste auf ein Array normalisierter Strings. */
function musterListe(muster) {
  if (!muster) return [];
  return (Array.isArray(muster) ? muster : [muster]).map(normalisiere);
}


// ===== LESE-HILFSFUNKTIONEN =====

/** Rohwert eines Custom Fields. custom_fields liefern die v2-Listenendpunkte gleich mit. */
function leseCustomField(deal, fieldKey) {
  const cf = deal.custom_fields || {};
  const wert = cf[fieldKey];
  return wert === undefined ? null : wert;
}

// ===== OPTION-REGISTRY (enum vs. autocomplete) =====
//
// STAND DER TATSACHEN (2026-08-17 gegen die echten dealFields geprueft): Alle Quellfelder dieses
// Scripts -- Netzstatus, Foerderstatus, AR versendet, Zahlungseingang, Foerderzusage, Wartet auf --
// sind echte "enum"-Felder und liefern numerische Option-IDs. Die Label-Aufloesung unten ist damit
// AKTUELL WIRKUNGSLOS. Sie steht bewusst trotzdem hier, als Absturzsicherung:
//
// In Sheet-Sync wurde am 2026-08-17 eine Options-ID in das Feld "Fortschritt" geschrieben, das
// varchar_auto ist -- Antwort HTTP 400, "Expected 'string' as autocomplete custom field value".
// Das Schreib- UND Leseformat haengt also am field_type, und Feldtypen sind in Pipedrive nicht
// nachtraeglich aenderbar: wird ein Quellfeld je neu angelegt und dabei anders getypt, kaeme
// "Zählpunkt da" als Text statt als 185. Number() machte daraus NaN, die Regel griffe nie, und der
// Lauf saehe mit lauter 0/11 wie ein sauberer Nulllauf aus -- die teuerste Fehlerart in diesem
// Projekt, weil sie gesund aussieht.
//
// Die Registry wird vom Hauptlauf aus den ohnehin geladenen dealFields gefuellt
// (fuelleOptionRegistry in Code.gs), kostet keinen zusaetzlichen API-Call. Ist sie leer,
// funktioniert alles wie sonst fuer numerische Werte.

let _optionRegistry = {}; // fieldKey -> { name: string, labels: { id: label } }

function setzeOptionRegistry(registry) { _optionRegistry = registry || {}; }

/**
 * Normalisiert Einfach- UND Mehrfachauswahl-Felder auf ein Array von Option-IDs.
 * Deckt alle Formen ab, in denen Pipedrive Optionswerte liefern kann: einzelne Zahl, Array von
 * Zahlen, Zahl als String, Objekt mit id, Array solcher Objekte -- UND das Label als String
 * (autocomplete-Felder, siehe Kommentar oben).
 */
function leseOptionIds(deal, fieldKey) {
  const wert = leseCustomField(deal, fieldKey);
  if (wert === null || wert === '') return [];
  const roh = Array.isArray(wert) ? wert : [wert];
  const feld = _optionRegistry[fieldKey] || { name: fieldKey, labels: {} };

  return roh
    .map(eintrag => aufOptionId(eintrag, feld))
    .filter(id => id !== null);
}

/** Ein einzelner Optionswert -> numerische Option-ID. null, wenn nicht aufloesbar. */
function aufOptionId(eintrag, feld) {
  if (eintrag === null || eintrag === undefined) return null;

  if (typeof eintrag === 'object') {
    eintrag = (eintrag.id !== undefined) ? eintrag.id : eintrag.label;
    if (eintrag === null || eintrag === undefined) return null;
  }

  const text = String(eintrag).trim();
  if (text === '') return null;

  // Numerisch -> direkt die Option-ID (enum/set, der Normalfall).
  const zahl = Number(text);
  if (!isNaN(zahl)) return zahl;

  // Nicht numerisch -> autocomplete-Feld liefert das Label. Ueber die Feld-Metadaten zurueck
  // auf die ID, damit die Regeln weiter mit IDs vergleichen koennen.
  const gesucht = normalisiere(text);
  for (const id in feld.labels) {
    if (normalisiere(feld.labels[id]) === gesucht) return Number(id);
  }

  // Weder Zahl noch bekanntes Label -- nicht raten, aber auch nicht verschweigen: sonst greift
  // die Regel stillschweigend nicht und der Lauf sieht gesund aus.
  meldeDatenqualitaet(`${feld.name}: Wert "${text}" ist weder eine Option-ID noch ein bekanntes `
    + `Options-Label -- Regel greift nicht`);
  return null;
}

/** Wie leseOptionIds, aber fuer Felder mit genau einer Option. null wenn leer. */
function leseEnumId(deal, fieldKey) {
  const ids = leseOptionIds(deal, fieldKey);
  return ids.length ? ids[0] : null;
}

/** Heutiges Datum als "YYYY-MM-DD" in der Script-Zeitzone (appsscript.json: Europe/Vienna). */
function heuteIso() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * Kleinschreibung + Umlaut-Transliteration, damit "Erstgespräch", "erstgespraech" und
 * "ERSTGESPRÄCH" gleich behandelt werden -- Aktivitaets-Betreffe tippen Menschen, und Vorlagen
 * schreiben Umlaute uneinheitlich. Beide Seiten (Muster und Betreff) laufen durch dieselbe
 * Funktion, deshalb kann die Normalisierung keine Asymmetrie erzeugen.
 */
function normalisiere(text) {
  return String(text).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

/**
 * Stage-Vergleich. Ist die Stage-ID noch ein TODO_-Platzhalter (also kein number), liefert das
 * bewusst false statt zufaellig zu matchen -- der Hauptlauf startet in diesem Zustand ohnehin
 * nicht, weil pruefeKonfiguration() vorher abbricht.
 */
function istStage(deal, stageId) {
  if (typeof stageId !== 'number') return false;
  return Number(deal.stage_id) === stageId;
}
