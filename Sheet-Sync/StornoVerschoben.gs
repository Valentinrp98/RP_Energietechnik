// ===== STORNO / VERSCHOBEN -> Hinweis in der Partner-Sheet-Zeile (05.10.2026) =====
//
// Valentin, 05.10.2026: "wenn storno vor ct / nach ct -> in der Sync-Liste ein Kommentar
// 'Storno einstweilen', und wenn verschoben -> 'keine Prio, verschoben auf später'".
//
// DIE Funktion zum Ausführen: pflegeStornoVerschobenHinweise()   (Datei: Sheet-Sync/StornoVerschoben.gs)
// Solange SV_SCHARF = false, ist sie eine reine Vorschau (Log, keine Sheet-Änderung).
// Mit SV_SCHARF = true schreibt sie UND der 5-Min-Lauf syncNeueZeilen() pflegt die Hinweise mit.
//
// WO: Notiz an der Kunden-Zelle (Spalte "Kunden") + Zellfarbe. Die bestehende Notiz ("Automatisch
// angelegt am ...") bleibt unter einem Trenner erhalten, der Hinweis steht oben.
//
// QUELLE: die beiden von Hand gepflegten Felder aus Sevdesk-Pipdrive_sync/StornoFelderSetup.js
// (28.09.2026). Stage 24 allein reicht nicht -- die heißt "Verschoben/onhold/storniert" und
// unterscheidet die Fälle nicht.
//
// REGELN
//   - Stornozeitpunkt gesetzt (ohne / vor / nach CT) -> Storno. Stage egal: das Feld IST die
//     ausdrückliche Handlung, und ein Storno ist endgültig.
//   - Verschiebezeitpunkt gesetzt UND Deal in Stage 24 -> Verschoben. Die Stage-Bedingung ist
//     nötig, weil das Feld als Historie stehen bleibt, wenn der Deal weiterläuft
//     (StornoFelderSetup.js: "beide Ereignisse bleiben erhalten"). Ohne sie bliebe "keine Prio" an
//     einem Kunden kleben, der längst wieder geplant wird.
//   - Beides gesetzt -> Storno gewinnt (erst verschoben, dann storniert).
//   - Stage 24 ohne eines der beiden Felder -> nicht raten. Sammelzeile im Log, damit jemand das
//     Feld in 30 Sekunden setzen kann.
//   - Fällt der Grund weg (Feld geleert / Deal aus Stage 24 raus) -> Hinweis + Farbe wieder raus,
//     die übrige Notiz bleibt.
//
// KOSTEN: null zusätzliche API-Calls (alles steckt im Deal-Objekt der Liste). Sheet-seitig ein
// getNotes() der Kunden-Spalte pro Partner pro Lauf. Erlischt von selbst: steht der richtige
// Hinweis schon drin, wird nichts geschrieben.
//
// GRENZE: syncNeueZeilen() liest nur status=won (Befund D20). Ein Storno, das in Pipedrive als
// "lost" markiert wird, fällt aus der Liste und bekommt keinen Hinweis -- RP schiebt bei Storno
// aber auf Stage 24 statt auf lost (CT-Funnel/Changelog.gs), der Normalfall ist also abgedeckt.

// Sicherheitsschalter: false = nur Vorschau, nichts im Sheet ändern, kein Mitlaufen im 5-Min-Lauf.
const SV_SCHARF = true; // scharf seit 05.10.2026 (Valentins OK nach Review)

// field_codes + Options-IDs aus docs/REFERENZ-Pipedrive-AppsScript.md ("Abschluss & Lernen").
const SV_STORNOZEITPUNKT_FIELD_KEY = 'fee682d05bd3c8c3e052474b6729429c129e70fb';     // ohne CT 413, vor CT 414, nach CT 415
const SV_VERSCHIEBEZEITPUNKT_FIELD_KEY = '03d6f3287eadf5993282118a68eeb8bbbbfcf5dd'; // ohne CT 416, vor CT 417, nach CT 418
const SV_VERSCHOBEN_AUF_FIELD_KEY = 'a6dc892da6e8a16eeef6e57e3530b903e0cf2f42';      // date, optional
const SV_STAGE_VERSCHOBEN_STORNIERT = 24; // Pipeline 2: "Verschoben/onhold/storniert"

// Hinweis-Kopf. raeumeAlteNotizen() (SetupHelpers.gs) erkennt die Hinweise an genau diesen
// Anfängen und lässt sie stehen -- also nur hier ändern.
const SV_PRAEFIX = {
  storno: '⛔ Storno einstweilen',
  verschoben: '⏸ Keine Prio'
};
const SV_FARBE = {
  storno: '#e8e8e8',     // grau, wie NA_GRAU_ im ALE-Sheet-Helper
  verschoben: '#fce5cd'  // hellorange
};
const SV_TRENNER = '\n—\n';

