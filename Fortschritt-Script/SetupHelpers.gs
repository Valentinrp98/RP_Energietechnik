// ==========================================================================================
// PROJEKT: "Fortschritt-Script"
// DATEI IM EDITOR: SetupHelpers.gs  --> kompletten Inhalt ersetzen
//
// Konfigurationspruefung, Testfunktionen, Trigger. Alle Funktionen hier sind PARAMETERLOS und
// damit im Editor per Play-Button startbar -- der Button ruft ohne Argumente auf, ein Parameter
// waere dort immer undefined (das hat schon einmal eine Webhook-URL "undefined?token=..." erzeugt).
// Werte, die man variieren will, stehen als Konstanten in Config.gs.
// ==========================================================================================


// ===== 1. KONFIGURATIONSPRUEFUNG =====

/**
 * Testplan Schritt 1. Gleicht ALLE hartcodierten Option-IDs und die Stage-IDs gegen die echte API
 * ab (GET /api/v2/dealFields, GET /api/v2/stages) und schreibt das Ergebnis ins Protokoll.
 * Vor jedem Vollauf ausfuehren. Der Hauptlauf ruft dieselbe Pruefung selbst auf und BRICHT AB,
 * wenn sie nicht sauber ist -- er warnt nicht nur.
 */
function pruefeKonfiguration() {
  const ergebnis = pruefeKonfigurationIntern();
  ergebnis.meldungen.forEach(m => Logger.log(m));
  Logger.log(ergebnis.fehler === 0
    ? 'Konfiguration OK -- der Hauptlauf wuerde starten.'
    : `${ergebnis.fehler} Abweichung(en). Der Hauptlauf BRICHT in diesem Zustand ab. Oben korrigieren.`);
}

/**
 * Der eigentliche Abgleich. Gibt Fehlerzahl, Meldungen und die geladenen Metadaten zurueck, damit
 * der Hauptlauf die dealFields fuer die Ausfuehrungsart-Labels weiterverwenden kann statt sie
 * nochmal zu holen.
 * @return {{fehler: number, meldungen: string[], felder: Object[], stages: Object[]}}
 */
