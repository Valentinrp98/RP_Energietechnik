// ============================================================================
// KOSTEN FÜLLEN: "Dachmontage bezahlt von" + "Elektromontage bezahlt von"
// Stand 30.09.2026. Felder legt KostenFelderSetup.js an. Anzeige: Sheet-Sync,
// Spalte "Kostenübernahme" (ALE / Kreuzeder / Berger).
//
// Regel (VP 30.09.): Full Service ODER Finanzierung zugesagt -> RP zahlt beides.
//   Full Service          = Ausführungsart 154 -> RP
//   Selbstmontage (155) / Hybrid (156) -> RP nur mit Finanzierung zugesagt, sonst nichts
//   Ausführungsart leer   -> nichts (keine Info), auch mit Finanzierung
//   Finanzierung zugesagt = Finanzierungsstatus 204
//   "Finanzierung gewünscht? = nur als Vergleich" (306) zählt NICHT.
//   Test-Deals (KFU_AUSGESCHLOSSENE_DEALS) werden gar nicht angefasst.
// Alles andere wird beim Closing-Termin von Hand gesetzt -- das Script setzt nie "Kunde".
//
// "Automatisch, aber von Hand geändert bleibt": pro Deal und Feld merkt sich das
// Script in einer Script Property (KOSTEN_<dealId>, 2 Zeichen: Dach, Elektro):
//   '-'  noch nichts gemacht
//   'S'  Script hat RP gesetzt
//   'M'  von Hand -- nie wieder anfassen
//
//   Regel greift:
//     '-' + Feld leer               -> RP setzen, 'S'
//     '-' + Feld schon gesetzt      -> 'M' (hat jemand von Hand gemacht)
//     'S' + Feld nicht mehr RP/leer -> 'M'
//   Regel greift nicht (mehr), z.B. Finanzierung nachträglich abgelehnt:
//     'S' + Feld noch RP            -> Feld leeren, '-', Zeile KOSTEN-ZURUECK ins Sync-Log
//     'S' + Feld geändert           -> 'M'
//
// Sicherheit (wie RollenFuellen.js):
//   - Jeder PATCH feuert die Deal-Webhooks -> höchstens KFU_MAX_WRITES_PRO_LAUF Deals pro Lauf.
//   - Erster scharfer Set UND erster scharfer Leeren-Write: Round-Trip-Check.
//     Grund: ein undefined in custom_fields verwirft Pipedrive still mit 200, und
//     ob null ein enum-Feld wirklich leert, ist nicht dokumentiert.
//   - Status wird erst NACH erfolgreichem PATCH gespeichert.
//   - Verlorene Deals werden übersprungen.
//
// REIHENFOLGE:
//   1. KostenFelderSetup.js: kfAnlegen() scharf
//   2. kfLauf()  mit KFU_DRY_RUN = true -> Log prüfen
//   3. KFU_DRY_RUN = false, kfLauf() -> schreibt scharf
//   4. kfTriggerInstallieren()  stündlich
// ============================================================================

// Sicherheitsschalter: true = nur loggen, NICHTS nach Pipedrive schreiben.
const KFU_DRY_RUN = false; // scharf seit 30.09.2026 12:40 (erster Lauf: 28 Deals, 56 Felder, 0 Fehler)

// Müssen mit KostenFelderSetup.js übereinstimmen.
const KFU_FELD_DACH    = 'Dachmontage bezahlt von';
const KFU_FELD_ELEKTRO = 'Elektromontage bezahlt von';
const KFU_OPTION_RP    = 'RP';

// Aus docs/DUMP-dealFields-2026-09-15.md.
const KFU_AUSFUEHRUNGSART = 'cc80ad5daf0788dba60b3da3931681edd3dd2c87';
const KFU_AUSF_FULL_SERVICE = 154;
const KFU_FINANZIERUNGSSTATUS = 'ec8aa2fee84efabc5770fae60e13397c3247a146';
const KFU_FIN_ZUGESAGT = 204;

const KFU_PIPELINE_FULFILLMENT = 2;
const KFU_MAX_LAUFZEIT_MS = 4.5 * 60 * 1000;
const KFU_MAX_WRITES_PRO_LAUF = 30; // Deals, nicht Felder
const KFU_PROP_PREFIX = 'KOSTEN_';
const KFU_AUSGESCHLOSSENE_DEALS = [7253]; // AI TEST

