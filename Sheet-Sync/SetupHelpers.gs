// ===== EINMALIGE SETUP-FUNKTIONEN =====
// Im Apps-Script-Editor oben im Dropdown auswählen und ausführen (▷-Button).

/**
 * LIEST NUR: zeigt die echten Tab-Namen der 5 neuen Montageplanung-RP-Sheets -- zweimal falsch
 * geraten ("Tabellenblatt1", dann "Sheet1"), deshalb hier direkt nachschauen statt nochmal zu raten.
 */
function zeigeTabNamenNeuerSheets() {
  const ids = {
    'Berger Elektrotechnik': '1agWue-J07hZpo-nRnyYzIxe1ow_QD9vaP61dyiT05G8',
    'Greensky': '1pRHk5ITCUhMywUuyAn738hAcJ3oK9ZSxwC4EJ92yXnc',
    'Kreuzeder': '19-TnTIXawgYrDGwMEJauNFRZZaxmzYNtnnIsY1M3MF4',
    'Tiroler Partner': '10jV4UC_w23l2hyhcDVwG5YyCy95vFtOr_stFBpLotXg',
    'Vorarlberg Partner': '1r7XorkWkmqOYc0aa_hcfncEOFaGOvxX6eLWYpOMQeRU'
  };
  Object.entries(ids).forEach(([label, id]) => {
    const namen = SpreadsheetApp.openById(id).getSheets().map(s => s.getName());
    Logger.log(`${label}: ${namen.join(', ')}`);
  });
}

/**
 * EINMALIG: fügt die Spalte "Erstellungsdatum" (falls noch nicht vorhanden) ganz rechts in jedem
 * konfigurierten Partner-Sheet hinzu -- die 6 neu angelegten Sheets (KOLLSTAR-Test + 5 echte
 * Montageplanung-RP-Sheets) haben sie noch nicht, weil sie vor dieser Entscheidung erstellt wurden.
 * Nur Header, kein Rückwirkend-Befüllen bestehender Zeilen (deren Erstelldatum kennen wir nicht
 * mehr genau) -- ab jetzt schreibt createSheetRowForDeal() das bei jeder NEUEN Zeile automatisch.
 */
function fuegeErstellungsdatumSpalteHinzu() {
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
    if (findColumnIndexByHeader(sheet, COL.erstellungsdatum)) {
      Logger.log(`"${partner}": Spalte "${COL.erstellungsdatum}" existiert schon.`);
      return;
    }
    const neueSpalte = sheet.getLastColumn() + 1;
    sheet.getRange(1, neueSpalte).setValue(COL.erstellungsdatum);
    Logger.log(`"${partner}": Spalte "${COL.erstellungsdatum}" als Spalte ${neueSpalte} angelegt.`);
  });
}

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
  // 5:00 -- nach den nächtlichen Läufen der Webhook-Projekte (2:00/3:00), vor Arbeitsbeginn.
  // Siehe WebhookHealth.gs; separat installierbar über installWebhookHealthTrigger().
  ScriptApp.newTrigger('pruefeWebhookErreichbarkeit').timeBased().everyDays(1).atHour(5).create();

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

/**
 * Aktiviert NUR den 15-Minuten-Timer für syncNeueZeilen() (automatische Zeilen-Erstellung für neu
 * gewonnene Deals) -- rührt onEdit-Trigger und syncPipedriveToSheetFields NICHT an, anders als
 * installTriggers(). ERST ausführen, wenn für ALLE Partner in PARTNER_SHEET_CONFIG der
 * Namensabgleich (Montageplanung-Namensabgleich-Projekt) durchgelaufen ist: syncNeueZeilen prüft
 * pro Deal nur "gibt's schon eine Zeile mit dieser Deal-ID" (findRowByDealId) -- eine alte,
 * händisch reinkopierte Zeile OHNE Deal-ID wird dabei nicht erkannt, es entstünde eine zweite,
 * doppelte Zeile für denselben Kunden. Idempotent: entfernt vorher einen evtl. bestehenden eigenen
 * Trigger für dieselbe Funktion.
 */
function installSyncNeueZeilenTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncNeueZeilen') {
      ScriptApp.deleteTrigger(t);
      Logger.log('Bestehenden syncNeueZeilen-Trigger entfernt (Neuanlage folgt).');
    }
  });
  ScriptApp.newTrigger('syncNeueZeilen').timeBased().everyMinutes(15).create();
  Logger.log('syncNeueZeilen läuft jetzt alle 15 Minuten. onEdit-Trigger und syncPipedriveToSheetFields sind davon NICHT betroffen.');
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
 * Canary-Rollout (2026-08-31, Valentins Vorgabe): installTriggers() ist alles-oder-nichts --
 * würde auf einen Schlag den onEdit-Trigger für ALLE sechs Partner-Sheets aktivieren UND die
 * globalen 15-Minuten-/Tages-Timer, die company-weit über ALLE gewonnenen Deals laufen
 * (syncNeueZeilen würde z.B. sofort versuchen, für jeden Partner mit gesetztem Kundenordner-Link
 * neue Sheet-Zeilen anzulegen -- bei Kreuzeder/Berger/Greensky/Tirol/Vorarlberg, die noch nicht
 * befüllt/bereit sind, unkontrolliert). Aktuell ist nur ALE so weit (Deal-IDs stehen, siehe
 * project_montage_sheets_migration). Diese Funktion installiert NUR den onEdit-Trigger
 * (Sheet->Pipedrive) für EINEN Partner, rührt die globalen Timer NICHT an -- die bleiben aus,
 * bis alle sechs Partner bereit sind und bewusst installTriggers() für alle zusammen läuft.
 * Idempotent: entfernt vorher nur einen evtl. schon bestehenden eigenen onEdit-Trigger für GENAU
 * dieses Sheet (nicht die anderer Partner).
 */
// Liste statt einzelnem Wert (FIX 31.08.2026): Valentin will Partner nach und nach dazunehmen
// (ALE zuerst, jetzt Kreuzeder), nicht immer nur einen ersetzen. Neuen Partner einfach ergänzen,
// sobald der so weit ist (Deal-IDs stehen, siehe project_montage_sheets_migration) -- bestehende
// Partner in der Liste bleiben unangetastet, siehe Idempotenz-Kommentar unten.
const CANARY_PARTNERS = ['ALE-Engineering (NÖ, Wien, BGL)', 'Kreuzeder (OÖ, SBG)'];

function installOnEditTriggerFuerEinenPartner() {
  CANARY_PARTNERS.forEach(partner => {
    const config = PARTNER_SHEET_CONFIG[partner];
    if (!config || config.sheetId.startsWith('TODO_')) {
      Logger.log('WARNUNG: Kein gültiges Sheet für "%s" in PARTNER_SHEET_CONFIG -- übersprungen.', partner);
      return;
    }

    ScriptApp.getProjectTriggers().forEach(t => {
      if (t.getHandlerFunction() === 'handleSheetEdit' && t.getTriggerSourceId && t.getTriggerSourceId() === config.sheetId) {
        ScriptApp.deleteTrigger(t);
        Logger.log('Bestehenden onEdit-Trigger für "%s" entfernt (Neuanlage folgt).', partner);
      }
    });

    ScriptApp.newTrigger('handleSheetEdit').forSpreadsheet(config.sheetId).onEdit().create();
    Logger.log('onEdit-Trigger für "%s" (Sheet %s) eingerichtet. Globale 15-Min-/Tages-Timer sind weiterhin AUS -- betrifft nur Sheet->Pipedrive-Edits in diesem Sheet.',
      partner, config.sheetId);
  });
}

/**
 * Canary-Test für die Gegenrichtung (Pipedrive->Sheet), OHNE den globalen 15-Minuten-Timer
 * einzuschalten (siehe installOnEditTriggerFuerEinenPartner() oben für die Begründung -- der
 * globale Timer läuft über alle sechs Partner, nur ALE ist bereit). Gleiche Kernlogik wie
 * syncPipedriveToSheetFields() in FieldSync.gs, aber hart auf CANARY_PARTNER eingeschränkt statt
 * über PARTNER_SHEET_CONFIG zu iterieren -- manuell im Editor auslösen (▷-Button), kein Trigger.
 */