function pruefeKonfigurationIntern() {
  const meldungen = [];
  let fehler = 0;
  const fehlerMelden = (text) => { meldungen.push(`FEHLER: ${text}`); fehler++; };
  const hinweis = (text) => meldungen.push(`Hinweis: ${text}`);

  // field_name ist das Klartext-Label, field_code der Identifier. "name" ist bei ALLEN Feldern
  // undefined -- wer danach greift, bekommt lautlos nichts.
  const felder = fetchPipedrive('dealFields?limit=500') || [];
  const feldNach = {};
  felder.forEach(f => { feldNach[f.field_code] = f; });

  // ---- Zielfeld "Erledigt": Typ set, alle 11 Optionen mit passendem Label ----------------
  const erledigt = feldNach[ERLEDIGT_FIELD_KEY];
  if (!erledigt) {
    fehlerMelden(`Zielfeld "Erledigt" (${ERLEDIGT_FIELD_KEY}) existiert nicht (mehr).`);
  } else {
    meldungen.push(`Erledigt: "${erledigt.field_name}", Typ ${erledigt.field_type}, ${(erledigt.options || []).length} Optionen`);
    if (erledigt.field_type !== 'set') {
      // Das Schreibformat haengt am field_type, nicht daran, ob ein Feld Optionen hat. In
      // Sheet-Sync wurde 2026-08-17 eine Options-ID in das Feld "Fortschritt" geschrieben, das
      // varchar_auto ist -- Antwort: HTTP 400 "Expected 'string' as autocomplete custom field
      // value". Deshalb hier abbrechen statt ein Array von IDs in ein Textfeld zu schicken.
      fehlerMelden(`"Erledigt" ist Typ "${erledigt.field_type}", erwartet wird "set" (Mehrfachauswahl). `
        + `Das Script schreibt ein Array von Option-IDs -- ein Textfeld quittiert das mit HTTP 400. `
        + `Bevor der field_code getauscht wird: pruefen, welches Feld die 11 Meilenstein-Optionen traegt.`);
    }
    if (erledigt.is_writable === false) fehlerMelden('"Erledigt" ist laut API nicht beschreibbar (is_writable=false).');

    const live = {};
    (erledigt.options || []).forEach(o => { live[o.id] = o.label; });
    Object.keys(ERLEDIGT_OPTION_LABELS).forEach(idText => {
      const id = Number(idText);
      const sollLabel = ERLEDIGT_OPTION_LABELS[id];
      if (live[id] === undefined) {
        fehlerMelden(`Erledigt-Option ${id} ("${sollLabel}") existiert in Pipedrive nicht.`);
      } else if (normalisiere(live[id]) !== normalisiere(sollLabel)) {
        // Nur die ID zu pruefen wuerde nicht auffallen, wenn eine Option inzwischen etwas anderes
        // bedeutet -- genau das wird sonst zur stillen Falschbefuellung.
        fehlerMelden(`Erledigt-Option ${id}: Script erwartet "${sollLabel}", Pipedrive sagt "${live[id]}".`);
      }
    });
    Object.keys(live).forEach(id => {
      if (ERLEDIGT_OPTION_LABELS[Number(id)] === undefined) {
        hinweis(`Pipedrive kennt im Feld "Erledigt" zusaetzlich "${live[id]}" (id ${id}) -- im Script nicht hinterlegt. `
          + `Das Script wuerde diesen Haken bei jedem Lauf entfernen (Spiegel-Modus).`);
      }
    });
  }

  // Jede Regel muss auf eine bekannte Erledigt-Option zeigen.
  erledigtRegeln().forEach(r => {
    if (r.optionId === undefined || r.optionId === null) {
      fehlerMelden(`Regel "${r.label}" hat keine optionId (ERLEDIGT_OPTION_IDS-Schluessel vertippt?).`);
    } else if (ERLEDIGT_OPTION_LABELS[r.optionId] === undefined) {
      fehlerMelden(`Regel "${r.label}" zeigt auf Option ${r.optionId}, die in ERLEDIGT_OPTION_LABELS fehlt.`);
    }
  });
  if (erledigtRegeln().length !== Object.keys(ERLEDIGT_OPTION_LABELS).length) {
    hinweis(`${erledigtRegeln().length} Regeln, aber ${Object.keys(ERLEDIGT_OPTION_LABELS).length} Erledigt-Optionen `
      + `hinterlegt -- Balken und Zaehler richten sich nach der Regelanzahl.`);
  }

  // ---- Zielfeld "Fortschritt": Typ ------------------------------------------------------
  const fortschritt = feldNach[FORTSCHRITT_FIELD_KEY];
  if (!fortschritt) {
    fehlerMelden(`Zielfeld "Fortschritt" (${FORTSCHRITT_FIELD_KEY}) existiert nicht (mehr).`);
  } else {
    meldungen.push(`Fortschritt: "${fortschritt.field_name}", Typ ${fortschritt.field_type}`);
    if (fortschritt.is_writable === false) fehlerMelden('"Fortschritt" ist laut API nicht beschreibbar (is_writable=false).');

    if (fortschritt.field_type === 'varchar_auto') {
      const text = `"Fortschritt" ist Typ varchar_auto (Autocomplete). Jeder geschriebene Wert landet dauerhaft `
        + `in der Vorschlagsliste; das Format erzeugt 400+ distinkte Werte und muellt sie zu. `
        + `Feldtyp in Pipedrive auf varchar umstellen (Feld ist noch leer, es geht nichts verloren).`;
      if (DRY_RUN) {
        hinweis(`${text} -- DRY-Laeufe sind damit erlaubt, LIVE nicht.`);
      } else if (FORTSCHRITT_AUTOCOMPLETE_AKZEPTIERT) {
        hinweis(`${text} -- bewusst akzeptiert (FORTSCHRITT_AUTOCOMPLETE_AKZEPTIERT=true).`);
      } else {
        fehlerMelden(`${text} Oder FORTSCHRITT_AUTOCOMPLETE_AKZEPTIERT=true setzen, dann aber den `
          + `ZPN-Retry-Workaround aus Sheet-Sync/FieldSync.gs uebernehmen.`);
      }
    } else if (fortschritt.field_type !== 'varchar' && fortschritt.field_type !== 'text') {
      fehlerMelden(`"Fortschritt" ist Typ "${fortschritt.field_type}", erwartet wird ein Textfeld (varchar). `
        + `Das Script schreibt dort einen String.`);
    }
  }

  // ---- Quellfelder ----------------------------------------------------------------------
  // Als Datentabelle, damit ein neues Quellfeld hier eine Zeile ist. Steht bewusst IN der
  // Funktion: eine top-level const wuerde die Config-Konstanten schon beim Laden auflesen, und die
  // Auswertungsreihenfolge der .gs-Dateien ist in Apps Script nicht garantiert.
  const quellfelder = [
    { key: NETZSTATUS_FIELD_KEY, name: 'Netzstatus', typ: 'enum',
      optionen: [NETZSTATUS_UEBERGEBEN, NETZSTATUS_EINGEREICHT, NETZSTATUS_ZAEHLPUNKT_DA, NETZSTATUS_FERTIGMELDUNG_RAUS] },
    { key: FOERDERSTATUS_FIELD_KEY, name: 'Förderstatus', typ: 'enum',
      optionen: [FOERDERSTATUS_ZUGESAGT, FOERDERSTATUS_ABGERECHNET] },
    { key: AR_VERSENDET_FIELD_KEY, name: 'AR versendet', typ: 'enum', optionen: [AR_VERSENDET_JA] },
    { key: ZAHLUNGSEINGANG_FIELD_KEY, name: 'Zahlungseingang erhalten', typ: 'enum', optionen: [ZAHLUNGSEINGANG_JA] },
    { key: FOERDERZUSAGE_FIELD_KEY, name: 'Förderzusage erhalten', typ: 'enum', optionen: [FOERDERZUSAGE_JA] },
    { key: ZPN_FIELD_KEY, name: 'Einspeisezählpunkt (ZPN)', typ: null, optionen: [] },
    // heisst in Pipedrive "Material-Liefertermin" (2026-08-17 verifiziert), der Plan nannte es "Liefertermin"
    { key: LIEFERTERMIN_FIELD_KEY, name: 'Material-Liefertermin', typ: 'date', optionen: [] },
    { key: AC_TERMIN_FIELD_KEY, name: 'AC-Termin', typ: 'date', optionen: [] },
    { key: IB_TERMIN_FIELD_KEY, name: 'IB-Termin (geplant)', typ: 'date', optionen: [] },
    { key: IB_ERLEDIGT_AM_FIELD_KEY, name: 'IB erledigt am', typ: 'date', optionen: [] },
    { key: FERTIGMELDUNG_AM_FIELD_KEY, name: 'Fertigmeldung am', typ: 'date', optionen: [] }
  ];

  quellfelder.forEach(q => {
    const feld = feldNach[q.key];
    if (!feld) {
      fehlerMelden(`Quellfeld "${q.name}" (${q.key}) existiert nicht (mehr) -- die zugehoerige Regel wuerde nie greifen.`);
      return;
    }
    if (q.typ && feld.field_type !== q.typ) {
      // Warnung, kein Abbruch: die Lesefunktionen kommen mit mehreren Formen zurecht. Ein
      // abweichender Typ ist aber der wahrscheinlichste Grund fuer eine Regel, die nie greift.
      hinweis(`"${q.name}" ist Typ "${feld.field_type}", erwartet wurde "${q.typ}" -- pruefen, ob die Regel noch stimmt.`);
    }
    // Lesen ist bei autocomplete-Optionsfeldern anders: Pipedrive liefert dann das LABEL als
    // String, nicht die numerische Option-ID (in Sheet-Sync 2026-08-17 live aufgeschlagen).
    // Das Script loest solche Werte ueber die Option-Registry zurueck auf IDs auf -- der Hinweis
    // steht hier, damit im Protokoll sichtbar ist, WARUM das noetig ist.
    if (q.optionen.length && feld.field_type === 'autocomplete') {
      hinweis(`"${q.name}" ist ein autocomplete-Feld MIT Options-Liste -- Werte kommen als Label-String `
        + `statt als Option-ID. Das Script loest sie ueber die Feld-Metadaten zurueck auf, die Regel `
        + `funktioniert also. Nur falls RP dort Freitext eintraegt, greift sie nicht (wird als SOFT_ERROR geloggt).`);
    }
    const live = {};
    (feld.options || []).forEach(o => { live[o.id] = o.label; });
    q.optionen.forEach(id => {
      if (live[id] === undefined) {
        fehlerMelden(`"${q.name}": Option-ID ${id} existiert in Pipedrive nicht (Optionen dort: `
          + `${Object.keys(live).map(k => `${k}="${live[k]}"`).join(', ') || 'keine'}).`);
      } else {
        meldungen.push(`   ${q.name}: ${id} = "${live[id]}"`);
      }
    });
  });

  // ---- "Wartet auf": beide Richtungen pruefen -------------------------------------------
  const wartetAuf = feldNach[WARTET_AUF_FIELD_KEY];
  if (!wartetAuf) {
    fehlerMelden(`Quellfeld "Wartet auf" (${WARTET_AUF_FIELD_KEY}) existiert nicht (mehr).`);
  } else {
    const live = {};
    (wartetAuf.options || []).forEach(o => { live[o.id] = o.label; });
    Object.keys(WARTET_AUF_KURZ).forEach(idText => {
      if (live[Number(idText)] === undefined) {
        fehlerMelden(`"Wartet auf": Option-ID ${idText} ("${WARTET_AUF_KURZ[idText]}") existiert in Pipedrive nicht.`);
      }
    });
    // Diese Richtung ist die wichtigere: eine Option, die Pipedrive kennt und das Script nicht,
    // laesst jeden betroffenen Deal im Hauptlauf als HARD_ERROR liegen (er wird dann NICHT
    // geschrieben). Hier faellt das vorher auf statt erst in hunderten Logzeilen.
    Object.keys(live).forEach(id => {
      if (WARTET_AUF_KURZ[Number(id)] === undefined) {
        fehlerMelden(`"Wartet auf": Pipedrive kennt Option ${id} ("${live[id]}"), WARTET_AUF_KURZ nicht. `
          + `Kuerzel in Regeln.gs ergaenzen, sonst bleiben diese Deals ungeschrieben.`);
      }
    });
  }

  // ---- Stage + Grund-Felder fuer die Sonderzustaende ------------------------------------
  const stages = fetchPipedrive('stages?limit=500') || [];
  fehler += pruefeStage(stages, STAGE_ID_VERSCHOBEN_STORNIERT, STAGE_NAME_VERSCHOBEN_STORNIERT,
    'STAGE_ID_VERSCHOBEN_STORNIERT', meldungen);

  // Ohne die Grund-Felder liessen sich Storno und Verschiebung nicht unterscheiden -- sie haengen
  // am selben Stage.
  [[STORNOGRUND_FIELD_KEY, 'Stornogrund'],
   [VERSCHIEBEGRUND_FIELD_KEY, 'Verschiebegrund'],
   [VERSCHOBEN_AUF_FIELD_KEY, 'Verschoben auf']].forEach(([key, bez]) => {
    const feld = feldNach[key];
    if (!feld) fehlerMelden(`Feld "${bez}" (${key}) existiert nicht (mehr) -- ohne es fallen alle Deals `
      + `im Stage "${STAGE_NAME_VERSCHOBEN_STORNIERT}" in den neutralen Sammelzustand.`);
    else meldungen.push(`   ${bez}: "${feld.field_name}" (${feld.field_type})`);
  });

  // ---- Sonstige Selbstpruefungen --------------------------------------------------------
  if (LEERWERT_FUER_SET !== null && !Array.isArray(LEERWERT_FUER_SET)) {
    fehlerMelden(`LEERWERT_FUER_SET muss null oder [] sein, ist aber "${LEERWERT_FUER_SET}".`);
  }
  if (DASHBOARD_ENABLED && String(DASHBOARD_SHEET_ID).indexOf('TODO_') === 0) {
    hinweis('DASHBOARD_ENABLED=true, aber DASHBOARD_SHEET_ID steht auf TODO_ -- Dashboard-Zeilen entfallen.');
  }
  if (String(AUSFUEHRUNGSART_FIELD_KEY).indexOf('TODO_') === 0) {
    hinweis('AUSFUEHRUNGSART_FIELD_KEY steht auf TODO_ -- die Aufschluesselung nach Ausfuehrungsart '
      + '(Selbstmontage-Frage, Testplan Schritt 4) entfaellt. Feldcode mit listDealFieldsHelper() ermitteln.');
  }
  meldungen.push(`Modus: ${DRY_RUN ? 'DRY (es wird nichts geschrieben)' : 'LIVE (es wird geschrieben)'}`);

  return { fehler: fehler, meldungen: meldungen, felder: felder, stages: stages };
}

