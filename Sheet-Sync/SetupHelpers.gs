// ===== EINMALIGE SETUP-FUNKTIONEN =====
// Im Apps-Script-Editor oben im Dropdown auswählen und ausführen (▷-Button).

/**
 * Trägt Adresse/PLZ/Telefon/Anlagengröße/Speicher NACHTRÄGLICH in bereits bestehende Zeilen ein
 * (2026-08-17) -- betrifft alle Zeilen, die VOR Stufe 1 (IDEEN-Felder-und-Aktionen.md) angelegt
 * wurden und deren Spalten deshalb leer sind. createSheetRowForDeal() befüllt das nur bei NEUEN
 * Zeilen, überspringt bestehende komplett -- dieser Helper holt das einmalig nach. Überschreibt
 * NIE einen bereits befüllten Wert, nur echte Lücken (leere Zellen). Einmalig laufen lassen.
 */
function backfillStufe1Felder() {
  starteLauf('backfillStufe1Felder');
  const stufe1Spalten = [COL.adresse, COL.plz, COL.telefon, COL.module, COL.speicher];

  try {
    Object.keys(PARTNER_SHEET_CONFIG).forEach(partner => {
      let sheet;
      try {
        sheet = openPartnerSheet(partner);
      } catch (err) {
        return; // TODO noch nicht konfiguriert -- kein Fehler, einfach überspringen
      }
      const dealIdCol = findColumnIndexByHeader(sheet, COL.dealId);
      if (!dealIdCol) return;

      const anzahlZeilen = Math.max(sheet.getLastRow() - 1, 0);
      if (anzahlZeilen === 0) return;
      const dealIds = sheet.getRange(2, dealIdCol, anzahlZeilen, 1).getValues().flat();

      dealIds.forEach((dealId, i) => {
        if (!dealId) return;
        const row = i + 2;

        const stufe1SpaltenIndizes = stufe1Spalten.map(header => findColumnIndexByHeader(sheet, header)).filter(Boolean);
        const hatLuecke = stufe1SpaltenIndizes.some(col => sheet.getRange(row, col).getValue() === '');
        if (!hatLuecke) return; // schon vollständig -- nichts zu tun

        const deal = fetchPipedrive(`deals/${dealId}`);
        const cf = deal.custom_fields || {};
        const person = deal.person_id ? fetchPipedrive(`persons/${deal.person_id}`) : null;
        const personCf = person?.custom_fields || {};
        const adrObj = personCf[ADRESSE_FIELD_KEY];

        const werte = {
          [COL.adresse]: adrObj?.formatted_address || adrObj?.value || '',
          [COL.plz]: personCf[PLZ_FIELD_KEY] || '',
          [COL.telefon]: person?.phones?.[0]?.value || '',
          [COL.module]: cf[MODULE_ANZAHL_FIELD_KEY] || '',
          [COL.speicher]: cf[SPEICHER_KWH_FIELD_KEY] || ''
        };

        if (DRY_RUN) {
          logRow('pipedrive→sheet', dealId, partner, 'Stufe-1-Backfill', 'DRY-RUN', JSON.stringify(werte));
          return;
        }

        Object.entries(werte).forEach(([header, wert]) => {
          if (!wert) return;
          const col = findColumnIndexByHeader(sheet, header);
          if (col && sheet.getRange(row, col).getValue() === '') sheet.getRange(row, col).setValue(wert);
        });
        logRow('pipedrive→sheet', dealId, partner, 'Stufe-1-Backfill', 'geschrieben', JSON.stringify(werte));
      });
    });
  } finally {
    flushLog();
  }
  Logger.log('Fertig -- Ergebnis siehe LOG_Sheet-Sync (V2).');
}

/**
 * Richtet alle Trigger ein: zeitgesteuert für neue Zeilen + Pipedrive->Sheet-Sync (alle 15 Min),
 * täglich für die verzögerte Ordner-Verschiebung nach Fertigmeldung (siehe OrdnerAbschluss.gs),
 * die Netzanmeldung-/Kundentermin-Eskalation (siehe NetzanmeldungEskalation.gs) und das
 * Notizen-Aufräumen, plus installierbare onEdit-Trigger für jedes konfigurierte Partner-Sheet
 * (Sheet->Pipedrive). Idempotent: entfernt vorher alle eigenen Trigger, damit mehrfaches
 * Ausführen nicht zu doppelten Läufen führt.
 */
