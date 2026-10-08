/**
 * EagZiehung.gs -- Ticketziehung 08.10.2026: Master (Tab „Ticketliste") → ein Tab pro Zieher
 *
 * 1. eagZiehungVorbereiten(): Master bekommt „Prio" (R, Dropdown „hoch") + „Zieher" (S), neuer Tab „Team".
 * 2. Von Hand: Namen in „Team" eintragen + Anwesend anhaken; im Master Prio = „hoch" setzen.
 * 3. eagZiehungVerteilen(): aktualisiert zuerst die Liste, verteilt dann alle ✅ ready, nicht gezogenen Deals
 *    gleichmäßig auf die Anwesenden (Prio hoch → Kat A → B → C → D → ?), schreibt „Zieher" in den Master
 *    und baut die Tabs „🎟 <Name>" (Prio hoch ganz oben). Mehrfach ausführbar: Zuteilung an Anwesende bleibt,
 *    Deals von Abwesenden werden neu verteilt, bereits gezogene bleiben, wo sie sind.
 * 4. eagZiehungOnEdit (installierbarer Trigger, legt Schritt 3 an): Hakerl „Ticket gezogen" im Personen-Tab
 *    → Hakerl im Master (→ Zeitstempel B), und umgekehrt.
 */

const EAG_Z_PRIO_ = 18, EAG_Z_ZIEHER_ = 19; // R, S im Master
const EAG_Z_TEAM_ = 'Team', EAG_Z_PREFIX_ = '🎟 ', EAG_Z_TEAM_ZEILEN_ = 20;
const EAG_Z_HEAD_ = [['Prio', 55], ['Ticket gezogen', 70], ['Zeitpunkt (Master)', 135], ['Deal-ID', 65], ['Kunde', 200],
  ['Einspeise-ZPN', 270], ['Ticket-E-Mail', 230], ['PLZ', 55], ['kWp', 55], ['Kategorie', 70], ['Partner', 80], ['Hinweise', 320]];

function eagZiehungVorbereiten() {
  const ss = eagListeHolen_(), sh = ss.getSheetByName('Ticketliste'), max = EAG_MAX_ZEILEN_;
  if (sh.getMaxColumns() < EAG_Z_ZIEHER_) sh.insertColumnsAfter(sh.getMaxColumns(), EAG_Z_ZIEHER_ - sh.getMaxColumns());
  [[EAG_Z_PRIO_, 'Prio', 60], [EAG_Z_ZIEHER_, 'Zieher', 110]].forEach(([c, name, w]) => {
    sh.getRange(1, c).setValue(name).setFontWeight('bold').setFontColor('#FFFFFF').setBackground(EAG_FARBE_.track)
      .setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('center');
    sh.setColumnWidth(c, w);
  });
  sh.getRange(2, EAG_Z_PRIO_, max - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['hoch'], true).setAllowInvalid(false).build());
  const f = sh.getFilter();
  if (f && f.getRange().getLastColumn() < EAG_Z_ZIEHER_) { f.remove(); sh.getRange(1, 1, max, EAG_Z_ZIEHER_).createFilter(); }
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
    t.getRange(2, 3, n, 2).setFormulas(Array.from({ length: n }, (_, k) => [
      `=IF(A${k + 2}="","",COUNTIF(Ticketliste!S:S,A${k + 2}))`,
      `=IF(A${k + 2}="","",COUNTIFS(Ticketliste!S:S,A${k + 2},Ticketliste!A:A,TRUE))`]));
    t.getRange('F1:F4').setValues([['Ablauf'], ['1. Namen eintragen, Anwesende anhaken'],
      ['2. Im Tab Ticketliste Spalte „Prio" = hoch setzen'], ['3. eagZiehungVerteilen() ausführen (EagZiehung.gs)']]);
    t.getRange('F1').setFontWeight('bold');
    t.setColumnWidth(1, 160); t.setColumnWidth(6, 340); t.setFrozenRows(1);
  }
  Logger.log(`Vorbereitet: ${ss.getUrl()}#gid=${ss.getSheetByName(EAG_Z_TEAM_).getSheetId()}`);
}

