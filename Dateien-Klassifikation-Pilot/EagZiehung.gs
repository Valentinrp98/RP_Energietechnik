/**
 * EagZiehung.gs -- Ticketziehung 08.10.2026: Master (Tab „Ticketliste") → ein Tab pro Zieher
 *
 * 1. eagZiehungVorbereiten(): Master bekommt „Prio" (R, Dropdown „hoch"), „Zieher" (S), „Fix-Zieher" (T, Dropdown
 *    aus Team), neuer Tab „Team" (= Menschen anlegen). Mehrfach ausführbar.
 * 2. Von Hand: Namen in „Team" eintragen + Anwesend anhaken; im Master Prio = „hoch" setzen;
 *    Deals, die fix an jemanden gehen, in T zuordnen (gewinnt immer, solange die Person anwesend ist).
 * 3. eagZiehungVorschau(): Test, loggt die Verteilung, schreibt nichts.
 *    eagZiehungVerteilen(): aktualisiert zuerst die Liste, setzt Fix-Zuordnungen, verteilt dann alle übrigen
 *    ✅ ready, nicht gezogenen Deals gleichmäßig auf die Anwesenden (Fix-Deals zählen bei der Last mit) (Prio hoch → Kat A → B → C → D → ?), schreibt „Zieher" in den Master
 *    und baut die Tabs „<Name>" (Prio hoch ganz oben). Mehrfach ausführbar: Zuteilung an Anwesende bleibt,
 *    Deals von Abwesenden werden neu verteilt, bereits gezogene bleiben, wo sie sind.
 * 4. eagZiehungOnEdit (installierbarer Trigger, legt Schritt 3 an): Hakerl „Ticket gezogen" im Personen-Tab
 *    → Hakerl im Master (→ Zeitstempel B), und umgekehrt.
 */

const EAG_Z_PRIO_ = 18, EAG_Z_ZIEHER_ = 19, EAG_Z_FIX_ = 20; // R, S, T im Master
// U „Zusage schon" (seit 08.10.): Förderzusage gibt's schon → kein Ticket nötig. Hakerl nur im Master U (seit 08.10. abends,
// nicht mehr im Personen-Tab) → Zeile verschwindet sofort aus dem Personen-Tab (onEdit), Master-Zeile wandert nach unten.
const EAG_Z_ZUSAGE_ = 21, EAG_Z_TAB_DEAL_ = 6;
// Personen-Tab heißt seit 08.10. ~15 Uhr genau wie die Person (ohne „🎟 "). Alte „🎟 Name"-Tabs werden beim Verteilen
// umbenannt (gid/Link bleibt). Erkennung der Personen-Tabs über Kopf A1 = „Ticket gezogen" (eagZiehungIstTab_).
const EAG_Z_TEAM_ = 'Team', EAG_Z_PREFIX_ALT_ = '🎟 ', EAG_Z_TEAM_ZEILEN_ = 20;
// Ticket-Mail fürs EAG-Formular: Gruppe → alle im Team bekommen die Ticket-Mails (08.10., Test-Mail angekommen)
const EAG_Z_TICKET_MAIL_ = 'eag@rp-energietechnik.at';
const EAG_Z_SCHUTZ_ = 'EAG: RP alles, alle anderen nur Hakerl';
// Personen-Tab (seit 08.10. ~15 Uhr, Reihenfolge wie im EAG-Formular): A Hakerl · B ZPN · C Ticket-Mail · D Kunde ·
// E Zeitpunkt · F Deal-ID (ausgeblendet, nur für den Sync). Keine Notizen, keine Farben, kein Fett – Prio = Reihenfolge.
const EAG_Z_HEAD_ = [['Ticket gezogen', 70], ['Einspeise-ZPN', 280], ['Ticket-E-Mail', 230], ['Kunde', 220],
  ['Zeitpunkt', 135], ['Deal-ID', 65]];
const EAG_Z_T_ZPN_ = 2, EAG_Z_T_KUNDE_ = 4, EAG_Z_T_ZEIT_ = 5;