function installTriggers() {
  removeAllTriggers();

  ScriptApp.newTrigger('syncNeueZeilen').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('syncPipedriveToSheetFields').timeBased().everyMinutes(15).create();
  // Die drei täglichen Läufe zeitlich entzerrt (6/7/4 Uhr) -- alle drei iterieren über alle
  // gewonnenen Deals und loggen ins selbe Sheet, entzerrt bleiben auch die Log-Blöcke pro Lauf
  // sauber getrennt (Lauf-ID macht das ohnehin, aber so überlappen sich die API-Calls nicht).
  ScriptApp.newTrigger('verschiebeAbgeschlosseneOrdner').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('ueberwacheNetzanmeldungUndKundentermin').timeBased().everyDays(1).atHour(7).create();
  ScriptApp.newTrigger('raeumeAlteNotizen').timeBased().everyDays(1).atHour(4).create();

  Object.entries(PARTNER_SHEET_CONFIG).forEach(([partner, config]) => {
    if (config.sheetId.startsWith('TODO_')) {
      Logger.log(`Übersprungen: keine Sheet-ID für "${partner}" -- kein onEdit-Trigger eingerichtet.`);
      return;
    }
    ScriptApp.newTrigger('handleSheetEdit').forSpreadsheet(config.sheetId).onEdit().create();
    Logger.log(`onEdit-Trigger für "${partner}" eingerichtet.`);
  });

  Logger.log('Fertig. Mit listInstalledTriggers() prüfen.');
}

function listInstalledTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    Logger.log(`${t.getHandlerFunction()} -- ${t.getEventType()} -- ${t.getTriggerSourceId ? t.getTriggerSourceId() : ''}`);
  });
}

/** Entfernt ALLE Trigger dieses Projekts (zum saubereren Neu-Einrichten). */
function removeAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('Alle Trigger entfernt.');
}

/**
 * Schützt die Deal-ID-Spalte UND alle pipedrive_to_sheet-Spalten (DC-/AC-/IB-Termin,
 * Materiallieferung, ...) in allen konfigurierten Partner-Sheets vor Bearbeitung durch die
 * Partner -- nur der Script-Ausführer (Owner) darf reinschreiben. Grund für die Erweiterung über
 * die Deal-ID hinaus: trägt ein Partner versehentlich in eine dieser Spalten ein, überschreibt
 * sie der nächste 15-Minuten-Lauf kommentarlos -- er sieht keinen Fehler, wir sehen nichts.
 * Einmalig ausführen, NACHDEM die Spalte "Deal-ID" manuell in jedem Sheet angelegt wurde.
 * Warnung: aktuelle Editoren des Sheets (z.B. ein Partner mit Bearbeitungsrecht) können den
 * eigenen Schutz theoretisch wieder aufheben, wenn sie "Bearbeiter verwalten" dürfen --
 * bei Bedarf zusätzlich die Sheet-Freigabe selbst auf "Kommentieren" statt "Bearbeiten" stellen.
 */
function protectDealIdColumn() {
  const geschuetzteFelder = SYNC_FIELD_CONFIG.filter(f => f.direction === 'pipedrive_to_sheet');

  Object.entries(PARTNER_SHEET_CONFIG).forEach(([partner, config]) => {
    if (config.sheetId.startsWith('TODO_') || config.tabName.startsWith('TODO_')) {
      Logger.log(`Übersprungen: "${partner}" noch nicht vollständig konfiguriert.`);
      return;
    }
    let sheet;
    try {
      sheet = openPartnerSheet(partner);
    } catch (err) {
      Logger.log(`Übersprungen: "${partner}" -- ${err.message}`);
      return;
    }

    // Stufe-1-Felder (Adresse/PLZ/Telefon/Anlagengröße/Speicher, siehe RowCreation.gs) werden wie
    // die Deal-ID nur vom Script geschrieben (einmalig bei Zeilen-Erstellung) -- gehören deshalb
    // hier mit rein, auch wenn sie kein SYNC_FIELD_CONFIG-Eintrag sind.
    const zuSchuetzendeSpalten = [
      { header: COL.dealId, label: 'Deal-ID (Sync-Schlüssel)' },
      { header: COL.adresse, label: 'Adresse' },
      { header: COL.plz, label: 'PLZ' },
      { header: COL.telefon, label: 'Telefon Kunde' },
      { header: COL.module, label: 'Anlagengröße (Module)' },
      { header: COL.speicher, label: 'Speicher (kWh)' }
    ].concat(geschuetzteFelder.map(f => ({ header: f.sheetColumnHeader, label: f.label })));

    zuSchuetzendeSpalten.forEach(({ header, label }) => {
      const col = findColumnIndexByHeader(sheet, header);
      if (!col) {
        Logger.log(`Übersprungen: "${partner}" -- Spalte "${header}" existiert noch nicht, erst manuell anlegen.`);
        return;
      }
      const range = sheet.getRange(1, col, sheet.getMaxRows(), 1);
      const protection = range.protect().setDescription(`${label} -- wird zentral von RP gepflegt, nicht bearbeiten -- ${partner}`);
      protection.removeEditors(protection.getEditors()); // niemand außer dem Owner darf bearbeiten
      if (protection.canDomainEdit()) protection.setDomainEdit(false);
      Logger.log(`Spalte "${header}" in "${partner}" geschützt.`);
    });
  });
}