function testSyncPipedriveToSheetFuerEinenPartner() {
  starteLauf('testSyncPipedriveToSheetFuerEinenPartner');
  const summary = { geschrieben: 0, dryRun: 0 };
  let partnerVerarbeitet = 0;

  const relevanteFelder = SYNC_FIELD_CONFIG.filter(f => {
    if (f.direction !== 'pipedrive_to_sheet' && f.direction !== 'bidirektional') return false;
    if (f.combineFrom) return true;
    return !f.pipedriveFieldKey.startsWith('TODO_');
  });
  if (relevanteFelder.length === 0) {
    Logger.log('Keine Felder mit Richtung "pipedrive_to_sheet"/"bidirektional" konfiguriert -- nichts zu tun.');
    logLaufEnde('KETTE_BLOCKIERT', { grund: 'keine pipedrive_to_sheet-Felder konfiguriert' });
    flushLog();
    return;
  }

  const dealMap = {};
  let cursor = null;
  do {
    const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/deals?status=won&limit=100&sort_by=id&sort_direction=asc`
      + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const response = callPipedriveWithRetryRaw(url);
    (response.data || []).forEach(d => { dealMap[d.id] = d; });
    cursor = response.additional_data?.next_cursor || null;
  } while (cursor);

  try {
    CANARY_PARTNERS.forEach(partner => {
      let sheet;
      try {
        sheet = openPartnerSheet(partner);
      } catch (err) {
        Logger.log('Übersprungen: "%s" -- %s', partner, err.message);
        return;
      }
      const dealIdCol = findColumnIndexByHeader(sheet, COL.dealId);
      if (!dealIdCol) { Logger.log('Keine Deal-ID-Spalte im Sheet "%s" gefunden.', partner); return; }

      const feldSpalten = relevanteFelder
        .map(fieldConfig => ({ fieldConfig, col: findColumnIndexByHeader(sheet, fieldConfig.sheetColumnHeader) }))
        .filter(x => x.col);
      if (feldSpalten.length === 0) { Logger.log('Keine der konfigurierten Spalten im Sheet "%s" gefunden.', partner); return; }

      const anzahlZeilen = Math.max(sheet.getLastRow() - 1, 0);
      if (anzahlZeilen === 0) { Logger.log('Sheet "%s" hat keine Datenzeilen.', partner); return; }
      partnerVerarbeitet++;

      const werte = sheet.getRange(2, 1, anzahlZeilen, sheet.getLastColumn()).getValues();

      for (let i = 0; i < werte.length; i++) {
        const dealId = werte[i][dealIdCol - 1];
        if (!dealId) continue;
        const deal = dealMap[dealId];
        if (!deal) continue;
        const row = i + 2;
        const cf = deal.custom_fields || {};

        feldSpalten.forEach(({ fieldConfig, col }) => {
          const pipedriveWert = fieldConfig.combineFrom
            ? fieldConfig.combineFrom.map(key => cf[key]).filter(Boolean).join('\n---\n')
            : cf[fieldConfig.pipedriveFieldKey];
          if (pipedriveWert === undefined) return;
          if (fieldConfig.combineFrom && pipedriveWert === '') return;
          const aktuellerWert = werte[i][col - 1];
          if (vergleichswert(fieldConfig, pipedriveWert) === vergleichswert(fieldConfig, aktuellerWert)) return;

          if (DRY_RUN) {
            logRow('pipedrive→sheet (canary)', dealId, partner, fieldConfig.label, 'DRY-RUN', `würde "${zeigeWert(pipedriveWert)}" ins Sheet schreiben`);
            summary.dryRun++;
            return;
          }

          const zelle = sheet.getRange(row, col);
          const wertZumSchreiben = fieldConfig.istDatumsfeld
            ? (alsDatum(pipedriveWert) || pipedriveWert)
            : pipedriveWert;
          zelle.setValue(wertZumSchreiben);
          zelle.setNote(`↻ Von RP geändert am ${notizZeitstempel()}\n`
                      + `vorher: ${zeigeWert(aktuellerWert)}\n`
                      + `neu:    ${zeigeWert(pipedriveWert)}`);
          zelle.setBackground('#fff2cc');
          summary.geschrieben++;
          logRow('pipedrive→sheet (canary)', dealId, partner, fieldConfig.label, 'geschrieben',
                 `${zeigeWert(aktuellerWert)} -> ${zeigeWert(pipedriveWert)}`);
        });
      }
    });
  } finally {
    logLaufEnde(summary.geschrieben === 0 && summary.dryRun === 0 ? 'KETTE_BLOCKIERT' : 'OK', Object.assign({ partnerVerarbeitet }, summary));
    flushLog();
  }
}

/**
 * Setzt Datumsformat (nicht nur Wert -- auch das Zellformat) auf die vier istDatumsfeld-Spalten
 * (DC-/AC-/IB-Termin, Materiallieferung), inkl. Puffer für künftige Zeilen. Reine Formatierung,
 * kein Pipedrive-Zugriff -- deshalb FIX 31.08.2026 (Valentins Vorgabe) bewusst für ALLE Partner in
 * PARTNER_SHEET_CONFIG statt nur CANARY_PARTNERS: anders als die Trigger-Funktionen betrifft das
 * keine Live-Daten, ist also auch für noch nicht befüllte Partner-Sheets unbedenklich. Wichtig
 * für: (a) Partner tippt "15.05.2026" ein -- ohne Datumsformat könnte die Zelle das als Text
 * stehen lassen statt zu erkennen, (b) die Sortierung/der Datumsvergleich in vergleichswert()
 * (Config.gs) setzt ein echtes Date-Objekt in der Zelle voraus, kein Text, der zufällig wie ein
 * Datum aussieht.
 */
function richteDatumsformateEin() {
  const datumsFelder = SYNC_FIELD_CONFIG.filter(f => f.istDatumsfeld);

  Object.keys(PARTNER_SHEET_CONFIG).forEach(partner => {
    const config = PARTNER_SHEET_CONFIG[partner];
    if (!config || config.sheetId.startsWith('TODO_')) {
      Logger.log('WARNUNG: Kein gültiges Sheet für "%s" -- übersprungen.', partner);
      return;
    }
    const sheet = openPartnerSheet(partner);
    const letzteZeileMitPuffer = Math.max(sheet.getLastRow(), 2) + 200;
    let gesetzt = 0;
    datumsFelder.forEach(fieldConfig => {
      const col = findColumnIndexByHeader(sheet, fieldConfig.sheetColumnHeader);
      if (!col) {
        Logger.log('"%s": Spalte "%s" nicht gefunden -- übersprungen.', partner, fieldConfig.sheetColumnHeader);
        return;
      }
      const bereich = sheet.getRange(2, col, letzteZeileMitPuffer - 1, 1);
      bereich.setNumberFormat('dd.mm.yyyy');
      // setNumberFormat allein ändert nur die ANZEIGE -- bei einer leeren Zelle erscheint beim
      // Anklicken trotzdem kein Kalender-Picker (Valentin hat das getestet, 2026-08-31). Der Picker
      // kommt erst über eine Datenüberprüfung vom Typ "Datum".
      const regel = SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(true).build();
      bereich.setDataValidation(regel);
      gesetzt++;
    });
    Logger.log('"%s": Datumsformat + Datenüberprüfung gesetzt für %s von %s Spalten, Zeile 2 bis %s.',
      partner, gesetzt, datumsFelder.length, letzteZeileMitPuffer);
  });
}

/**
 * Checkbox-Format für die drei echten Checkbox-Felder (verifiziert aus SYNC_FIELD_CONFIG, nicht
 * geraten): Netzanmeldung eingereicht (checkbox_to_option), IB erledigt + Fertigmeldung
 * (checkbox_to_date). DC-/AC-/IB-Termin sind KEINE Checkboxen, siehe istDatumsfeld oben.
 * FIX 31.08.2026: Duplikat von richteCheckboxenEin() im Montageplanung-Namensabgleich-Projekt --
 * dort mit fest hartcodierten Spaltennummern (COL.NETZANMELDUNG=3 etc.), hier stattdessen über
 * findColumnIndexByHeader() wie der Rest von Sheet-Sync, damit man für Checkboxen+Datum nicht
 * zwischen zwei Apps-Script-Projekten wechseln muss. Für ALLE Partner, reine Formatierung.
 */
function richteCheckboxenEin() {
  const checkboxFelder = SYNC_FIELD_CONFIG.filter(f =>
    f.valueType === 'checkbox_to_date' || f.valueType === 'checkbox_to_option');

  Object.keys(PARTNER_SHEET_CONFIG).forEach(partner => {
    const config = PARTNER_SHEET_CONFIG[partner];
    if (!config || config.sheetId.startsWith('TODO_')) {
      Logger.log('WARNUNG: Kein gültiges Sheet für "%s" -- übersprungen.', partner);
      return;
    }
    const sheet = openPartnerSheet(partner);
    const letzteZeileMitPuffer = Math.max(sheet.getLastRow(), 2) + 200;
    let gesetzt = 0;
    checkboxFelder.forEach(fieldConfig => {
      const col = findColumnIndexByHeader(sheet, fieldConfig.sheetColumnHeader);
      if (!col) {
        Logger.log('"%s": Spalte "%s" nicht gefunden -- übersprungen.', partner, fieldConfig.sheetColumnHeader);
        return;
      }
      sheet.getRange(2, col, letzteZeileMitPuffer - 1, 1).insertCheckboxes();
      gesetzt++;
    });
    Logger.log('"%s": Checkboxen gesetzt für %s von %s Feldern, Zeile 2 bis %s.',
      partner, gesetzt, checkboxFelder.length, letzteZeileMitPuffer);
  });
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
      { header: COL.speicher, label: 'Speicher (kWh)' },
      { header: COL.erstellungsdatum, label: 'Erstellungsdatum' }
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

// FIX 31.08.2026: generalisiert -- statt einer fest verdrahteten Test-Deal-ID (7455, Michael
// Siedler) jetzt eine Liste. Valentin will gezielt einzelne neue Deals (z.B. 2 frisch gewonnene)
// reinziehen, ohne den globalen syncNeueZeilen() company-weit laufen zu lassen.
// createSheetRowForDeal() akzeptiert schon eine Deal-ID direkt (lädt den Deal nach), kein Umbau
// dort nötig. DRY_RUN gilt hier genauso wie überall -- erst prüfen, dann DRY_RUN=false.
const NEUE_DEALS_ZUM_ANLEGEN = [7319]; // Deal-IDs hier eintragen, die eine Sheet-Zeile bekommen sollen

/** Für Einzeltests/gezieltes Nachziehen einzelner Deals: Zeilen-Erstellung ohne den globalen Timer. */
function testCreateSheetRow() {
  starteLauf('testCreateSheetRow');
  try {
    NEUE_DEALS_ZUM_ANLEGEN.forEach(dealId => {
      // Diagnose-Zeile VOR createSheetRowForDeal (1.9.2026, Hubert-Hochmuth-Fall): zeigt status +
      // DOKU_STATUS_FIELD_KEY direkt vom Einzelabruf -- erklärt, warum ein Deal in syncNeueZeilen()
      // (die über die won-Liste geht) evtl. gar nicht erst auftaucht.
      const deal = fetchPipedrive(`deals/${dealId}`);
      const cf = deal.custom_fields || {};
      Logger.log('%s: status=%s, DOKU_STATUS_FIELD_KEY=%s', dealId, deal.status, cf[DOKU_STATUS_FIELD_KEY]);
      // createSheetRowForDeal() liefert seit 2.9.2026 { code, text } statt eines Strings --
      // .text ist die Klartextzeile, .code der stabile Schlüssel für die Zählung in syncNeueZeilen().
      const result = createSheetRowForDeal(deal);
      Logger.log('%s: [%s] %s', dealId, result.code, result.text);
    });
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