function eagZiehungVorbereiten() {
  const ss = eagListeHolen_(), sh = ss.getSheetByName('Ticketliste'), max = EAG_MAX_ZEILEN_;
  if (sh.getMaxColumns() < EAG_Z_ZUSAGE_) sh.insertColumnsAfter(sh.getMaxColumns(), EAG_Z_ZUSAGE_ - sh.getMaxColumns());
  [[EAG_Z_PRIO_, 'Prio', 60], [EAG_Z_ZIEHER_, 'Zieher', 110], [EAG_Z_FIX_, 'Fix-Zieher', 110],
    [EAG_Z_ZUSAGE_, 'Zusage schon', 80]].forEach(([c, name, w]) => {
    sh.getRange(1, c).setValue(name).setFontWeight('bold').setFontColor('#FFFFFF').setBackground(EAG_FARBE_.track)
      .setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('center');
    sh.setColumnWidth(c, w);
  });
  sh.getRange(2, EAG_Z_PRIO_, max - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['hoch'], true).setAllowInvalid(false).build());
  // U-Checkboxen nur bis zur letzten Datenzeile (bis 400 → getLastRow = 400, Bug 08.10.); neue Zeilen: eagFormelnUndFarben_
  if (eagLetzteZeile_(sh) > 1) sh.getRange(2, EAG_Z_ZUSAGE_, eagLetzteZeile_(sh) - 1, 1).insertCheckboxes();
  const f = sh.getFilter();
  if (f && f.getRange().getLastColumn() < EAG_Z_ZUSAGE_) { f.remove(); sh.getRange(1, 1, max, EAG_Z_ZUSAGE_).createFilter(); }
  // Prio hoch rot markieren (eagFormelnUndFarben_ lässt fremde Regeln stehen)
  const formel = '=$R2="hoch"', regeln = sh.getConditionalFormatRules();
  if (!regeln.some(r => r.getBooleanCondition() && r.getBooleanCondition().getCriteriaValues()[0] === formel)) {
    regeln.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formel)
      .setBackground('#F4CCCC').setBold(true).setRanges([sh.getRange(`R2:R${max}`)]).build());
    sh.setConditionalFormatRules(regeln);
  }

  if (!ss.getSheetByName(EAG_Z_TEAM_)) {
    const t = ss.insertSheet(EAG_Z_TEAM_, 1), n = EAG_Z_TEAM_ZEILEN_;
    t.getRange(1, 1, 1, 4).setValues([['Name', 'Anwesend', 'Zugeteilt', 'Gezogen']])
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground(EAG_FARBE_.track);
    t.getRange(2, 2, n, 1).insertCheckboxes();
    t.setColumnWidth(1, 160); t.setColumnWidth(6, 380); t.setFrozenRows(1);
  }
  const team = ss.getSheetByName(EAG_Z_TEAM_);
  team.getRange('E1').setValue('davon fix').setFontWeight('bold').setFontColor('#FFFFFF').setBackground(EAG_FARBE_.track);
  eagZiehungTeamFormeln_(team);
  team.getRange('F1:F5').setValues([['Ablauf'], ['1. Menschen hier anlegen (Spalte A), Anwesende anhaken'],
    ['2. Ticketliste Spalte R „Prio" = hoch → bei der Person ganz oben'],
    ['3. Ticketliste Spalte T „Fix-Zieher" = Name → Deal geht fix an diese Person'],
    ['4. eagZiehungVerteilen() ausführen (EagZiehung.gs)']]);
  team.getRange('F6').setValue('Spontanausfall: Hakerl „Anwesend" (B) raus → offene Kunden der Person werden sofort ' +
    'auf die anderen aufgeteilt (unten an deren Tab angehängt). Ergebnis steht in F8.');
  team.getRange('F1').setFontWeight('bold');
  sh.getRange(2, EAG_Z_FIX_, max - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(team.getRange(`A2:A${EAG_Z_TEAM_ZEILEN_ + 1}`), true).setAllowInvalid(true).build());
  Logger.log(`Vorbereitet: ${ss.getUrl()}#gid=${ss.getSheetByName(EAG_Z_TEAM_).getSheetId()}`);
}

// Team-Namen dürfen eine Klammer-Anmerkung haben („Lorin Palla (VP)") → zählt als „Lorin Palla" (Tab, Spalte S/T)
function eagZiehungName_(s) { return String(s).replace(/\s*\(.*\)\s*$/, '').trim(); }

// Team C Zugeteilt · D Gezogen · E davon fix -- Kriterium = Name ohne Klammer-Anmerkung
function eagZiehungTeamFormeln_(team) {
  team.getRange(2, 3, EAG_Z_TEAM_ZEILEN_, 3).setFormulas(Array.from({ length: EAG_Z_TEAM_ZEILEN_ }, (_, k) => {
    const a = `A${k + 2}`, n = `REGEXREPLACE(${a},"\\s*\\(.*\\)\\s*$","")`;
    return [`=IF(${a}="","",COUNTIF(Ticketliste!S:S,${n}))`,
      `=IF(${a}="","",COUNTIFS(Ticketliste!S:S,${n},Ticketliste!A:A,TRUE))`,
      `=IF(${a}="","",COUNTIF(Ticketliste!T:T,${n})+COUNTIF(Ticketliste!T:T,${n}&" (*"))`];
  }));
}

function eagZiehungVerteilen() { eagZiehungLauf_(false); }

// Test: rechnet die Verteilung durch und loggt sie -- schreibt NICHTS (kein S, keine Tabs, kein Trigger, kein Listen-Update)
function eagZiehungVorschau() { eagZiehungLauf_(true); }

// Neue Leute dazugekommen (Team-Tab: Name + Anwesend): Verteilen ohne Ausgleich gibt ihnen nur freie Deals.
// Ausgleichen schiebt offene Deals von den Vollsten zu den Leersten, bis alle ±1 gleich viele OFFENE haben.
// Gezogene + Fix-Deals bleiben; geschoben wird jeweils der letzte der Liste (= den hätte man zuletzt gezogen).
// Während der Ziehung nur mit Ansage: wer gerade einen verschobenen Deal ausfüllt, verliert die Zeile im Tab.
function eagZiehungAusgleichen() { eagZiehungLauf_(false, true); }
function eagZiehungAusgleichenVorschau() { eagZiehungLauf_(true, true); }

