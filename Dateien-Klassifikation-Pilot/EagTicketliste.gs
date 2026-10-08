/**
 * EagTicketliste.gs -- EAG-Ticketliste Fördercall 3/2026 (Ticketziehung 08.10.2026 ab 17:00)
 *
 * eagTicketliste(): liest die 4 Montageplanungs-Sheets (Hakerl „Netzanmeldung eingereicht" ODER Zählpunkt)
 *   und legt die Ticketliste an (1. Lauf, ID → ScriptProperty EAG_TICKETLISTE_ID) bzw. aktualisiert sie.
 *   - Handarbeit bleibt unangetastet: Ticket gezogen, Ticket-Zeitpunkt, EAG-Portal, Antrag eingereicht.
 *   - ZPN wird aus der Quelle nachgezogen; Kunde/PLZ/Mail/kWp/kWh/Neu-Erw nur in LEERE Zellen
 *     (= Korrekturen von Hand in der Liste gewinnen).
 *   - Neue Deals werden unten angehängt, nie gelöscht.
 *   - Fehlende Mails: Pipedrive GET deals/persons -- schreibt NICHTS nach Pipedrive.
 * eagTicketlisteTriggerAn() / eagTicketlisteTriggerAus(): alle 10 min automatisch aktualisieren.
 */

const EAG_QUELLEN_ = [
  { partner: 'ALE', id: '1j2NIi4zeTQlEhWqYlb3IXSjE_69J6ZPNQ1vK4-YiFgM' },
  { partner: 'Kreuzeder', id: '19-TnTIXawgYrDGwMEJauNFRZZaxmzYNtnnIsY1M3MF4' },
  { partner: 'Berger', id: '1agWue-J07hZpo-nRnyYzIxe1ow_QD9vaP61dyiT05G8' },
  { partner: 'Greensky', id: '1pRHk5ITCUhMywUuyAn738hAcJ3oK9ZSxwC4EJ92yXnc' }
];
const EAG_PROP_ID_ = 'EAG_TICKETLISTE_ID';
const EAG_SKIP_ = [5853]; // Shamoun: nur AC-Anschluss, erledigt
const EAG_NETTO_ = { '10.0': 8.76, '6.0': 5.84 }; // Sigenergy-Modul brutto → netto

// Hand-Wissen, gewinnt gegen das Sheet (Stand 06.10.2026)
const EAG_OVERRIDE_ = {
  3904: { plz: 4600, notiz: 'kWp + Speicher auch in Pipedrive leer → Angebot prüfen · Thalheim b. Wels' },
  418: { notiz: 'kWp + Speicher auch in Pipedrive leer · Deal-ID 418 auffällig niedrig (Altdeal?)' },
  6754: { notiz: 'Mail, kWp, Speicher auch in Pipedrive leer → Kunde anrufen' },
  7046: { neu: 'Erweiterung', kwp: 7.35, notiz: 'ERWEITERUNG: nur die zusätzlichen 15 Module förderbar (kein Repowering) · Mail = Firmenadresse' },
  7195: { notiz: 'Module: Pipedrive-Feld 18 Stk (8,82 kWp) vs. Artikel 20 Stk (9,80) → Angebot prüfen' }
};
// Kreuzeder-Werte aus Pipedrive (eagTicketDaten, 06.10.) -- nur wenn das Sheet leer ist: [Mail, kWp, kWh, Neu/Erw]
const EAG_FALLBACK_ = {
  7186: ['karolo3340@gmail.com', 8.82, 8.76, 'Neuanlage'],
  7388: ['office@stsoft.at', 21.56, 17.52, 'Neuanlage'],
  7071: ['neureiter91@gmail.com', 16.66, 17.52, ''],
  7046: ['office@onestofood.at', 7.35, 8.76, 'Erweiterung'],
  3904: ['lehnerchristian@yahoo.de', '', '', ''],
  418: ['maderebner@gmail.com', '', '', ''],
  7113: ['elke.edi0602@gmail.com', 20.58, 17.52, 'Neuanlage'],
  7189: ['iris_haberlehner@hotmail.com', 9.8, 8.76, ''],
  7195: ['hubert.hochmuth0108@gmx.at', 9.8, 8.76, ''],
  7032: ['brucki2804@gmail.com', 27.44, 17.52, 'Neuanlage']
};

// Spalten der Ticketliste (1-basiert)
const EAG_COL_ = { gezogen: 1, zeit: 2, deal: 3, kunde: 4, partner: 5, plz: 6, zpn: 7, check: 8, mail: 9,
  ready: 10, kwp: 11, kwh: 12, quote: 13, neu: 14, portal: 15, antrag: 16, kat: 17 };