/**
 * Entfernt Erfolgs-/Änderungs-Notizen, die älter als NOTIZ_AUFRAEUM_TAGE sind, samt gelber
 * Markierung. Fehler-Notizen (⚠) bleiben IMMER stehen -- die sind das offene Problem, nicht
 * eine alte Bestätigung. Ohne das trägt nach ein paar Monaten jede Zelle ein Notiz-Eck und die
 * Notiz sagt nichts mehr aus. Für einen täglichen Trigger gedacht (siehe installTriggers()).
 */
function raeumeAlteNotizen() {
  starteLauf('raeumeAlteNotizen');
  const grenze = new Date();
  grenze.setDate(grenze.getDate() - NOTIZ_AUFRAEUM_TAGE);
  const summary = { entfernt: 0, sheets: 0 };

  try {
    Object.keys(PARTNER_SHEET_CONFIG).forEach(partner => {
      let sheet;
      try { sheet = openPartnerSheet(partner); } catch (e) { return; }

      const anzahlZeilen = Math.max(sheet.getLastRow() - 1, 0);
      if (anzahlZeilen === 0) return;
      summary.sheets++;

      const range = sheet.getRange(2, 1, anzahlZeilen, sheet.getLastColumn());
      const notizen = range.getNotes();
      const farben = range.getBackgrounds();
      let geaendert = 0;

      for (let r = 0; r < notizen.length; r++) {
        for (let c = 0; c < notizen[r].length; c++) {
          const notiz = notizen[r][c];
          if (!notiz) continue;
          if (notiz.indexOf('⚠') === 0) continue;              // Fehler bleiben stehen
          const m = notiz.match(/(\d{2})\.(\d{2})\.(\d{4})/);  // dd.MM.yyyy aus dem Notiztext
          if (!m) continue;
          if (new Date(`${m[3]}-${m[2]}-${m[1]}`) >= grenze) continue;
          notizen[r][c] = '';
          farben[r][c] = '#ffffff';
          geaendert++;
        }
      }

      if (geaendert > 0 && !DRY_RUN) {
        range.setNotes(notizen);
        range.setBackgrounds(farben);
      }
      summary.entfernt += geaendert;
      logRow('pipedrive→sheet', null, partner, 'Notizen aufräumen',
             DRY_RUN ? 'DRY-RUN' : 'aufgeräumt', `${geaendert} Notizen älter als ${NOTIZ_AUFRAEUM_TAGE} Tage`);
    });
  } finally {
    logLaufEnde('OK', summary);
    flushLog();
  }
}

/** Debug: listet alle Deal-Custom-Fields (field_name + field_code). Bei Einfachauswahl-/
 * Mehrfachauswahl-Feldern (z.B. "Netzstatus") zusätzlich die Options-IDs -- die braucht man,
 * um in ein solches Feld zu schreiben (Pipedrive nimmt dort Options-IDs, keine Klartext-Labels).
 */
function listDealFieldsHelper() {
  const fields = fetchPipedrive('dealFields?limit=500');
  fields.forEach(f => {
    Logger.log(`${f.field_name}  -->  ${f.field_code}`);
    if (f.options && f.options.length) {
      f.options.forEach(o => Logger.log(`    - "${o.label}"  -->  ${o.id}`));
    }
  });
}

