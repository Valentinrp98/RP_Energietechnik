// ==========================================================================================
// PROJEKT: "Fortschritt-Script"
// DATEI IM EDITOR: Regeln.gs
//
// Die Ableitungsregeln als DATENTABELLE, nicht als if-Kaskade: ein neuer Meilenstein ist eine
// Zeile in ERLEDIGT_REGELN, kein Umbau.
// ==========================================================================================


// ===== ABLEITUNGSREGELN "Erledigt" =====
//
// Modus SPIEGEL: bei jedem Lauf wird die komplette Menge neu berechnet und gesetzt. Haken
// verschwinden also auch wieder, wenn das Quellfeld zurueckgesetzt wird -- damit ist das
// Script idempotent und selbstheilend.
//
// Aufbau einer Regel:
//   optionId          Option-ID im Feld "Erledigt"
//   label             Klartext, erscheint in der Fortschritt-Zeile und im Log
//   aktivitaetsMuster (optional) Betreff-Muster; nur Regeln mit diesem Feld brauchen Aktivitaeten.
//                     ladeAktivitaetenIndex() leitet daraus ab, welche Betreffe ueberhaupt
//                     gemerkt werden muessen -- eine neue Gespraechsregel erweitert den Filter
//                     damit automatisch mit.
//   quelle(deal, betreffe)
//                     gibt einen BELEG-STRING zurueck wenn die Regel greift, sonst null.
//                     Bewusst kein reines true/false: der Beleg landet als "ausgeloest durch"
//                     im Log, damit nachvollziehbar ist, WORAUF gematcht wurde (Rohwert des
//                     Quellfelds bzw. der tatsaechliche Aktivitaets-Betreff). Ein String ist
//                     truthy, die Regel bleibt damit so auswertbar wie ein boolean.
//
// Die Reihenfolge in dieser Tabelle ist fachlich: "letzter erledigter Schritt" ist die
// HOECHSTE erfuellte Regel. Nicht umsortieren, ohne das mitzudenken -- die Quellfelder tragen
// keinen Zeitstempel, aus dem man die tatsaechlich letzte Aenderung ableiten koennte.
const ERLEDIGT_REGELN = [
  {
    optionId: ERLEDIGT_OPTION_IDS.Erstgespraech,
    label: 'Erstgespräch',
    aktivitaetsMuster: 'erstgespräch',
    quelle: (deal, betreffe) => belegAusAktivitaet(betreffe, 'erstgespräch')
  },
  {
    optionId: ERLEDIGT_OPTION_IDS.NetzUebergeben,
    label: 'Netz übergeben',
    quelle: (deal) => belegAusEnum(deal, NETZSTATUS_FIELD_KEY, 'Netzstatus',
      [NETZSTATUS_UEBERGEBEN, NETZSTATUS_EINGEREICHT, NETZSTATUS_ZAEHLPUNKT_DA, NETZSTATUS_FERTIGMELDUNG_RAUS])
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
    // ANNAHME (im DRY-Vollauf zu pruefen): unterstellt, dass ein verschobener Liefertermin auch
    // im Feld korrigiert wird. Sind auffaellig viele alte Deals "geliefert", obwohl sie es nicht
    // sind, muss die Regel auf die Stage umgestellt werden.
    quelle: (deal) => belegAusDatum(deal, LIEFERTERMIN_FIELD_KEY, 'Liefertermin')
  },
  {
    optionId: ERLEDIGT_OPTION_IDS.Zweitgespraech,
    label: 'Zweitgespräch',
    aktivitaetsMuster: 'zweitgespräch',
    quelle: (deal, betreffe) => belegAusAktivitaet(betreffe, 'zweitgespräch')
  },
  {
    optionId: ERLEDIGT_OPTION_IDS.Montiert,
    label: 'Montiert',
    // ANNAHME (im DRY-Vollauf zu pruefen): funktioniert bei Full Service. Bei Ausfuehrungsart
    // "Selbstmontage" gibt es evtl. gar keinen AC-Termin -- diese Deals haengen dann dauerhaft
    // auf "nicht montiert". Deshalb schluesselt der Vollauf die Verteilung nach Ausfuehrungsart auf.
    quelle: (deal) => belegAusDatum(deal, AC_TERMIN_FIELD_KEY, 'AC-Termin')
  },
  {
    optionId: ERLEDIGT_OPTION_IDS.IbErfolgt,
    label: 'IB erfolgt',
    quelle: (deal) => belegAusDatum(deal, IB_TERMIN_FIELD_KEY, 'IB-Termin')
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
const BALKEN_VOLL = '▰';  // U+25B0
const BALKEN_LEER = '▱';  // U+25B1
const TRENNER = ' · ';    // U+00B7

/**
 * Baut die Fortschritt-Zeile, z.B.:
 *   ▰▰▰▰▱▱▱▱▱▱▱ 4/11 · Anzahlung da · wa:Kunde
 *
 * Der Balken steht bewusst ZUERST: dann sortiert die Pipedrive-Listenansicht alphabetisch
 * automatisch nach Fortschritt.
 *
 * @param {Object} deal            Deal aus der Listenabfrage
 * @param {Array}  erfuellteRegeln erfuellte Regeln, in der Reihenfolge von ERLEDIGT_REGELN
 * @return {{text: string|null, konfigFehler: string|null}}
 *         konfigFehler ist gesetzt, wenn eine "Wartet auf"-Option-ID unbekannt ist. In dem Fall
 *         ist text null und der Deal wird NICHT geschrieben -- lieber gar nichts schreiben als
 *         eine Zeile, die stillschweigend eine Information weglaesst (sie ist zugleich Sortier-
 *         schluessel in der Listenansicht).
 */
function baueFortschrittText(deal, erfuellteRegeln) {
  // Sonderzustaende ERSETZEN den Balken komplett (nicht anhaengen), damit tote Deals in der
  // Liste sofort auffallen.
  if (istStage(deal, STAGE_ID_STORNIERT)) return { text: '✖ Storniert', konfigFehler: null };
  if (istStage(deal, STAGE_ID_VERSCHOBEN)) return { text: '⏸ Verschoben', konfigFehler: null };

  const gesamt = ERLEDIGT_REGELN.length;
  const anzahl = erfuellteRegeln.length;
  const balken = BALKEN_VOLL.repeat(anzahl) + BALKEN_LEER.repeat(gesamt - anzahl);

  if (anzahl === gesamt) return { text: `${balken} ${anzahl}/${gesamt} ✓`, konfigFehler: null };

  const teile = [`${balken} ${anzahl}/${gesamt}`];

  // Letzter erledigter Schritt = die HOECHSTE erfuellte Regel (nicht die zuletzt gesetzte --
  // die Quellfelder tragen keinen Zeitstempel). Bei 0/11 gibt es keinen, das Segment entfaellt.
  if (anzahl > 0) teile.push(erfuellteRegeln[erfuellteRegeln.length - 1].label);

  const wartetAufId = leseEnumId(deal, WARTET_AUF_FIELD_KEY);
  if (wartetAufId !== null) {
    const kurz = WARTET_AUF_KURZ[wartetAufId];
    if (!kurz) {
      return {
        text: null,
        konfigFehler: `KONFIG-FEHLER: "Wartet auf"-Option-ID ${wartetAufId} ist in WARTET_AUF_KURZ nicht hinterlegt`
      };
    }
    teile.push(`wa:${kurz}`);
  }

  return { text: teile.join(TRENNER), konfigFehler: null };
}


// ===== BELEG-HILFSFUNKTIONEN =====
// Jede gibt einen Beleg-String zurueck (Regel greift) oder null (greift nicht). Der Beleg
// enthaelt immer den ROHWERT, damit im Log nachvollziehbar ist, worauf gematcht wurde.

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
  // ISO-Datumsstrings lassen sich direkt lexikografisch vergleichen -- kein Date-Parsing, damit
  // keine Zeitzonen-Verschiebung um einen Tag entsteht.
  const datum = String(roh).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return null; // unerwartetes Format: nicht raten
  return datum <= heuteIso() ? `${feldName}=${datum}` : null;
}

/** Am Deal haengt eine erledigte Aktivitaet, deren Betreff das Muster enthaelt. */
function belegAusAktivitaet(betreffe, muster) {
  if (!betreffe || !betreffe.length) return null;
  const gesucht = normalisiere(muster);
  const treffer = betreffe.filter(b => normalisiere(b).indexOf(gesucht) !== -1)[0];
  // Betreff-Matching ist per Definition fragil -- deshalb steht der TATSAECHLICHE Betreff im
  // Beleg und damit im Log, nicht nur "Regel hat gegriffen".
  return treffer ? `Aktivität: "${treffer}"` : null;
}


// ===== LESE-HILFSFUNKTIONEN =====

/** Rohwert eines Custom Fields. custom_fields kommt bei v2-Listenendpunkten mit. */
function leseCustomField(deal, fieldKey) {
  const cf = deal.custom_fields || {};
  const wert = cf[fieldKey];
  return wert === undefined ? null : wert;
}

/**
 * Normalisiert Einfach- UND Mehrfachauswahl-Felder auf ein Array von Option-IDs.
 * Deckt die Formen ab, in denen Pipedrive Optionswerte liefern kann (einzelne Zahl, Array von
 * Zahlen, Objekt mit id, Array solcher Objekte) -- kostet nichts und verhindert, dass eine
 * abweichende Antwortform stillschweigend als "nicht erfuellt" durchgeht.
 */
function leseOptionIds(deal, fieldKey) {
  const wert = leseCustomField(deal, fieldKey);
  if (wert === null || wert === '') return [];
  const roh = Array.isArray(wert) ? wert : [wert];
  return roh
    .map(e => (e !== null && typeof e === 'object') ? e.id : e)
    .map(e => Number(e))
    .filter(e => !isNaN(e));
}

/** Wie leseOptionIds, aber fuer Felder mit genau einer Option. null wenn leer. */
function leseEnumId(deal, fieldKey) {
  const ids = leseOptionIds(deal, fieldKey);
  return ids.length ? ids[0] : null;
}

/** Heutiges Datum als "YYYY-MM-DD" in der Zeitzone des Scripts (appsscript.json: Europe/Vienna). */
function heuteIso() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * Kleinschreibung + Umlaut-Transliteration, damit "Erstgespräch", "erstgespraech" und
 * "ERSTGESPRÄCH" alle gleich behandelt werden -- Aktivitaets-Betreffe werden von Menschen
 * getippt, und Apps-Script-/Pipedrive-Vorlagen schreiben Umlaute uneinheitlich.
 */
function normalisiere(text) {
  return String(text).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

/** Stage-Vergleich, der TODO_-Platzhalter nie versehentlich matchen laesst. */
function istStage(deal, stageId) {
  if (typeof stageId !== 'number') return false;
  return Number(deal.stage_id) === stageId;
}