const EAG_HEAD_ = [
  ['Ticket gezogen', 70, 'track'], ['Ticket-Zeitpunkt (auto)', 135, 'track'],
  ['Deal-ID', 65, 'ticket'], ['Kunde (Förderwerber)', 190, 'ticket'], ['Partner', 80, 'ticket'], ['PLZ Anlage', 60, 'ticket'],
  ['Einspeise-ZPN (33-stellig)', 270, 'ticket'], ['ZPN-Check', 170, 'ticket'], ['Ticket-E-Mail', 220, 'ticket'], ['Ticket-ready?', 100, 'ticket'],
  ['kWp', 60, 'anlage'], ['Speicher netto kWh', 80, 'anlage'], ['kWh/kWp ≥ 0,5?', 75, 'anlage'], ['Neuanlage / Erweiterung', 110, 'anlage'],
  ['Projekt im EAG-Portal', 80, 'track'], ['Antrag eingereicht (bis 22.10.)', 100, 'track'], ['Kategorie', 75, 'anlage']
];
const EAG_FARBE_ = { track: '#7F6000', ticket: '#1F4E78', anlage: '#375623' };
// V „Neu seit" (08.10.): Zeitpunkt, wann die Zeile in die Liste kam (alte Zeilen leer)
const EAG_COL_NEUSEIT_ = 22;
// Sean-Nachtrag (08.10., von Sean kurzfristig erhalten) -- [Kunde, Geburtsdatum, ZPN roh, Mail]; ohne Deal-ID
const EAG_SEAN_TAG_ = 'von Sean kurzfristig erhalten – später abklären';
const EAG_SEAN_ = [
  ['Gerhard Reiterer', '09.07.1960', '', 'gerhard.reiterer@icloud.com'],
  ['Lukas Shamoun Privat', '15.07.1991', 'AT0010000000000000001000015612411', 'saidosh@hotmail.com'],
  ['Lukas Shamoun Firma', '01.09.1992', 'AT0010000000000000001000015612853', 'saidosh@hotmail.com'],
  ['Eva Bogengruber', '15.07.1974', 'AT0030000000000000000000030121742', 'johann.bogengruber@gmx.at'],
  ['Edin Hamzic', '', '', 'hamzicedin20@gmail.com'],
  ['Nuri Yorulmaz PV', '', 'AT00330004600EWERKWELSAG00A205202', 'nuri62.yorulmaz@gmail.com'],
  ['Andreas Meister', '', '', 'meister@allyourfriends.de'],
  ['Gerhard Spath', '13.04.1975', '', 'office@kfz-spath.at'],
  ['Jürgen Pußwald', '05.07.1977', 'AT.008130.00000.00000000000003266301', 'juergen.pusswald@hotmail.com'],
  ['Harald Lamprecht', '', 'AT.008000.08330.\n00000202606190630522', 'lamprecht4320@gmail.com']
];
const EAG_MAX_ZEILEN_ = 400; // Bereich für Formate/Regeln/Filter
const EAG_INFO_BLEIBT_ = 'Bleibt immer: Haken, Zeitpunkt, EAG-Portal, Antrag, Farben/Formatierung. ' +
  'Kunde/PLZ/Mail/kWp/kWh/Neu-Erw werden nur in LEERE Zellen geschrieben.';
const EAG_INFO_ZPN_ = 'ZPN kommt immer aus dem Montage-Sheet → ZPN-Korrekturen dort machen, nicht hier.';

