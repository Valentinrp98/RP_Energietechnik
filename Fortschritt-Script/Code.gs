// ==========================================================================================
// PROJEKT: "Fortschritt-Script"
// DATEI IM EDITOR: Code.gs        --> kompletten Inhalt ersetzen
//
// Hauptlauf: laden, berechnen, DIFFEN, schreiben, loggen.
//
// Ablauf pro Lauf:
//   1. pruefeKonfiguration -- bricht bei jeder Abweichung AB (kein "Warnung und weiter")
//   2. erledigte Aktivitaeten EINMAL paginiert laden -> Map deal_id -> [Betreff]
//   3. gewonnene Deals EINMAL paginiert laden (custom_fields kommen mit)
//   4. pro Deal Soll berechnen, gegen Ist diffen, NUR bei echter Abweichung patchen
//   5. loggen (nur Aenderungen + Fehler, plus eine Zusammenfassungszeile)
//
// Es gibt bewusst KEINEN Einzelabruf pro Deal und keinen Aktivitaetsabruf pro Deal -- das waeren
// bei ~440 Deals und 96 Laeufen/Tag zehntausende Calls gegen ein Kontingent von ~20.000.
// ==========================================================================================


// ===== EINSTIEGSPUNKTE =====
// Beide parameterlos: der Play-Button im Editor ruft ohne Argumente auf.

/** Manueller Lauf (Play-Button im Editor). */
function aktualisiereFortschritt() {
  laufDurchfuehren('manuell');
}

/** Ziel des 15-Minuten-Triggers. Eigener Einstiegspunkt, damit im Log "Trigger" statt "manuell" steht. */
function aktualisiereFortschrittPerTrigger() {
  laufDurchfuehren('Trigger');
}


// ===== HAUPTLAUF =====

/**
 * Frischer Laufkontext: Lauf-ID, Zaehler, Verteilungen. Wird vom Hauptlauf und von den
 * Einzeldeal-Tests gleichermassen benutzt, damit beide dieselbe Statistik und dasselbe Logformat
 * erzeugen.
 */
function neuerKontext(laufTyp) {
  return {
    laufId: Utilities.getUuid().slice(0, 8),
    laufTyp: laufTyp,
    zaehler: {
      geprueft: 0, geaendert: 0, dryRun: 0, unveraendert: 0,
      vorCutoff: 0, viaAusnahme: 0, softError: 0, hardError: 0
    },
    verteilung: {},          // Anzahl erfuellter Regeln -> Anzahl Deals
    regelTreffer: {},        // Regel-Label -> Anzahl Deals, bei denen sie greift
    nachAusfuehrungsart: {}, // Ausfuehrungsart -> { Anzahl erfuellter Regeln -> Anzahl Deals }
    ausfuehrungsartLabels: {},
    datenqualitaet: []       // fachliche Grenzfaelle (SOFT_ERROR), z.B. unlesbare Datumswerte
  };
}

/**
 * Kernlauf. Hat einen Parameter und ist deshalb NICHT fuer den Play-Button gedacht -- dafuer gibt
 * es die beiden Einstiegspunkte oben.
 * @param {string} laufTyp 'manuell' | 'Trigger'
 */