function eagZiehungLauf_(vorschau, ausgleich) {
  if (!vorschau) eagTicketliste(); // frische Daten (eigener Lock)
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Läuft schon, abgebrochen.'); return; }
  try {
    const ss = eagListeHolen_(), sh = ss.getSheetByName('Ticketliste'), team = ss.getSheetByName(EAG_Z_TEAM_), C = EAG_COL_;
    if (!team || sh.getMaxColumns() < EAG_Z_ZUSAGE_) throw new Error('Zuerst eagZiehungVorbereiten() ausführen');
    const leute = team.getRange(2, 1, Math.max(team.getLastRow() - 1, 1), 2).getValues()
      .filter(r => String(r[0]).trim() && r[1] === true).map(r => eagZiehungName_(r[0]));
    if (!leute.length) throw new Error('Niemand als anwesend angehakt (Tab „Team")');
    const sortLog = vorschau ? '' : '\n' + eagZiehungFarbigNachUnten_(sh); // vor dem Lesen, Zeilen k gelten danach

    const n = eagLetzteZeile_(sh) - 1, rng = sh.getRange(2, 1, n, EAG_Z_ZUSAGE_);
    const w = rng.getValues(), a = rng.getDisplayValues(), kRng = sh.getRange(2, C.kunde, n, 1);
    const notiz = kRng.getNotes(), schrift = kRng.getFontColors(), hg = kRng.getBackgrounds();
    const deals = w.map((r, k) => ({
      k, gezogen: r[C.gezogen - 1] === true, deal: r[C.deal - 1], kunde: a[k][C.kunde - 1], zpn: a[k][C.zpn - 1],
      mail: a[k][C.mail - 1], plz: a[k][C.plz - 1], kwp: r[C.kwp - 1], kat: a[k][C.kat - 1], partner: a[k][C.partner - 1],
      // Mail egal (Ticket-Mail = EAG_Z_TICKET_MAIL_) → „⚠️ Mail" mit ✅ ZPN zählt als ready
      ready: a[k][C.ready - 1].indexOf('✅') === 0 || (a[k][C.ready - 1] === '⚠️ Mail' && a[k][C.check - 1].indexOf('✅') === 0),
      prio: String(r[EAG_Z_PRIO_ - 1]).trim().toLowerCase() === 'hoch',
      zieher: eagZiehungName_(r[EAG_Z_ZIEHER_ - 1]), fix: eagZiehungName_(r[EAG_Z_FIX_ - 1]),
      notiz: notiz[k][0], schrift: schrift[k][0], hg: hg[k][0],
      farbe: eagZiehungFarbe_(schrift[k][0]) || eagZiehungFarbe_(hg[k][0]) || (r[EAG_Z_ZUSAGE_ - 1] === true ? 'Zusage' : '')
    })).filter(d => d.deal !== '' || d.zpn);

    const katRang = { A: 1, B: 2, C: 3, D: 4 };
    const rang = d => (d.prio ? 0 : 10) + (katRang[d.kat] || 5);
    const ordnung = (x, y) => rang(x) - rang(y) || String(x.deal).localeCompare(String(y.deal), undefined, { numeric: true });
    const last = {}, hoch = {};
    leute.forEach(p => { last[p] = 0; hoch[p] = 0; });
    const zaehle = d => { last[d.zieher]++; if (d.prio) hoch[d.zieher]++; };
    const log = [], warn = [];
    // Name rot = Storno, grün = macht der Kunde selbst → nicht verteilen (bereits gezogene bleiben)
    deals.filter(d => d.farbe && !d.gezogen).forEach(d => {
      d.raus = true;
      if (d.zieher) log.push(`${d.deal || d.kunde}: ${d.zieher} → raus (${d.farbe})`);
      d.zieher = '';
    });
    const raus = f => deals.filter(d => d.raus && d.farbe === f).map(d => d.deal || d.kunde).join(', ') || '—';
    const sonstFarbe = deals.filter(d => !d.farbe && (!/^#0{6}$/i.test(d.schrift) || !/^#f{6}$/i.test(d.hg)))
      .map(d => `${d.deal || d.kunde} (Schrift ${d.schrift}, Hintergrund ${d.hg})`);
    const rausLog = `\nRaus rot (Storno): ${raus('rot')}\nRaus grün (selber): ${raus('grün')}\nRaus Zusage schon: ${raus('Zusage')}` +
      (sonstFarbe.length ? `\nAndere Farbe, wird verteilt: ${sonstFarbe.join(', ')}` : '');
    // Fix-Zieher (Spalte T) gewinnt, solange die Person anwesend ist; sonst normal verteilen + Warnung
    const person = {};
    leute.forEach(p => { person[p.toLowerCase()] = p; });
    deals.filter(d => d.fix && d.ready && !d.gezogen && !d.raus).forEach(d => {
      const p = person[d.fix.toLowerCase()];
      if (!p) { warn.push(`${d.deal || d.kunde}: Fix-Zieher „${d.fix}" nicht anwesend → normal verteilt`); return; }
      if (d.zieher !== p) { if (d.zieher) log.push(`${d.deal || d.kunde}: ${d.zieher} → ${p} (fix)`); d.zieher = p; }
      d.istFix = true;
    });
    deals.filter(d => d.fix && !d.ready && !d.gezogen && !d.raus)
      .forEach(d => warn.push(`${d.deal || d.kunde}: Fix-Zieher „${d.fix}", aber nicht ready → nicht verteilt`));
    deals.filter(d => leute.indexOf(d.zieher) >= 0).forEach(zaehle);
    deals.filter(d => d.ready && !d.gezogen && !d.raus && leute.indexOf(d.zieher) < 0).sort(ordnung).forEach(d => {
      const alt = d.zieher;
      d.zieher = leute.slice().sort((x, y) => last[x] - last[y] || hoch[x] - hoch[y] || leute.indexOf(x) - leute.indexOf(y))[0];
      zaehle(d);
      if (alt) log.push(`${d.deal || d.kunde}: ${alt} (nicht anwesend) → ${d.zieher}`);
    });
    if (ausgleich) {
      const offen = p => deals.filter(d => d.zieher === p && !d.gezogen);
      const fest = {};
      for (;;) {
        const voll = leute.filter(p => !fest[p]).sort((x, y) => offen(y).length - offen(x).length)[0];
        const leer = leute.slice().sort((x, y) => offen(x).length - offen(y).length)[0];
        if (!voll || offen(voll).length - offen(leer).length <= 1) break;
        const d = offen(voll).filter(x => !x.istFix).sort(ordnung).pop();
        if (!d) { fest[voll] = true; continue; }
        d.zieher = leer;
        log.push(`${d.deal || d.kunde}: ${voll} → ${leer} (ausgleichen)`);
      }
    }

    if (vorschau) {
      const offen = deals.filter(d => !d.ready && !d.zieher && !d.raus);
      Logger.log(`VORSCHAU${ausgleich ? ' AUSGLEICHEN' : ''} (nichts geschrieben) · Anwesend: ${leute.join(', ')}\n` +
        leute.map(p => {
          const liste = deals.filter(d => d.zieher === p).sort(ordnung);
          return `${p}: ${liste.length}, ${liste.filter(d => !d.gezogen).length} offen ` +
            `(${liste.filter(d => d.prio).length} hoch, ${liste.filter(d => d.istFix).length} fix) → ` +
            liste.map(d => `${d.deal || d.kunde}${d.prio ? '🔴' : ''}${d.istFix ? '📌' : ''}/${d.kat}`).join(', ');
        }).join('\n') +
        `\nNicht verteilt (nicht ready): ${offen.map(d => `${d.deal || d.kunde} ${a[d.k][C.ready - 1]}`).join(', ') || '—'}` +
        (log.length ? `\nUmverteilt:\n${log.join('\n')}` : '') + (warn.length ? `\n⚠️ Fix-Zuordnung:\n${warn.join('\n')}` : '') + rausLog +
        `\nBeim Verteilen nach unten: ${eagZiehungZuSchieben_(deals.map(d => !!d.farbe)).length} rot/grün-Zeilen`);
      return;
    }

    const spalteS = w.map(r => [r[EAG_Z_ZIEHER_ - 1]]);
    deals.forEach(d => { spalteS[d.k][0] = d.zieher; });
    sh.getRange(2, EAG_Z_ZIEHER_, n, 1).setValues(spalteS);
    eagZiehungTeamFormeln_(team);
    eagZiehungSchutzMaster_(sh);

    // Tabs: alle mit zugeteilten Deals (auch Abwesende mit bereits gezogenen), übrige 🎟-Tabs weg
    const namen = leute.concat([...new Set(deals.map(d => d.zieher))].filter(p => p && leute.indexOf(p) < 0));
    const links = [];
    namen.forEach((p, i) => {
      const liste = deals.filter(d => d.zieher === p).sort(ordnung);
      if (!liste.length) return;
      const t = eagZiehungTab_(ss, p, liste, 2 + i);
      links.push(`${p}: ${liste.length} (${liste.filter(d => d.prio).length} hoch) → ${ss.getUrl()}#gid=${t.getSheetId()}`);
    });
    ss.getSheets().filter(t => eagZiehungIstTab_(t) && !deals.some(d => d.zieher && d.zieher === t.getName()))
      .forEach(t => ss.deleteSheet(t));

    if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'eagZiehungOnEdit'))
      ScriptApp.newTrigger('eagZiehungOnEdit').forSpreadsheet(ss).onEdit().create();

    const offen = deals.filter(d => !d.ready && !d.zieher && !d.raus);
    Logger.log(`Anwesend: ${leute.join(', ')}\n${links.join('\n')}\n` +
      `Nicht verteilt (nicht ready): ${offen.map(d => `${d.deal || d.kunde} ${a[d.k][C.ready - 1]}`).join(', ') || '—'}` +
      (log.length ? `\nUmverteilt:\n${log.join('\n')}` : '') + (warn.length ? `\n⚠️ Fix-Zuordnung:\n${warn.join('\n')}` : '') + rausLog + sortLog);
  } finally {
    lock.releaseLock();
  }
}