function eagTicketliste() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Läuft schon, abgebrochen.'); return; }
  try {
    const quelle = eagQuellenLesen_();
    const ss = eagListeHolen_();
    const sh = ss.getSheetByName('Ticketliste');
    const C = EAG_COL_, log = [];
    // Info-Tab bestehender Listen auf die aktuelle Regel ziehen (07.10.: Kunde nicht mehr überschreiben)
    const info = ss.getSheetByName('Info');
    if (info) [['Bleibt immer:', EAG_INFO_BLEIBT_], ['ZPN + Kunde kommen immer', EAG_INFO_ZPN_]].forEach(([alt, neuText]) =>
      info.createTextFinder(alt).findAll().forEach(c => { if (c.getValue() !== neuText) c.setValue(neuText); }));

    const aufr = eagAufraeumen_(sh);
    if (aufr) log.push(aufr);
    eagNeuSeitSpalte_(sh);
    const last = eagLetzteZeile_(sh); // NICHT getLastRow: Checkboxen/Formeln in leeren Zeilen zählen dort mit
    const ist = last > 1 ? sh.getRange(2, 1, last - 1, EAG_HEAD_.length).getValues() : [];
    const zeileVon = {};
    ist.forEach((r, k) => { if (r[C.deal - 1] !== '') zeileVon[r[C.deal - 1]] = k + 2; });

    // 1) bestehende Zeilen: nur geänderte Zellen schreiben
    quelle.filter(q => zeileVon[q.deal]).forEach(q => {
      const z = zeileVon[q.deal], r = ist[z - 2];
      const setze = (col, wert, nurWennLeer) => {
        const alt = r[col - 1];
        if (wert === '' || wert === null || wert === undefined || String(alt) === String(wert)) return;
        if (nurWennLeer && alt !== '') return;
        sh.getRange(z, col).setValue(wert);
        log.push(`${q.deal} ${EAG_HEAD_[col - 1][0]}: „${alt}" → „${wert}"`);
      };
      setze(C.zpn, q.zpn, false);
      setze(C.kunde, q.kunde, true); // Namen von Hand eingefärbt → nie überschreiben (07.10.)
      setze(C.plz, q.plz, true);
      setze(C.kwp, q.kwp, !q.kwpFix);
      setze(C.kwh, q.kwh, true);
      setze(C.neu, q.neu, true);
      if (r[C.mail - 1] === '') setze(C.mail, q.mail || eagMailAusPipedrive_(q), true);
      sh.getRange(z, C.kunde).setNote(q.notiz.join('\n'));
    });

    // 2) neue Deals unten anhängen (mit ZPN zuerst)
    const neu = quelle.filter(q => !zeileVon[q.deal])
      .sort((a, b) => (a.zpn ? 0 : 1) - (b.zpn ? 0 : 1) || a.partner.localeCompare(b.partner) || a.deal - b.deal);
    if (neu.length) {
      const start = eagLetzteZeile_(sh) + 1;
      neu.forEach(q => { if (!q.mail) q.mail = eagMailAusPipedrive_(q); });
      sh.getRange(start, 1, neu.length, EAG_HEAD_.length).setValues(neu.map((q, k) => eagZeile_(q, start + k)));
      sh.getRange(start, C.kunde, neu.length, 1).setNotes(neu.map(q => [q.notiz.join('\n')]));
      [C.gezogen, C.portal, C.antrag].forEach(c => sh.getRange(start, c, neu.length, 1).insertCheckboxes());
      sh.getRange(start, EAG_COL_NEUSEIT_, neu.length, 1).setValue(new Date());
      log.push(`+${neu.length} neue Deals: ${neu.map(q => q.deal).join(', ')}`);
    }

    // 3) aus der Quelle verschwunden → nur markieren, nicht löschen
    const inQuelle = new Set(quelle.map(q => q.deal));
    Object.keys(zeileVon).filter(d => !inQuelle.has(Number(d))).forEach(d => {
      sh.getRange(zeileVon[d], C.kunde).setNote('⚠️ nicht mehr in den Montage-Sheets (Hakerl/ZPN entfernt?)');
      log.push(`${d} nicht mehr in Quelle`);
    });

    eagFormelnUndFarben_(sh);
    SpreadsheetApp.flush();
    const alle = sh.getRange(2, 1, Math.max(eagLetzteZeile_(sh) - 1, 1), EAG_HEAD_.length).getDisplayValues();
    const ready = alle.filter(r => r[C.ready - 1].indexOf('✅') === 0).length;
    const ohneMail = alle.filter(r => r[C.zpn - 1] && !r[C.mail - 1]).map(r => r[C.deal - 1]);
    const gezogen = alle.filter(r => r[C.gezogen - 1] === 'TRUE').length;
    const kommt = alle.filter(r => !r[C.zpn - 1]).length;
    Logger.log(`${ss.getUrl()}\n${alle.length} Deals · ${alle.filter(r => r[C.zpn - 1]).length} mit Einspeise-ZPN · ` +
      `${ready} ticket-ready · ${gezogen} gezogen · ⏳ ${kommt} eingereicht, ZPN kommt noch · ` +
      `ZPN ohne Mail: ${ohneMail.join(', ') || '—'}\n` +
      (log.length ? `Änderungen:\n${log.join('\n')}` : 'Keine Änderungen.'));
  } finally {
    lock.releaseLock();
  }
}

function eagTicketlisteTriggerAn() {
  eagTicketlisteTriggerAus();
  ScriptApp.newTrigger('eagTicketliste').timeBased().everyMinutes(10).create();
  Logger.log('Trigger an: alle 10 min. Nach dem 22.10. eagTicketlisteTriggerAus() ausführen.');
}

function eagTicketlisteTriggerAus() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'eagTicketliste')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

// ---------- Quellen ----------