/** true, wenn die Notiz mit einem unserer Hinweise beginnt. Auch von raeumeAlteNotizen() genutzt. */
function svIstStatusHinweis(notiz) {
  const n = String(notiz || '');
  return Object.keys(SV_PRAEFIX).some(k => n.indexOf(SV_PRAEFIX[k]) === 0);
}

function svGesetzt(wert) {
  return wert !== null && wert !== undefined && String(wert).trim() !== '';
}

/**
 * Soll-Zustand für einen Deal. Rückgabe { art: 'storno'|'verschoben'|null, text, unklar }.
 * unklar = Stage 24, aber weder Storno- noch Verschiebezeitpunkt gesetzt.
 */
function svErmittleStatus(deal) {
  const cf = deal.custom_fields || {};
  const inStage24 = Number(deal.stage_id) === SV_STAGE_VERSCHOBEN_STORNIERT;

  if (svGesetzt(cf[SV_STORNOZEITPUNKT_FIELD_KEY])) {
    return { art: 'storno', text: `${SV_PRAEFIX.storno} – bitte nicht einplanen`, unklar: false };
  }
  if (svGesetzt(cf[SV_VERSCHIEBEZEITPUNKT_FIELD_KEY]) && inStage24) {
    const datum = alsDatum(String(cf[SV_VERSCHOBEN_AUF_FIELD_KEY] || '').slice(0, 10));
    const ab = datum ? `\nvoraussichtlich ab ${Utilities.formatDate(datum, Session.getScriptTimeZone(), 'dd.MM.yyyy')}` : '';
    return { art: 'verschoben', text: `${SV_PRAEFIX.verschoben} – verschoben auf später${ab}`, unklar: false };
  }
  return { art: null, text: '', unklar: inStage24 };
}

/** Notiz in { block, rest } zerlegen -- block ist unser Hinweis (oder ''), rest der Rest. */
function svZerlegeNotiz(notiz) {
  const n = String(notiz || '');
  if (!svIstStatusHinweis(n)) return { block: '', rest: n };
  const i = n.indexOf(SV_TRENNER);
  return i === -1 ? { block: n, rest: '' } : { block: n.slice(0, i), rest: n.slice(i + SV_TRENNER.length) };
}

/**
 * Notizen der Kunden-Spalte, pro Partner pro Lauf einmal gelesen. Hängt an der Identität von
 * eintrag.dealIdZeilen: Partnerwechsel.gs löscht Zeilen und setzt dealIdZeilen auf null -- dann
 * stimmen auch die Zeilennummern hier nicht mehr, und es wird neu gelesen.
 */
function svCacheKundenNotizen(eintrag, nameCol) {
  if (!eintrag.svNotizen || eintrag.svNotizenBasis !== eintrag.dealIdZeilen) {
    const anzahl = eintrag.sheet.getLastRow() - 1;
    eintrag.svNotizen = anzahl > 0
      ? eintrag.sheet.getRange(2, nameCol, anzahl, 1).getNotes().map(r => r[0])
      : [];
    eintrag.svNotizenBasis = eintrag.dealIdZeilen;
  }
  return eintrag.svNotizen;
}

/**
 * Hinweis für EINEN Deal setzen / ändern / entfernen. z = Zähler { gesetzt, entfernt, vorschau,
 * unklar: [] }. Schluckt Fehler bewusst: ein fehlender Hinweis darf die Zeilen-Anlage nie
 * scheitern lassen (gleiches Prinzip wie setzeNotizAmDeal() in Config.gs).
 */