function eagZiehungVerteilen() {
  eagTicketliste(); // frische Daten (eigener Lock)
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Läuft schon, abgebrochen.'); return; }
  try {
    const ss = eagListeHolen_(), sh = ss.getSheetByName('Ticketliste'), team = ss.getSheetByName(EAG_Z_TEAM_), C = EAG_COL_;
    if (!team || sh.getMaxColumns() < EAG_Z_ZIEHER_) throw new Error('Zuerst eagZiehungVorbereiten() ausführen');
    const leute = team.getRange(2, 1, Math.max(team.getLastRow() - 1, 1), 2).getValues()
      .filter(r => String(r[0]).trim() && r[1] === true).map(r => String(r[0]).trim());
    if (!leute.length) throw new Error('Niemand als anwesend angehakt (Tab „Team")');

    const n = sh.getLastRow() - 1, rng = sh.getRange(2, 1, n, EAG_Z_ZIEHER_);
    const w = rng.getValues(), a = rng.getDisplayValues(), kRng = sh.getRange(2, C.kunde, n, 1);
    const notiz = kRng.getNotes(), schrift = kRng.getFontColors(), hg = kRng.getBackgrounds();
    const deals = w.map((r, k) => ({
      k, gezogen: r[C.gezogen - 1] === true, deal: r[C.deal - 1], kunde: a[k][C.kunde - 1], zpn: a[k][C.zpn - 1],
      mail: a[k][C.mail - 1], plz: a[k][C.plz - 1], kwp: r[C.kwp - 1], kat: a[k][C.kat - 1], partner: a[k][C.partner - 1],
      ready: a[k][C.ready - 1].indexOf('✅') === 0, prio: String(r[EAG_Z_PRIO_ - 1]).trim().toLowerCase() === 'hoch',
      zieher: String(r[EAG_Z_ZIEHER_ - 1]).trim(), notiz: notiz[k][0], schrift: schrift[k][0], hg: hg[k][0]
    })).filter(d => d.deal !== '' || d.zpn);

    const katRang = { A: 1, B: 2, C: 3, D: 4 };
    const rang = d => (d.prio ? 0 : 10) + (katRang[d.kat] || 5);
    const ordnung = (x, y) => rang(x) - rang(y) || String(x.deal).localeCompare(String(y.deal), undefined, { numeric: true });
    const last = {}, hoch = {};
    leute.forEach(p => { last[p] = 0; hoch[p] = 0; });
    const zaehle = d => { last[d.zieher]++; if (d.prio) hoch[d.zieher]++; };
    deals.filter(d => leute.indexOf(d.zieher) >= 0).forEach(zaehle);
    const log = [];
    deals.filter(d => d.ready && !d.gezogen && leute.indexOf(d.zieher) < 0).sort(ordnung).forEach(d => {
      const alt = d.zieher;
      d.zieher = leute.slice().sort((x, y) => last[x] - last[y] || hoch[x] - hoch[y] || leute.indexOf(x) - leute.indexOf(y))[0];
      zaehle(d);
      if (alt) log.push(`${d.deal || d.kunde}: ${alt} (nicht anwesend) → ${d.zieher}`);
    });

    const spalteS = w.map(r => [r[EAG_Z_ZIEHER_ - 1]]);
    deals.forEach(d => { spalteS[d.k][0] = d.zieher; });
    sh.getRange(2, EAG_Z_ZIEHER_, n, 1).setValues(spalteS);

    // Tabs: alle mit zugeteilten Deals (auch Abwesende mit bereits gezogenen), übrige 🎟-Tabs weg
    const namen = leute.concat([...new Set(deals.map(d => d.zieher))].filter(p => p && leute.indexOf(p) < 0));
    const links = [];
    namen.forEach((p, i) => {
      const liste = deals.filter(d => d.zieher === p).sort(ordnung);
      if (!liste.length) return;
      const t = eagZiehungTab_(ss, p, liste, 2 + i);
      links.push(`${p}: ${liste.length} (${liste.filter(d => d.prio).length} hoch) → ${ss.getUrl()}#gid=${t.getSheetId()}`);
    });
    ss.getSheets().filter(t => t.getName().indexOf(EAG_Z_PREFIX_) === 0 &&
      !deals.some(d => EAG_Z_PREFIX_ + d.zieher === t.getName())).forEach(t => ss.deleteSheet(t));

    if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'eagZiehungOnEdit'))
      ScriptApp.newTrigger('eagZiehungOnEdit').forSpreadsheet(ss).onEdit().create();

    const offen = deals.filter(d => !d.ready && !d.zieher);
    Logger.log(`Anwesend: ${leute.join(', ')}\n${links.join('\n')}\n` +
      `Nicht verteilt (nicht ready): ${offen.map(d => `${d.deal || d.kunde} ${a[d.k][C.ready - 1]}`).join(', ') || '—'}` +
      (log.length ? `\nUmverteilt:\n${log.join('\n')}` : ''));
  } finally {
    lock.releaseLock();
  }
}