function eagQuellenLesen_() {
  const out = [];
  EAG_QUELLEN_.forEach(src => {
    const tab = SpreadsheetApp.openById(src.id).getSheets().find(s => {
      if (s.getLastColumn() < 1) return false;
      const h = s.getRange(1, 1, 1, s.getLastColumn()).getDisplayValues()[0];
      return h.indexOf('Deal-ID') >= 0 && h.indexOf('Netzanmeldung eingereicht') >= 0;
    });
    if (!tab) throw new Error(`${src.partner}: kein Tab mit „Netzanmeldung eingereicht" gefunden`);
    const rng = tab.getDataRange(), daten = rng.getValues(), anzeige = rng.getDisplayValues();
    const h = anzeige[0].map(x => String(x).trim());
    // exakter Spaltenname, sonst Präfix (Sonderzeichen wie „×" im Namen)
    const sp = name => { const i = h.indexOf(name); return i >= 0 ? i : h.findIndex(x => x.indexOf(name) === 0); };
    const iHak = sp('Netzanmeldung eingereicht');
    daten.slice(1).forEach((r, k) => {
      const t = anzeige[k + 1];
      const get = name => { const i = sp(name); return i >= 0 ? String(t[i]).trim() : ''; };
      const deal = Number(get('Deal-ID'));
      if (!deal || EAG_SKIP_.indexOf(deal) >= 0) return;
      const hak = r[iHak] === true || String(t[iHak]).toUpperCase() === 'TRUE';
      const zpnRe = /AT(?: ?[0-9A-Z]){20,31}/;
      const m = get('Zählpunkt').match(zpnRe) || get('Zählpunktnummer').match(zpnRe) ||
        get('Sonstige Informationen').match(zpnRe);
      if (!hak && !m) return;
      out.push(eagDatensatz_(src.partner, deal, hak, m ? m[0].replace(/ /g, '') : '', get));
    });
  });
  return out;
}

function eagDatensatz_(partner, deal, hak, zpn, get) {
  const notiz = [], ov = EAG_OVERRIDE_[deal] || {}, fb = EAG_FALLBACK_[deal] || ['', '', '', ''];
  const zahl = s => { const n = parseFloat(String(s).replace(',', '.')); return isNaN(n) ? '' : n; };
  const module = (get('Module (Anzahl') || get('Anlagengröße (Module)')).replace(/\s+/g, ' ');
  const speicherText = get('Speicher (Anzahl') || module;

  let kwp = zahl(get('PV-Leistung (kWp)'));
  const mm = module.match(/(\d+)\s*x?\s*[A-Za-z]+\s*(\d{3})\s*W?p?/);
  // „22x Aiko 475Wp (17 + 5 Erweiterung)" → förderbar nur die 5 neuen
  const erw = module.match(/\(\s*(\d+)\s*\+\s*(\d+)\s*Erweiterung\s*\)/i);
  if (kwp === '' && mm && erw) {
    kwp = Math.round(erw[2] * mm[2] / 10) / 100;
    notiz.push(`ERWEITERUNG: ${erw[1]} Module bestehen schon, kWp = nur die ${erw[2]} neuen`);
  } else if (kwp === '' && mm) kwp = Math.round(mm[1] * mm[2] / 10) / 100;

  let kwh = zahl(get('Speichergröße (kWh)'));
  if (kwh === '') {
    let sp = [...speicherText.matchAll(/(\d+)x Sigenergy Speicher (\d+\.\d)/g)].map(x => [x[1], x[2]]);
    if (!sp.length) sp = [...speicherText.matchAll(/Sigenergy (\d+\.\d)(?! kW)/g)].map(x => ['1', x[1]]);
    if (sp.length) {
      kwh = Math.round(sp.reduce((s, [n, g]) => s + n * (EAG_NETTO_[g] || Number(g)), 0) * 100) / 100;
      if (sp.some(([, g]) => !EAG_NETTO_[g])) notiz.push('Speicher brutto, netto prüfen');
    } else if (/KEIN Speicher/i.test(speicherText)) kwh = 0;
  }

  const sonst = get('Sonstige Informationen').replace(/\s+/g, ' ').replace(/^[-\s]+|[-\s]+$/g, '');
  let neu = get('Neuanlage / Erweiterung');
  if (!neu) neu = /erweiterung/i.test(module + ' ' + sonst) ? 'Erweiterung' : (/Neuanlage/.test(sonst) ? 'Neuanlage' : '');
  // auf die zwei Dropdown-Werte normieren, sonst blockiert die Datenvalidierung das Schreiben
  const istNeu = /neu/i.test(neu), istErw = /erweiter|zubau/i.test(neu);
  if (istNeu !== istErw) neu = istNeu ? 'Neuanlage' : 'Erweiterung';
  else if (neu) { notiz.push(`Neu/Erw im Sheet unklar: „${neu}"`); neu = ''; }

  const plzAdr = get('Adresse').match(/\b(\d{4})\b/);
  const plzSp = (get('PLZ (Anlage)') || get('PLZ')).match(/\d{4}/);
  const plz = plzAdr ? Number(plzAdr[1]) : (plzSp ? Number(plzSp[0]) : '');
  if (plzAdr && plzSp && plzAdr[1] !== plzSp[0]) notiz.push(`PLZ-Spalte ${plzSp[0]} ≠ Adresse ${plzAdr[1]}`);

  if (!module && !kwp && !fb[1]) notiz.push('Keine Module im Sheet (nur AC-Anschluss?) → EAG-Relevanz prüfen');
  if (!zpn) notiz.push('⏳ Netzanmeldung eingereicht, Einspeise-ZPN kommt noch vom Netzbetreiber');
  if (!hak) notiz.push('Hakerl „eingereicht" fehlt, ZPN steht im Sheet');
  if (/^_/.test(get('Zählpunkt'))) notiz.push('ZPN im Sheet mit „_" davor, hier bereinigt');
  if (sonst && !/AT00/.test(sonst) && !/^(Neuanlage \(Einspeisung\)|Nur AC Anschluss)$/.test(sonst)) notiz.push(sonst.slice(0, 200));
  if (ov.notiz) notiz.unshift(ov.notiz);

  return {
    partner, deal, zpn, notiz, kunde: get('Kunden'),
    mail: get('E-Mail') || fb[0],
    plz: ov.plz || plz,
    kwp: ov.kwp || (kwp !== '' ? kwp : fb[1]),
    kwpFix: !!(ov.kwp || erw), // Erweiterung: kWp = nur neue Module, überschreibt auch alte Werte
    kwh: kwh !== '' ? kwh : fb[2],
    neu: ov.neu || neu || fb[3]
  };
}