function laufDurchfuehren(laufTyp) {
  const start = Date.now();
  const props = PropertiesService.getScriptProperties();

  // Schuetzt gegen einen manuellen Start, der in einen laufenden Trigger-Lauf hineingraetscht --
  // zwei parallele Laeufe wuerden dieselben Deals gleichzeitig patchen.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log('Ein anderer Lauf ist noch aktiv -- dieser Lauf wird uebersprungen (kein Fehler).');
    return;
  }

  const ctx = neuerKontext(laufTyp);
  let abgebrochen = false;

  try {
    // ---- 1. Konfiguration: bei Abweichung ABBRECHEN, nicht warnen -----------------------
    const konfig = pruefeKonfigurationIntern();
    konfig.meldungen.forEach(m => Logger.log(m));
    if (konfig.fehler > 0) {
      ctx.zaehler.hardError += konfig.fehler;
      const msg = `${konfig.fehler} Konfigurationsabweichung(en) -- Lauf abgebrochen, es wurde NICHTS geschrieben. `
                + `pruefeKonfiguration() ausfuehren, Meldungen stehen im Ausfuehrungsprotokoll.`;
      Logger.log(`HARD_ERROR: ${msg}`);
      logDetail(ctx, { status: 'HARD_ERROR', detail: msg });
      return; // finally schreibt Log + Dashboard und gibt den Lock frei
    }
    ctx.ausfuehrungsartLabels = optionLabelMap(konfig.felder, AUSFUEHRUNGSART_FIELD_KEY);
    fuelleOptionRegistry(konfig.felder);

    // ---- 2. Aktivitaeten einmal vorladen ------------------------------------------------
    const aktIndex = ladeAktivitaetenIndex();

    // ---- 3. Gewonnene Deals paginiert ---------------------------------------------------
    // status=won ist in v2 gueltig. Der v1-Wert all_not_deleted existiert in v2 NICHT und
    // quittiert mit 400 ERR_SCHEMA_VALIDATION_FAILED -- v2 kennt nur open|won|lost|deleted.
    let cursor = props.getProperty(PROP_RESUME_CURSOR) || null;
    if (cursor) Logger.log(`Setze abgebrochenen Lauf fort (Cursor ${cursor}). Neustart von vorne: resetVollauf()`);

    do {
      const path = `deals?status=won&limit=${DEALS_PRO_SEITE}`
                 + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const response = fetchPipedriveRaw(path);
      const deals = response.data || [];
      cursor = (response.additional_data && response.additional_data.next_cursor) || null;

      for (const deal of deals) {
        verarbeiteDeal(deal, aktIndex[deal.id] || [], ctx);
      }

      if (cursor) props.setProperty(PROP_RESUME_CURSOR, cursor);
      else props.deleteProperty(PROP_RESUME_CURSOR);

      if (cursor && Date.now() - start > MAX_LAUFZEIT_MS) {
        abgebrochen = true;
        break;
      }
    } while (cursor);

  } catch (err) {
    ctx.zaehler.hardError++;
    Logger.log(`HARD_ERROR: ${err.message}`);
    logDetail(ctx, { status: 'HARD_ERROR', detail: `Lauf abgebrochen: ${err.message}` });

  } finally {
    const dauer = Math.round((Date.now() - start) / 1000);
    const status = bestimmeStatus(ctx, abgebrochen);
    const zusammenfassung = baueZusammenfassung(ctx, abgebrochen, dauer, status);

    Logger.log(zusammenfassung.langtext);

    // Eine gesammelte Zeile fuer alle Datenqualitaets-Grenzfaelle des Laufs, mit Rohwerten.
    if (ctx.datenqualitaet.length) {
      logDetail(ctx, {
        status: 'SOFT_ERROR',
        detail: `${ctx.zaehler.softError} Deal(s) mit unlesbaren Quellwerten (Regel greift dort nicht, `
          + `Deal wurde sonst normal verarbeitet): ${ctx.datenqualitaet.join(' | ')}`
          + (ctx.zaehler.softError > ctx.datenqualitaet.length
              ? ` [... ${ctx.zaehler.softError - ctx.datenqualitaet.length} weitere, siehe Ausfuehrungsprotokoll]` : '')
      });
    }

    logDetail(ctx, { status: `LAUF ${status}`, detail: zusammenfassung.kurztext });
    flushLog();
    schreibeDashboardZeile(ctx, status, zusammenfassung.kurztext);
    lock.releaseLock();
  }
}


/**
 * Berechnet Soll fuer EINEN Deal, diffed gegen Ist und schreibt nur bei echter Abweichung.
 * @param {Object} deal      Deal aus der Listenabfrage (custom_fields sind enthalten)
 * @param {Array}  betreffe  Betreffe der erledigten Aktivitaeten dieses Deals
 * @param {Object} ctx       Laufkontext (Zaehler, Verteilung, Lauf-ID)
 * @param {Object} [optionen] { schreibenErzwingen: true } schreibt auch bei DRY_RUN=true.
 *        Nur fuer schreibeEinzelDealLive() -- damit man EINEN Deal in der Oberflaeche ansehen kann,
 *        ohne den globalen Schalter umzustellen (und ihn danach womoeglich umgestellt zu lassen).
 */