/** Prueft eine Stage-ID gegen GET /api/v2/stages -- inklusive Namensabgleich. */
function pruefeStage(stages, stageId, erwarteterName, konstantenName, meldungen) {
  if (typeof stageId !== 'number') {
    meldungen.push(`FEHLER: ${konstantenName} ist noch nicht erhoben (Wert "${stageId}"). `
      + `Mit listStagesHelper() die ID der Stage "${erwarteterName}" ermitteln und als ZAHL in Config.gs eintragen. `
      + `Ohne das wuerde der Sonderzustand stillschweigend nie greifen.`);
    return 1;
  }
  const stage = stages.filter(s => Number(s.id) === stageId)[0];
  if (!stage) {
    meldungen.push(`FEHLER: ${konstantenName}=${stageId} existiert in Pipedrive nicht.`);
    return 1;
  }
  if (normalisiere(stage.name).indexOf(normalisiere(erwarteterName)) === -1) {
    meldungen.push(`FEHLER: ${konstantenName}=${stageId} heisst in Pipedrive "${stage.name}", erwartet wurde `
      + `etwas mit "${erwarteterName}". Verwechselte ID wuerde die falschen Deals als Sonderzustand markieren.`);
    return 1;
  }
  meldungen.push(`   ${konstantenName}: ${stageId} = "${stage.name}"`);
  return 0;
}