/** Für Einzeltests: Zeilen-Erstellung für einen bekannten Deal. */
function testCreateSheetRow() {
  starteLauf('testCreateSheetRow');
  try {
    const result = createSheetRowForDeal(7253); // Test-Deal-ID, ggf. anpassen
    Logger.log(result);
  } finally {
    flushLog();
  }
}

/**
 * Testet Sheet->Pipedrive OHNE onEdit-Trigger einzurichten: liest den aktuell im Sheet stehenden
 * ZPN-Wert bei Deal 7253 (KOLLSTAR-Sheet) und schreibt ihn nach Pipedrive, genau wie es der
 * Trigger später automatisch tun würde. Wert also vorher manuell in die Zelle eintragen, dann
 * diese Funktion ausführen. Ergebnis im Log-Sheet UND als Notiz an der Zelle bei Fehlern.
 */
function testZpnSchreiben() {
  starteLauf('testZpnSchreiben');
  try {
    const partner = 'KOLLSTAR (OÖ)';
    const sheet = openPartnerSheet(partner);
    const dealIdCol = findColumnIndexByHeader(sheet, COL.dealId);
    const zpnCol = findColumnIndexByHeader(sheet, COL.zpn);
    const row = findRowByDealId(sheet, dealIdCol, 7253);
    if (!row) {
      Logger.log('Zeile für Deal 7253 nicht gefunden -- erst testCreateSheetRow() ausführen.');
      return;
    }
    const fieldConfig = SYNC_FIELD_CONFIG.find(f => f.sheetColumnHeader === COL.zpn);
    handleSingleCellEdit(sheet, row, zpnCol, dealIdCol, fieldConfig, {});
    Logger.log('Fertig -- Ergebnis siehe LOG_Sheet-Sync (V2) bzw. Notiz an der Zelle.');
  } finally {
    flushLog();
  }
}

/**
 * Testet "Fertigmeldung" OHNE onEdit-Trigger -- gleiches Muster wie testZpnSchreiben(). Checkbox
 * bei Deal 7253 (KOLLSTAR-Sheet) vorher manuell anhaken, dann ausführen. Schreibt bei
 * DRY_RUN=false ein Datum ins Pipedrive-Feld "Fertigmeldung am" UND Netzstatus="Fertigmeldung raus".
 */
function testFertigmeldungSchreiben() {
  starteLauf('testFertigmeldungSchreiben');
  try {
    const partner = 'KOLLSTAR (OÖ)';
    const sheet = openPartnerSheet(partner);
    const dealIdCol = findColumnIndexByHeader(sheet, COL.dealId);
    const spalte = findColumnIndexByHeader(sheet, COL.fertigmeldung);
    if (!spalte) {
      Logger.log(`Spalte "${COL.fertigmeldung}" fehlt im Sheet -- erst manuell als Checkbox-Spalte anlegen.`);
      return;
    }
    const row = findRowByDealId(sheet, dealIdCol, 7253);
    if (!row) {
      Logger.log('Zeile für Deal 7253 nicht gefunden -- erst testCreateSheetRow() ausführen.');
      return;
    }
    const fieldConfig = SYNC_FIELD_CONFIG.find(f => f.sheetColumnHeader === COL.fertigmeldung);
    handleSingleCellEdit(sheet, row, spalte, dealIdCol, fieldConfig, {});
    Logger.log('Fertig -- Ergebnis siehe LOG_Sheet-Sync (V2) bzw. Notiz an der Zelle.');
  } finally {
    flushLog();
  }
}

/**
 * Testet "Netzanmeldung eingereicht" OHNE onEdit-Trigger -- gleiches Muster wie
 * testZpnSchreiben(). Checkbox bei Deal 7253 (KOLLSTAR-Sheet) vorher manuell anhaken, dann
 * ausführen. Schreibt bei DRY_RUN=false Netzstatus="eingereicht".
 */