function eagZiehungTab_(ss, name, liste, pos) {
  const titel = name, h = EAG_Z_HEAD_.length, n = liste.length;
  let t = ss.getSheetByName(titel);
  const alt = !t && ss.getSheetByName(EAG_Z_PREFIX_ALT_ + name);
  if (alt) { alt.setName(titel); t = alt; } // umbenennen statt neu → gid (geteilter Link) bleibt
  if (t) { // leeren statt löschen → gid (geteilter Link) bleibt
    t.clear(); t.clearNotes(); t.clearConditionalFormatRules();
    t.getRange(1, 1, t.getMaxRows(), t.getMaxColumns()).clearDataValidations();
  } else t = ss.insertSheet(titel, Math.min(pos, ss.getSheets().length));
  if (t.getMaxColumns() < h) t.insertColumnsAfter(t.getMaxColumns(), h - t.getMaxColumns());
  t.showColumns(1, h);
  t.setTabColor('#7F6000');
  t.getRange(1, 1, 1, h).setValues([EAG_Z_HEAD_.map(x => x[0])]).setFontWeight('bold').setFontColor('#FFFFFF')
    .setBackground(EAG_FARBE_.ticket).setWrap(true).setVerticalAlignment('middle');
  EAG_Z_HEAD_.forEach((x, i) => t.setColumnWidth(i + 1, x[1]));
  t.setFrozenRows(1);
  if (t.getMaxColumns() > h) t.deleteColumns(h + 1, t.getMaxColumns() - h); // alte Spalten (Prio, PLZ, Zusage G …) weg
  t.getRange(2, 1, n, h).setNumberFormat('General'); // alte Tabs: G hatte Text-Format → Hakerl wurde Text „false"
  t.getRange(2, EAG_Z_T_ZPN_, n, 1).setNumberFormat('@');
  t.getRange(2, EAG_Z_T_ZEIT_, n, 1).setNumberFormat('dd.MM. HH:mm:ss');
  t.getRange(2, 1, n, 1).insertCheckboxes();
  t.getRange(2, 1, n, h).setValues(liste.map((d, k) => eagZiehungTabZeile_(d.gezogen, d.zpn, d.kunde, d.deal, k + 2)));
  t.hideColumns(EAG_Z_TAB_DEAL_);
  t.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$A2=TRUE').setBackground('#C6E0B4')
      .setRanges([t.getRange(2, 1, t.getMaxRows() - 1, h)]).build() // ganze Spalten → Ausfall-Zeilen unten auch grün
  ]);
  eagZiehungFortschritt_(t);
  // Nur zum Kopieren (außer RP): ganzer Tab gesperrt außer Hakerl A (bei jedem Lauf neu, Zeilenzahl ändert sich)
  eagZiehungSchutzTab_(t, eagZiehungTabFrei_(t, n));
  return t;
}

