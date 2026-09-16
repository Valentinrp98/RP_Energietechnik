// ===== ZEILEN-ERSTELLUNG (Pipedrive → Sheet, einmalig pro Deal) =====

/**
 * Läuft über alle gewonnenen Deals und legt im passenden Partner-Sheet eine Zeile an,
 * falls noch keine existiert. Erkennungslogik: Ordner-Link ist gesetzt (= Projekt
 * "Ordnererstellung-bei-Gewonnen" ist fertig) UND es gibt noch keine Zeile mit dieser Deal-ID.
 * Für den zeitgesteuerten Trigger gedacht (siehe SetupHelpers.gs).
 *
 * LOG-PRINZIP (Fix 2.9.2026): createSheetRowForDeal() loggt nur noch echte SCHREIBVORGÄNGE
 * (angelegt / DRY-RUN). Jeder Skip wird hier gezählt und pro Lauf zu EINER Zeile aggregiert.
 * Vorher schrieb jeder Lauf ~63 "Zeile existiert bereits"-Zeilen und 6 identische FEHLER-Zeilen
 * ins Log -- alle 15 Minuten, also ~6.600 Zeilen/Tag, in denen die eine relevante Meldung unterging.
 */
function syncNeueZeilen() {
  // LockService (Umfeld Befund D2): am 2.9.2026 haben ein Timer-Lauf und ein manueller
  // testCreateSheetRow()-Lauf gleichzeitig Deal 7319 verarbeitet und BEIDE "Zeile 20" berechnet.
  // Dort blieb es folgenlos -- gleicher Deal, gleiche Zeile, also idempotent. Bei zwei
  // VERSCHIEDENEN Deals wäre der zweite in die Zeile des ersten geschrieben worden:
  // findNextEmptyRowFor() + Schreiben ist nicht atomar. Ein Lauf dauert inzwischen 30-140s, also
  // liegt der nächste Timer nicht weit weg. tryLock statt waitLock: ein übersprungener Lauf ist
  // harmlos, der nächste kommt in 5 Minuten (Intervall am 10.09.2026 von 15 auf 5 Min verkürzt).
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log('syncNeueZeilen: ein anderer Lauf schreibt gerade -- übersprungen.');
    return;
  }

  starteLauf('syncNeueZeilen');
  let cursor = null;
  let processed = 0;
  // kandidaten = Deals mit gesetztem DOKU_STATUS_FIELD_KEY (TRIGGER oder DONE), also überhaupt für
  // eine Zeile in Frage kommen. Nur darauf darf der Alarm unten schauen (siehe dort).
  let kandidaten = 0;
  const summary = {
    angelegt: 0, nachgefuellt: 0, dryRun: 0, existiert: 0,
    keinOrdnerLink: 0, keinPartner: 0, sheetFehler: 0, nichtReady: 0
  };
  // Deal-IDs der Kandidaten, die HÄNGEN -- das ist die einzige Information, die aus einem Lauf
  // ohne neue Zeile heraus etwas wert ist.
  const haengt = { keinOrdnerLink: [], keinPartner: [], sheetFehler: [] };
  // Ein Cache PRO LAUF (nicht global) -- siehe neuerSheetCache() unten. Lebt genau so lange wie
  // dieser Lauf, danach wird wieder frisch aus den Sheets gelesen.
  const sheetCache = neuerSheetCache();

  try {
    do {
      // sort_by=id (Fix 2.9.2026): Deal 7195/7319 fehlten in mehreren aufeinanderfolgenden Live-
      // Läufen komplett -- nicht mal als "übersprungen" geloggt, obwohl beide durchgehend
      // status=won + DOKU_STATUS bereit waren (per Einzelabruf verifiziert). Ohne festen
      // Sortierschlüssel kann Cursor-Pagination bei mehreren Seiten (469 Deals / 100 pro Seite =
      // ~5 Seiten) Datensätze an Seitengrenzen verlieren, wenn mehrere Deals denselben Default-
      // Sortierwert (vermutlich update_time) haben. id ist garantiert eindeutig, also keine Ties
      // mehr an der Seitengrenze möglich.
      const path = `deals?status=won&limit=100&sort_by=id&sort_direction=asc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`;
      const response = callPipedriveWithRetryRaw(url);
      const deals = response.data || [];
      cursor = response.additional_data?.next_cursor || null;

      for (const deal of deals) {
        // GEÄNDERT 1.9.2026 (Valentins Vorgabe): statt eines Zeit-Cutoffs jetzt dasselbe Feld, das
        // auch den Projektdoku-Generator auslöst ("Projektdokumentation-Partner" = "rdy for
        // creation") -- ein Deal bekommt hier nur dann automatisch eine Zeile, wenn das Feld auf
        // TRIGGER (235) ODER schon DONE (234) steht (der Wert bleibt nach der Doku-Erstellung auf
        // 234 stehen, siehe Config.gs-Kommentar). Der Altbestand (21 gewonnene Deals ohne Zeile,
        // siehe DRY-RUN vom 1.9.) bleibt für diese Automatik unsichtbar, solange das Feld dort nicht
        // gesetzt wird -- Nachziehen bei Bedarf weiterhin manuell (testCreateSheetRow() bzw.
        // Namensabgleich-Projekt).
        const dokuStatus = String((deal.custom_fields || {})[DOKU_STATUS_FIELD_KEY]);
        const istReady = dokuStatus === String(DOKU_STATUS_OPTION_TRIGGER) || dokuStatus === String(DOKU_STATUS_OPTION_DONE);
        if (!istReady) {
          processed++;
          summary.nichtReady++;
          continue;
        }
        kandidaten++;
        // deal kommt schon vollständig aus der Liste (inkl. custom_fields) -- kein zusätzlicher
        // Einzelabruf pro Deal nötig, spart bei jedem 15-Minuten-Lauf viele API-Calls.
        const result = createSheetRowForDeal(deal, sheetCache);
        processed++;
        switch (result.code) {
          case 'angelegt': summary.angelegt++; break;
          case 'nachgefuellt': summary.nachgefuellt++; break;
          case 'dry-run': summary.dryRun++; break;
          case 'existiert': summary.existiert++; break;
          case 'kein-ordnerlink': summary.keinOrdnerLink++; haengt.keinOrdnerLink.push(deal.id); break;
          case 'kein-partner': summary.keinPartner++; haengt.keinPartner.push(deal.id); break;
          default: summary.sheetFehler++; haengt.sheetFehler.push(deal.id); break;
        }
      }
    } while (cursor);
  } finally {
    // Ein Kandidat, der auf den Ordner-Link wartet, ist der Normalfall kurz nach dem Gewinn --
    // erst wenn das über Tage so bleibt, ist die Kette wirklich blockiert. Deshalb hier nur als
    // Hinweiszeile, nicht als Lauf-Status.
    if (haengt.keinOrdnerLink.length) {
      logRow('zeile anlegen', null, null, null, 'wartet auf Ordner',
             `${haengt.keinOrdnerLink.length} Kandidat(en) ohne Kundenordner-Link: ${kuerzeIdListe(haengt.keinOrdnerLink)}`);
    }
    // Kein Montagepartner am Deal = Endstation. Weder dieses Script noch "Montagepartner-aus-
    // Bundesland" holen das nach (dort hängt es meist am fehlenden/falschen Bundesland, siehe
    // Befund "Pipedrive PLZ-Feld unzuverlässig"). Eine Zeile pro Lauf mit allen betroffenen
    // Deal-IDs -- in 30 Sekunden entscheidbar, statt 6 identischer FEHLER-Zeilen alle 15 Minuten.
    if (haengt.keinPartner.length) {
      logRow('zeile anlegen', null, null, null, 'MANUELL_KLAEREN',
             `${haengt.keinPartner.length} Deal(s) ohne Montagepartner -- Feld in Pipedrive setzen, dann kommt die Zeile automatisch: ${kuerzeIdListe(haengt.keinPartner)}`);
    }
    if (haengt.sheetFehler.length) {
      logRow('zeile anlegen', null, null, null, 'FEHLER',
             `${haengt.sheetFehler.length} Deal(s) mit Sheet-/Spalten-Problem: ${kuerzeIdListe(haengt.sheetFehler)}`);
    }

    // Lauf-Status (überarbeitet 2.9.2026): Der Alarm hing vorher an "kandidaten > 0 && angelegt
    // === 0". Das ist aber der eingeschwungene Normalzustand -- alle 69 Kandidaten haben ihre
    // Zeile, also feuerte KETTE_BLOCKIERT bei JEDEM 15-Minuten-Lauf. Genau der Fall, den der
    // Kommentar vom 1.9. vermeiden wollte, nur eine Ebene höher. Jetzt schaut der Status
    // ausschließlich auf Kandidaten, die tatsächlich HÄNGEN.
    const status = (summary.keinPartner || summary.sheetFehler) ? 'MANUELL_KLAEREN'
                 : (summary.keinOrdnerLink && !summary.angelegt && !summary.nachgefuellt && !summary.dryRun) ? 'KETTE_BLOCKIERT'
                 : 'OK';
    logLaufEnde(status, Object.assign({ geprueft: processed, kandidaten: kandidaten }, summary));
    flushLog();
    lock.releaseLock();
  }
}

