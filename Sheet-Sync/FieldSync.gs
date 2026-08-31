// ===== FELD-SYNC ENGINE =====
// Richtung pro Feld kommt aus SYNC_FIELD_CONFIG (Config.gs). Einfach dort umstellen/ergänzen,
// keine Logik hier anfassen müssen.

/**
 * Reagiert auf Zell-Änderungen in einem Partner-Sheet (Sheet -> Pipedrive).
 * WICHTIG: das ist KEIN einfacher onEdit()-Trigger (der feuert nur im Container-Script),
 * sondern muss als installierbarer Trigger pro Partner-Sheet eingerichtet werden
 * (siehe installTriggers() in SetupHelpers.gs).
 *
 * Behandelt auch Mehrfach-Zell-Edits (z.B. eine Spalte mit 10 ZPNs reinkopiert) -- e.range kann
 * mehrere Zeilen/Spalten umfassen, nicht nur eine einzelne Zelle.
 */
/**
 * FIX 31.08.2026 (Valentins Vorgabe): schreibt NICHT mehr sofort, sondern reiht die Änderung nur
 * in eine Warteschlange ein -- verarbeitePendingCellEdits() (unten) schreibt sie erst, wenn die
 * Zelle SCHREIB_VERZOEGERUNG_SEK lang nicht mehr angefasst wurde. Grund: bei schnellem
 * Nachbessern (Partner tippt Datum, korrigiert es Sekunden später nochmal) hat jede einzelne
 * Änderung sofort einen PATCH-Call + eine "✓ übermittelt"-Notiz ausgelöst -- nervig und unnötige
 * Pipedrive-Writes (die wiederum Automations auslösen können). Mit der Verzögerung zählt nur der
 * letzte Stand.
 */
function handleSheetEdit(e) {
  starteLauf('handleSheetEdit');
  try {
    const sheet = e.range.getSheet();
    const firstRow = e.range.getRow();
    const lastRow = e.range.getLastRow();
    const firstCol = e.range.getColumn();
    const lastCol = e.range.getLastColumn();

    const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const dealIdCol = findColumnIndexByHeader(sheet, COL.dealId);
    const spreadsheetId = sheet.getParent().getId();
    const gid = sheet.getSheetId();

    // FIX 31.08.2026: fehlt die Deal-ID-Spalte, wurde vorher nur "nicht eingereiht" -- mit dem
    // Kommentar, handleSingleCellEdit melde den Fehler beim Verarbeiten. Tut es aber nicht: ohne
    // Eintrag in der Warteschlange wird handleSingleCellEdit nie erreicht, der Fehler landete also
    // NIRGENDS. Ein Sheet mit umbenannter/fehlender Deal-ID-Spalte hat damit jede Zell-Aenderung
    // lautlos verworfen. Deshalb hier melden, wo es auffaellt.
    if (!dealIdCol) {
      logRow('sheet→pipedrive', '', sheet.getName(), '(Struktur)', 'FEHLER',
        'Spalte "' + COL.dealId + '" im Tab "' + sheet.getName() + '" nicht gefunden -- Zell-Aenderungen koennen nicht zugeordnet werden und werden verworfen. Kopfzeile pruefen.');
      return;
    }

    // Ein Lesevorgang fuer den ganzen bearbeiteten Bereich statt einer getValue()-Abfrage pro
    // Zelle -- beim Einfuegen einer Spalte mit 30 Werten waren das 30 Roundtrips ins Sheet.
    const bearbeiteteWerte = e.range.getValues();

    const pending = ladePendingCellEdits();
    let neueEintraege = 0;

    for (let col = firstCol; col <= lastCol; col++) {
      const header = String(headerRow[col - 1]).trim();
      const fieldConfig = SYNC_FIELD_CONFIG.find(
        f => (f.direction === 'sheet_to_pipedrive' || f.direction === 'bidirektional') && f.sheetColumnHeader === header
      );
      if (!fieldConfig) continue; // diese Spalte ist nicht für Sync konfiguriert

      for (let row = Math.max(firstRow, 2); row <= lastRow; row++) {
        const rohWert = bearbeiteteWerte[row - firstRow][col - firstCol];
        // Wert-Felder bewusst schlank: spreadsheetId/gid/row/col stehen schon im Schluessel.
        pending[pendingKey(spreadsheetId, gid, row, col)] = {
          fieldLabel: fieldConfig.label,
          zeitpunkt: Date.now(),
          wert: serialisiereZellwert(rohWert)
        };
        neueEintraege++;
      }
    }

    if (neueEintraege > 0) {
      // Obergrenze: lieber sofort schreiben als die Warteschlange (und damit den 9-KB-Wert)
      // ueberlaufen lassen. Betrifft nur sehr grosse Einfuege-Aktionen.
      const zuVoll = Object.keys(pending).length > PENDING_MAX_EINTRAEGE;
      const gespeichert = !zuVoll && speicherePendingCellEdits(pending);

      if (gespeichert) {
        planeVerarbeitungPendingCellEdits();
        logRow('sheet→pipedrive', '', sheet.getName(), '(Warteschlange)', 'WARTET',
          neueEintraege + ' Zell-Änderung(en) eingereiht, wird in ' + SCHREIB_VERZOEGERUNG_SEK + 's verarbeitet, falls bis dahin nicht nochmal geändert');
      } else {
        // Konnte nicht eingereiht werden (zu viele Eintraege oder Property-Limit). Die Aenderung
        // darf NICHT verloren gehen -- deshalb sofort verarbeiten, ohne Verzoegerung.
        logRow('sheet→pipedrive', '', sheet.getName(), '(Warteschlange)', 'WARNUNG',
          'Warteschlange voll (' + Object.keys(pending).length + ' Eintraege) oder nicht speicherbar -- diese ' +
          neueEintraege + ' Aenderung(en) werden SOFORT geschrieben, ohne die ' + SCHREIB_VERZOEGERUNG_SEK + 's-Verzoegerung.');
        verarbeiteSofort(sheet, dealIdCol, headerRow, firstRow, lastRow, firstCol, lastCol, bearbeiteteWerte);
      }
    }
  } finally {
    flushLog();
  }
}

