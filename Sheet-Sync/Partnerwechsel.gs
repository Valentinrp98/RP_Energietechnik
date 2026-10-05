// ===== PARTNERWECHSEL (02.10.2026, Anlass: Start Greensky) =====
//
// Fall: Montagepartner wird in Pipedrive von Hand umgestellt, z.B. Kreuzeder -> Greensky, NACHDEM
// Ordner und Sheet-Zeile schon beim alten Partner angelegt waren. Ohne diese Datei passierte:
//   - syncNeueZeilen() legt beim NEUEN Partner eine Zeile an (prüft nur dessen Sheet) -- gut.
//   - die ALTE Zeile bleibt beim alten Partner stehen; der sieht den Auftrag weiter.
//   - der Kundenordner bleibt im Drive-Ordner des alten Partners; Ordnererstellung-bei-Gewonnen
//     fasst ihn nie wieder an (Ordner-Link ist ja gesetzt).
//
// Was hier passiert, pro Kandidat in syncNeueZeilen(), NACHDEM die Zeile beim neuen Partner steht:
//   1. Deal-ID in allen ANDEREN Partner-Sheets suchen (Lauf-Cache, kein Extra-openById).
//   2. Treffer -> komplette alte Zeile als JSON ins Log (Wiederherstellung von Hand möglich),
//      dann Zeile im alten Sheet löschen.
//   3. Kundenordner verschieben: von "Montage offen" des alten Partners nach "Montage offen" des
//      neuen. Der Link bleibt gleich (Drive-ID ändert sich bei moveTo nicht) -- Pipedrive und die
//      neue Sheet-Zeile müssen also NICHT angefasst werden.
//   "Montage offen" darf im Partner-Root auch nur eine Verknüpfung sein (Kreuzeder!) -- wird aufgelöst.
//   Liegt der Ordner woanders (z.B. schon "Montage abgeschlossen"), wird NICHT geraten:
//   MANUELL_KLAEREN-Zeile im Log.
//
// Schreibt NIE nach Pipedrive.
//
// Eigener Schalter statt nur DRY_RUN: DRY_RUN ist global false (Sync läuft live), dieser neue Pfad
// soll erst gemessen werden. Erst Log prüfen ("würde ..."-Zeilen), dann auf false.
const PARTNERWECHSEL_DRY_RUN = false; // scharf seit 02.10.2026 auf VP-OK (Deal 7607 Lindner, Kreuzeder -> Greensky)

// Valentin 02.10.2026: NUR wenn Montagepartner von Hand auf Greensky gestellt wird. Die PLZ-/
// Bundesland-Automatik (Montagepartner-aus-Bundesland) vergibt Greensky nie (OÖ -> Kreuzeder) und
// überschreibt einen gesetzten Partner nicht -- Greensky am Deal heißt also immer: von Hand.
// Andere Wechsel (z.B. ALE <-> Berger) bleiben unangetastet. Weitere Ziele hier ergänzen.
const PARTNERWECHSEL_ZIELE = ['Greensky (OÖ, SBG)'];

// Partner-Root-Ordner. MUSS identisch sein mit PARTNER_TO_DRIVE_FOLDER_ID in
// Ordnererstellung-bei-Gewonnen/Config.gs -- dort entsteht der Ordner, hier wird er umgezogen.
const PARTNER_ORDNER_IDS = {
  'ALE-Engineering (NÖ, Wien, BGL)': '1XIBb_UvDaNON3t38sR2PSxWzsyUnw75d',
  'Berger Elektrotechnik (KTN)': '13oW_ltohWezbjiuFWUdZZXgM6NtndcD_',
  'Greensky (OÖ, SBG)': '14j-TzXjnCNVgx9SqCcTilX3gsGB0DnF5',
  'KOLLSTAR (OÖ)': '1ZeOW8gm0jhVDNG9920Yori7pde1G6bpw',
  'Kreuzeder (OÖ, SBG)': '1zAdnKf5VPEuUqQsdDWSb9D5btaf_7t1K',
  'Tiroler Partner (T)': '1AAB7JjI5L5Zq3R-S7f_JpvbN-4g9y061',
  'Vorarlberg Partner (V)': '1ICcSFoZ0EGnib1I3oi60eTjotx30Fqkl'
};