/** enum-Wert als Zahl oder null. v2 liefert Zahl, ältere Antworten evtl. ein Objekt. */
function kfEnum_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'object') return Number(v.id || v.value) || null;
  return Number(v) || null;
}

/** field_codes + Options-ID "RP" per Name auflösen. Bricht ab, wenn etwas fehlt. */
function kfFeldInfo_() {
  const index = feldSetupIndex_(feldSetupLadeAlle_());
  const info = {};
  [KFU_FELD_DACH, KFU_FELD_ELEKTRO].forEach(name => {
    const f = index.get(feldSetupNorm_(name));
    if (!f) throw new Error('Feld "' + name + '" fehlt -- zuerst KostenFelderSetup.js / kfAnlegen().');
    if (f.field_type !== 'enum') throw new Error('Feld "' + name + '" hat Typ "' + f.field_type + '", erwartet "enum".');
    const rp = (f.options || []).find(o => o.label === KFU_OPTION_RP);
    if (!rp) throw new Error('Feld "' + name + '" hat keine Option "' + KFU_OPTION_RP + '".');
    info[name] = { code: f.field_code, rpId: rp.id };
  });
  return info;
}

/** RP zahlt bei Full Service oder Finanzierung zugesagt -- Ausführungsart leer = nichts. Grund oder null. */
function kfRegelGrund_(cf) {
  const art = kfEnum_(cf[KFU_AUSFUEHRUNGSART]);
  if (art === null) return null; // keine Info -> nicht raten
  const gruende = [];
  if (art === KFU_AUSF_FULL_SERVICE) gruende.push('Full Service');
  if (kfEnum_(cf[KFU_FINANZIERUNGSSTATUS]) === KFU_FIN_ZUGESAGT) gruende.push('Finanzierung zugesagt');
  return gruende.length ? gruende.join(' + ') : null;
}

/**
 * Entscheidet ein Feld. -> { neuStatus, write: undefined | rpId | null, text }
 * write undefined = nichts schreiben.
 */
function kfEntscheide_(status, wert, rpId, regelGreift) {
  if (status === 'M') return { neuStatus: 'M' };
  if (regelGreift) {
    if (status === '-') {
      if (wert === null) return { neuStatus: 'S', write: rpId, text: 'setze RP' };
      return { neuStatus: 'M', text: 'schon von Hand gesetzt -> ab jetzt Hand' };
    }
    // status 'S'
    if (wert === rpId) return { neuStatus: 'S' };
    return { neuStatus: 'M', text: 'von Hand geändert (' + (wert === null ? 'geleert' : wert) + ') -> ab jetzt Hand' };
  }
  if (status === 'S') {
    if (wert === rpId) return { neuStatus: '-', write: null, text: 'Regel greift nicht mehr -> RP wieder leeren' };
    return { neuStatus: 'M', text: 'von Hand geändert -> ab jetzt Hand' };
  }
  return { neuStatus: '-' };
}

/**
 * Hauptlauf. DRY: nur Logger. Scharf: PATCH + Status + Sync-Log für Zurücknahmen.
 * Script-Lock wie syncPendingOrders(): Read-Modify-Write auf KOSTEN_<id> + PATCH dürfen nicht
 * doppelt laufen (Trigger + Handstart). Belegt -> Lauf überspringen; kostet höchstens einen
 * 5-Min-Takt des sevdesk-Syncs, weil kfLauf ohne Writes nur Sekunden braucht.
 */
function kfLauf() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    Logger.log('⏭️ Ein anderer Lauf (sevdesk-Sync oder kfLauf) ist aktiv -- übersprungen, nächster Takt in 1 h.');
    return;
  }
  try {
    kfLaufUnlocked_();
  } finally {
    lock.releaseLock();
  }
}