/** Deal-ID-Listen fürs Log kürzen -- eine Log-Zelle mit 400 IDs liest niemand. */
function kuerzeIdListe(ids, max) {
  const grenze = max || 25;
  return ids.length <= grenze
    ? ids.join(', ')
    : `${ids.slice(0, grenze).join(', ')} ... (+${ids.length - grenze} weitere)`;
}

// ===== LAUF-CACHE (Performance, 10.09.2026) =====
//
// Anlass: Trigger-Intervall von 15 auf 5 Minuten verkürzt = 288 Läufe/Tag. Bei ~54s pro Lauf sind
// das 4,3h von 6h Trigger-GESAMTlaufzeit pro Tag -- und dieses Kontingent gilt pro NUTZER über
// alle Script-Projekte zusammen, nicht pro Projekt. Ist es aufgebraucht, stoppen ALLE Trigger des
// Accounts bis Mitternacht, ohne Fehlermeldung im Script.
//
// Die 54s kamen fast komplett aus drei Sheet-Operationen PRO KANDIDAT (aktuell 74 pro Lauf):
// SpreadsheetApp.openById() (der teuerste Einzelaufruf überhaupt), ein Kopfzeilen-Read für die
// Deal-ID-Spalte und ein Read der kompletten Deal-ID-Spalte. Es gibt aber nur 7 Partner-Sheets --
// also 222 Operationen für 7 verschiedene Sheets. Genau das Muster aus reference_apps_script_limits:
// "einmal getValues(), im Speicher arbeiten".
//
// ERGÄNZT 10.09.2026: cacheAlleWerte() liest zusätzlich einmal pro Partner den kompletten
// Datenblock -- Grundlage fürs Nachfüllen leerer Zellen (fuelleLeereZellenNach()). Zweiter Read
// pro Partner statt eines getValue() pro Spalte pro Deal; bei 7 Sheets nicht messbar.
//
// BEWUSST NICHT gecacht: findNextEmptyRowFor(). Das MUSS den Live-Zustand sehen, weil die
// Kollisionssicherung daran hängt (Deal-ID wird zuerst geschrieben und sofort geflusht, damit die
// Zielzeile für den nächsten Aufruf belegt ist). Ein Cache dort würde zwei neue Deals in dieselbe
// Zeile schreiben -- genau der Fehler, den der tryLock oben verhindern soll.