/**
 * Zeitgesteuert (einmaliger Trigger, sich selbst nachplanend): schreibt alle Warteschlangen-
 * Einträge, die seit mindestens SCHREIB_VERZOEGERUNG_SEK nicht mehr überschrieben wurden. Frischere
 * Einträge bleiben liegen, dafür wird am Ende erneut ein Trigger geplant (siehe
 * planeVerarbeitungPendingCellEdits() -- idempotent, kein Trigger-Aufbau bei Dauerbetrieb).
 */
function verarbeitePendingCellEdits() {
  starteLauf('verarbeitePendingCellEdits');
  try {
    markiereVerarbeitungsTriggerAlsGefeuert(); // Planung freigeben, siehe planeVerarbeitungPendingCellEdits()
    const pending = ladePendingCellEdits();
    const jetzt = Date.now();
    const nochOffen = {};
    const dealCacheProSpreadsheet = {};
    let verarbeitet = 0;

    Object.keys(pending).forEach(key => {
      const eintrag = pending[key];
      if (jetzt - eintrag.zeitpunkt < SCHREIB_VERZOEGERUNG_SEK * 1000) {
        nochOffen[key] = eintrag;
        return;
      }

      try {
        const ort = pendingKeyTeile(key);
        const spreadsheet = SpreadsheetApp.openById(ort.spreadsheetId);
        const sheet = spreadsheet.getSheets().find(s => s.getSheetId() === ort.gid);
        if (!sheet) throw new Error('Tab (gid ' + ort.gid + ') nicht mehr gefunden.');

        const dealIdCol = findColumnIndexByHeader(sheet, COL.dealId);
        if (!dealIdCol) throw new Error('Spalte "' + COL.dealId + '" nicht gefunden -- Kopfzeile geaendert?');
        const fieldConfig = SYNC_FIELD_CONFIG.find(f => f.label === eintrag.fieldLabel);
        if (!fieldConfig) throw new Error('Feld "' + eintrag.fieldLabel + '" nicht mehr in SYNC_FIELD_CONFIG gefunden.');

        if (!dealCacheProSpreadsheet[ort.spreadsheetId]) dealCacheProSpreadsheet[ort.spreadsheetId] = {};
        const rohWert = deserialisiereZellwert(eintrag.wert);

        // FIX 31.08.2026: pruefen, ob die Zelle inzwischen von jemand ANDEREM geaendert wurde.
        // Ein erneuter Edit durch den Partner ueberschreibt den Warteschlangen-Eintrag (gleicher
        // Schluessel), stimmt also weiter ueberein. Ein Unterschied bedeutet deshalb: die Zelle
        // wurde ohne onEdit-Ereignis geaendert -- und das ist praktisch immer der
        // Pipedrive→Sheet-Lauf, denn installierbare onEdit-Trigger feuern NICHT bei Aenderungen
        // durch das Script selbst. Wuerden wir den alten Wert trotzdem schreiben, machten wir den
        // frischeren Pipedrive-Stand rueckgaengig. Die Verzoegerung hat dieses Fenster von
        // ~0 auf SCHREIB_VERZOEGERUNG_SEK Sekunden vergroessert.
        const aktuell = sheet.getRange(ort.row, ort.col).getValue();
        if (vergleichswert(fieldConfig, aktuell) !== vergleichswert(fieldConfig, rohWert)) {
          logRow('sheet→pipedrive', '', sheet.getName(), eintrag.fieldLabel, 'ÜBERSPRUNGEN',
            'Zeile ' + ort.row + ': Zelle wurde nach dem Einreihen anderweitig geaendert (jetzt "' +
            aktuell + '", eingereiht war "' + rohWert + '") -- nicht ueberschrieben, der neuere Wert gewinnt.');
          return;
        }

        handleSingleCellEdit(sheet, ort.row, ort.col, dealIdCol, fieldConfig,
          dealCacheProSpreadsheet[ort.spreadsheetId], rohWert);
        verarbeitet++;
      } catch (err) {
        Logger.log('FEHLER beim Verarbeiten des Warteschlangen-Eintrags %s: %s', key, err.message);
        logRow('sheet→pipedrive', '', '', eintrag.fieldLabel, 'FEHLER',
          'Warteschlange, Zeile ' + pendingKeyTeile(key).row + ': ' + err.message);
      }
    });

    speicherePendingCellEdits(nochOffen);
    if (Object.keys(nochOffen).length > 0) {
      planeVerarbeitungPendingCellEdits();
    }
    Logger.log('%s Warteschlangen-Eintrag/Einträge verarbeitet, %s noch zu frisch (bleiben liegen).',
      verarbeitet, Object.keys(nochOffen).length);
  } finally {
    flushLog();
  }
}