// ===== 2. EINZELDEAL-TESTS =====

/**
 * Testplan Schritt 2: rechnet EINEN Deal (TEST_DEAL_ID) durch und schluesselt jede der 11 Regeln
 * einzeln auf -- Treffer, Beleg und Rohwert. Damit laesst sich die berechnete Menge von Hand gegen
 * die Pipedrive-Oberflaeche gegenpruefen.
 */
function testEinzelDeal() {
  const konfig = pruefeKonfigurationIntern();
  konfig.meldungen.forEach(m => Logger.log(m));
  if (konfig.fehler > 0) {
    Logger.log(`ABBRUCH: ${konfig.fehler} Konfigurationsabweichung(en) -- erst korrigieren.`);
    return;
  }

  const ctx = neuerKontext('manuell (Einzeldeal)');
  ctx.ausfuehrungsartLabels = optionLabelMap(konfig.felder, AUSFUEHRUNGSART_FIELD_KEY);
  fuelleOptionRegistry(konfig.felder);
  try {
    const deal = fetchPipedrive(`deals/${TEST_DEAL_ID}`);
    const betreffe = ladeAktivitaetsBetreffeFuerDeal(TEST_DEAL_ID);
    erklaereDeal(deal, betreffe);
    verarbeiteDeal(deal, betreffe, ctx);
  } finally {
    flushLog();
  }
  Logger.log(baueZusammenfassung(ctx, false, 0, bestimmeStatus(ctx, false)).langtext);
}