/** Leerer Lauf-Cache. Pro syncNeueZeilen()-Lauf einer, danach verworfen. */
function neuerSheetCache() {
  return { partner: {} };
}

/**
 * Sheet + Spaltennummern + Deal-ID-Index für einen Partner, pro Lauf nur einmal geladen.
 * Fehler (z.B. KOLLSTAR ohne konfigurierte Sheet-ID) werden MITgecacht -- sonst läuft
 * openPartnerSheet() für jeden betroffenen Kandidaten erneut in dieselbe Exception.
 */
function cachePartnerEintrag(partner, cache) {
  if (!cache.partner[partner]) {
    const eintrag = { sheet: null, fehler: null, spalten: {}, dealIdZeilen: null };
    try {
      eintrag.sheet = openPartnerSheet(partner);
    } catch (err) {
      eintrag.fehler = err.message;
    }
    cache.partner[partner] = eintrag;
  }
  return cache.partner[partner];
}

/** Spaltennummer einer Überschrift, pro Lauf und Sheet nur einmal aus der Kopfzeile gelesen. */
function cacheSpaltenIndex(eintrag, header) {
  if (!(header in eintrag.spalten)) {
    eintrag.spalten[header] = findColumnIndexByHeader(eintrag.sheet, header);
  }
  return eintrag.spalten[header];
}