function testNetzanmeldungSchreiben() {
  starteLauf('testNetzanmeldungSchreiben');
  try {
    const partner = 'KOLLSTAR (OÖ)';
    const sheet = openPartnerSheet(partner);
    const dealIdCol = findColumnIndexByHeader(sheet, COL.dealId);
    const spalte = findColumnIndexByHeader(sheet, COL.netzanmeldung);
    if (!spalte) {
      Logger.log(`Spalte "${COL.netzanmeldung}" fehlt im Sheet -- erst manuell als Checkbox-Spalte anlegen.`);
      return;
    }
    const row = findRowByDealId(sheet, dealIdCol, 7253);
    if (!row) {
      Logger.log('Zeile für Deal 7253 nicht gefunden -- erst testCreateSheetRow() ausführen.');
      return;
    }
    const fieldConfig = SYNC_FIELD_CONFIG.find(f => f.sheetColumnHeader === COL.netzanmeldung);
    handleSingleCellEdit(sheet, row, spalte, dealIdCol, fieldConfig, {});
    Logger.log('Fertig -- Ergebnis siehe LOG_Sheet-Sync (V2) bzw. Notiz an der Zelle.');
  } finally {
    flushLog();
  }
}

/**
 * Testet "IB erledigt" OHNE onEdit-Trigger -- gleiches Muster wie testZpnSchreiben(). Checkbox
 * bei Deal 7253 (KOLLSTAR-Sheet) vorher manuell anhaken, dann ausführen. Schreibt bei
 * DRY_RUN=false "IB erfolgt" ins Pipedrive-Feld "Fortschritt" plus eine Aktivität am Deal.
 */
function testIbErledigtSchreiben() {
  starteLauf('testIbErledigtSchreiben');
  try {
    const partner = 'KOLLSTAR (OÖ)';
    const sheet = openPartnerSheet(partner);
    const dealIdCol = findColumnIndexByHeader(sheet, COL.dealId);
    const spalte = findColumnIndexByHeader(sheet, COL.ibErledigt);
    if (!spalte) {
      Logger.log(`Spalte "${COL.ibErledigt}" fehlt im Sheet -- erst manuell als Checkbox-Spalte anlegen.`);
      return;
    }
    const row = findRowByDealId(sheet, dealIdCol, 7253);
    if (!row) {
      Logger.log('Zeile für Deal 7253 nicht gefunden -- erst testCreateSheetRow() ausführen.');
      return;
    }
    const fieldConfig = SYNC_FIELD_CONFIG.find(f => f.sheetColumnHeader === COL.ibErledigt);
    handleSingleCellEdit(sheet, row, spalte, dealIdCol, fieldConfig, {});
    Logger.log('Fertig -- Ergebnis siehe LOG_Sheet-Sync (V2) bzw. Notiz an der Zelle.');
  } finally {
    flushLog();
  }
}

/**
 * Testet Sheet->Pipedrive für DC-/AC-/IB-Termin OHNE onEdit-Trigger -- gleiches Muster wie
 * testZpnSchreiben(). Die drei Spalten sind seit 2026-08-17 "bidirektional": Wert vorher manuell
 * in eine oder mehrere der drei Zellen bei Deal 7253 (KOLLSTAR-Sheet) eintragen, dann ausführen.
 * Ohne installierten onEdit-Trigger passiert bei einem manuellen Eintippen im Sheet sonst NICHTS --
 * das ist kein Bug, der Trigger ist ja bewusst noch nicht aktiviert (installTriggers()).
 */
function testTermineSchreiben() {
  starteLauf('testTermineSchreiben');
  try {
    const partner = 'KOLLSTAR (OÖ)';
    const sheet = openPartnerSheet(partner);
    const dealIdCol = findColumnIndexByHeader(sheet, COL.dealId);
    const row = findRowByDealId(sheet, dealIdCol, 7253);
    if (!row) {
      Logger.log('Zeile für Deal 7253 nicht gefunden -- erst testCreateSheetRow() ausführen.');
      return;
    }
    [COL.dcTermin, COL.acTermin, COL.ibTermin].forEach(header => {
      const spalte = findColumnIndexByHeader(sheet, header);
      if (!spalte) {
        Logger.log(`Spalte "${header}" fehlt im Sheet -- übersprungen.`);
        return;
      }
      const fieldConfig = SYNC_FIELD_CONFIG.find(f => f.sheetColumnHeader === header);
      handleSingleCellEdit(sheet, row, spalte, dealIdCol, fieldConfig, {});
    });
    Logger.log('Fertig -- Ergebnis siehe LOG_Sheet-Sync (V2) bzw. Notiz an den Zellen.');
  } finally {
    flushLog();
  }
}