/**
 * Testplan Schritt 3 und 7: rechnet die in TEST_DEAL_IDS_RANDFAELLE eingetragenen Deals durch.
 * Dort gehoeren die Randfaelle hinein: ein Deal ohne jeden Meilenstein (0/11), ein 11/11-Deal, ein
 * stornierter und ein verschobener Deal. Bei DRY_RUN=false ist das zugleich der kontrollierte
 * Live-Test an 2-3 Deals, bevor der Vollauf scharf laeuft.
 */
function testRandfaelle() {
  const konfig = pruefeKonfigurationIntern();
  konfig.meldungen.forEach(m => Logger.log(m));
  if (konfig.fehler > 0) {
    Logger.log(`ABBRUCH: ${konfig.fehler} Konfigurationsabweichung(en) -- erst korrigieren.`);
    return;
  }

  const ctx = neuerKontext('manuell (Randfaelle)');
  ctx.ausfuehrungsartLabels = optionLabelMap(konfig.felder, AUSFUEHRUNGSART_FIELD_KEY);
  fuelleOptionRegistry(konfig.felder);
  try {
    TEST_DEAL_IDS_RANDFAELLE.forEach(dealId => {
      const deal = fetchPipedrive(`deals/${dealId}`);
      const betreffe = ladeAktivitaetsBetreffeFuerDeal(dealId);
      erklaereDeal(deal, betreffe);
      verarbeiteDeal(deal, betreffe, ctx);
    });
  } finally {
    flushLog();
  }
  Logger.log(baueZusammenfassung(ctx, false, 0, bestimmeStatus(ctx, false)).langtext);
}

/** Schluesselt fuer einen Deal jede Regel einzeln auf: Treffer, Beleg, sonst der Rohwert. */
function erklaereDeal(deal, betreffe) {
  Logger.log(`--- Deal ${deal.id} "${deal.title}" (stage_id ${deal.stage_id}, status ${deal.status}) ---`);
  Logger.log(`Erledigte Aktivitaeten am Deal (Betreffe): ${betreffe.join(' | ') || '(keine)'}`);

  starteDatenqualitaet();
  const erfuellte = [];
  erledigtRegeln().forEach((regel, i) => {
    let beleg = null;
    let fehlertext = null;
    try {
      beleg = regel.quelle(deal, betreffe);
    } catch (err) {
      fehlertext = err.message;
    }
    if (fehlertext) {
      Logger.log(`${i + 1}. ${regel.label}: REGEL GESCHEITERT -- ${fehlertext}`);
    } else if (beleg) {
      erfuellte.push(regel);
      Logger.log(`${i + 1}. ${regel.label}: JA   <- ${beleg}`);
    } else {
      Logger.log(`${i + 1}. ${regel.label}: nein`);
    }
  });

  const auffaellig = holeDatenqualitaet();
  if (auffaellig.length) Logger.log(`SOFT_ERROR (unlesbare Quellwerte): ${auffaellig.join(' ; ')}`);

  const fortschritt = baueFortschrittText(deal, erfuellte);
  Logger.log(`Soll Erledigt:    ${labelListe(erfuellte.map(r => r.optionId).sort((a, b) => a - b))}`);
  Logger.log(`Ist  Erledigt:    ${labelListe(leseOptionIds(deal, ERLEDIGT_FIELD_KEY).sort((a, b) => a - b))}`);
  Logger.log(`Soll Fortschritt: ${fortschritt.konfigFehler ? `(nicht bildbar: ${fortschritt.konfigFehler})` : fortschritt.text}`);
  Logger.log(`Ist  Fortschritt: ${leseCustomField(deal, FORTSCHRITT_FIELD_KEY) || '(leer)'}`);
}