/**
 * { "<Deal-ID>": Zeilennummer } für ein Partner-Sheet, pro Lauf einmal gelesen -- ersetzt
 * findRowByDealId() im Zeilen-Anlage-Pfad. Vergleichslogik absichtlich identisch zu
 * findRowByDealId() in Config.gs (String(...) ohne trim, leere Zellen ignoriert, bei Duplikaten
 * gewinnt die oberste Zeile), damit sich das Verhalten bei krummen Zellinhalten nicht still ändert.
 */
function cacheDealIdZeilen(eintrag, dealIdCol) {
  if (!eintrag.dealIdZeilen) {
    const zeilen = {};
    const anzahlDatenzeilen = eintrag.sheet.getLastRow() - 1;
    if (anzahlDatenzeilen > 0) {
      const werte = eintrag.sheet.getRange(2, dealIdCol, anzahlDatenzeilen, 1).getValues();
      werte.forEach((row, i) => {
        const wert = String(row[0]);
        if (wert !== '' && !(wert in zeilen)) zeilen[wert] = i + 2;
      });
    }
    eintrag.dealIdZeilen = zeilen;
  }
  return eintrag.dealIdZeilen;
}

/**
 * Alle Datenzeilen eines Partner-Sheets als 2D-Array, pro Lauf einmal gelesen. Basis fürs
 * Nachfüllen: welche Zellen einer bestehenden Zeile leer sind, lässt sich damit im Speicher
 * beantworten statt mit einem getValue() pro Spalte pro Deal.
 *
 * Zugriff: alleWerte[sheetZeile - 2][spalte - 1] (Zeile 1 ist die Kopfzeile).
 *
 * Bewusst getrennt von cacheDealIdZeilen(): dessen Vergleichslogik ist gegen findRowByDealId()
 * verifiziert, da wird nichts umgebaut, nur weil hier ein zweiter Leser dazukommt. Ein zusätzlicher
 * Read pro Partner pro Lauf (also 7) fällt neben dem openById nicht auf.
 */
function cacheAlleWerte(eintrag) {
  if (!eintrag.alleWerte) {
    const anzahlDatenzeilen = eintrag.sheet.getLastRow() - 1;
    const anzahlSpalten = eintrag.sheet.getLastColumn();
    eintrag.alleWerte = (anzahlDatenzeilen > 0 && anzahlSpalten > 0)
      ? eintrag.sheet.getRange(2, 1, anzahlDatenzeilen, anzahlSpalten).getValues()
      : [];
  }
  return eintrag.alleWerte;
}

/**
 * Baut die komplette Werte-Liste für eine Deal-Zeile: die einmaligen Stufe-1-Felder (Kontakt-/
 * Auftragsdaten) plus alle pipedrive_to_sheet-/bidirektionalen Sync-Felder mit ihrem aktuellen
 * Pipedrive-Wert. Rückgabe enthält NUR Header, die wirklich einen Wert haben.
 *
 * Ausgelagert am 10.09.2026, weil zwei Pfade dieselben Werte brauchen: das Anlegen einer neuen
 * Zeile und das Nachfüllen leerer Zellen in einer bestehenden. Eine zweite Kopie dieser Logik
 * würde genau den Fehler wiederholen, vor dem der Kommentar im Rumpf warnt -- Log und
 * Schreibvorgang dürfen nie auseinanderlaufen -- nur eine Ebene höher.
 *
 * person darf null sein (Deal ohne verknüpfte Person, oder der Aufrufer braucht die Personendaten
 * nicht): dann bleiben Adresse/PLZ/Telefon leer und der Name fällt auf den Deal-Titel zurück.
 */
