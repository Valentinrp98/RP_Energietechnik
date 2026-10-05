// ===== PARTNER-CHECK (05.10.2026, Anlass: 7024 Neubauer NÖ landete bei Kreuzeder) =====
//
// VP: „ist jmd andere noch falsch?“ -- prüft JEDE Zeile mit Deal-ID in allen Partner-Sheets gegen
// Pipedrive:
//   - Sheet-Partner  !=  Montagepartner am Deal      -> Zeile liegt im falschen Sheet
//   - Montagepartner !=  Regel aus Bundesland         -> Partner passt nicht zum Bundesland
//   - Bundesland leer / Deal nicht gewonnen / Stornogrund gesetzt
//   - Deal-ID doppelt (im selben Sheet oder in mehreren Sheets)
//   - Zeile mit Kundenname, aber ohne Deal-ID
// Plus: gewonnene Deals mit Partner, der nicht zum Bundesland passt (auch ohne Sheet-Zeile).
//
// NUR LESEN: kein Schreiben nach Pipedrive, nichts in den Partner-Sheets. Ergebnis landet im
// Ausführungsprotokoll UND in einem eigenen Ergebnis-Sheet (ID in Script Property
// PARTNER_CHECK_SHEET_ID, wird beim ersten Lauf angelegt) -- wird bei jedem Lauf überschrieben.
//
// Regel = BUNDESLAND_PARTNER_VS (VerloreneSeelen.gs, Kopie aus Montagepartner-aus-Bundesland).
// Greensky/KOLLSTAR in OÖ/SBG sind von Hand vergeben (die Automatik vergibt sie nie) -> nur Info.

const PROP_PARTNER_CHECK_SHEET_ID = 'PARTNER_CHECK_SHEET_ID';
const HANDPARTNER_OOE_SBG = [159, 160]; // Greensky, KOLLSTAR