/**
 * Schreibt EINEN einzigen Deal (TEST_DEAL_ID) wirklich in Pipedrive -- damit man das Ergebnis in
 * der Oberflaeche ansehen kann, bevor der Vollauf scharf geht.
 *
 * Ignoriert DRY_RUN bewusst: der Sinn ist, genau einen Deal zu schreiben, OHNE den globalen
 * Schalter umzustellen. Genau da liegt das Risiko sonst -- DRY_RUN auf false gestellt, Einzeldeal
 * geprueft, und dann bleibt es aus Versehen so stehen und der naechste Trigger-Lauf schreibt alle
 * 437 Deals. Hier bleibt DRY_RUN unangetastet.
 *
 * Anschliessend nochmal ausfuehren: dann muss "unveraendert 1" kommen und KEINE Log-Zeile
 * entstehen. Das ist der Idempotenz-Beweis (Testplan Schritt 9) im Kleinen -- meldet er wieder
 * "geaendert", ist der Diff kaputt und der Vollauf ist tabu.
 */
function schreibeEinzelDealLive() {
  const konfig = pruefeKonfigurationIntern();
  konfig.meldungen.forEach(m => Logger.log(m));
  if (konfig.fehler > 0) {
    Logger.log(`ABBRUCH: ${konfig.fehler} Konfigurationsabweichung(en) -- es wurde nichts geschrieben.`);
    return;
  }
  fuelleOptionRegistry(konfig.felder);

  const ctx = neuerKontext('manuell (Einzeldeal LIVE)');
  ctx.ausfuehrungsartLabels = optionLabelMap(konfig.felder, AUSFUEHRUNGSART_FIELD_KEY);

  Logger.log(`ACHTUNG: schreibt Deal ${TEST_DEAL_ID} WIRKLICH (ignoriert DRY_RUN=${DRY_RUN}). `
           + `Nur dieser eine Deal, kein anderer.`);
  try {
    const deal = fetchPipedrive(`deals/${TEST_DEAL_ID}`);
    const betreffe = ladeAktivitaetsBetreffeFuerDeal(TEST_DEAL_ID);
    erklaereDeal(deal, betreffe);
    verarbeiteDeal(deal, betreffe, ctx, { schreibenErzwingen: true });
  } finally {
    flushLog();
  }

  const z = ctx.zaehler;
  Logger.log(`Ergebnis: geaendert ${z.geaendert} | unveraendert ${z.unveraendert} | `
           + `HARD_ERROR ${z.hardError} | SOFT_ERROR ${z.softError}`);
  if (z.geaendert > 0) {
    Logger.log('In Pipedrive geschrieben. Jetzt in der Oberflaeche pruefen -- und danach diese '
             + 'Funktion NOCHMAL starten: dann muss "unveraendert 1" kommen.');
  } else if (z.unveraendert > 0) {
    Logger.log('Nichts geschrieben, weil Soll = Ist. Genau das ist beim zweiten Durchlauf richtig.');
  }
}

/**
 * Klaert empirisch, womit Pipedrive ein "set"-Feld leert -- mit [] oder mit null. Die v2-Doku sagt
 * dazu nichts (sie beschreibt nur das Schreiben als "array of ids"), deshalb wird das gemessen
 * statt geraten. Ergebnis in LEERWERT_FUER_SET (Config.gs) eintragen.
 *
 * ACHTUNG: diese Funktion SCHREIBT wirklich, auch bei DRY_RUN=true -- anders laesst sich die Frage
 * nicht beantworten. Sie merkt sich den Ausgangswert von TEST_DEAL_ID_LEERER_SET und stellt ihn am
 * Ende wieder her. Zum Schutz laeuft sie nur mit TEST_LEERER_SET_ERLAUBT=true.
 */
function testLeerenSetWert() {
  if (!TEST_LEERER_SET_ERLAUBT) {
    Logger.log('Abgebrochen: TEST_LEERER_SET_ERLAUBT steht auf false. Diese Funktion schreibt echt in Pipedrive '
      + '(und stellt danach wieder her) -- Schalter in Config.gs bewusst auf true setzen.');
    return;
  }

  const dealId = TEST_DEAL_ID_LEERER_SET;
  const deal = fetchPipedrive(`deals/${dealId}`);
  const original = leseOptionIds(deal, ERLEDIGT_FIELD_KEY);
  Logger.log(`Deal ${dealId} "${deal.title}": Ausgangswert Erledigt = ${JSON.stringify(original)}`);

  const versuche = [
    { name: '[] (leeres Array)', wert: [] },
    { name: 'null', wert: null }
  ];

  versuche.forEach(v => {
    try {
      patchPipedrive(`deals/${dealId}`, { custom_fields: { [ERLEDIGT_FIELD_KEY]: v.wert } });
      const danach = leseOptionIds(fetchPipedrive(`deals/${dealId}`), ERLEDIGT_FIELD_KEY);
      Logger.log(danach.length === 0
        ? `${v.name}: FUNKTIONIERT -- Feld ist danach leer.`
        : `${v.name}: akzeptiert (HTTP 200), aber das Feld ist NICHT leer (${JSON.stringify(danach)}) -- untauglich.`);
    } catch (err) {
      Logger.log(`${v.name}: abgelehnt -- ${err.message}`);
    }
  });

  // Ausgangswert wiederherstellen. Schlaegt das fehl, muss es sichtbar sein -- der Testdeal traegt
  // sonst stillschweigend falsche Daten.
  try {
    patchPipedrive(`deals/${dealId}`, {
      custom_fields: { [ERLEDIGT_FIELD_KEY]: original.length ? original : LEERWERT_FUER_SET }
    });
    Logger.log(`Ausgangswert wiederhergestellt: ${JSON.stringify(original)}`);
  } catch (err) {
    Logger.log(`ACHTUNG: Wiederherstellen fehlgeschlagen (${err.message}). Deal ${dealId} manuell pruefen! `
      + `Ausgangswert war ${JSON.stringify(original)}.`);
  }
  Logger.log('Ergebnis in LEERWERT_FUER_SET (Config.gs) eintragen.');
}