/**
 * Räumt die Spuren eines Partnerwechsels auf. Aufruf aus syncNeueZeilen(), nur wenn der Deal beim
 * aktuellen Partner schon eine Zeile hat (angelegt / nachgefuellt / existiert).
 * Rückgabe: Anzahl bereinigter alter Zeilen (0 = kein Wechsel).
 */
function bereinigePartnerwechsel(deal, cache) {
  const cf = deal.custom_fields || {};
  const neuerPartner = MONTAGEPARTNER_ID_TO_NAME[cf[MONTAGEPARTNER_FIELD_KEY]];
  if (!neuerPartner || PARTNERWECHSEL_ZIELE.indexOf(neuerPartner) === -1) return 0;

  let bereinigt = 0;
  Object.keys(PARTNER_SHEET_CONFIG).forEach(alterPartner => {
    if (alterPartner === neuerPartner) return;
    const eintrag = cachePartnerEintrag(alterPartner, cache);
    if (eintrag.fehler) return; // z.B. KOLLSTAR ohne Sheet -- kann keine Zeile haben
    const dealIdCol = cacheSpaltenIndex(eintrag, COL.dealId);
    if (!dealIdCol) return;
    const zeile = cacheDealIdZeilen(eintrag, dealIdCol)[String(deal.id)];
    if (!zeile) return;

    bereinigt++;
    verarbeiteAlteZeile_(deal, cf, alterPartner, neuerPartner, eintrag, zeile);
  });
  // Keine alte Zeile, Ordner kann trotzdem beim alten Partner liegen -- z.B. Zeile nie angelegt,
  // weil der Deal dort keinen Doku-Status hatte (Deal 7607 Lindner, 02.10.2026).
  if (bereinigt === 0) pruefeVerwaistenOrdner_(deal, cf, neuerPartner);
  return bereinigt;
}

/**
 * Ordner-Umzug ohne alte Sheet-Zeile: liegt der Kundenordner direkt im "Montage offen" eines
 * ANDEREN Partners, wird er zum neuen verschoben. Liegt er woanders (schon beim neuen Partner,
 * "Montage abgeschlossen", sonstwo): nichts tun, nicht raten. Ergebnis 6 h gecacht pro Deal,
 * damit nicht jeder 5-Min-Lauf Drive abfragt.
 */
function pruefeVerwaistenOrdner_(deal, cf, neuerPartner) {
  const ordnerLink = cf[KUNDENORDNER_LINK_FIELD_KEY];
  if (!ordnerLink) return;
  const sc = CacheService.getScriptCache();
  const cacheKey = `pwo:${deal.id}`;
  if (sc.get(cacheKey)) return;

  try {
    const elternIter = holeOrdnerAusLink(ordnerLink).getParents();
    const elternId = elternIter.hasNext() ? elternIter.next().getId() : null;
    const alterPartner = elternId && Object.keys(PARTNER_ORDNER_IDS).find(p =>
      p !== neuerPartner && holeMontageOffenId_(p) === elternId);
    if (!alterPartner) {
      sc.put(cacheKey, '1', 21600);
      return;
    }
    const wechsel = `${alterPartner} -> ${neuerPartner}`;
    const ergebnis = pruefeOrdnerUmzug_(ordnerLink, alterPartner, neuerPartner, PARTNERWECHSEL_DRY_RUN);
    const ok = ergebnis.startsWith('verschoben') || ergebnis.startsWith('würde');
    logRow('partnerwechsel', deal.id, neuerPartner, 'Ordner', PARTNERWECHSEL_DRY_RUN ? 'DRY-RUN' : (ok ? 'OK' : 'MANUELL_KLAEREN'),
      `${wechsel} (keine alte Sheet-Zeile): ${ergebnis}`);
    if (ergebnis.startsWith('verschoben')) {
      setzeNotizAmDeal(deal, neuerPartner, COL.ordnerLink,
        `📁 Auftrag von ${alterPartner} übernommen am ${notizZeitstempel()}\nOrdner liegt jetzt in eurem Ordner "${MONTAGE_OFFEN_ORDNERNAME}". Link unverändert.`);
    }
    sc.put(cacheKey, '1', 21600);
  } catch (err) {
    logRow('partnerwechsel', deal.id, neuerPartner, 'Ordner', 'FEHLER', `Ordner-Check ohne alte Zeile: ${err.message}`);
  }
}