function eagMailAusPipedrive_(q) {
  const d = fetchPipedriveV1(`deals/${q.deal}`);
  if (!d) { q.notiz.push('Deal in Pipedrive nicht gefunden'); return ''; }
  const pId = d.person_id && (d.person_id.value || d.person_id);
  const p = pId ? (fetchPipedriveV1(`persons/${pId}`) || {}) : {};
  const mails = (p.email || []).map(e => e.value).filter(Boolean);
  if (mails.length > 1) q.notiz.push(`weitere Mail: ${mails.slice(1).join(', ')}`);
  return mails[0] || '';
}

// ---------- Ticketliste ----------

function eagZeile_(q, i) {
  const g = `G${i}`, f = `F${i}`, k = `K${i}`, l = `L${i}`, h = `H${i}`;
  // ZPN-Aufbau: AT | 6 Ziffern Netzbetreiber | 5 Ziffern PLZ (00000 erlaubt) | 20 Zeichen Zählpunkt
  // G leer = Hakerl „eingereicht" gesetzt (sonst wäre der Deal nicht in der Liste) → ZPN kommt noch
  const check =
    `=IF(${g}="","⏳ ZPN kommt (eingereicht)",IF(LEN(${g})<>33,"❌ "&LEN(${g})&" statt 33 Stellen",` +
    `IF(LEFT(${g},4)<>"AT00","❌ beginnt nicht mit AT00",` +
    `IF(NOT(ISNUMBER(VALUE(MID(${g},3,11)))),"❌ Stelle 3–13 keine Ziffern",` +
    `IF(AND(${f}<>"",MID(${g},9,5)<>"00000",VALUE(MID(${g},9,5))<>${f}),"⚠️ PLZ im ZPN ≠ Anlage",` +
    `IF(COUNTIF(G:G,${g})>1,"⚠️ doppelt","✅"))))))`;
  return [
    false, `=IF(A${i},IF(B${i}="",NOW(),B${i}),"")`, // Zeitstempel: Zirkelbezug + iterative Berechnung
    q.deal, q.kunde, q.partner, q.plz, q.zpn, check, q.mail,
    `=IF(LEFT(${h},1)="⏳","⏳ ZPN kommt",IF(LEFT(${h},1)="❌","❌ ZPN",IF(I${i}="","⚠️ Mail",IF(LEFT(${h},1)="⚠","⚠️ ZPN prüfen","✅ ready"))))`,
    q.kwp, q.kwh, `=IF(OR(${k}="",${l}=""),"?",IF(${l}/${k}>=0.5,"✅","❌"))`, q.neu,
    false, false,
    `=IF(${k}="","?",IF(${k}<=10,"A",IF(${k}<=20,"B",IF(${k}<=100,"C","D"))))`
  ];
}