function partnerCheckAlle() {
  const befunde = []; // [Art, Deal-ID, Kunde, Sheet (Zeile), Partner am Deal, Bundesland, Regel-Partner, Status/Storno]

  // 1. Alle gewonnenen Deals auf einmal (wie syncNeueZeilen, sort_by=id gegen Seitengrenzen-Verlust)
  const deals = {};
  let cursor = null;
  do {
    const path = `deals?status=won&limit=100&sort_by=id&sort_direction=asc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = callPipedriveWithRetryRaw(`https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`);
    (res.data || []).forEach(d => { deals[String(d.id)] = d; });
    cursor = res.additional_data?.next_cursor || null;
  } while (cursor);
  Logger.log(`${Object.keys(deals).length} gewonnene Deals geladen.`);

  const partnerName = id => MONTAGEPARTNER_ID_TO_NAME[id] || (id ? `? (${id})` : '(leer)');
  const blName = id => BUNDESLAND_VS[id] || (id ? `? (${id})` : '(leer)');
  const regelName = blId => BUNDESLAND_PARTNER_VS[blId] ? partnerName(BUNDESLAND_PARTNER_VS[blId]) : '-';
  const passtZurRegel = (blId, partnerId) => {
    const soll = BUNDESLAND_PARTNER_VS[blId];
    if (!soll || !partnerId) return true; // leer wird separat gemeldet
    if (soll === Number(partnerId)) return true;
    return soll === 161 && HANDPARTNER_OOE_SBG.indexOf(Number(partnerId)) !== -1 ? 'info' : false;
  };

  // 2. Alle Partner-Sheets durchgehen
  const cache = neuerSheetCache();
  const fundorte = {}; // dealId -> ["Partner Zeile n", ...]
  let zeilenGeprueft = 0;
  Object.keys(PARTNER_SHEET_CONFIG).forEach(sheetPartner => {
    const eintrag = cachePartnerEintrag(sheetPartner, cache);
    if (eintrag.fehler) { Logger.log(`${sheetPartner}: übersprungen (${eintrag.fehler})`); return; }
    const dealIdCol = cacheSpaltenIndex(eintrag, COL.dealId);
    const nameCol = cacheSpaltenIndex(eintrag, COL.name);
    if (!dealIdCol) { befunde.push(['Spalte Deal-ID fehlt', '', '', sheetPartner, '', '', '', '']); return; }

    cacheAlleWerte(eintrag).forEach((zeilenWerte, i) => {
      const zeile = i + 2;
      const dealId = String(zeilenWerte[dealIdCol - 1]).trim();
      const kunde = nameCol ? String(zeilenWerte[nameCol - 1]).trim() : '';
      const ort = `${sheetPartner} Z${zeile}`;
      if (!dealId) {
        if (kunde) befunde.push(['Zeile ohne Deal-ID', '', kunde, ort, '', '', '', '']);
        return;
      }
      zeilenGeprueft++;
      (fundorte[dealId] = fundorte[dealId] || []).push(ort);

      let deal = deals[dealId];
      if (!deal) {
        try { deal = fetchPipedrive(`deals/${dealId}`); } catch (err) { deal = null; }
        if (!deal) { befunde.push(['Deal nicht gefunden', dealId, kunde, ort, '', '', '', '']); return; }
      }
      const cf = deal.custom_fields || {};
      const partnerId = cf[MONTAGEPARTNER_FIELD_KEY];
      const blId = cf[BUNDESLAND_FIELD_KEY_VS];
      const storno = cf[STORNOGRUND_FIELD_KEY_VS] ? `Storno: ${cf[STORNOGRUND_FIELD_KEY_VS]}` : '';
      const status = deal.status !== 'won' ? `status=${deal.status}` : '';
      const basis = [dealId, kunde || deal.title, ort, partnerName(partnerId), blName(blId), regelName(blId),
        [status, storno].filter(Boolean).join(' | ')];

      if (partnerName(partnerId) !== sheetPartner) befunde.push(['❌ Falsches Sheet (≠ Partner am Deal)', ...basis]);
      const regel = passtZurRegel(blId, partnerId);
      if (regel === false) befunde.push(['❌ Partner ≠ Bundesland-Regel', ...basis]);
      if (regel === 'info') befunde.push(['ℹ Hand-Partner OÖ/SBG', ...basis]);
      if (!blId) befunde.push(['⚠ Bundesland leer', ...basis]);
      if (status) befunde.push(['⚠ Nicht gewonnen', ...basis]);
      if (storno) befunde.push(['⚠ Stornogrund gesetzt', ...basis]);
    });
  });

  // 3. Doppelte Deal-IDs
  Object.entries(fundorte).forEach(([dealId, orte]) => {
    if (orte.length > 1) {
      const d = deals[dealId];
      befunde.push(['⚠ Deal-ID doppelt', dealId, d ? d.title : '', orte.join(' + '), '', '', '', '']);
    }
  });

  // 4. Gewonnene Deals OHNE Sheet-Zeile, deren Partner nicht zur Regel passt
  Object.values(deals).forEach(d => {
    if (fundorte[String(d.id)]) return;
    const cf = d.custom_fields || {};
    const partnerId = cf[MONTAGEPARTNER_FIELD_KEY];
    const blId = cf[BUNDESLAND_FIELD_KEY_VS];
    if (cf[STORNOGRUND_FIELD_KEY_VS] || !partnerId || !blId) return;
    if (passtZurRegel(blId, partnerId) !== false) return;
    befunde.push(['❌ Partner ≠ Regel (ohne Sheet-Zeile)', String(d.id), d.title, '-', partnerName(partnerId),
      blName(blId), regelName(blId), '']);
  });

  // 5. Ausgabe
  const kopf = ['Art', 'Deal-ID', 'Kunde', 'Sheet (Zeile)', 'Partner am Deal', 'Bundesland', 'Partner laut Regel', 'Status/Storno'];
  befunde.sort((a, b) => a[0].localeCompare(b[0]) || String(a[1]).localeCompare(String(b[1])));
  befunde.forEach(b => Logger.log(b.join(' | ')));
  Logger.log(`Fertig: ${zeilenGeprueft} Sheet-Zeilen mit Deal-ID geprüft, ${befunde.length} Befunde.`);

  const props = PropertiesService.getScriptProperties();
  let ss = null;
  const id = props.getProperty(PROP_PARTNER_CHECK_SHEET_ID);
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('Partner-Check (Sheet-Sync)');
    props.setProperty(PROP_PARTNER_CHECK_SHEET_ID, ss.getId());
  }
  const tab = ss.getSheets()[0];
  tab.clear();
  const ausgabe = [kopf].concat(befunde.length ? befunde : [['keine Befunde', '', '', '', '', '', '', '']]);
  tab.getRange(1, 1, ausgabe.length, kopf.length).setValues(ausgabe);
  tab.getRange(ausgabe.length + 2, 1).setValue(`Stand ${notizZeitstempel()} -- ${zeilenGeprueft} Sheet-Zeilen geprüft`);
  Logger.log(`Ergebnis-Sheet: ${ss.getUrl()}`);
}