function baueZeilenWerte(deal, cf, ordnerLink, person) {
  const dealId = deal.id;
  const name = person?.name || deal.title || `Deal ${dealId}`;

  // Stufe 1 (IDEEN-Felder-und-Aktionen.md): Kontakt-/Auftragsdaten, ohne die der Partner mit dem
  // Sheet allein nirgends hinfahren/niemanden erreichen kann. Bewusst NUR HIER, einmalig bei
  // Zeilen-Erstellung geschrieben (KORREKTUR 10.09.2026: seit dem Nachfüllen leerer Zellen auch
  // aus fuelleLeereZellenNach() -- aber ebenfalls einmalig, weil dort nur LEERE Zellen beschrieben
  // werden und die Person nur bei einer echten Lücke nachgeladen wird; der Kontingent-Grund unten
  // bleibt damit gewahrt) -- nicht Teil von SYNC_FIELD_CONFIG/des 15-Minuten-Loops, weil
  // sich Adresse/Telefon nach Gewinn praktisch nie mehr ändern und ein wiederkehrender
  // Person-Fetch pro Zeile pro Lauf denselben Kontingent-Fehler wie S1 (FIXES-2026-08-13.md)
  // reproduzieren würde, nur für Personendaten statt Dealdaten. person ist hier ohnehin schon
  // geladen (für "name"), kostet also keinen zusätzlichen Call.
  const personCf = person?.custom_fields || {};
  const adrObj = personCf[ADRESSE_FIELD_KEY];
  const adresse = adrObj?.formatted_address || adrObj?.value || '';
  const plz = personCf[PLZ_FIELD_KEY] || '';
  const telefon = person?.phones?.[0]?.value || '';
  const moduleAnzahl = cf[MODULE_ANZAHL_FIELD_KEY] || '';
  // Speicher (kWh) bleibt bewusst ungenutzt (Valentin, 25.08.) -- die Info steht schon im
  // Anlagendetails-Summary-Text (COL.module, siehe SYNC_FIELD_CONFIG unten), keine doppelte
  // Quelle für dieselbe Angabe.
  const erstellungsdatum = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy');

  // Komplette Liste aller Werte, die diese Zeile bekommen würde -- EINMAL aufgebaut, sowohl fürs
  // DRY-RUN-Log (Valentin, 25.08.: "ultra ungenau" -- vorher stand da nur der Name) als auch für
  // den echten Schreibvorgang unten. So können Log und tatsächliches Schreiben nie auseinanderlaufen.
  const geplanteWerte = {
    [COL.name]: name,
    [COL.ordnerLink]: ordnerLink,
    [COL.dealId]: dealId,
    [COL.adresse]: adresse,
    [COL.plz]: plz,
    [COL.telefon]: telefon,
    [COL.module]: moduleAnzahl,
    [COL.erstellungsdatum]: erstellungsdatum
  };
  // Alle pipedrive_to_sheet- UND bidirektionalen Felder (DC-/AC-/IB-Termin, Materiallieferung, ...)
  // gleich mit dem aktuellen Pipedrive-Wert befüllen, statt bis zum nächsten 15-Minuten-Sync zu warten.
  // combineFrom-Felder (z.B. "Sonstige Informationen") haben kein pipedriveFieldKey -- derselbe
  // Guard wie in FieldSync.gs syncPipedriveToSheetFields(), sonst crasht startsWith() auf undefined.
  SYNC_FIELD_CONFIG
    .filter(f => (f.direction === 'pipedrive_to_sheet' || f.direction === 'bidirektional')
      && (f.combineFrom || !f.pipedriveFieldKey.startsWith('TODO_')))
    .forEach(fieldConfig => {
      const wert = baueKombiniertenWert(fieldConfig, cf);
      // Nur überschreiben, wenn Pipedrive tatsächlich einen Wert liefert -- sonst würde z.B.
      // COL.module den oben schon berechneten moduleAnzahl-Fallback verlieren, nur weil das
      // neuere Anlagendetails-Summary-Feld bei diesem Deal (noch) nicht gesetzt ist.
      if (wert !== undefined) geplanteWerte[fieldConfig.sheetColumnHeader] = wert;
    });
  // Nur Header behalten, die wirklich einen Wert hätten -- sonst zeigt das Log lauter "" für
  // leere Termine/Felder und wird selbst wieder unübersichtlich.
  const befuellteWerte = Object.fromEntries(
    Object.entries(geplanteWerte).filter(([, wert]) => wert !== undefined && wert !== '' && wert !== null)
  );

  return befuellteWerte;
}