// Bei jedem Lauf: Formel-Spalten H/J/M/Q + Farbregeln neu (Logik-Änderungen greifen auch in alten Zeilen).
// A/B (Haken, Zeitstempel) und alle Werte-Spalten bleiben unangetastet.
function eagFormelnUndFarben_(sh) {
  const C = EAG_COL_, max = EAG_MAX_ZEILEN_, n = eagLetzteZeile_(sh) - 1;
  if (n > 0) {
    const zeilen = Array.from({ length: n }, (_, k) => eagZeile_({}, k + 2));
    [C.check, C.ready, C.quote, C.kat].forEach(c =>
      sh.getRange(2, c, n, 1).setFormulas(zeilen.map(z => [z[c - 1]])));
    // Checkboxen nachziehen (Werte TRUE/FALSE bleiben erhalten)
    [C.gezogen, C.portal, C.antrag].forEach(c => sh.getRange(2, c, n, 1).insertCheckboxes());
    if (sh.getMaxColumns() >= EAG_Z_ZUSAGE_) sh.getRange(2, EAG_Z_ZUSAGE_, n, 1).insertCheckboxes(); // U „Zusage schon"
    // Zeitstempel-Formel nur dort ergänzen, wo B komplett leer ist -- bestehende Zeitstempel nie anfassen
    const bR = sh.getRange(2, C.zeit, n, 1), bF = bR.getFormulas(), bV = bR.getValues();
    bF.forEach((f, k) => {
      if (!f[0] && bV[k][0] === '') sh.getRange(k + 2, C.zeit).setFormula(zeilen[k][C.zeit - 1]);
    });
  }
  const regel = (rng, formel, farbe) => SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(formel).setBackground(farbe).setRanges([sh.getRange(rng)]).build();
  const regeln = [
    regel(`A2:B${max}`, '=$A2=TRUE', '#C6E0B4'),
    regel(`A2:Q${max}`, '=$P2=TRUE', '#E2EFDA')
  ];
  ['H', 'J'].forEach(c => {
    regeln.push(regel(`${c}2:${c}${max}`, `=LEFT(${c}2,1)="✅"`, '#E2EFDA'));
    regeln.push(regel(`${c}2:${c}${max}`, `=LEFT(${c}2,1)="❌"`, '#FCE4D6'));
    regeln.push(regel(`${c}2:${c}${max}`, `=LEFT(${c}2,1)="⚠"`, '#FFF2CC'));
    regeln.push(regel(`${c}2:${c}${max}`, `=LEFT(${c}2,1)="⏳"`, '#DDEBF7'));
  });
  // händische Regeln (z.B. farbige Namen) behalten, nur die eigenen ersetzen
  const eigene = new Set(regeln.map(r => r.getBooleanCondition().getCriteriaValues()[0]));
  const fremde = sh.getConditionalFormatRules().filter(r => {
    const b = r.getBooleanCondition();
    return !(b && eigene.has(b.getCriteriaValues()[0]));
  });
  sh.setConditionalFormatRules(fremde.concat(regeln));
}

// Letzte Zeile mit Deal-ID, Kunde oder ZPN (C/D/G). getLastRow zählt Checkboxen (FALSE) + Formeln in leeren
// Zeilen mit → war am 08.10. 400 statt ~55 (Statistik falsch, Anhängen ab 401, rot/grün hinter Zeile 400).
function eagLetzteZeile_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return 1;
  const v = sh.getRange(2, EAG_COL_.deal, last - 1, EAG_COL_.zpn - EAG_COL_.deal + 1).getValues();
  for (let k = v.length - 1; k >= 0; k--) if (v[k][0] !== '' || v[k][1] !== '' || v[k][4] !== '') return k + 2;
  return 1;
}

// Datenzeilen lückenlos nach oben (moveRows, Notizen/Farben wandern mit), darunter Checkboxen/Formeln/Werte A–V weg.
// Zeitstempel B gezogener Zeilen danach prüfen und notfalls fix zurückschreiben (wie eagZiehungFarbigNachUnten_).
function eagAufraeumen_(sh) {
  const C = EAG_COL_, last = sh.getLastRow();
  if (last < 2) return '';
  const breite = Math.min(sh.getMaxColumns(), EAG_COL_NEUSEIT_);
  const v = sh.getRange(2, 1, last - 1, breite).getValues();
  const daten = v.map((r, k) => (r[C.deal - 1] !== '' || r[C.kunde - 1] !== '' || r[C.zpn - 1] !== '' ? k : -1)).filter(k => k >= 0);
  const out = [];
  let ziel = 0, verschoben = 0;
  const merken = [];
  daten.forEach(k => {
    if (k !== ziel) {
      if (v[k][C.gezogen - 1] === true && v[k][C.zeit - 1] instanceof Date) merken.push([ziel, v[k][C.zeit - 1]]);
      sh.moveRows(sh.getRange(k + 2, 1), ziel + 2);
      verschoben++;
    }
    ziel++;
  });
  if (verschoben) {
    SpreadsheetApp.flush();
    merken.forEach(([z, zeit]) => {
      const b = sh.getRange(z + 2, C.zeit).getValue();
      if (!(b instanceof Date) || b.getTime() !== zeit.getTime()) sh.getRange(z + 2, C.zeit).setValue(zeit);
    });
    out.push(`Aufgeräumt: ${verschoben} Zeile(n) aus dem Leerbereich nach oben geholt`);
  }
  const ende = daten.length + 1, rest = sh.getLastRow() - ende;
  if (rest > 0) {
    const cb = [C.gezogen, C.portal, C.antrag];
    if (breite >= 21) cb.push(21);
    cb.forEach(c => sh.getRange(ende + 1, c, rest, 1).removeCheckboxes());
    sh.getRange(ende + 1, 1, rest, breite).clearContent();
    out.push(`Leerzeilen ${ende + 1}–${ende + rest}: Checkboxen/Formeln entfernt`);
  }
  return out.join(' · ');
}