function eagZiehungTab_(ss, name, liste, pos) {
  const titel = EAG_Z_PREFIX_ + name, h = EAG_Z_HEAD_.length, n = liste.length;
  let t = ss.getSheetByName(titel);
  if (t) { // leeren statt löschen → gid (geteilter Link) bleibt
    t.clear(); t.clearNotes(); t.clearConditionalFormatRules();
    t.getRange(1, 1, t.getMaxRows(), t.getMaxColumns()).clearDataValidations();
  } else t = ss.insertSheet(titel, Math.min(pos, ss.getSheets().length));
  t.setTabColor('#7F6000');
  t.getRange(1, 1, 1, h).setValues([EAG_Z_HEAD_.map(x => x[0])]).setFontWeight('bold').setFontColor('#FFFFFF')
    .setBackground(EAG_FARBE_.ticket).setWrap(true).setVerticalAlignment('middle');
  EAG_Z_HEAD_.forEach((x, i) => t.setColumnWidth(i + 1, x[1]));
  t.setFrozenRows(1);
  t.getRange(2, 6, n, 1).setNumberFormat('@');
  t.getRange(2, 3, n, 1).setNumberFormat('dd.MM. HH:mm:ss');
  t.getRange(2, 2, n, 1).insertCheckboxes();
  t.getRange(2, 1, n, h).setValues(liste.map((d, k) => {
    const z = `XLOOKUP(F${k + 2},Ticketliste!G:G,Ticketliste!B:B,"")`;
    return [d.prio ? 'hoch' : '', d.gezogen, `=IFERROR(IF(${z}="","",${z}),"")`, d.deal, d.kunde, d.zpn, d.mail,
      d.plz, d.kwp, d.kat, d.partner, d.notiz];
  }));
  // Namensfarben aus dem Master übernehmen
  t.getRange(2, 5, n, 1).setFontColors(liste.map(d => [d.schrift])).setBackgrounds(liste.map(d => [d.hg]));
  t.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$B2=TRUE').setBackground('#C6E0B4')
      .setRanges([t.getRange(2, 1, Math.max(n, 1), h)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$A2="hoch"').setBackground('#F4CCCC').setBold(true)
      .setRanges([t.getRange(2, 1, Math.max(n, 1), 1)]).build()
  ]);
  return t;
}

// Installierbarer onEdit-Trigger (legt eagZiehungVerteilen an): Hakerl Personen-Tab ↔ Master
function eagZiehungOnEdit(e) {
  const r = e.range, t = r.getSheet(), name = t.getName(), ss = t.getParent(), C = EAG_COL_;
  if (r.getRow() < 2) return;
  const master = ss.getSheetByName('Ticketliste');
  if (name.indexOf(EAG_Z_PREFIX_) === 0 && r.getColumn() <= 2 && r.getLastColumn() >= 2) {
    const m = master.getRange(2, 1, master.getLastRow() - 1, C.zpn).getDisplayValues();
    t.getRange(r.getRow(), 2, r.getNumRows(), 5).getValues().forEach(([gez, , deal, , zpn]) => {
      const k = m.findIndex(x => deal !== '' ? String(x[C.deal - 1]) === String(deal) : (zpn && x[C.zpn - 1] === zpn));
      if (k >= 0) master.getRange(k + 2, C.gezogen).setValue(gez === true);
    });
  } else if (name === 'Ticketliste' && r.getColumn() <= C.gezogen && r.getLastColumn() >= C.gezogen) {
    master.getRange(r.getRow(), 1, r.getNumRows(), EAG_Z_ZIEHER_).getValues().forEach(x => {
      const tab = x[EAG_Z_ZIEHER_ - 1] && ss.getSheetByName(EAG_Z_PREFIX_ + String(x[EAG_Z_ZIEHER_ - 1]).trim());
      if (!tab || tab.getLastRow() < 2) return;
      const zeilen = tab.getRange(2, 4, tab.getLastRow() - 1, 3).getDisplayValues(); // D Deal, E Kunde, F ZPN
      const deal = x[C.deal - 1], zpn = String(x[C.zpn - 1]);
      const k = zeilen.findIndex(z => deal !== '' ? z[0] === String(deal) : (zpn && z[2] === zpn));
      if (k >= 0) tab.getRange(k + 2, 2).setValue(x[C.gezogen - 1] === true);
    });
  }
}