function verarbeiteDeal(deal, betreffe, ctx, optionen) {
  const opt = optionen || {};
  ctx.zaehler.geprueft++;

  // ---- Altbestand bewusst nicht anfassen (Muster aus Bundesland-aus-PLZ) -----------------
  // Ausnahmeliste schlaegt den Cutoff: einzelne Altdeals koennen ueber CUTOFF_AUSNAHMEN
  // gezielt dazugenommen werden, ohne den Cutoff fuer alle zu lockern.
  if (CUTOFF_ENABLED && deal.add_time && new Date(deal.add_time) < CUTOFF_DATE) {
    if (istCutoffAusnahme(deal.id)) {
      ctx.zaehler.viaAusnahme++;
    } else {
      ctx.zaehler.vorCutoff++;
      return;
    }
  }

  // ---- Regeln auswerten (Spiegel: komplette Menge jedes Mal neu) -------------------------
  starteDatenqualitaet();
  const erfuellte = [];
  const belege = {}; // optionId -> Beleg-String (Rohwert bzw. Aktivitaets-Betreff)
  for (const regel of erledigtRegeln()) {
    let beleg;
    try {
      beleg = regel.quelle(deal, betreffe);
    } catch (err) {
      // Eine kaputte Regel darf nicht den ganzen Lauf killen -- aber sie ist ein HARD_ERROR und
      // dieser Deal wird NICHT geschrieben (die Menge waere unvollstaendig, und im Spiegel-Modus
      // hiesse das: bestehende Haken faelschlich entfernen).
      ctx.zaehler.hardError++;
      logDetail(ctx, {
        dealId: deal.id, titel: deal.title, status: 'HARD_ERROR',
        detail: `Regel "${regel.label}" ist gescheitert: ${err.message}`
      });
      return;
    }
    if (beleg) {
      erfuellte.push(regel);
      belege[regel.optionId] = beleg;
    }
  }

  // ---- Datenqualitaet: fachliche Grenzfaelle sind SOFT_ERROR, keine HARD_ERROR -----------
  // Unlesbare Quellwerte (z.B. ein Datum als "31.12.2026") machen den Deal nicht unschreibbar,
  // die betroffene Regel greift nur nicht. Das darf aber nicht still passieren -- gezaehlt wird
  // pro Deal, gemeldet mit Rohwert. Ins Sheet geht daraus EINE gesammelte Zeile pro Lauf, nicht
  // eine pro Deal: bei einem 15-Min-Trigger waeren das sonst 96 identische Zeilen pro Tag und
  // Deal, und genau solches Rauschen macht die echten Fehler unsichtbar.
  const auffaelligkeiten = holeDatenqualitaet();
  if (auffaelligkeiten.length) {
    ctx.zaehler.softError++;
    Logger.log(`SOFT_ERROR Deal ${deal.id} "${deal.title}": ${auffaelligkeiten.join(' ; ')}`);
    if (ctx.datenqualitaet.length < 25) {
      ctx.datenqualitaet.push(`Deal ${deal.id}: ${auffaelligkeiten.join(' ; ')}`);
    }
  }

  // ---- Statistik (traegt den Abbruchtest aus Testplan Schritt 4) -------------------------
  const anzahl = erfuellte.length;
  ctx.verteilung[anzahl] = (ctx.verteilung[anzahl] || 0) + 1;
  erfuellte.forEach(r => { ctx.regelTreffer[r.label] = (ctx.regelTreffer[r.label] || 0) + 1; });
  zaehleNachAusfuehrungsart(ctx, deal, anzahl);

  // ---- Soll vs. Ist ---------------------------------------------------------------------
  const soll = erfuellte.map(r => r.optionId).sort((a, b) => a - b);
  const ist = leseOptionIds(deal, ERLEDIGT_FIELD_KEY).sort((a, b) => a - b);

  const fortschritt = baueFortschrittText(deal, erfuellte);
  if (fortschritt.konfigFehler) {
    ctx.zaehler.hardError++;
    logDetail(ctx, {
      dealId: deal.id, titel: deal.title, status: 'HARD_ERROR',
      detail: `KONFIG-FEHLER: ${fortschritt.konfigFehler} -- pruefeKonfiguration() ausfuehren`
    });
    return;
  }

  const istFortschritt = leseCustomField(deal, FORTSCHRITT_FIELD_KEY);
  const istFortschrittText = (istFortschritt === null) ? '' : String(istFortschritt);
  const sollFortschrittText = fortschritt.text;

  const erledigtGeaendert = !gleicheIds(ist, soll);
  const fortschrittGeaendert = istFortschrittText !== sollFortschrittText;

  // ---- DIFF-PFLICHT --------------------------------------------------------------------
  // Bei unveraendertem Zustand wird NICHT geschrieben und NICHT ins Sheet geloggt. Beides ist
  // Absicht: blindes Patchen waeren 437 x 96 = ~42.000 Writes/Tag gegen ~20.000 Kontingent, und
  // jeder Write ist in Pipedrive ein "Deal aktualisiert"-Ereignis, an dem Automations haengen.
  // "Nichts passiert" gehoert ausserdem nicht ins Log -- sonst machen 437 Zeilen Rauschen die
  // drei echten Fehler unsichtbar.
  if (!erledigtGeaendert && !fortschrittGeaendert) {
    ctx.zaehler.unveraendert++;
    return;
  }

  // ---- Nutzlast bauen: nur die tatsaechlich geaenderten Felder ---------------------------
  const custom = {};
  if (erledigtGeaendert) custom[ERLEDIGT_FIELD_KEY] = soll.length ? soll : LEERWERT_FUER_SET;
  if (fortschrittGeaendert) custom[FORTSCHRITT_FIELD_KEY] = sollFortschrittText;

  const nutzlastFehler = pruefePatchNutzlast(custom);
  if (nutzlastFehler) {
    ctx.zaehler.hardError++;
    logDetail(ctx, {
      dealId: deal.id, titel: deal.title, status: 'HARD_ERROR',
      detail: `PATCH abgebrochen, sonst stiller Nullschreibvorgang: ${nutzlastFehler}`
    });
    return;
  }

  const zeile = {
    dealId: deal.id,
    titel: deal.title,
    erledigtVorher: labelListe(ist),
    erledigtNachher: labelListe(soll),
    fortschrittVorher: istFortschrittText,
    fortschrittNachher: sollFortschrittText,
    ausgeloestDurch: beschreibeAenderung(ist, soll, belege, erledigtGeaendert, fortschrittGeaendert)
  };

  if (DRY_RUN && !opt.schreibenErzwingen) {
    ctx.zaehler.dryRun++;
    zeile.status = 'DRY-RUN';
    zeile.detail = 'wuerde geschrieben werden';
    logDetail(ctx, zeile);
    return;
  }

  try {
    patchPipedrive(`deals/${deal.id}`, { custom_fields: custom });
  } catch (err) {
    ctx.zaehler.hardError++;
    zeile.status = 'HARD_ERROR';
    zeile.detail = `PATCH fehlgeschlagen: ${err.message}`;
    logDetail(ctx, zeile);
    return;
  }

  ctx.zaehler.geaendert++;
  zeile.status = 'geändert';
  zeile.detail = '';
  logDetail(ctx, zeile);
}