// rohWertUeberschreiben: optional -- wenn gesetzt (auch null/false/''), wird DIESER Wert statt
// cell.getValue() verwendet. Für den verzögerten Schreib-Pfad (verarbeitePendingCellEdits()),
// wo zwischen dem eigentlichen Edit und der Verarbeitung Zeit vergangen ist und die Zelle sich
// zwischenzeitlich nochmal geändert haben könnte -- der gespeicherte Wert vom Zeitpunkt der
// Warteschlangen-Eintragung soll geschrieben werden, nicht was gerade zufällig in der Zelle steht.
/**
 * Notausgang, wenn die Warteschlange nicht aufnahmefaehig ist (siehe handleSheetEdit): schreibt die
 * gerade bearbeiteten Zellen direkt, ohne Verzoegerung. Lieber ohne Debounce schreiben als die
 * Aenderung des Partners verlieren.
 */
function verarbeiteSofort(sheet, dealIdCol, headerRow, firstRow, lastRow, firstCol, lastCol, werte) {
  const dealCache = {};
  for (let col = firstCol; col <= lastCol; col++) {
    const header = String(headerRow[col - 1]).trim();
    const fieldConfig = SYNC_FIELD_CONFIG.find(
      f => (f.direction === 'sheet_to_pipedrive' || f.direction === 'bidirektional') && f.sheetColumnHeader === header
    );
    if (!fieldConfig) continue;
    for (let row = Math.max(firstRow, 2); row <= lastRow; row++) {
      try {
        handleSingleCellEdit(sheet, row, col, dealIdCol, fieldConfig, dealCache,
          werte[row - firstRow][col - firstCol]);
      } catch (err) {
        logRow('sheet→pipedrive', '', sheet.getName(), fieldConfig.label, 'FEHLER',
          'Sofort-Schreibung Zeile ' + row + ': ' + err.message);
      }
    }
  }
}