// Personen-Tab: frei für Link-Leute = nur Hakerl A
function eagZiehungTabFrei_(t, n) {
  return n > 0 ? [t.getRange(2, 1, n, 1)] : [];
}

// Eine Zeile im Personen-Tab; Zeitpunkt = XLOOKUP über die ZPN in den Master (Zeilen dürfen dort wandern)
function eagZiehungTabZeile_(gezogen, zpn, kunde, deal, zeile) {
  const z = `XLOOKUP(B${zeile},Ticketliste!G:G,Ticketliste!B:B,"")`;
  return [gezogen, zpn, EAG_Z_TICKET_MAIL_, kunde, `=IFERROR(IF(${z}="","",${z}),"")`, deal];
}

// Personen-Tab = Kopf A1 „Ticket gezogen" (Master hat denselben Kopf → per Name ausgeschlossen)
function eagZiehungIstTab_(t) {
  const n = t.getName();
  return n !== 'Ticketliste' && n !== EAG_Z_TEAM_ && n !== 'Info' && t.getRange(1, 1).getValue() === EAG_Z_HEAD_[0][0];
}

// Live-Fortschritt im Kopf C1 („Kunde · 3/12 gezogen"), reine Formel → aktualisiert sich bei jedem Hakerl, kein Trigger.
// Alles gezogen → Kopf grün. Daten bleiben ab Zeile 2 (onEdit-Indizes unverändert).
function eagZiehungFortschritt_(t) {
  const c1 = t.getRange(1, EAG_Z_T_KUNDE_), alle = '=COUNTIF($A$2:$A,TRUE)=COUNTA($B$2:$B)';
  c1.setFormula('="Kunde · "&COUNTIF(A2:A,TRUE)&"/"&COUNTA(B2:B)&" gezogen"');
  const regeln = t.getConditionalFormatRules().filter(r =>
    !(r.getBooleanCondition() && r.getBooleanCondition().getCriteriaValues()[0] === alle));
  regeln.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(alle)
    .setBackground('#38761D').setRanges([t.getRange(1, 1, 1, EAG_Z_TAB_DEAL_ - 1)]).build());
  t.setConditionalFormatRules(regeln);
}

// Einzeln ausführbar: Fortschritt in alle bestehenden 🎟-Tabs, ohne neu zu verteilen
function eagZiehungFortschrittAn() {
  const tabs = eagListeHolen_().getSheets().filter(eagZiehungIstTab_);
  tabs.forEach(eagZiehungFortschritt_);
  Logger.log(`Fortschritt live in: ${tabs.map(t => t.getName()).join(', ')}`);
}

// Einzeln ausführbar, ohne neu zu verteilen: Master sortieren (ZPN da → ohne ZPN → rot/grün/Zusage unten)
function eagZiehungSortieren() { eagZiehungFarbigNachUnten(); }

function eagZiehungFarbigNachUnten() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Läuft schon, abgebrochen.'); return; }
  try { Logger.log(eagZiehungFarbigNachUnten_(eagListeHolen_().getSheetByName('Ticketliste'))); }
  finally { lock.releaseLock(); }
}

// Indizes der farbigen Zeilen, unter denen noch eine nicht-farbige steht (= müssen nach unten)
function eagZiehungZuSchieben_(farbig) {
  const letzteNormale = farbig.lastIndexOf(false);
  return farbig.map((f, k) => (f && k < letzteNormale ? k : -1)).filter(k => k >= 0);
}