// ===== VORABLADUNG AKTIVITAETEN =====

/**
 * Laedt alle ERLEDIGTEN Aktivitaeten einmal paginiert und legt die betreff-relevanten in eine
 * Map deal_id -> [Betreff]. Ein Abruf pro Deal waeren bei ~440 Deals 440 Calls PRO LAUF.
 *
 * Gemerkt werden nur Betreffe, die auf ein aktivitaetsMuster einer Regel passen -- die Filterliste
 * kommt direkt aus der Regeltabelle, eine neue Gespraechsregel erweitert sie also automatisch.
 *
 * API-Parameter gegen die v2-Doku geprueft: done ist ein boolean-Filter ("If supplied, only
 * activities with specified 'done' flag value are returned"), limit erlaubt maximal 500,
 * Pagination laeuft ueber cursor.
 */
function ladeAktivitaetenIndex() {
  const muster = [];
  erledigtRegeln().forEach(r => musterListe(r.aktivitaetsMuster).forEach(m => muster.push(m)));

  if (!muster.length) {
    Logger.log('Keine aktivitaetsbasierte Regel vorhanden -- Aktivitaeten werden nicht geladen.');
    return {};
  }

  const index = {};
  const beispielBetreffe = [];
  let cursor = null;
  let seiten = 0;
  let gesehen = 0;
  let behalten = 0;

  do {
    const path = `activities?done=true&limit=${AKTIVITAETEN_PRO_SEITE}`
               + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const response = fetchPipedriveRaw(path);
    const aktivitaeten = response.data || [];
    cursor = (response.additional_data && response.additional_data.next_cursor) || null;
    seiten++;

    for (const a of aktivitaeten) {
      gesehen++;
      if (!a.deal_id) continue; // nicht am Deal haengende Aktivitaeten interessieren nicht
      const betreff = a.subject || '';
      if (betreff && beispielBetreffe.length < 15) beispielBetreffe.push(betreff);
      const norm = normalisiere(betreff);
      if (!muster.some(m => norm.indexOf(m) !== -1)) continue;
      if (!index[a.deal_id]) index[a.deal_id] = [];
      index[a.deal_id].push(betreff);
      behalten++;
    }

    if (seiten >= MAX_AKTIVITAETEN_SEITEN) {
      Logger.log(`WARNUNG: Aktivitaeten-Vorabzug nach ${seiten} Seiten abgebrochen (MAX_AKTIVITAETEN_SEITEN). `
               + `Die Gespraechs-Regeln arbeiten in diesem Lauf auf unvollstaendigen Daten.`);
      break;
    }
  } while (cursor);

  Logger.log(`Aktivitaeten-Index: ${gesehen} erledigte Aktivitaeten in ${seiten} Seitenabruf(en), `
           + `${behalten} betreff-relevant, ${Object.keys(index).length} Deals mit Treffer.`);

  // Erwarteter Zustand, solange Automation A1 die Gespraechs-Aktivitaeten nicht mit stabilem
  // Betreff anlegt -- kein Bug, muss aber im DRY-Lauf SICHTBAR sein. Der Betreff-Auszug macht
  // zugleich diagnostizierbar, ob nur das Muster nicht passt oder ob gar keine Aktivitaeten am
  // Deal haengen.
  if (gesehen > 0 && behalten === 0) {
    Logger.log(`HINWEIS: kein einziger Betreff passt auf "${muster.join('" / "')}". Regel "Erstgespräch" und `
             + `"Zweitgespräch" greifen dann nur bei haendisch so betitelten Aktivitaeten. `
             + `Gesehene Betreffe (Auszug): ${beispielBetreffe.join(' | ') || '(keine)'}`);
  }
  return index;
}