function verarbeiteAlteZeile_(deal, cf, alterPartner, neuerPartner, eintrag, zeile) {
  const sheet = eintrag.sheet;
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const werte = sheet.getRange(zeile, 1, 1, header.length).getValues()[0];
  const zeileAlsObjekt = {};
  header.forEach((h, i) => { if (h !== '' && werte[i] !== '') zeileAlsObjekt[h] = werte[i]; });
  const wechsel = `${alterPartner} -> ${neuerPartner}`;

  if (PARTNERWECHSEL_DRY_RUN) {
    // Alle 5 Minuten dieselbe Zeile wäre Log-Müll -- pro Deal höchstens alle 6 Stunden.
    const cacheKey = `pw:${deal.id}:${alterPartner}`;
    const sc = CacheService.getScriptCache();
    if (sc.get(cacheKey)) return;
    sc.put(cacheKey, '1', 21600);
    const ordnerPlan = pruefeOrdnerUmzug_(cf[KUNDENORDNER_LINK_FIELD_KEY], alterPartner, neuerPartner, true);
    logRow('partnerwechsel', deal.id, alterPartner, null, 'DRY-RUN',
      `${wechsel}: würde Zeile ${zeile} löschen + Ordner: ${ordnerPlan}. Zeile: ${JSON.stringify(zeileAlsObjekt)}`);
    return;
  }

  // Zuerst die Daten sichern (Log), dann löschen -- Log wird am Laufende geflusht, also hier sofort.
  logRow('partnerwechsel', deal.id, alterPartner, null, 'Zeile gesichert',
    `${wechsel}, Zeile ${zeile}: ${JSON.stringify(zeileAlsObjekt)}`);
  flushLog();

  // Sicherheitsnetz: steht in der Zeile wirklich noch diese Deal-ID? (Cache könnte veraltet sein,
  // wenn jemand seit Laufbeginn Zeilen eingefügt/gelöscht hat.)
  const dealIdCol = cacheSpaltenIndex(eintrag, COL.dealId);
  if (String(sheet.getRange(zeile, dealIdCol).getValue()) !== String(deal.id)) {
    logRow('partnerwechsel', deal.id, alterPartner, null, 'MANUELL_KLAEREN',
      `${wechsel}: Zeile ${zeile} enthält nicht mehr Deal ${deal.id} -- nichts gelöscht, nächster Lauf versucht es neu`);
  } else {
    sheet.deleteRow(zeile);
    logRow('partnerwechsel', deal.id, alterPartner, null, 'Zeile gelöscht', `${wechsel}, war Zeile ${zeile}`);
  }
  // Zeilennummern im alten Sheet haben sich verschoben -> Cache dieses Partners verwerfen.
  eintrag.dealIdZeilen = null;
  eintrag.alleWerte = null;

  const ordnerErgebnis = pruefeOrdnerUmzug_(cf[KUNDENORDNER_LINK_FIELD_KEY], alterPartner, neuerPartner, false);
  const ok = ordnerErgebnis.startsWith('verschoben') || ordnerErgebnis.startsWith('liegt schon');
  logRow('partnerwechsel', deal.id, neuerPartner, 'Ordner', ok ? 'OK' : 'MANUELL_KLAEREN', `${wechsel}: ${ordnerErgebnis}`);
  if (ordnerErgebnis.startsWith('verschoben')) {
    setzeNotizAmDeal(deal, neuerPartner, COL.ordnerLink,
      `📁 Auftrag von ${alterPartner} übernommen am ${notizZeitstempel()}\nOrdner liegt jetzt in eurem Ordner "${MONTAGE_OFFEN_ORDNERNAME}". Link unverändert.`);
  }
}