function handleSingleCellEdit(sheet, row, col, dealIdCol, fieldConfig, dealCache, rohWertUeberschreiben) {
  const cell = sheet.getRange(row, col);
  let dealId = null; // auch im catch verfügbar, damit Fehler-Logzeilen die Deal-ID haben
  try {
    if (!dealIdCol) {
      throw new Error(`Spalte "${COL.dealId}" fehlt im Sheet "${sheet.getName()}" -- Sync nicht möglich.`);
    }
    dealId = sheet.getRange(row, dealIdCol).getValue();
    if (!dealId) {
      throw new Error(`Zeile ${row} hat keine Deal-ID -- übersprungen.`);
    }

    const rohWert = rohWertUeberschreiben !== undefined ? rohWertUeberschreiben : cell.getValue();
    let neuerWert;
    if (fieldConfig.valueType === 'checkbox_to_date') {
      // Checkbox liefert true/false; Pipedrive bekommt ein DATUM (oder null), kein Boolean --
      // ein Datum beantwortet ob UND wann (wichtig für Abrechnung/Gewährleistung/Durchlaufzeit),
      // und Pipedrive hat ohnehin keinen echten Boolean-Typ (siehe IDEEN-Felder-und-Aktionen.md
      // Abschnitt 1). Haken raus = Datum wird wieder gelöscht (null), nicht auf leer stehen lassen.
      neuerWert = rohWert === true
        ? Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : null;
    } else if (fieldConfig.valueType === 'checkbox_to_option') {
      // Haken ENTFERNT: bewusst NICHT nach Pipedrive schreiben. Das Zielfeld ("Fortschritt")
      // bildet eine ganze Stufenkette ab und wird auch manuell von RP gepflegt -- ein null würde
      // nicht diese eine Meldung zurücknehmen, sondern den kompletten Stand löschen. Ein Häkchen
      // ist eine Meldung ("ist passiert"), keine Zustandsspiegelung: man nimmt sie nicht durch
      // Wegklicken zurück.
      if (rohWert !== true) {
        cell.setNote(`↩ Haken entfernt am ${notizZeitstempel()}\n`
                   + `In Pipedrive wurde NICHTS geändert. Falls das ein Versehen war, bitte RP informieren.`);
        logRow('sheet→pipedrive', dealId, sheet.getName(), fieldConfig.label, 'Haken entfernt',
               'bewusst nicht nach Pipedrive geschrieben -- Zielfeld wird auch manuell gepflegt');
        return;
      }
      // checkedOptionValue ist je nach Feld eine Options-ID (Netzstatus, echtes single-option-Feld)
      // ODER ein Text-Label (Fortschritt, field_type "autocomplete" trotz Options-Liste) -- welcher
      // Typ hier reingehört, steht direkt bei der jeweiligen SYNC_FIELD_CONFIG-Zeile in Config.gs.
      neuerWert = fieldConfig.checkedOptionValue;
    } else if (rohWert instanceof Date) {
      // Bei bidirektionalen Terminfeldern (DC-/AC-/IB-Termin) formatiert Sheets eine als Datum
      // eingegebene Zelle als echtes Date-Objekt, nicht als Text -- ungefiltert würde
      // JSON.stringify() daraus einen vollen ISO-Zeitstempel mit Uhrzeit machen (Zeitzone
      // inklusive), Pipedrive will hier aber nur ein Datum (yyyy-MM-dd).
      neuerWert = Utilities.formatDate(rohWert, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else {
      // Manche Custom-Field-Typen (z.B. "autocomplete" wie der ZPN) lehnen einen leeren String ab
      // und verlangen ausdrücklich null als "kein Wert" -- siehe ERR_SCHEMA_VALIDATION_FAILED weiter unten.
      neuerWert = rohWert === '' ? null : rohWert;
    }

    if (fieldConfig.pipedriveFieldKey.startsWith('TODO_')) {
      throw new Error('Pipedrive-Feldcode für dieses Feld noch nicht in Config.gs eingetragen.');
    }

    if (DRY_RUN) {
      logRow('sheet→pipedrive', dealId, sheet.getName(), fieldConfig.label, 'DRY-RUN', `würde "${zeigeWert(neuerWert)}" nach Pipedrive schreiben`);
      // Notiz SETZEN statt clearNote(): so sieht man beim Testen an der Zelle, dass der Trigger
      // überhaupt gefeuert hat -- und ein versehentlich eingeschalteter DRY_RUN löscht nicht
      // reihenweise echte Bestätigungs-Notizen.
      cell.setNote(`🧪 DRY-RUN (${notizZeitstempel()})\nwürde "${zeigeWert(neuerWert)}" an RP übermitteln -- noch NICHT geschrieben.`);
      return;
    }

    // Alten Pipedrive-Wert VOR dem Schreiben holen, nur für die Notiz -- so funktioniert das
    // "vorher -> nachher" unabhängig davon, ob der echte onEdit-Trigger oder ein manueller Test
    // aufruft (e.oldValue wäre nur beim echten Trigger verfügbar und auch dann nicht immer korrekt,
    // z.B. bei Einfügen/Paste). Pro Deal-ID nur einmal abrufen (dealCache), siehe handleSheetEdit().
    if (!dealCache[dealId]) dealCache[dealId] = fetchPipedrive(`deals/${dealId}`);
    const dealVorher = dealCache[dealId]; // Referenz behalten -- dealCache[dealId] wird unten genullt
    const alterWert = dealVorher.custom_fields?.[fieldConfig.pipedriveFieldKey];

    // Pipedrive steht schon genau auf dem Wert, der geschrieben werden soll -- kein erneutes PATCH,
    // keine erneute Aktivität. Ohne diese Bremse legt jeder wiederholte Trigger auf derselben Zelle
    // (zweiter Testlauf, ein irrelevanter Multi-Zell-Edit in derselben Zeile, o.ä.) bei
    // erzeugtAktivitaetBeimAnhaken-Feldern wie "IB erledigt" jedes Mal eine neue Duplikat-Aktivität
    // an -- und würde nebenbei unnötig Pipedrive-Automations erneut auslösen (API-Writes lösen
    // Automations genauso aus wie Klicks in der Oberfläche, auch wenn sich der Wert nicht ändert).
    if (neuerWert !== null && String(alterWert) === String(neuerWert)) {
      logRow('sheet→pipedrive', dealId, sheet.getName(), fieldConfig.label, 'übersprungen',
             `Wert ist bereits "${zeigeWert(alterWert)}" -- kein erneutes Schreiben/keine Duplikat-Aktivität`);
      cell.setNote(`ℹ️ Bereits übermittelt\nWert in Pipedrive ist schon "${zeigeWert(alterWert)}" -- nichts geändert.`);
      return;
    }

    // Manche Checkboxen setzen beim Anhaken ZWEI Felder in einem Rutsch (z.B. Fertigmeldung ->
    // Datum UND Netzstatus="Fertigmeldung raus") -- ein PATCH-Call statt zwei, und beide Werte
    // kommen atomar an oder keiner. Nur beim Anhaken (neuerWert !== null), nicht beim Entfernen.
    const customFieldsPayload = { [fieldConfig.pipedriveFieldKey]: neuerWert };
    if (fieldConfig.zusaetzlichesFeldBeimAnhaken && neuerWert !== null) {
      customFieldsPayload[fieldConfig.zusaetzlichesFeldBeimAnhaken.fieldKey] = fieldConfig.zusaetzlichesFeldBeimAnhaken.wert;
    }

    try {
      patchPipedrive(`deals/${dealId}`, { custom_fields: customFieldsPayload });
    } catch (patchErr) {
      // Bekannter Einzelfall: beim Schreiben direkt nach der Zell-Bearbeitung war der Wert manchmal
      // noch nicht final committed, Pipedrive antwortet dann mit ERR_SCHEMA_VALIDATION_FAILED. Ein
      // zweiter Versuch nach kurzer Pause hat das bisher immer gelöst. Der generische Retry-Wrapper
      // hilft hier nicht, weil er bei 4xx bewusst sofort abbricht.
      if (neuerWert !== null && /ERR_SCHEMA_VALIDATION_FAILED/.test(patchErr.message)) {
        Utilities.sleep(1500);
        patchPipedrive(`deals/${dealId}`, { custom_fields: customFieldsPayload });
      } else {
        throw patchErr;
      }
    }
    dealCache[dealId] = null; // Cache-Eintrag ist nach dem Schreiben veraltet -- nicht wiederverwenden
    logRow('sheet→pipedrive', dealId, sheet.getName(), fieldConfig.label, 'geschrieben', `${zeigeWert(alterWert)} -> ${zeigeWert(neuerWert)}`);
    if (fieldConfig.zusaetzlichesFeldBeimAnhaken && neuerWert !== null) {
      const zusatz = fieldConfig.zusaetzlichesFeldBeimAnhaken;
      const lesbar = NETZSTATUS_ID_TO_LABEL[zusatz.wert] || zusatz.wert;
      logRow('sheet→pipedrive', dealId, sheet.getName(), fieldConfig.label, 'Zusatzfeld geschrieben',
             `${zusatz.fieldKey} -> ${lesbar}`);
    }

    // Aktivität statt/zusätzlich zum stillen Feldwert -- der Sinn ist, dass RP es AKTIV bemerkt
    // (Aufgabenliste/Deal-Verlauf), nicht nur, dass irgendwo ein Feld einen neuen Wert hat.
    // Nur beim Anhaken (nicht beim Entfernen des Hakens), sonst würde jedes versehentliche
    // Wieder-Abwählen auch eine Aktivität erzeugen. Ein Fehler hier lässt den Feld-Schreibvorgang
    // oben unangetastet -- eigener try/catch, eigenes Logging.
    if (fieldConfig.erzeugtAktivitaetBeimAnhaken && neuerWert !== null) {
      try {
        const kundenNameCol = findColumnIndexByHeader(sheet, COL.name);
        const kundenName = kundenNameCol ? sheet.getRange(row, kundenNameCol).getValue() : `Deal ${dealId}`;
        const ownerIdRaw = dealVorher.owner_id;
        const ownerId = ownerIdRaw && typeof ownerIdRaw === 'object' ? ownerIdRaw.id : ownerIdRaw;
        erstellePipedriveAktivitaet(dealId, `${fieldConfig.label} gemeldet: ${kundenName}`, ownerId);
        logRow('aktivität', dealId, sheet.getName(), fieldConfig.label, 'Aktivität angelegt', `für ${kundenName}`);
      } catch (aktErr) {
        logRow('aktivität', dealId, sheet.getName(), fieldConfig.label, 'FEHLER', aktErr.message);
        Logger.log(`FEHLER beim Anlegen der Aktivität für Deal ${dealId}: ${aktErr.message}`);
      }
    }

    // Zwei Fälle unterscheiden: ein zurückgenommener Eintrag ist kein "✓".
    const zeitstempel = notizZeitstempel();
    cell.setNote(neuerWert === null
      ? `↩ Eintrag zurückgenommen am ${zeitstempel}\nvorher: ${zeigeWert(alterWert)} -> jetzt: (leer)`
      : `✓ An RP übermittelt am ${zeitstempel}\nvorher: ${zeigeWert(alterWert)} -> neu: ${zeigeWert(neuerWert)}`);
    cell.setBackground(null); // eine frühere Fehler-Markierung wieder aufheben
  } catch (err) {
    // An der Zelle nur eine Handlungsanweisung für den Montagepartner -- die technische Meldung
    // geht ausschließlich ins Log. Zeitstempel ist wichtig: sonst weiß er nicht, ob die Notiz
    // von heute ist oder seit drei Wochen dranhängt.
    cell.setNote(`⚠ NICHT übernommen (${notizZeitstempel()})\n`
               + `Dein Eintrag ist bei RP nicht angekommen. Bitte RP informieren.`);
    cell.setBackground('#f4c7c3'); // rot -- Notizen sieht man nur beim Hovern, Farbe beim Scrollen
    logRow('sheet→pipedrive', dealId, sheet.getName(), fieldConfig.label, 'FEHLER',
           `Zeile ${row}, Spalte ${col}: ${err.message}`);
    Logger.log(`FEHLER in handleSingleCellEdit (${sheet.getName()} Zeile ${row}): ${err.message}`);
  }
}

/**
 * Holt für alle pipedrive_to_sheet-Felder den aktuellen Pipedrive-Wert und schreibt ihn in die
 * Sheets, für alle Zeilen mit Deal-ID. Für den zeitgesteuerten Trigger gedacht.
 */
function syncPipedriveToSheetFields() {
  starteLauf('syncPipedriveToSheetFields');
  const summary = { geschrieben: 0, dryRun: 0 };
  let partnerVerarbeitet = 0;

  // combineFrom (z.B. "Sonstige Informationen" aus zwei Notizfeldern) hat statt einem einzelnen
  // pipedriveFieldKey ein Array -- deshalb hier defensiv geprüft, sonst würde startsWith() auf
  // undefined krachen.
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

  // Alle gewonnenen Deals EINMAL paginiert holen statt pro Sheet-Zeile einzeln abzurufen (N+1-Falle,
  // siehe RowCreation.gs syncNeueZeilen -- macht es schon richtig). Bei ~440 Zeilen und einem
  // 15-Minuten-Trigger wären es sonst >40.000 UrlFetch-Calls/Tag, weit über dem Gratis-Kontingent
  // (~20.000/Tag). Mit der Map sind es ~5 Calls statt 440.
  const dealMap = {};
  let cursor = null;
  do {
    const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/deals?status=won&limit=100`
      + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const response = callPipedriveWithRetryRaw(url);
    (response.data || []).forEach(d => { dealMap[d.id] = d; });
    cursor = response.additional_data?.next_cursor || null;
  } while (cursor);

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

      // Spaltenindizes EINMAL pro Sheet auflösen statt pro Zeile/Feld erneut die Kopfzeile zu lesen
      // (bei 4 Feldern x 440 Zeilen sonst >1700 zusätzliche Sheets-Calls pro Lauf).
      const feldSpalten = relevanteFelder
        .map(fieldConfig => ({ fieldConfig, col: findColumnIndexByHeader(sheet, fieldConfig.sheetColumnHeader) }))
        .filter(x => x.col);
      if (feldSpalten.length === 0) return;

      const anzahlZeilen = Math.max(sheet.getLastRow() - 1, 0);
      if (anzahlZeilen === 0) return;
      partnerVerarbeitet++;

      // LESEN bleibt gebündelt (ein getValues für alles).
      const werte = sheet.getRange(2, 1, anzahlZeilen, sheet.getLastColumn()).getValues();

      for (let i = 0; i < werte.length; i++) {
        const dealId = werte[i][dealIdCol - 1];
        if (!dealId) continue;
        const deal = dealMap[dealId];
        if (!deal) continue; // Deal aktuell nicht unter den gewonnenen -- nichts zu syncen
        const row = i + 2;
        const cf = deal.custom_fields || {};

        feldSpalten.forEach(({ fieldConfig, col }) => {
          // combineFrom: mehrere Pipedrive-Freitextfelder zu einem Sheet-Wert zusammenfassen
          // (z.B. "Sonstige Informationen" aus internen Notizen UND Kunden-Mitteilung, Valentin
          // 25.08. -- beide sollen der Montagepartner sehen, es gibt aber nur eine Sheet-Spalte).
          const pipedriveWert = fieldConfig.combineFrom
            ? fieldConfig.combineFrom.map(key => cf[key]).filter(Boolean).join('\n---\n')
            : cf[fieldConfig.pipedriveFieldKey];
          if (pipedriveWert === undefined) return;
          // combineFrom liefert bei leeren Quellfeldern '' statt undefined (Array.join auf leerem
          // Array) -- ohne diesen Check überschreibt das eine bereits befüllte Sheet-Zelle mit
          // leer, sobald die letzte Pipedrive-Quelle geleert wird. RowCreation.gs filtert '' beim
          // Zeilen-Anlegen genauso heraus.
          if (fieldConfig.combineFrom && pipedriveWert === '') return;
          const aktuellerWert = werte[i][col - 1];
          // Datumsfelder (DC-/AC-/IB-Termin, Materiallieferung) über vergleichswert() vergleichen,
          // nicht über String() direkt -- sonst schreibt jeder Lauf neu, sobald die Zelle einmal
          // ein echtes Date-Objekt enthält (String(Date) sieht nie aus wie "2026-07-14").
          if (vergleichswert(fieldConfig, pipedriveWert) === vergleichswert(fieldConfig, aktuellerWert)) return;

          if (DRY_RUN) {
            logRow('pipedrive→sheet', dealId, partner, fieldConfig.label, 'DRY-RUN', `würde "${zeigeWert(pipedriveWert)}" ins Sheet schreiben`);
            summary.dryRun++;
            return;
          }

          // SCHREIBEN gezielt pro Zelle -- NICHT den ganzen Bereich mit setValues() zurück.
          // Zwischen getValues() und setValues() liegen bei ~440 Zeilen mehrere Sekunden; ein
          // Blockschreiben würde alles überschreiben, was der Partner in dieser Zeit eingetippt
          // hat, auch in seinen eigenen Spalten. Änderungen sind pro Lauf ohnehin selten.
          const zelle = sheet.getRange(row, col);
          // Datumsfelder als echtes Date-Objekt schreiben (Sortierung/Weiterverarbeitung), nicht
          // als Roh-String aus Pipedrive -- fällt auf den Roh-String zurück, falls das Format
          // doch mal nicht "YYYY-MM-DD" ist, statt eine leere Zelle zu riskieren.
          const wertZumSchreiben = fieldConfig.istDatumsfeld
            ? (alsDatum(pipedriveWert) || pipedriveWert)
            : pipedriveWert;
          zelle.setValue(wertZumSchreiben);
          // Notiz: sonst ändert sich z.B. der DC-Termin still, und der Monteur, der schon
          // disponiert hat, merkt es bestenfalls zufällig.
          zelle.setNote(`↻ Von RP geändert am ${notizZeitstempel()}\n`
                      + `vorher: ${zeigeWert(aktuellerWert)}\n`
                      + `neu:    ${zeigeWert(pipedriveWert)}`);
          zelle.setBackground('#fff2cc'); // gelb, wird von raeumeAlteNotizen() wieder entfernt
          summary.geschrieben++;
          logRow('pipedrive→sheet', dealId, partner, fieldConfig.label, 'geschrieben',
                 `${zeigeWert(aktuellerWert)} -> ${zeigeWert(pipedriveWert)}`);
        });
      }
    });
  } finally {
    // Abschlusszeile -- bisher hatte diese Funktion als einzige gar keine. Ein Lauf, der nichts
    // getan hat, war von einem Lauf, der nicht stattfand, nicht unterscheidbar.
    const partnerGesamt = Object.keys(PARTNER_SHEET_CONFIG).length;
    const status = partnerVerarbeitet === 0 ? 'KETTE_BLOCKIERT' : 'OK';
    logLaufEnde(status, Object.assign({ partnerVerarbeitet, partnerGesamt }, summary));
    flushLog();
  }
}