/** Betreffe der erledigten Aktivitaeten EINES Deals -- nur fuer die Einzeldeal-Tests. */
function ladeAktivitaetsBetreffeFuerDeal(dealId) {
  const aktivitaeten = fetchPipedrive(`activities?deal_id=${dealId}&done=true&limit=${AKTIVITAETEN_PRO_SEITE}`) || [];
  return aktivitaeten.map(a => a.subject || '').filter(s => s !== '');
}


// ===== DIFF / NUTZLAST =====

/**
 * Steht die Deal-ID in CUTOFF_AUSNAHMEN? Vergleich ueber Number, damit eine als String
 * eingetragene ID ("7253") genauso trifft wie 7253 -- die Liste pflegt ein Mensch.
 */
function istCutoffAusnahme(dealId) {
  const id = Number(dealId);
  return CUTOFF_AUSNAHMEN.some(e => Number(e) === id);
}

/** Vergleicht zwei aufsteigend sortierte Option-ID-Listen. */
function gleicheIds(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Letzte Bremse vor dem PATCH gegen den stillen Nullschreibvorgang: JSON.stringify entfernt
 * undefined-Werte lautlos. Der PATCH geht dann mit leerem oder unvollstaendigem custom_fields
 * raus, Pipedrive antwortet 200, und das Log meldet Erfolg, obwohl nichts geschrieben wurde.
 * Deshalb wird der SERIALISIERTE Round-Trip geprueft, nicht das Quellobjekt.
 * @return {string|null} Fehlertext, oder null wenn die Nutzlast in Ordnung ist
 */
function pruefePatchNutzlast(custom) {
  const keys = Object.keys(custom);
  if (!keys.length) return 'custom_fields ist leer -- es gaebe nichts zu schreiben';

  let rund;
  try {
    rund = JSON.parse(JSON.stringify({ custom_fields: custom })).custom_fields;
  } catch (err) {
    return `custom_fields ist nicht serialisierbar: ${err.message}`;
  }
  if (!rund) return 'custom_fields ist beim Serialisieren verschwunden';

  const verloren = keys.filter(k => !Object.prototype.hasOwnProperty.call(rund, k));
  if (verloren.length) return `Feld(er) beim Serialisieren verloren (undefined-Wert): ${verloren.join(', ')}`;
  if (!Object.keys(rund).length) return 'custom_fields ist nach dem Serialisieren leer';
  return null;
}

/**
 * "ausgeloest durch": welche Regel neu gegriffen hat -- mit dem Beleg, also dem Rohwert des
 * Quellfelds bzw. dem tatsaechlichen Aktivitaets-Betreff. Entfallene Haken werden ebenfalls
 * benannt (Spiegel-Modus kann Haken auch wieder entfernen).
 */
function beschreibeAenderung(ist, soll, belege, erledigtGeaendert, fortschrittGeaendert) {
  if (!erledigtGeaendert) return fortschrittGeaendert ? 'nur Fortschritt-Text neu berechnet' : '';

  const teile = [];
  soll.filter(id => ist.indexOf(id) === -1)
      .forEach(id => teile.push(`+ ${ERLEDIGT_OPTION_LABELS[id] || id} ← ${belege[id] || '(kein Beleg)'}`));
  // Zwei Ursachen, beide moeglich: das Quellfeld wurde zurueckgesetzt ODER jemand hat den Haken
  // haendisch gesetzt, obwohl ihn kein Quellfeld belegt. Der Text muss beides abdecken -- "Quellfeld
  // zurueckgesetzt" allein war irrefuehrend.
  ist.filter(id => soll.indexOf(id) === -1)
     .forEach(id => teile.push(`− ${ERLEDIGT_OPTION_LABELS[id] || id} (kein Quellfeld belegt ihn)`));
  return teile.join(' | ');
}

/** Option-IDs als Klartext-Labels. Unbekannte IDs bleiben als "?<id>" sichtbar. */
function labelListe(ids) {
  if (!ids || !ids.length) return '(leer)';
  return ids.map(id => ERLEDIGT_OPTION_LABELS[id] || `?${id}`).join(', ');
}


// ===== STATISTIK =====

/** Verteilung zusaetzlich nach Ausfuehrungsart -- traegt die Selbstmontage-Frage aus dem Plan. */
function zaehleNachAusfuehrungsart(ctx, deal, anzahl) {
  if (String(AUSFUEHRUNGSART_FIELD_KEY).indexOf('TODO_') === 0) return;
  const id = leseEnumId(deal, AUSFUEHRUNGSART_FIELD_KEY);
  const name = (id === null) ? '(nicht gesetzt)' : (ctx.ausfuehrungsartLabels[id] || `?${id}`);
  if (!ctx.nachAusfuehrungsart[name]) ctx.nachAusfuehrungsart[name] = {};
  ctx.nachAusfuehrungsart[name][anzahl] = (ctx.nachAusfuehrungsart[name][anzahl] || 0) + 1;
}

/**
 * Statusermittlung fuers Dashboard. Fehler zaehlen reicht NICHT: zwei reale Laeufe
 * (Montagepartner, Sheet-Sync) waren fehlerfrei und trotzdem komplett wirkungslos, weil ein
 * Vorgaenger nichts geliefert hatte. Deshalb KETTE_BLOCKIERT, wenn fast alle Deals auf 0/11
 * stehen oder gar keine Deals ankamen.
 */
function bestimmeStatus(ctx, abgebrochen) {
  if (ctx.zaehler.hardError > 0) return 'HARD_ERROR';

  // Bezugsgroesse sind die tatsaechlich AUSGEWERTETEN Deals, nicht die geprueften.
  // Ueber geprueft zu rechnen war ein Fehler: per CUTOFF uebersprungene Deals landen in keiner
  // Verteilung, wuerden den Anteil aber verwaessern. Bei aktivem CUTOFF haette ein kompletter
  // Nulllauf damit als OK durchgehen koennen (440 geprueft, 440 uebersprungen, verteilung leer
  // -> 0/440 = 0 -> gruen) -- genau der Montagepartner-Vorfall, den diese Ampel finden soll.
  const ausgewertet = ctx.zaehler.geprueft - ctx.zaehler.vorCutoff;

  if (ausgewertet === 0) {
    // Nichts ausgewertet. Bei einem freiwilligen Zeitabbruch ist der Lauf einfach noch nicht
    // fertig und nicht beurteilbar; sonst ist es der Nulllauf.
    return abgebrochen ? 'OK' : 'KETTE_BLOCKIERT';
  }

  const nullDeals = ctx.verteilung[0] || 0;
  if (nullDeals / ausgewertet >= SCHWELLE_KETTE_BLOCKIERT) return 'KETTE_BLOCKIERT';
  if (ctx.zaehler.softError > 0) return 'SOFT_ERROR';
  return 'OK';
}

/** Zusammenfassung fuer Ausfuehrungsprotokoll (lang) und Log-/Dashboard-Zelle (kurz). */
function baueZusammenfassung(ctx, abgebrochen, dauerSek, status) {
  const z = ctx.zaehler;
  const modus = DRY_RUN ? 'DRY' : 'LIVE';
  const lauf = abgebrochen
    ? 'PAUSIERT (Zeitbudget) -- nochmal starten, macht automatisch weiter'
    : 'DURCHGELAUFEN';

  const verteilungText = Object.keys(ctx.verteilung)
    .map(Number).sort((a, b) => a - b)
    .map(n => `${n}/${erledigtRegeln().length}:${ctx.verteilung[n]}`)
    .join(', ') || '(keine Deals)';

  const kurztext = `${lauf} | ${status} | ${modus} | ${dauerSek}s | geprueft=${z.geprueft} `
    + `geaendert=${z.geaendert} dryRun=${z.dryRun} unveraendert=${z.unveraendert} `
    + (z.vorCutoff ? `vorCutoff=${z.vorCutoff} ` : '')
    + `hardError=${z.hardError} softError=${z.softError} | Verteilung ${verteilungText}`;

  const zeilen = [
    `=== ${SCRIPT_NAME} | Lauf-ID ${ctx.laufId} | ${ctx.laufTyp} | Modus ${modus} ===`,
    `${lauf}. Status ${status}. Dauer ${dauerSek}s.`,
    `Geprueft ${z.geprueft} | geaendert ${z.geaendert} | DRY-RUN ${z.dryRun} | unveraendert ${z.unveraendert} `
      + `| vor CUTOFF uebersprungen ${z.vorCutoff} | davon per Ausnahmeliste doch mitgenommen ${z.viaAusnahme} `
      + `| HARD_ERROR ${z.hardError} | SOFT_ERROR ${z.softError}`,
    CUTOFF_ENABLED
      ? `CUTOFF aktiv ab ${CUTOFF_DATE.toISOString().slice(0, 10)}, ${CUTOFF_AUSNAHMEN.length} Ausnahme-Deal(s) konfiguriert.`
      : 'CUTOFF aus -- alle gewonnenen Deals werden angefasst.',
    `Verteilung (Zaehlerstand: Anzahl Deals): ${verteilungText}`,
    `Regel-Treffer: ${erledigtRegeln().map(r => `${r.label}=${ctx.regelTreffer[r.label] || 0}`).join(' | ')}`
  ];

  if (Object.keys(ctx.nachAusfuehrungsart).length) {
    zeilen.push('Verteilung nach Ausfuehrungsart:');
    Object.keys(ctx.nachAusfuehrungsart).forEach(name => {
      const je = ctx.nachAusfuehrungsart[name];
      const text = Object.keys(je).map(Number).sort((a, b) => a - b).map(n => `${n}:${je[n]}`).join(', ');
      zeilen.push(`   ${name} -> ${text}`);
    });
  } else if (String(AUSFUEHRUNGSART_FIELD_KEY).indexOf('TODO_') === 0) {
    zeilen.push('Verteilung nach Ausfuehrungsart: uebersprungen (AUSFUEHRUNGSART_FIELD_KEY steht auf TODO_).');
  }

  if (status === 'KETTE_BLOCKIERT') {
    zeilen.push('ACHTUNG KETTE_BLOCKIERT: fast alle Deals stehen auf 0 erfuellten Regeln (oder es kamen keine '
      + 'Deals an). Das ist der Abbruchtest aus dem Plan -- die Ableitungsregeln bzw. die Quellfelder pruefen, '
      + 'BEVOR DRY_RUN=false gesetzt wird.');
  }
  if (z.hardError > 0) {
    zeilen.push(`ACHTUNG ${z.hardError} HARD_ERROR -- Detailzeilen im Log-Sheet nach Lauf-ID ${ctx.laufId} filtern.`);
  }
  if (z.softError > 0) {
    zeilen.push(`${z.softError} SOFT_ERROR (unlesbare Quellwerte). Kein technischer Fehler -- die betroffene Regel `
      + `greift dort nur nicht. Rohwerte stehen oben im Protokoll und gesammelt im Log-Sheet.`);
  }
  if (DRY_RUN) zeilen.push('Modus DRY: es wurde nichts geschrieben. Zum Scharfschalten DRY_RUN in Config.gs auf false.');

  return { kurztext: kurztext, langtext: zeilen.join('\n') };
}

/** id -> label eines Optionsfelds, aus den bereits geladenen dealFields. */
function optionLabelMap(felder, fieldKey) {
  const map = {};
  if (!felder || String(fieldKey).indexOf('TODO_') === 0) return map;
  const feld = felder.filter(f => f.field_code === fieldKey)[0];
  if (!feld) return map;
  (feld.options || []).forEach(o => { map[o.id] = o.label; });
  return map;
}

/**
 * Baut die Option-Registry fuer alle Felder mit Options-Liste und uebergibt sie an Regeln.gs.
 * Damit lassen sich Optionswerte auch dann auf IDs aufloesen, wenn Pipedrive sie als Label-String
 * liefert (autocomplete-Felder) -- ausfuehrliche Begruendung bei setzeOptionRegistry() in Regeln.gs.
 */
function fuelleOptionRegistry(felder) {
  const registry = {};
  (felder || []).forEach(f => {
    if (!f.options || !f.options.length) return;
    const labels = {};
    f.options.forEach(o => { labels[o.id] = o.label; });
    registry[f.field_code] = { name: f.field_name || f.field_code, labels: labels };
  });
  setzeOptionRegistry(registry);
  return registry;
}


// ===== LOGGING =====
// Drei Ebenen: Lauf-Log (1 Zeile/Lauf, Dashboard), Aenderungs-Log (nur Aenderungen + Fehler,
// dieses Sheet), Debug (Logger.log). "Nichts passiert" gehoert in keine der beiden Sheets.

const LOG_HEADER = [
  'Zeitstempel', 'Lauf-ID', 'Deal-ID', 'Titel',
  'Erledigt vorher', 'Erledigt nachher',
  'Fortschritt vorher', 'Fortschritt nachher',
  'ausgelöst durch', 'Status', 'Detail'
];

let _logSheet = null;
let _logBuffer = [];

/** Self-bootstrapping Log-Sheet, gleiches Muster wie in den anderen RP-Scripts. */
function getLogSheet() {
  if (_logSheet) return _logSheet;

  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty(PROP_LOG_SHEET_ID);
  let ss = null;
  if (sheetId) {
    try { ss = SpreadsheetApp.openById(sheetId); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('LOG_Fortschritt-Script');
    props.setProperty(PROP_LOG_SHEET_ID, ss.getId());
    ss.getSheets()[0].appendRow(LOG_HEADER);
    Logger.log(`Neues Log-Sheet angelegt: ${ss.getUrl()}`);
  }
  // Bewusst getSheets()[0] statt getActiveSheet(): raeumeLogAuf() legt Archiv-Tabs an, was den
  // "aktiven" Tab verschieben kann.
  _logSheet = ss.getSheets()[0];
  return _logSheet;
}

/**
 * Puffert eine Log-Zeile. Geschrieben wird gebuendelt in flushLog() -- ein setValues() statt
 * appendRow pro Zeile. Bei sehr vielen Aenderungen (erster Vollauf) wird zwischendurch geleert,
 * damit der Puffer nicht unbegrenzt waechst.
 */
function logDetail(ctx, zeile) {
  if (_logBuffer.length >= LOG_PUFFER_MAX) flushLog();
  _logBuffer.push([
    new Date(),
    ctx.laufId,
    zeile.dealId || '',
    zeile.titel || '',
    zeile.erledigtVorher || '',
    zeile.erledigtNachher || '',
    zeile.fortschrittVorher || '',
    zeile.fortschrittNachher || '',
    zeile.ausgeloestDurch || '',
    zeile.status || '',
    zeile.detail || ''
  ]);
}

/** Schreibt alle gepufferten Zeilen in EINEM Range-Write. Kein appendRow pro Zeile. */
function flushLog() {
  if (!_logBuffer.length) return;
  try {
    raeumeLogAuf();
    const sheet = getLogSheet();
    sheet.getRange(sheet.getLastRow() + 1, 1, _logBuffer.length, LOG_HEADER.length).setValues(_logBuffer);
    SpreadsheetApp.flush();
    Logger.log(`${_logBuffer.length} Log-Zeile(n) geschrieben: ${sheet.getParent().getUrl()}`);
  } catch (err) {
    // Ein nicht schreibbares Log darf einen sonst erfolgreichen Lauf nicht in einen Absturz
    // verwandeln -- die Zeilen landen dann wenigstens im Ausfuehrungsprotokoll.
    Logger.log(`WARNUNG: Log-Sheet nicht schreibbar (${err.message}). Gepufferte Zeilen:`);
    _logBuffer.forEach(r => Logger.log(r.join(' | ')));
  }
  _logBuffer = [];
}

/**
 * Laengt das Log ueber LOG_MAX_ZEILEN, wandern die aeltesten LOG_ARCHIV_BLOCK Zeilen in einen
 * Archiv-Tab. Ohne das laeuft das Sheet irgendwann in die 10-Mio.-Zellen-Grenze und stirbt
 * mitten in einem Lauf.
 */
function raeumeLogAuf() {
  const sheet = getLogSheet();
  const datenzeilen = sheet.getLastRow() - 1;
  if (datenzeilen <= LOG_MAX_ZEILEN) return;

  const anzahl = Math.min(LOG_ARCHIV_BLOCK, datenzeilen);
  const name = `Archiv_${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmm')}`;
  const archiv = sheet.getParent().insertSheet(name);
  archiv.getRange(1, 1, 1, LOG_HEADER.length).setValues([LOG_HEADER]);
  archiv.getRange(2, 1, anzahl, LOG_HEADER.length)
        .setValues(sheet.getRange(2, 1, anzahl, LOG_HEADER.length).getValues());
  sheet.deleteRows(2, anzahl);
  Logger.log(`Log aufgeraeumt: ${anzahl} aelteste Zeilen nach "${name}" verschoben.`);
}

/**
 * Eine Zeile pro Lauf ins zentrale Automations-Dashboard.
 *
 * Schema laut Dashboard-Konzept (ARCHITEKTUR-2026-08-13.md, Abschnitt 2) -- auf das verweist der
 * Plan ausdruecklich. Gegenueber der Kurzliste im Plan sind Lauf-ID und Modus zusaetzlich drin:
 * Modus ist dort als Pflichtspalte festgelegt (ein Script, das produktiv laufen soll und DRY
 * meldet, ist gelb, nicht gruen), die Lauf-ID ist der Filtersprung ins Detail-Log.
 */
function schreibeDashboardZeile(ctx, status, detail) {
  if (!DASHBOARD_ENABLED) return;
  if (String(DASHBOARD_SHEET_ID).indexOf('TODO_') === 0) {
    Logger.log('DASHBOARD_ENABLED=true, aber DASHBOARD_SHEET_ID steht noch auf TODO_ -- Dashboard-Zeile uebersprungen.');
    return;
  }
  try {
    const tab = SpreadsheetApp.openById(DASHBOARD_SHEET_ID).getSheetByName(DASHBOARD_TAB_NAME);
    if (!tab) {
      Logger.log(`WARNUNG: Tab "${DASHBOARD_TAB_NAME}" existiert im Dashboard-Sheet nicht -- Zeile uebersprungen.`);
      return;
    }
    tab.appendRow([
      new Date(),
      ctx.laufId,
      SCRIPT_NAME,
      ctx.laufTyp,
      DRY_RUN ? 'DRY' : 'LIVE',
      status,
      ctx.zaehler.geaendert + ctx.zaehler.dryRun,
      ctx.zaehler.unveraendert,
      ctx.zaehler.hardError + ctx.zaehler.softError,
      detail
    ]);
  } catch (err) {
    // Ein nicht erreichbares Dashboard darf einen sonst erfolgreichen Lauf nicht als Fehler
    // dastehen lassen.
    Logger.log(`WARNUNG: Dashboard-Zeile konnte nicht geschrieben werden: ${err.message}`);
  }
}