// Sortierung (seit 08.10. abends): 1) Einspeise-ZPN (G) da · 2) ohne ZPN (⏳) · 3) rot/grün/Zusage ganz unten.
// Innerhalb der Gruppen bleibt die Reihenfolge. Ganze Zeilen per moveRows (Notizen, Farben, Hakerl wandern mit).
// Zeitstempel B ist ein Zirkelbezug → danach je gezogenem Deal prüfen und notfalls als fixen Wert zurückschreiben
// (Haken weg → eagZiehungOnEdit setzt die Formel wieder).
function eagZiehungFarbigNachUnten_(sh) {
  const C = EAG_COL_, n = eagLetzteZeile_(sh) - 1; // nicht getLastRow (leere Checkbox-Zeilen → Ziel hinter Zeile 400)
  if (n < 2) return 'Sortierung: nichts zu tun.';
  const kRng = sh.getRange(2, C.kunde, n, 1), schrift = kRng.getFontColors(), hg = kRng.getBackgrounds();
  const zusage = sh.getMaxColumns() >= EAG_Z_ZUSAGE_ ? sh.getRange(2, EAG_Z_ZUSAGE_, n, 1).getValues() : schrift.map(() => [false]);
  const vorher = sh.getRange(2, 1, n, C.zpn).getValues(); // A gezogen, B Zeit, C Deal … G ZPN
  const rang = vorher.map((r, k) => (eagZiehungFarbe_(schrift[k][0]) || eagZiehungFarbe_(hg[k][0]) || zusage[k][0] === true) ? 2
    : (String(r[C.zpn - 1]).trim() ? 0 : 1));
  const reihe = vorher.map((_, k) => k).sort((x, y) => rang[x] - rang[y] || x - y); // Ziel: reihe[pos] = alter Index
  const ist = vorher.map((_, k) => k); // ist[pos] = alter Index der Zeile, die gerade an pos steht
  let zuege = 0;
  reihe.forEach((alt, pos) => { // Positionen davor sind fertig → Zeile steht an j ≥ pos, nach oben ziehen
    const j = ist.indexOf(alt);
    if (j === pos) return;
    sh.moveRows(sh.getRange(j + 2, 1), pos + 2);
    ist.splice(j, 1); ist.splice(pos, 0, alt);
    zuege++;
  });
  const anz = [0, 1, 2].map(x => rang.filter(r => r === x).length);
  const text = `${anz[0]} mit ZPN oben · ${anz[1]} ohne ZPN · ${anz[2]} rot/grün/Zusage unten`;
  if (!zuege) return `Sortierung: passt schon (${text})`;
  SpreadsheetApp.flush();
  const nachher = sh.getRange(2, 1, n, C.deal).getValues(), warn = [];
  let fix = 0;
  reihe.forEach((alt, pos) => {
    const [gez, zeit, deal] = vorher[alt];
    if (gez !== true || !(zeit instanceof Date)) return;
    const p = deal !== '' ? nachher.findIndex(r => String(r[C.deal - 1]) === String(deal)) : pos;
    if (p < 0) { warn.push(`${deal}: Zeile nicht wiedergefunden, Zeitpunkt war ${zeit}`); return; }
    const b = nachher[p][C.zeit - 1];
    if (!(b instanceof Date) || b.getTime() !== zeit.getTime()) { sh.getRange(p + 2, C.zeit).setValue(zeit); fix++; }
  });
  return `Sortierung: ${zuege} Zeilen verschoben (${text})` + (fix ? `, ${fix} Zeitstempel fix zurückgeschrieben` : ', Zeitstempel unverändert') +
    (warn.length ? `\n⚠️ ${warn.join('\n⚠️ ')}` : '');
}

// Haken weg → Zeitstempel-Formel zurück, falls B nach dem Umsortieren als fixer Wert drinsteht
function eagZiehungZeitFormel_(master, row) {
  const b = master.getRange(row, EAG_COL_.zeit);
  if (!b.getFormula()) b.setFormula(`=IF(A${row},IF(B${row}="",NOW(),B${row}),"")`);
}

// Schutz für die ganze Datei (08.10.): RP-Domain darf alles, alle anderen (Link-Mitbearbeiter) nur die Hakerl.
// Einzeln ausführbar, ohne neu zu verteilen. Script + onEdit-Trigger laufen als Owner und dürfen weiter schreiben.
// Wirkt nur zusammen mit der Freigabe: Link-Leute brauchen „Mitbearbeiter", sonst können sie gar nichts anhaken.
function eagZiehungSchutzAn() {
  const ss = eagListeHolen_();
  eagZiehungSchutzMaster_(ss.getSheetByName('Ticketliste'));
  [EAG_Z_TEAM_, 'Info'].map(x => ss.getSheetByName(x)).filter(Boolean).forEach(t => eagZiehungSchutzTab_(t, []));
  ss.getSheets().filter(eagZiehungIstTab_)
    .forEach(t => eagZiehungSchutzTab_(t, eagZiehungTabFrei_(t, t.getLastRow() - 1)));
  Logger.log(`Schutz an: RP (@${Session.getEffectiveUser().getEmail().split('@')[1]}) alles, Link-Mitbearbeiter nur Hakerl. ` +
    `Tabs: ${ss.getSheets().map(t => t.getName()).join(', ')}`);
}

// Master übersichtlicher: E Partner, F PLZ, I Kunden-Mail, K kWp, L kWh, M Quote, N Neu/Erw ausblenden (Daten bleiben,
// Formeln rechnen weiter). Wieder einblenden: Spaltenkopf-Pfeile im Sheet oder eagZiehungSpaltenZeigen().
const EAG_Z_VERBERGEN_ = ['E', 'F', 'I', 'K', 'L', 'M', 'N'];
function eagZiehungSpaltenVerbergen() {
  const sh = eagListeHolen_().getSheetByName('Ticketliste');
  EAG_Z_VERBERGEN_.forEach(x => sh.hideColumns(sh.getRange(x + '1').getColumn()));
  Logger.log(`Ausgeblendet: ${EAG_Z_VERBERGEN_.join(', ')}`);
}
function eagZiehungSpaltenZeigen() {
  const sh = eagListeHolen_().getSheetByName('Ticketliste');
  EAG_Z_VERBERGEN_.forEach(x => sh.showColumns(sh.getRange(x + '1').getColumn()));
}