// V „Neu seit" anlegen (einmalig) + Filter bis V
function eagNeuSeitSpalte_(sh) {
  const c = EAG_COL_NEUSEIT_, max = EAG_MAX_ZEILEN_;
  if (sh.getMaxColumns() < c) sh.insertColumnsAfter(sh.getMaxColumns(), c - sh.getMaxColumns());
  if (sh.getRange(1, c).getValue() === 'Neu seit') return;
  sh.getRange(1, c).setValue('Neu seit').setFontWeight('bold').setFontColor('#FFFFFF').setBackground(EAG_FARBE_.track)
    .setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('center');
  sh.setColumnWidth(c, 110);
  sh.getRange(2, c, max - 1, 1).setNumberFormat('dd.MM. HH:mm');
  const f = sh.getFilter();
  if (f && f.getRange().getLastColumn() < c) { f.remove(); sh.getRange(1, 1, max, c).createFilter(); }
}

// Einmal ausführen: Seans Liste (EAG_SEAN_) unten anhängen, ohne Deal-ID. Doppelte (ZPN oder Name) werden übersprungen
// → mehrfach ausführbar. Notiz am Kunden = EAG_SEAN_TAG_ + Geburtsdatum. Kein ZPN → ⏳, wird nicht verteilt.
function eagSeanNachtrag() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Läuft schon, abgebrochen.'); return; }
  try {
    const ss = eagListeHolen_(), sh = ss.getSheetByName('Ticketliste'), C = EAG_COL_;
    const aufr = eagAufraeumen_(sh);
    eagNeuSeitSpalte_(sh);
    const last = eagLetzteZeile_(sh);
    const ist = last > 1 ? sh.getRange(2, 1, last - 1, EAG_HEAD_.length).getDisplayValues() : [];
    const norm = s => String(s).toLowerCase().replace(/\s+/g, '');
    const zpnDa = new Set(ist.map(r => r[C.zpn - 1]).filter(Boolean)), nameDa = new Set(ist.map(r => norm(r[C.kunde - 1])));
    const neu = [], skip = [];
    EAG_SEAN_.forEach(([kunde, geb, roh, mail]) => {
      const zpn = String(roh).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
      if ((zpn && zpnDa.has(zpn)) || nameDa.has(norm(kunde))) { skip.push(kunde); return; }
      neu.push({ deal: '', kunde, partner: 'Sean', plz: '', zpn, mail, kwp: '', kwh: '', neu: '',
        notiz: [EAG_SEAN_TAG_, geb ? `Geb. ${geb}` : '', zpn ? '' : 'kein ZPN → später abklären'].filter(Boolean) });
    });
    if (neu.length) {
      const start = last + 1;
      sh.getRange(start, 1, neu.length, EAG_HEAD_.length).setValues(neu.map((q, k) => eagZeile_(q, start + k)));
      sh.getRange(start, C.kunde, neu.length, 1).setNotes(neu.map(q => [q.notiz.join('\n')]));
      [C.gezogen, C.portal, C.antrag].forEach(c => sh.getRange(start, c, neu.length, 1).insertCheckboxes());
      if (sh.getMaxColumns() >= EAG_Z_ZUSAGE_) sh.getRange(start, EAG_Z_ZUSAGE_, neu.length, 1).insertCheckboxes();
      sh.getRange(start, EAG_COL_NEUSEIT_, neu.length, 1).setValue(new Date());
    }
    SpreadsheetApp.flush();
    const z = neu.length ? sh.getRange(last + 1, 1, neu.length, EAG_HEAD_.length).getDisplayValues() : [];
    Logger.log(`${ss.getUrl()}\n${aufr || 'Aufräumen: nichts zu tun'}\n+${neu.length} von Sean (Zeile ${last + 1}–${last + neu.length}):\n` +
      z.map(r => `${r[C.kunde - 1]} · ${r[C.zpn - 1] || '—'} · ${r[C.check - 1]} · ${r[C.ready - 1]}`).join('\n') +
      (skip.length ? `\nÜbersprungen (schon drin): ${skip.join(', ')}` : ''));
  } finally {
    lock.releaseLock();
  }
}