/**
 * Bestehende Zeile: leere Zellen nachtragen, gefüllte NIEMALS anfassen (Vorgabe Valentin
 * 10.09.2026: "nur die felder die noch leer sind").
 *
 * Anlass: Deal 5476 stand zwei Wochen halb leer im Kreuzeder-Sheet. Die Deal-ID hatte das
 * Namensabgleich-Projekt eingetragen (zusammen mit Adresse/PLZ/Telefon/Erstellungsdatum) --
 * Ordner-Link, Kundenname und Anlagengröße füllt es aber nicht. Dieser Zweig stieg wegen der
 * vorhandenen Deal-ID mit 'existiert' aus, ohne die Zeile je anzusehen. Das Schreiben der Deal-ID
 * allein hatte die Zeile also dauerhaft unbefüllbar gemacht; geholfen hat nur, sie ganz zu löschen.
 * Betrifft potenziell jede Zeile, deren Deal-ID nicht von diesem Script stammt.
 *
 * KOSTEN (wichtig, seit der Trigger alle 5 Min läuft): NULL zusätzliche API-Calls. Alles, was hier
 * nachgetragen wird, steckt schon im Deal-Objekt, das die Liste ohnehin geliefert hat. Deshalb
 * erlischt das hier garantiert von selbst: geschrieben wird nur, wenn es einen Wert gibt UND die
 * Zelle leer ist -- danach ist sie nicht mehr leer. Ist in Pipedrive nichts hinterlegt (z.B. ein
 * noch nicht vereinbarter DC-Termin), passiert gar nichts.
 *
 * KORREKTUR 10.09.2026 (erste Fassung war falsch, am Log aufgefallen): Die erste Version lud bei
 * einer leeren Adress-/PLZ-/Telefon-/Namensspalte die Person nach. Das erlischt NICHT von selbst --
 * hat Pipedrive dort auch nichts, wird nichts geschrieben, die Zelle bleibt leer und der Abruf
 * wiederholt sich bei jedem Lauf. Gemessen: 75 Kandidaten, 0 Nachträge, 198s statt 14s. Bei 288
 * Läufen/Tag wären das 15,8 h gegen ein Budget von 6 h -- also alle Trigger des Accounts tot.
 * Personendaten gehören damit NICHT in diesen Pfad; sie werden weiterhin nur beim Anlegen einer
 * neuen Zeile geschrieben.
 *
 * Notizen bleiben unangetastet: die Zeile wurde nicht von diesem Script angelegt, und eine
 * händische Notiz zu überschreiben wäre schlimmer als eine fehlende Herkunftsangabe.
 */
