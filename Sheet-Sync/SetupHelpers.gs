// ===== EINMALIGE SETUP-FUNKTIONEN =====
// Im Apps-Script-Editor oben im Dropdown auswählen und ausführen (▷-Button).

/**
 * Richtet alle Trigger ein: zeitgesteuert für neue Zeilen + Pipedrive->Sheet-Sync (alle 15 Min),
 * täglich für die verzögerte Ordner-Verschiebung nach Fertigmeldung (siehe OrdnerAbschluss.gs),
 * plus installierbare onEdit-Trigger für jedes konfigurierte Partner-Sheet (Sheet->Pipedrive).
 * Idempotent: entfernt vorher alle eigenen Trigger, damit mehrfaches Ausführen nicht zu doppelten
 * Läufen führt.
 */
function installTriggers() {
  removeAllTriggers();

  ScriptApp.newTrigger('syncNeueZeilen').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('syncPipedriveToSheetFields').timeBased().everyMinutes(15).create();
  // Täglich statt alle 15 Min: die Wartefrist (ORDNER_VERSCHIEBEN_WARTETAGE) macht häufigere
  // Läufe unnötig, und jeder Lauf liest pro fertiggemeldetem Deal den Kundenordner in Drive.
  ScriptApp.newTrigger('verschiebeAbgeschlosseneOrdner').timeBased().everyDays(1).atHour(6).create();
  // Ebenfalls täglich: Netzanmeldung-/Kundentermin-Eskalation (siehe NetzanmeldungEskalation.gs).
  ScriptApp.newTrigger('ueberwacheNetzanmeldungUndKundentermin').timeBased().everyDays(1).atHour(6).create();

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
 * Debug: listet alle Deal-Custom-Fields (field_name + field_code). Bei Einfachauswahl-/
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
  const result = createSheetRowForDeal(7253); // Test-Deal-ID, ggf. anpassen
  Logger.log(result);
}

/**
 * Testet Sheet->Pipedrive OHNE onEdit-Trigger einzurichten: liest den aktuell im Sheet stehenden
 * ZPN-Wert bei Deal 7253 (KOLLSTAR-Sheet) und schreibt ihn nach Pipedrive, genau wie es der
 * Trigger später automatisch tun würde. Wert also vorher manuell in die Zelle eintragen, dann
 * diese Funktion ausführen. Ergebnis im Log-Sheet UND als Notiz an der Zelle bei Fehlern.
 */
function testZpnSchreiben() {
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
  Logger.log('Fertig -- Ergebnis siehe LOG_Sheet-Sync bzw. Notiz an der Zelle.');
}

/**
 * Testet "Fertigmeldung" OHNE onEdit-Trigger -- gleiches Muster wie testZpnSchreiben(). Checkbox
 * bei Deal 7253 (KOLLSTAR-Sheet) vorher manuell anhaken, dann ausführen. Schreibt bei
 * DRY_RUN=false ein Datum ins Pipedrive-Feld "Fertigmeldung am".
 */
function testFertigmeldungSchreiben() {
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
  Logger.log('Fertig -- Ergebnis siehe LOG_Sheet-Sync bzw. Notiz an der Zelle.');
}

/**
 * Testet "Netzanmeldung eingereicht" OHNE onEdit-Trigger -- gleiches Muster wie
 * testZpnSchreiben(). Checkbox bei Deal 7253 (KOLLSTAR-Sheet) vorher manuell anhaken, dann
 * ausführen. Schreibt bei DRY_RUN=false Netzstatus="eingereicht".
 */
function testNetzanmeldungSchreiben() {
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
  Logger.log('Fertig -- Ergebnis siehe LOG_Sheet-Sync bzw. Notiz an der Zelle.');
}

/**
 * Testet "IB erledigt" OHNE onEdit-Trigger -- gleiches Muster wie testZpnSchreiben(). Checkbox
 * bei Deal 7253 (KOLLSTAR-Sheet) vorher manuell anhaken, dann ausführen. Schreibt bei
 * DRY_RUN=false "IB erfolgt" ins Pipedrive-Feld "Fortschritt".
 */
function testIbErledigtSchreiben() {
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
  Logger.log('Fertig -- Ergebnis siehe LOG_Sheet-Sync bzw. Notiz an der Zelle.');
}