function eagListeHolen_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(EAG_PROP_ID_);
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { Logger.log(`Gespeicherte Liste ${id} nicht erreichbar → neu anlegen`); }
  }
  const ss = SpreadsheetApp.create('EAG-Ticketliste Fördercall 3/2026');
  ss.setSpreadsheetTimeZone('Europe/Vienna');
  ss.setIterativeCalculationEnabled(true); // für den Ticket-Zeitstempel
  ss.setMaxIterativeCalculationCycles(1);
  const sh = ss.getSheets()[0].setName('Ticketliste');
  const n = EAG_HEAD_.length, max = EAG_MAX_ZEILEN_, C = EAG_COL_;
  if (sh.getMaxRows() < max) sh.insertRowsAfter(sh.getMaxRows(), max - sh.getMaxRows());

  sh.getRange(1, 1, 1, n).setValues([EAG_HEAD_.map(x => x[0])])
    .setFontWeight('bold').setFontColor('#FFFFFF').setWrap(true)
    .setVerticalAlignment('middle').setHorizontalAlignment('center');
  EAG_HEAD_.forEach((x, i) => { sh.getRange(1, i + 1).setBackground(EAG_FARBE_[x[2]]); sh.setColumnWidth(i + 1, x[1]); });
  sh.setRowHeight(1, 48);
  sh.getRange(2, C.zpn, max - 1, 1).setNumberFormat('@');
  sh.getRange(2, C.zeit, max - 1, 1).setNumberFormat('dd.MM.yyyy HH:mm:ss');
  sh.getRange(2, C.kwp, max - 1, 2).setNumberFormat('0.00');
  sh.getRange(2, C.neu, max - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Neuanlage', 'Erweiterung'], true).setAllowInvalid(false).build());

  sh.setFrozenRows(1);
  sh.setFrozenColumns(C.kunde);
  sh.getRange(1, 1, max, n).createFilter();

  const info = ss.insertSheet('Info');
  const zeilen = [
    'EAG-Investitionszuschuss PV – 3. Fördercall 2026', '',
    'Fördercall: 08.10.–22.10.2026',
    'Ticketziehung: NUR 08.10.2026 ab 17:00 über www.eag-abwicklungsstelle.at',
    'Für das Ticket nötig: Einspeise-ZPN (33-stellig, AT00…) + E-Mail. Bezugs-ZPN geht NICHT.',
    'Ticket verfällt, wenn bis 22.10. kein Antrag im EAG-Portal eingereicht ist. Verknüpfung über den Einspeise-ZPN.', '',
    'Bedienung',
    '„Ticket gezogen" anhaken → Zeitpunkt wird automatisch gesetzt (Haken weg = Zeit weg).',
    'Hinweise je Deal: Zell-Notiz an der Kunden-Zelle (Hover).',
    'Aktualisierung: Apps Script eagTicketliste() (Projekt Dateien-Klassifikation-Pilot, Datei EagTicketliste.gs) liest die 4 Montage-Sheets neu.',
    EAG_INFO_BLEIBT_,
    EAG_INFO_ZPN_, '',
    'ZPN-Check',
    'Aufbau: AT | 6 Ziffern Netzbetreiber | 5 Ziffern PLZ (oder 00000) | 20 Zeichen Zählpunkt = 33',
    '⏳ = Netzanmeldung eingereicht (Hakerl), Einspeise-ZPN kommt noch → vormerken, sobald ZPN da: Ticket ziehen',
    '❌ = Ticket geht nicht (falsche Länge, kein AT00, Stelle 3–13 keine Ziffern) · ⚠️ = PLZ im ZPN ≠ Anlage oder doppelt',
    'Erweiterung „17 + 5 Erweiterung" im Sheet → kWp nur aus den neuen Modulen',
    'Nicht prüfbar: ob es wirklich der Einspeise-ZPN ist → nur Netzbetreiber-Bestätigung zählt', '',
    'Kategorien: A ≤ 10 kWp · B > 10–20 → Reihung nach Ticketzeit · C > 20–100 · D > 100 → Reihung nach €/kWp',
    'Speicher: ≥ 0,5 kWh netto pro kWp, max. 50 kWh förderbar (Sigenergy 10,0 → 8,76 netto, 6,0 → 5,84)',
    'Erweiterung: nur zusätzliche Module förderbar, Repowering nicht', '',
    'Quellen: Montageplanung ALE, Kreuzeder, Berger, Greensky — Hakerl „Netzanmeldung eingereicht" ODER Zählpunkt. Shamoun 5853 bewusst raus.'
  ];
  info.getRange(1, 1, zeilen.length, 1).setValues(zeilen.map(z => [z]));
  info.setColumnWidth(1, 900);
  info.getRange('A1').setFontSize(13).setFontWeight('bold');
  [8, 15].forEach(r => info.getRange(r, 1).setFontWeight('bold'));

  props.setProperty(EAG_PROP_ID_, ss.getId());
  return ss;
}