// ===== 3. TRIGGER =====

/**
 * Richtet den 15-Minuten-Trigger ein. IDEMPOTENT: entfernt vorher alle eigenen Trigger, damit
 * mehrfaches Ausfuehren nicht zu doppelten Laeufen fuehrt (ohne das laeuft nach dem zweiten Klick
 * alles doppelt).
 */
function installTriggers() {
  removeAllTriggers();
  ScriptApp.newTrigger('aktualisiereFortschrittPerTrigger').timeBased().everyMinutes(15).create();
  Logger.log('15-Minuten-Trigger auf aktualisiereFortschrittPerTrigger eingerichtet. Pruefen mit listInstalledTriggers().');
  if (DRY_RUN) Logger.log('HINWEIS: DRY_RUN ist true -- der Trigger laeuft, schreibt aber nichts.');
}

function listInstalledTriggers() {
  const trigger = ScriptApp.getProjectTriggers();
  if (!trigger.length) { Logger.log('Keine Trigger installiert.'); return; }
  trigger.forEach(t => Logger.log(`${t.getHandlerFunction()} -- ${t.getEventType()}`));
}

/** Entfernt ALLE Trigger dieses Projekts. */
function removeAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('Alle Trigger entfernt.');
}


// ===== 4. WARTUNG / DEBUG =====

/** Setzt den Resume-Cursor zurueck, der naechste Lauf beginnt wieder bei der ersten Seite. */
function resetVollauf() {
  PropertiesService.getScriptProperties().deleteProperty(PROP_RESUME_CURSOR);
  Logger.log('Resume-Cursor geloescht. Der naechste Lauf startet von vorne.');
}

/**
 * Protokolliert den kompletten LIVE-Zustand dieses Projekts: Schalterstellungen, Trigger, Script
 * Properties, Log-Sheet, Feldtypen.
 *
 * Warum das eine eigene Funktion ist (R7 aus FIXES-INDEX-2026-08-13.md): Git sichert nur den Code.
 * Kaputtgegangen ist bei RP bisher aber immer die VERDRAHTUNG -- ein v1-Webhook, ein DRY_RUN, das
 * auf true stehengeblieben ist, ein doppelt installierter Trigger. Nichts davon steht im Repo.
 * Vor und nach jedem Scharfschalten einmal ausfuehren und die Ausgabe in den Projektnotizen
 * ablegen, dann ist der Zustand nachvollziehbar.
 */