/**
 * Verschiebt (oder prüft im Trockenlauf) den Kundenordner in "Montage offen" des neuen Partners.
 * Gibt einen kurzen Text fürs Log zurück, wirft nie.
 */
function pruefeOrdnerUmzug_(ordnerLink, alterPartner, neuerPartner, trocken) {
  try {
    if (!ordnerLink) return 'kein Ordner-Link am Deal';
    const kundenOrdner = holeOrdnerAusLink(ordnerLink);
    const elternIter = kundenOrdner.getParents();
    if (!elternIter.hasNext()) return 'Kundenordner hat keinen Eltern-Ordner -- von Hand prüfen';
    const eltern = elternIter.next();

    // Vergleich über die ID von "Montage offen", NICHT über den Großeltern-Ordner: bei Kreuzeder
    // liegt im Partner-Root nur eine VERKNÜPFUNG, der echte Ordner gehört office@kreuzeder.cc und
    // sein Eltern-Ordner ist für uns unsichtbar (gefunden 02.10.2026, Deal 7607 Lindner).
    const neuOffen = holeMontageOffenOrdner_(neuerPartner);
    if (neuOffen && eltern.getId() === neuOffen.getId()) {
      return `liegt schon beim neuen Partner (unter "${eltern.getName()}")`;
    }
    const altOffen = holeMontageOffenOrdner_(alterPartner);
    if (!altOffen || eltern.getId() !== altOffen.getId()) {
      return `liegt unter "${eltern.getName()}" (nicht "${MONTAGE_OFFEN_ORDNERNAME}" von ${alterPartner}) -- nicht verschoben, von Hand prüfen`;
    }
    if (!neuOffen) return `"${MONTAGE_OFFEN_ORDNERNAME}" von ${neuerPartner} nicht gefunden -- nicht verschoben`;

    if (trocken) return `würde nach "${MONTAGE_OFFEN_ORDNERNAME}" von ${neuerPartner} verschieben`;
    kundenOrdner.moveTo(neuOffen);
    return `verschoben nach "${MONTAGE_OFFEN_ORDNERNAME}" von ${neuerPartner}`;
  } catch (err) {
    return `Fehler: ${err.message}`;
  }
}

/**
 * "Montage offen" eines Partners -- echter Unterordner im Partner-Root ODER Verknüpfung darauf
 * (gleiche Logik wie Ordnererstellung-bei-Gewonnen/FolderCreation.gs). null, wenn nicht auffindbar.
 */
function holeMontageOffenOrdner_(partner) {
  const id = holeMontageOffenId_(partner);
  return id ? DriveApp.getFolderById(id) : null;
}

/** ID von "Montage offen" eines Partners, 6 h im Script-Cache ('-' = nicht gefunden). */
function holeMontageOffenId_(partner) {
  const sc = CacheService.getScriptCache();
  const cacheKey = `mo:${partner}`;
  const cached = sc.get(cacheKey);
  if (cached) return cached === '-' ? null : cached;
  const ordner = sucheMontageOffenOrdner_(partner);
  sc.put(cacheKey, ordner ? ordner.getId() : '-', 21600);
  return ordner ? ordner.getId() : null;
}

function sucheMontageOffenOrdner_(partner) {
  const rootId = PARTNER_ORDNER_IDS[partner];
  if (!rootId) return null;
  const root = DriveApp.getFolderById(rootId);
  const echt = root.getFoldersByName(MONTAGE_OFFEN_ORDNERNAME);
  if (echt.hasNext()) return echt.next();
  const dateien = root.getFilesByName(MONTAGE_OFFEN_ORDNERNAME);
  while (dateien.hasNext()) {
    const kandidat = dateien.next();
    if (kandidat.getMimeType() !== 'application/vnd.google-apps.shortcut') continue;
    // DriveApp löst Shortcuts nicht auf -> Drive-REST v3 mit dem Script-Token.
    const res = UrlFetchApp.fetch(
      `https://www.googleapis.com/drive/v3/files/${kandidat.getId()}?fields=shortcutDetails&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) continue;
    const zielId = (JSON.parse(res.getContentText()).shortcutDetails || {}).targetId;
    if (zielId) return DriveApp.getFolderById(zielId);
  }
  return null;
}