/** Eigentliche Arbeit. Nur aus kfLauf() aufrufen, damit der Lock immer greift. */
function kfLaufUnlocked_() {
  const start = Date.now();
  const info = kfFeldInfo_();
  const felder = [KFU_FELD_DACH, KFU_FELD_ELEKTRO];
  const props = PropertiesService.getScriptProperties();
  const alleProps = props.getProperties();

  const deals = kfAlleDeals_();
  Logger.log((KFU_DRY_RUN ? '=== DRY RUN ===' : '=== SCHARF ===') + ' ' + deals.length + ' Fulfillment-Deals (ohne verlorene).');

  const zaehler = { gesetzt: 0, geleert: 0, aufHand: 0, regelGreift: 0, fehler: 0 };
  let roundTripSetOffen = !KFU_DRY_RUN, roundTripLeerOffen = !KFU_DRY_RUN;
  let schreibDeals = 0, schreibLimitErreicht = false, abgebrochenBei = null;

  for (let i = 0; i < deals.length; i++) {
    if (Date.now() - start > KFU_MAX_LAUFZEIT_MS) { abgebrochenBei = i; break; }
    const deal = deals[i];
    const cf = deal.custom_fields || {};
    const key = KFU_PROP_PREFIX + deal.id;
    const altStatus = alleProps[key] || '--';
    const grund = kfRegelGrund_(cf);
    if (grund) zaehler.regelGreift++;

    const updates = {};
    const logZeilen = [];
    let neuStatus = '';
    felder.forEach((name, idx) => {
      const f = info[name];
      const e = kfEntscheide_(altStatus.charAt(idx) || '-', kfEnum_(cf[f.code]), f.rpId, !!grund);
      neuStatus += e.neuStatus;
      if (e.write !== undefined) updates[f.code] = e.write;
      if (e.text) logZeilen.push(name + ': ' + e.text);
      if (e.neuStatus === 'M' && altStatus.charAt(idx) !== 'M') zaehler.aufHand++;
    });
    if (neuStatus === altStatus) continue;

    const kopf = 'Deal ' + deal.id + ' "' + deal.title + '"' + (grund ? ' (' + grund + ')' : '') + ' -- ';
    const hatWrite = Object.keys(updates).length > 0;

    try {
      // Limit nur scharf -- der DRY-Lauf soll den kompletten Effekt zeigen (DRY-Vollauf).
      if (hatWrite && !KFU_DRY_RUN) {
        if (schreibDeals >= KFU_MAX_WRITES_PRO_LAUF) { schreibLimitErreicht = true; continue; }
        schreibDeals++;
      }
      Logger.log((KFU_DRY_RUN ? '[DRY] ' : '✓ ') + kopf + logZeilen.join(' | '));
      if (KFU_DRY_RUN) {
        Object.keys(updates).forEach(k => updates[k] === null ? zaehler.geleert++ : zaehler.gesetzt++);
        continue;
      }

      if (hatWrite) {
        // Kein undefined durchlassen (Pipedrive verwirft es still mit 200).
        Object.keys(updates).forEach(k => {
          if (updates[k] !== null && typeof updates[k] !== 'number') throw new Error('Wert für ' + k + ' ist keine Options-ID: ' + updates[k]);
        });
        const r = pdFetch('/deals/' + deal.id, {
          method: 'patch',
          contentType: 'application/json',
          payload: JSON.stringify({ custom_fields: updates })
        });
        if (r.code < 200 || r.code >= 300) {
          throw new Error('PATCH HTTP ' + r.code + ': ' + String(r.raw).substring(0, 300));
        }
        // Status SOFORT nach dem PATCH speichern: wirft danach etwas (Round-Trip-GET, Sync-Log),
        // hielte der nächste Lauf ein Script-RP sonst für "von Hand" und nähme es nie zurück.
        kfSpeichereStatus_(props, key, neuStatus);

        const hatSet = Object.keys(updates).some(k => updates[k] !== null);
        const hatLeer = Object.keys(updates).some(k => updates[k] === null);
        if ((hatSet && roundTripSetOffen) || (hatLeer && roundTripLeerOffen)) {
          const neu = rfGet_('/deals/' + deal.id).data.custom_fields || {};
          Object.keys(updates).forEach(k => {
            if (kfEnum_(neu[k]) !== updates[k]) {
              kfSpeichereStatus_(props, key, altStatus); // Write hat nicht gegriffen -> alter Stand
              throw new Error('ROUND-TRIP FEHLGESCHLAGEN: ' + k + ' ist "' + JSON.stringify(neu[k]) + '", gesetzt ' + updates[k] + ' -- Lauf abgebrochen.');
            }
          });
          Logger.log('✓ Round-Trip-Check ok (Deal ' + deal.id + (hatLeer ? ', inkl. Leeren' : '') + ').');
          if (hatSet) roundTripSetOffen = false;
          if (hatLeer) roundTripLeerOffen = false;
        }
        Object.keys(updates).forEach(k => updates[k] === null ? zaehler.geleert++ : zaehler.gesetzt++);
        if (hatLeer) {
          logSyncResult('KOSTEN-ZURUECK', deal.id, '-', 'RP bei Kostenübernahme wieder entfernt',
                        '"' + deal.title + '": weder Full Service noch Finanzierung zugesagt -- bitte beim Kunden klären, wer zahlt.');
        }
      }

      // Ohne Write (nur Wechsel auf 'M') hier speichern; mit Write ist es oben schon passiert.
      if (!hatWrite) kfSpeichereStatus_(props, key, neuStatus);
    } catch (err) {
      zaehler.fehler++;
      Logger.log('✗ Deal ' + deal.id + ': ' + err.message);
      if (!KFU_DRY_RUN) logSyncResult('KOSTEN-FEHLER', deal.id, '-', err.message, '');
      if (String(err.message).indexOf('ROUND-TRIP') === 0) throw err;
    }
  }

  Logger.log('\nFertig. Regel greift bei ' + zaehler.regelGreift + ' Deals | ' +
             (KFU_DRY_RUN ? 'würde setzen: ' : 'gesetzt: ') + zaehler.gesetzt +
             ' | ' + (KFU_DRY_RUN ? 'würde leeren: ' : 'geleert: ') + zaehler.geleert +
             ' | neu auf Hand: ' + zaehler.aufHand +
             ' | Fehler: ' + zaehler.fehler);
  if (schreibLimitErreicht) {
    Logger.log('⏸ Limit ' + KFU_MAX_WRITES_PRO_LAUF + ' Deals pro Lauf erreicht -- Rest beim nächsten Lauf (oder kfLauf() nochmal starten).');
  }
  if (abgebrochenBei !== null) {
    Logger.log('⏱ Zeitlimit -- ' + (deals.length - abgebrochenBei) + ' Deals nicht geprüft, kommen beim nächsten Lauf dran.');
  }
}