// Master: alles gesperrt außer den Hakerl-Spalten A (gezogen), O (EAG-Portal), P (Antrag), U (Zusage schon)
function eagZiehungSchutzMaster_(sh) {
  // alte Einzel-Sperren G/I (nur Owner) ablösen → RP darf jetzt auch dort
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .filter(p => p.getDescription() === 'EAG: ZPN + Mail gesperrt (Korrektur im Montage-Sheet)').forEach(p => p.remove());
  const max = EAG_MAX_ZEILEN_, C = EAG_COL_;
  eagZiehungSchutzTab_(sh, [C.gezogen, C.portal, C.antrag, EAG_Z_ZUSAGE_].map(c => sh.getRange(2, c, max - 1, 1)));
}

// Tab-Schutz neu setzen: ganze Tab gesperrt für Nicht-RP, frei bleiben nur die übergebenen Bereiche
function eagZiehungSchutzTab_(t, frei) {
  t.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => p.remove());
  return eagZiehungNurRp_(t.protect().setDescription(EAG_Z_SCHUTZ_)).setUnprotectedRanges(frei);
}

// Hex-Farbe → 'rot' | 'grün' | '' (deckt kräftige + helle Töne ab; Orange/Gelb/Grau zählen nicht)
function eagZiehungFarbe_(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return '';
  const [r, g, b] = m.slice(1).map(x => parseInt(x, 16));
  if (r >= 150 && r - g >= 30 && r - b >= 30 && Math.abs(g - b) <= 60) return 'rot';
  if (g >= 100 && g - r >= 15 && g - b >= 15 && Math.abs(r - b) <= 80) return 'grün';
  return '';
}

// Muster aus der Apps-Script-Doku (Einzel-Editoren raus) + ganze RP-Domain darf bearbeiten (Workspace-Domain des Owners)
function eagZiehungNurRp_(p) {
  p.addEditor(Session.getEffectiveUser());
  p.removeEditors(p.getEditors());
  p.setDomainEdit(true);
  return p;
}

// Zusage schon: Master U an; nicht gezogen → Zieher S leer (Team-Zähler stimmt, nächstes Verteilen nimmt ihn raus)
function eagZiehungZusageMaster_(master, row, gezogen) {
  master.getRange(row, EAG_Z_ZUSAGE_).setValue(true);
  if (!gezogen) master.getRange(row, EAG_Z_ZIEHER_).setValue('');
}

// Installierbarer onEdit-Trigger (legt eagZiehungVerteilen an): Hakerl Personen-Tab ↔ Master
function eagZiehungOnEdit(e) {
  const r = e.range, t = r.getSheet(), name = t.getName(), ss = t.getParent(), C = EAG_COL_;
  if (r.getRow() < 2) return;
  const master = ss.getSheetByName('Ticketliste');
  if (name === 'Ticketliste' && r.getColumn() <= EAG_Z_ZUSAGE_ && r.getLastColumn() >= EAG_Z_ZUSAGE_) {
    // Master U „Zusage schon" angehakt → Zeile aus dem Personen-Tab löschen, Zieher S leeren (wenn nicht gezogen)
    master.getRange(r.getRow(), 1, r.getNumRows(), EAG_Z_ZUSAGE_).getValues().forEach((x, i) => {
      if (x[EAG_Z_ZUSAGE_ - 1] !== true) return;
      const tab = x[EAG_Z_ZIEHER_ - 1] && ss.getSheetByName(eagZiehungName_(x[EAG_Z_ZIEHER_ - 1]));
      eagZiehungZusageMaster_(master, r.getRow() + i, x[C.gezogen - 1] === true);
      if (!tab || tab.getLastRow() < 2) return;
      const zeilen = tab.getRange(2, EAG_Z_T_ZPN_, tab.getLastRow() - 1, 5).getDisplayValues(); // B ZPN … F Deal
      const deal = x[C.deal - 1], zpn = String(x[C.zpn - 1]);
      const k = zeilen.findIndex(z => deal !== '' ? z[4] === String(deal) : (zpn && z[0] === zpn));
      if (k >= 0) tab.deleteRow(k + 2);
    });
  }
  if (name === EAG_Z_TEAM_ && r.getColumn() <= 2 && r.getLastColumn() >= 2) { // Team B „Anwesend" raus = Spontanausfall
    t.getRange(r.getRow(), 1, r.getNumRows(), 2).getValues()
      .filter(x => String(x[0]).trim() && x[1] !== true).forEach(x => eagZiehungAusfall_(ss, eagZiehungName_(x[0])));
    return;
  }
  if (r.getColumn() === 1 && name !== 'Ticketliste' && eagZiehungIstTab_(t)) { // Personen-Tab: A Hakerl, B ZPN, F Deal-ID
    const m = master.getRange(2, 1, master.getLastRow() - 1, C.zpn).getDisplayValues();
    t.getRange(r.getRow(), 1, r.getNumRows(), 6).getValues().forEach(([gez, zpn, , , , deal]) => {
      const k = m.findIndex(x => deal !== '' ? String(x[C.deal - 1]) === String(deal) : (zpn && x[C.zpn - 1] === zpn));
      if (k < 0) return;
      master.getRange(k + 2, C.gezogen).setValue(gez === true);
      if (gez !== true) eagZiehungZeitFormel_(master, k + 2);
    });
  } else if (name === 'Ticketliste' && r.getColumn() <= C.gezogen && r.getLastColumn() >= C.gezogen) {
    master.getRange(r.getRow(), 1, r.getNumRows(), EAG_Z_ZIEHER_).getValues().forEach((x, i) => {
      if (x[C.gezogen - 1] !== true) eagZiehungZeitFormel_(master, r.getRow() + i);
      const tab = x[EAG_Z_ZIEHER_ - 1] && ss.getSheetByName(eagZiehungName_(x[EAG_Z_ZIEHER_ - 1]));
      if (!tab || tab.getLastRow() < 2) return;
      const zeilen = tab.getRange(2, EAG_Z_T_ZPN_, tab.getLastRow() - 1, 5).getDisplayValues(); // B ZPN … F Deal
      const deal = x[C.deal - 1], zpn = String(x[C.zpn - 1]);
      const k = zeilen.findIndex(z => deal !== '' ? z[4] === String(deal) : (zpn && z[0] === zpn));
      if (k >= 0) tab.getRange(k + 2, 1).setValue(x[C.gezogen - 1] === true);
    });
  }
}