function dumpLiveState() {
  const props = PropertiesService.getScriptProperties();

  Logger.log(`=== LIVE STATE ${SCRIPT_NAME} | ${new Date().toISOString()} ===`);
  Logger.log(`DRY_RUN: ${DRY_RUN}   (true = es wird nichts geschrieben)`);
  Logger.log(`DASHBOARD_ENABLED: ${DASHBOARD_ENABLED} | DASHBOARD_SHEET_ID: ${DASHBOARD_SHEET_ID}`);
  Logger.log(`CUTOFF_ENABLED: ${CUTOFF_ENABLED} | CUTOFF_DATE: ${CUTOFF_DATE.toISOString().slice(0, 10)}`);
  Logger.log(`LEERWERT_FUER_SET: ${JSON.stringify(LEERWERT_FUER_SET)}`);
  Logger.log(`FORTSCHRITT_AUTOCOMPLETE_AKZEPTIERT: ${FORTSCHRITT_AUTOCOMPLETE_AKZEPTIERT}`);
  Logger.log(`TEST_LEERER_SET_ERLAUBT: ${TEST_LEERER_SET_ERLAUBT}`);
  Logger.log(`STAGE_ID_VERSCHOBEN_STORNIERT: ${STAGE_ID_VERSCHOBEN_STORNIERT}`);

  Logger.log('--- Trigger ---');
  listInstalledTriggers();

  Logger.log('--- Script Properties ---');
  const alle = props.getProperties();
  Object.keys(alle).sort().forEach(k => {
    // Token niemals ins Protokoll -- das landet sonst im Ausfuehrungslog und in Screenshots.
    const wert = /TOKEN|SECRET|KEY$/i.test(k) ? `(gesetzt, ${String(alle[k]).length} Zeichen)` : alle[k];
    Logger.log(`${k} = ${wert}`);
  });
  if (!props.getProperty('PIPEDRIVE_API_TOKEN')) Logger.log('ACHTUNG: PIPEDRIVE_API_TOKEN fehlt.');

  const sheetId = props.getProperty(PROP_LOG_SHEET_ID);
  Logger.log(`Log-Sheet: ${sheetId ? SpreadsheetApp.openById(sheetId).getUrl() : '(noch keines -- wird beim ersten Lauf angelegt)'}`);

  Logger.log('--- Feldtypen der beiden Zielfelder (der Punkt, an dem set vs. autocomplete entschieden wird) ---');
  try {
    const felder = fetchPipedrive('dealFields?limit=500') || [];
    [[ERLEDIGT_FIELD_KEY, 'Erledigt'], [FORTSCHRITT_FIELD_KEY, 'Fortschritt']].forEach(([key, bez]) => {
      const f = felder.filter(x => x.field_code === key)[0];
      // field_code MIT ausgeben: sonst laesst sich nicht unterscheiden, ob ein unerwarteter
      // Feldtyp am falschen field_code liegt oder daran, dass der Editor noch eine alte
      // Config.gs hat.
      Logger.log(f
        ? `${bez}: field_code=${key} -> "${f.field_name}", field_type=${f.field_type}, `
          + `${(f.options || []).length} Optionen, is_writable=${f.is_writable}`
        : `${bez}: field_code=${key} NICHT GEFUNDEN`);
    });
  } catch (err) {
    Logger.log(`Feldtypen nicht abrufbar: ${err.message}`);
  }
}

/**
 * Debug: listet alle Deal-Custom-Fields mit field_name, field_code, Typ und Options-IDs.
 * Damit AUSFUEHRUNGSART_FIELD_KEY ermitteln und im Zweifel jeden anderen Feldcode gegenpruefen.
 */
function listDealFieldsHelper() {
  const felder = fetchPipedrive('dealFields?limit=500') || [];
  felder.forEach(f => {
    Logger.log(`${f.field_name}  [${f.field_type}]  -->  ${f.field_code}`);
    (f.options || []).forEach(o => Logger.log(`    - "${o.label}"  -->  ${o.id}`));
  });
}

/** Debug: listet alle Stages mit ID und Pipeline -- daraus STAGE_ID_STORNIERT/VERSCHOBEN eintragen. */
function listStagesHelper() {
  const stages = fetchPipedrive('stages?limit=500') || [];
  stages.forEach(s => Logger.log(`Stage ${s.id}: "${s.name}" (pipeline_id ${s.pipeline_id})`));
  Logger.log('Die IDs von "Storniert" und "Verschoben" als ZAHL in Config.gs eintragen.');
}

/**
 * Debug fuer das fragile Betreff-Matching: zeigt, welche Betreffe erledigte Aktivitaeten
 * tatsaechlich tragen und wie viele davon auf die Muster der Gespraechs-Regeln passen. Damit laesst
 * sich vor dem Vollauf entscheiden, ob die Muster stimmen oder ob Automation A1 erst noch stabile
 * Betreffe liefern muss.
 */
function listAktivitaetsBetreffe() {
  const muster = [];
  erledigtRegeln().forEach(r => musterListe(r.aktivitaetsMuster).forEach(m => muster.push(m)));
  const haeufigkeit = {};
  let cursor = null;
  let seiten = 0;
  let gesehen = 0;

  do {
    const path = `activities?done=true&limit=${AKTIVITAETEN_PRO_SEITE}`
               + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const response = fetchPipedriveRaw(path);
    const aktivitaeten = response.data || [];
    cursor = (response.additional_data && response.additional_data.next_cursor) || null;
    seiten++;
    aktivitaeten.forEach(a => {
      gesehen++;
      const betreff = (a.subject || '(ohne Betreff)').trim();
      haeufigkeit[betreff] = (haeufigkeit[betreff] || 0) + 1;
    });
  } while (cursor && seiten < MAX_AKTIVITAETEN_SEITEN);

  Logger.log(`${gesehen} erledigte Aktivitaeten in ${seiten} Seitenabruf(en), ${Object.keys(haeufigkeit).length} verschiedene Betreffe.`);
  Logger.log(`Muster der Gespraechs-Regeln: "${muster.join('" / "')}"`);
  Object.keys(haeufigkeit)
    .sort((a, b) => haeufigkeit[b] - haeufigkeit[a])
    .slice(0, 60)
    .forEach(b => {
      const trifft = muster.some(m => normalisiere(b).indexOf(m) !== -1);
      Logger.log(`${trifft ? 'TREFFER ' : '        '}${haeufigkeit[b]}x  "${b}"`);
    });
}