/** Fulfillment-Deals ohne verlorene und ohne Test-Deals, neueste zuerst. */
function kfAlleDeals_() {
  return rfAlleSeiten_('/deals?pipeline_id=' + KFU_PIPELINE_FULFILLMENT)
    .filter(d => d.status !== 'lost' && KFU_AUSGESCHLOSSENE_DEALS.indexOf(Number(d.id)) === -1)
    .reverse();
}

function kfSpeichereStatus_(props, key, status) {
  if (status === '--') props.deleteProperty(key);
  else props.setProperty(key, status);
}

// Für kfZeigeStatus() -- ▷-Button ruft ohne Argumente auf, deshalb Konstante statt Parameter.
const KFU_STATUS_DEAL_IDS = [7657];

/** Zeigt den gemerkten Status der Deals in KFU_STATUS_DEAL_IDS. */
function kfZeigeStatus() {
  const props = PropertiesService.getScriptProperties();
  const t = { '-': 'nichts gemacht', 'S': 'Script hat RP gesetzt', 'M': 'von Hand -- tabu' };
  KFU_STATUS_DEAL_IDS.forEach(dealId => {
    const s = props.getProperty(KFU_PROP_PREFIX + dealId) || '--';
    Logger.log('Deal ' + dealId + ': Dach = ' + t[s.charAt(0)] + ', Elektro = ' + t[s.charAt(1)]);
  });
}

/** Stündlicher Trigger. Alte Trigger mit gleichem Handler werden vorher entfernt. */
function kfTriggerInstallieren() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'kfLauf')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('kfLauf').timeBased().everyHours(1).create();
  Logger.log('Stündlicher Trigger für kfLauf() angelegt.');
}