function svPflegeDeal(deal, cache, z) {
  try {
    const status = svErmittleStatus(deal);
    const cf = deal.custom_fields || {};
    const partner = MONTAGEPARTNER_ID_TO_NAME[cf[MONTAGEPARTNER_FIELD_KEY]];
    if (!partner) return;
    const eintrag = cachePartnerEintrag(partner, cache);
    if (eintrag.fehler) return;
    const dealIdCol = cacheSpaltenIndex(eintrag, COL.dealId);
    const nameCol = cacheSpaltenIndex(eintrag, COL.name);
    if (!dealIdCol || !nameCol) return;
    const zeile = cacheDealIdZeilen(eintrag, dealIdCol)[String(deal.id)];
    if (!zeile) return; // keine Zeile im Sheet -> nichts zu tun, auch nichts zu klären
    if (status.unklar) z.unklar.push(deal.id);

    const notizen = svCacheKundenNotizen(eintrag, nameCol);
    const imCache = zeile - 2 < notizen.length;
    const zelle = eintrag.sheet.getRange(zeile, nameCol);
    // Schnellprüfung gegen den Cache; erst wenn sich etwas ändern soll, live nachlesen. Nötig, weil
    // findNextEmptyRowFor() Lücken von oben füllt: eine in diesem Lauf angelegte Zeile kann MITTEN
    // im gelesenen Block liegen, der Cache kennt ihre "Automatisch angelegt"-Notiz dann nicht.
    if (imCache && svZerlegeNotiz(notizen[zeile - 2]).block === status.text) return; // Soll = Ist
    const live = zelle.getNote();
    if (imCache) notizen[zeile - 2] = live;
    const { block, rest } = svZerlegeNotiz(live);
    if (block === status.text) return;
    const neu = status.text ? (rest ? status.text + SV_TRENNER + rest : status.text) : rest;
    const aktion = !status.text ? 'entfernt' : (block ? 'geändert' : 'gesetzt');
    const detail = status.text ? status.text.replace(/\n/g, ' | ') : `Hinweis weg (war: ${block.replace(/\n/g, ' | ')})`;

    if (!SV_SCHARF || DRY_RUN) {
      z.vorschau++;
      logRow('statushinweis', deal.id, partner, COL.name, 'VORSCHAU', `Zeile ${zeile}: würde ${aktion} -- ${detail}`);
      Logger.log(`VORSCHAU Deal ${deal.id} (${partner}, Zeile ${zeile}): ${aktion} -- ${detail}`);
      return;
    }

    zelle.setNote(neu);
    // Farbe nur auf "unserem" Terrain: weiße Zelle oder eine unserer Farben. Hat der Partner die
    // Zelle selbst eingefärbt, bleibt seine Farbe -- der Hinweis steht trotzdem in der Notiz.
    const farbe = String(zelle.getBackground()).toLowerCase();
    const eigeneFarbe = Object.keys(SV_FARBE).some(k => SV_FARBE[k] === farbe);
    if (status.art) {
      if (farbe === '#ffffff' || eigeneFarbe) zelle.setBackground(SV_FARBE[status.art]);
    } else if (eigeneFarbe) {
      zelle.setBackground(null);
    }
    if (imCache) notizen[zeile - 2] = neu;
    if (status.text) z.gesetzt++; else z.entfernt++;
    logRow('statushinweis', deal.id, partner, COL.name, aktion, `Zeile ${zeile}: ${detail}`);
  } catch (e) {
    logRow('statushinweis', deal.id, null, COL.name, 'FEHLER', e.message);
  }
}

function svNeueZaehler() {
  return { gesetzt: 0, entfernt: 0, vorschau: 0, unklar: [] };
}

/**
 * Stage 24 ohne Storno-/Verschiebezeitpunkt: eine Sammelzeile. Aus dem 5-Min-Lauf heraus höchstens
 * alle 6 h (sonst 288 identische Zeilen am Tag), aus dem Editor-Lauf immer.
 */
function svMeldeUnklare(z, gedrosselt) {
  if (!z.unklar.length) return;
  if (gedrosselt) {
    const sc = CacheService.getScriptCache();
    const key = 'sv:unklar:' + z.unklar.slice().sort().join(',').slice(0, 200);
    if (sc.get(key)) return;
    sc.put(key, '1', 21600);
  }
  logRow('statushinweis', null, null, null, 'MANUELL_KLAEREN',
         `${z.unklar.length} Deal(s) in Stage 24 ohne Storno-/Verschiebezeitpunkt -- Feld in Pipedrive setzen, dann kommt der Hinweis automatisch: ${kuerzeIdListe(z.unklar)}`);
}

/**
 * Editor-Einstieg: alle gewonnenen Deals einmal durchgehen. Mit SV_SCHARF = false nur Vorschau
 * (Ausführungsprotokoll + Log-Sheet), mit true wird geschrieben.
 */
function pflegeStornoVerschobenHinweise() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log('Ein anderer Sheet-Sync-Lauf schreibt gerade -- in 5 Minuten nochmal starten.');
    return;
  }
  starteLauf('pflegeStornoVerschobenHinweise');
  const z = svNeueZaehler();
  const cache = neuerSheetCache();
  let geprueft = 0;
  try {
    let cursor = null;
    do {
      const path = `deals?status=won&limit=100&sort_by=id&sort_direction=asc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const response = callPipedriveWithRetryRaw(`https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`);
      (response.data || []).forEach(deal => { geprueft++; svPflegeDeal(deal, cache, z); });
      cursor = response.additional_data?.next_cursor || null;
    } while (cursor);
    svMeldeUnklare(z, false);
  } finally {
    const modus = (!SV_SCHARF || DRY_RUN) ? 'VORSCHAU' : 'OK';
    logLaufEnde(z.unklar.length ? 'MANUELL_KLAEREN' : modus,
      { geprueft, gesetzt: z.gesetzt, entfernt: z.entfernt, vorschau: z.vorschau, stage24OhneZeitpunkt: z.unklar.length });
    if (z.unklar.length) Logger.log(`Stage 24 ohne Zeitpunkt: ${z.unklar.join(', ')}`);
    flushLog();
    lock.releaseLock();
  }
}