function fuelleLeereZellenNach(deal, cf, ordnerLink, partner, eintrag, zeile) {
  const dealId = deal.id;
  const alleWerte = cacheAlleWerte(eintrag);
  const vorhandene = alleWerte[zeile - 2];
  if (!vorhandene) {
    // Zeile liegt außerhalb des gelesenen Blocks -- das Sheet hat sich zwischen den beiden Reads
    // geändert. Dann lieber nichts tun als auf Verdacht schreiben; der nächste Lauf sieht sie.
    return { code: 'existiert', text: `übersprungen (Zeile ${zeile} existiert bereits)` };
  }

  // Leer heißt: nichts drin oder nur Leerzeichen. Ein Datum oder eine 0 gilt als gefüllt und
  // bleibt damit tabu.
  const istLeer = (header) => {
    const col = cacheSpaltenIndex(eintrag, header);
    if (!col) return false; // Spalte gibt es in diesem Partner-Sheet nicht -> nichts nachzutragen
    const wert = vorhandene[col - 1];
    return wert === null || wert === undefined || String(wert).trim() === '';
  };

  // KEIN Person-Abruf hier (Korrektur 10.09.2026, direkt am Log gemessen -- Begründung oben).
  // person = null heißt: Adresse/PLZ/Telefon fallen als '' heraus, und COL.name würde auf
  // deal.title zurückfallen -- den Deal-Titel in die Kundenspalte zu schreiben wäre schlimmer als
  // eine leere Zelle. Deshalb sind die vier Spalten hier explizit gesperrt, nicht nur ungefüllt.
  const PERSONEN_SPALTEN = [COL.name, COL.adresse, COL.plz, COL.telefon];
  const werte = baueZeilenWerte(deal, cf, ordnerLink, null);
  // Deal-ID steht per Definition schon drin -- daran haben wir die Zeile ja gefunden.
  const nachzutragen = Object.entries(werte)
    .filter(([header]) => header !== COL.dealId
                       && PERSONEN_SPALTEN.indexOf(header) === -1
                       && istLeer(header));

  if (!nachzutragen.length) {
    return { code: 'existiert', text: `übersprungen (Zeile ${zeile} existiert bereits, keine leeren Felder)` };
  }

  const alsObjekt = Object.fromEntries(nachzutragen);
  if (DRY_RUN) {
    logRow('zeile nachfüllen', dealId, partner, null, 'DRY-RUN',
           `würde in Zeile ${zeile} die leeren Felder nachtragen: ${JSON.stringify(alsObjekt)}`);
    return { code: 'dry-run',
             text: `DRY-RUN: würde in Zeile ${zeile} (${partner}) ${nachzutragen.length} leere Felder nachtragen` };
  }

  nachzutragen.forEach(([header, wert]) => {
    const col = cacheSpaltenIndex(eintrag, header);
    if (!col) return;
    eintrag.sheet.getRange(zeile, col).setValue(wert);
    vorhandene[col - 1] = wert; // Lauf-Cache mitziehen, sonst schreibt ein Doppel-Deal zweimal
  });

  logRow('zeile nachfüllen', dealId, partner, null, 'nachgefüllt',
         `Zeile ${zeile}: ${JSON.stringify(alsObjekt)}`);
  return { code: 'nachgefuellt',
           text: `nachgefüllt: Zeile ${zeile} im ${partner}-Sheet (${nachzutragen.length} Felder)` };
}

/**
 * Für einen einzelnen Deal: legt bei Bedarf die Sheet-Zeile im passenden Partner-Sheet an.
 * deal: entweder ein volles Deal-Objekt (aus der Liste) oder eine Deal-ID (dann wird nachgeladen --
 * praktisch für Einzeltests, siehe testCreateSheetRow() in SetupHelpers.gs).
 *
 * Rückgabe: { code, text } -- code ist stabil und maschinenlesbar ('angelegt' | 'dry-run' |
 * 'existiert' | 'kein-ordnerlink' | 'kein-partner' | 'sheet-fehler'), text ist die Klartextzeile
 * für Logger.log bei Einzelaufrufen. Vorher wurde in syncNeueZeilen() auf den deutschen Text
 * gematcht (result.startsWith('angelegt')) -- eine Formulierungsänderung hätte die Zählung still
 * verfälscht.
 */