// Spontanausfall (Team B „Anwesend" raus, läuft im onEdit als Owner): offene Kunden der Person in ihrer Tab-Reihenfolge
// reihum an die Anwesenden mit den wenigsten offenen → UNTEN an deren Tab angehängt (wer gerade arbeitet, verliert keine
// Zeile), Master S umgestellt, beim Ausgefallenen gelöscht (gezogene bleiben; Tab leer → weg). Ergebnis in Team F8.
function eagZiehungAusfall_(ss, person) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const sh = ss.getSheetByName('Ticketliste'), team = ss.getSheetByName(EAG_Z_TEAM_), C = EAG_COL_;
    const melde = text => team.getRange('F8').setValue(
      `${Utilities.formatDate(new Date(), 'Europe/Vienna', 'HH:mm:ss')} Ausfall ${person}: ${text}`);
    const quelle = ss.getSheetByName(person);
    if (!quelle || !eagZiehungIstTab_(quelle) || quelle.getLastRow() < 2) return melde('kein Tab / nichts offen');
    const leute = team.getRange(2, 1, Math.max(team.getLastRow() - 1, 1), 2).getValues()
      .filter(r => String(r[0]).trim() && r[1] === true).map(r => eagZiehungName_(r[0]))
      .filter(p => p !== person && ss.getSheetByName(p) && eagZiehungIstTab_(ss.getSheetByName(p)));
    if (!leute.length) return melde('niemand anderer anwesend (mit Tab) → nichts verschoben');
    const n = eagLetzteZeile_(sh) - 1, m = sh.getRange(2, 1, n, EAG_Z_ZIEHER_).getValues();
    const offen = {};
    leute.forEach(p => { offen[p] = m.filter(r => eagZiehungName_(r[EAG_Z_ZIEHER_ - 1]) === p && r[C.gezogen - 1] !== true).length; });
    const zeilen = quelle.getRange(2, 1, quelle.getLastRow() - 1, EAG_Z_HEAD_.length).getValues();
    const anzeige = quelle.getRange(2, 1, quelle.getLastRow() - 1, EAG_Z_HEAD_.length).getDisplayValues();
    const weg = [], log = [], ziele = new Set();
    zeilen.forEach((z, i) => {
      if (z[0] === true) return; // gezogen → bleibt beim Ausgefallenen
      const zpn = anzeige[i][EAG_Z_T_ZPN_ - 1], deal = z[EAG_Z_HEAD_.length - 1];
      const k = m.findIndex(r => deal !== '' ? String(r[C.deal - 1]) === String(deal) : (zpn && String(r[C.zpn - 1]) === zpn));
      const p = leute.slice().sort((x, y) => offen[x] - offen[y] || leute.indexOf(x) - leute.indexOf(y))[0];
      const t = ss.getSheetByName(p), row = Math.max(t.getLastRow(), 1) + 1;
      t.getRange(row, EAG_Z_T_ZPN_).setNumberFormat('@');
      t.getRange(row, EAG_Z_T_ZEIT_).setNumberFormat('dd.MM. HH:mm:ss');
      t.getRange(row, 1).insertCheckboxes();
      t.getRange(row, 1, 1, EAG_Z_HEAD_.length).setValues([eagZiehungTabZeile_(false, zpn, z[EAG_Z_T_KUNDE_ - 1], deal, row)]);
      if (k >= 0) sh.getRange(k + 2, EAG_Z_ZIEHER_).setValue(p);
      offen[p]++; ziele.add(p); weg.push(i + 2);
      log.push(`${z[EAG_Z_T_KUNDE_ - 1]} → ${p}${k < 0 ? ' (⚠️ Master-Zeile nicht gefunden)' : ''}`);
    });
    if (!weg.length) return melde('nichts offen, alles schon gezogen');
    weg.reverse().forEach(r => quelle.deleteRow(r));
    ziele.forEach(p => { const t = ss.getSheetByName(p); eagZiehungSchutzTab_(t, eagZiehungTabFrei_(t, t.getLastRow() - 1)); });
    if (quelle.getLastRow() < 2) ss.deleteSheet(quelle);
    else eagZiehungSchutzTab_(quelle, eagZiehungTabFrei_(quelle, quelle.getLastRow() - 1));
    melde(`${weg.length} neu verteilt: ${log.join(' · ')}`);
  } finally {
    lock.releaseLock();
  }
}