function createSheetRowForDeal(deal, cache) {
  // Ohne Lauf-Cache (Einzelaufruf, z.B. testCreateSheetRow()) ein Wegwerf-Cache: dann passiert
  // genau das, was vorher fest im Code stand -- ein openById, ein Kopfzeilen-Read, ein
  // Spalten-Read. Verhalten für Einzelaufrufe damit unverändert.
  cache = cache || neuerSheetCache();

  if (typeof deal === 'number' || typeof deal === 'string') {
    deal = fetchPipedrive(`deals/${deal}`);
  }
  const dealId = deal.id;
  const cf = deal.custom_fields || {};

  const ordnerLink = cf[KUNDENORDNER_LINK_FIELD_KEY];
  if (!ordnerLink) {
    return { code: 'kein-ordnerlink',
             text: 'übersprungen (noch kein Ordner-Link -- Ordnererstellung-bei-Gewonnen ist noch nicht durch)' };
  }

  const partnerOptionId = cf[MONTAGEPARTNER_FIELD_KEY];
  const partner = MONTAGEPARTNER_ID_TO_NAME[partnerOptionId];
  if (!partner) {
    // Kein logRow hier: syncNeueZeilen() aggregiert das pro Lauf zu einer MANUELL_KLAEREN-Zeile.
    // Beim Einzelaufruf steht der Text im Execution-Log des Editors.
    return { code: 'kein-partner',
             text: `kein Montagepartner am Deal (Options-ID ${partnerOptionId}) -- Feld in Pipedrive setzen` };
  }

  const eintrag = cachePartnerEintrag(partner, cache);
  if (eintrag.fehler) {
    return { code: 'sheet-fehler', text: `übersprungen (${eintrag.fehler})` };
  }
  const sheet = eintrag.sheet;

  const dealIdCol = cacheSpaltenIndex(eintrag, COL.dealId);
  if (!dealIdCol) {
    return { code: 'sheet-fehler',
             text: `übersprungen (Spalte "${COL.dealId}" fehlt im Sheet von "${partner}" -- einmalig anlegen)` };
  }

  const dealIdZeilen = cacheDealIdZeilen(eintrag, dealIdCol);
  const bestehendeZeile = dealIdZeilen[String(dealId)];
  if (bestehendeZeile) {
    // NACHFÜLLEN statt blind überspringen (10.09.2026) -- Begründung in fuelleLeereZellenNach().
    return fuelleLeereZellenNach(deal, cf, ordnerLink, partner, eintrag, bestehendeZeile);
  }

  const person = deal.person_id ? fetchPipedrive(`persons/${deal.person_id}`) : null;
  const befuellteWerte = baueZeilenWerte(deal, cf, ordnerLink, person);
  const name = befuellteWerte[COL.name];

  if (DRY_RUN) {
    logRow('zeile anlegen', dealId, partner, null, 'DRY-RUN', `würde Zeile anlegen: ${JSON.stringify(befuellteWerte)}`);
    return { code: 'dry-run',
             text: `DRY-RUN: würde Zeile für "${name}" im ${partner}-Sheet anlegen (${Object.keys(befuellteWerte).length} Felder)` };
  }

  // Zielzeile muss vor dem Schreiben als leer geprüft werden -- sonst besteht bei Sheets mit
  // Zusatzinhalt unterhalb der Datenzeilen (Summen, Notizen) das Risiko, dort hineinzuschreiben.
  const nameCol = cacheSpaltenIndex(eintrag, COL.name);
  const checkCols = [dealIdCol, nameCol].filter(Boolean);
  const newRow = findNextEmptyRowFor(sheet, checkCols);

  // Deal-ID ZUERST schreiben und sofort per flush() festschreiben, dann der Rest. Sonst ist die
  // Zeile zwischen erstem Schreibvorgang und Ende der Schleife für findRowByDealId() noch
  // unsichtbar -- ein parallel laufender Lauf würde dieselbe Zielzeile berechnen. Zusammen mit
  // dem tryLock oben zweifach abgesichert; das flush() greift auch bei einem Abbruch mitten in
  // der Wertschleife (halb gefüllte Zeile bleibt dann wenigstens auffindbar statt anonym).
  sheet.getRange(newRow, dealIdCol).setValue(dealId);
  SpreadsheetApp.flush();

  Object.entries(befuellteWerte).forEach(([header, wert]) => {
    if (header === COL.dealId) return; // steht schon
    const col = cacheSpaltenIndex(eintrag, header);
    if (col) sheet.getRange(newRow, col).setValue(wert);
  });

  // Beantwortet ein für alle Mal "woher kommt diese Zeile" -- und macht sichtbar, dass sie
  // nicht von Hand eingetragen wurde (also auch nicht von Hand gelöscht werden sollte).
  if (nameCol) {
    sheet.getRange(newRow, nameCol).setNote(
      `Automatisch angelegt am ${notizZeitstempel()}\naus Pipedrive-Deal ${dealId}`);
  }

  // Frisch angelegte Zeile sofort in den Lauf-Cache nachtragen -- sonst würde derselbe Deal
  // innerhalb EINES Laufs (Pipedrive liefert einen Deal an einer Seitengrenze doppelt) eine
  // zweite Zeile bekommen. findRowByDealId() hat das vorher implizit erledigt, weil es jedes Mal
  // frisch gelesen hat.
  dealIdZeilen[String(dealId)] = newRow;

  logRow('zeile anlegen', dealId, partner, null, 'angelegt', `Zeile ${newRow}`);
  return { code: 'angelegt', text: `angelegt: Zeile ${newRow} im ${partner}-Sheet` };
}
