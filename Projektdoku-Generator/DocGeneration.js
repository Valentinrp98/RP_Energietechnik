// ===== KERNLOGIK =====
// Täglicher Trigger ruft generateDailyProjectDocumentation() auf. Sucht Deals mit
// Dokumentation-Status = "Doku erstellen", baut pro Deal ein Google Doc und schaltet den Status
// danach auf "Erstellt". Das Statusfeld ist gleichzeitig Trigger UND Idempotenz-Marker -- kein
// Script-Property-State nötig, kein N+1 (Listen-Endpunkte liefern custom_fields gleich mit).

/** Einstiegspunkt für den täglichen Zeit-Trigger. */
function generateDailyProjectDocumentation() {
  starteLauf('generateDailyProjectDocumentation');
  const summary = { verarbeitet: 0, uebersprungen: 0, fehler: 0, abgebrochen: 0 };
  try {
    const deals = findDealsForDokuErstellung();
    Logger.log(`[${_laufId}] ${deals.length} Deal(s) mit Status "Doku erstellen" gefunden`);

    for (const deal of deals) {
      if (Date.now() - _laufStart > MAX_LAUFZEIT_MS) {
        summary.abgebrochen = deals.length - summary.verarbeitet - summary.uebersprungen - summary.fehler;
        logRow(null, null, null, 'OK', null, null, `Laufzeit-Limit erreicht -- ${summary.abgebrochen} Deal(s) offen, werden im nächsten Lauf erledigt`);
        break;
      }
      try {
        const result = processDeal(deal);
        if (result.status === 'OK') summary.verarbeitet++;
        else if (result.status === 'SOFT_ERROR') summary.uebersprungen++;
        logRow(deal.id, deal.title, result.kunde, result.status, result.docUrl, result.completeness, result.detail);
      } catch (e) {
        summary.fehler++;
        logRow(deal.id, deal.title, null, 'HARD_ERROR', null, null, e.message);
        Logger.log(`[${_laufId}] HARD_ERROR bei Deal ${deal.id}: ${e.message}`);
      }
    }

    logRow(null, null, null, summary.fehler > 0 ? 'HARD_ERROR' : 'OK', null, null,
           `${JSON.stringify(summary)} -- ${Math.round((Date.now() - _laufStart) / 1000)}s`);
  } catch (e) {
    // Bricht z.B. findDealsForDokuErstellung() komplett ab (Pipedrive down nach 3 Retries) --
    // ohne diesen Fang würde der Lauf spurlos verschwinden, siehe finally unten.
    logRow(null, null, null, 'HARD_ERROR', null, null, `Lauf abgebrochen: ${e.message}`);
    throw e;
  } finally {
    flushLog(); // MUSS auch im Fehlerfall raus, sonst ist der ganze Lauf unsichtbar im Log-Sheet
  }
  Logger.log(`[${_laufId}] Lauf beendet: ${JSON.stringify(summary)}`);
}

/**
 * Paginiert durch alle nicht gelöschten Deals (status-Parameter bewusst weggelassen -- v2 kennt
 * kein "all_not_deleted", ohne Parameter liefert v2 laut Doku alle nicht gelöschten) und filtert
 * client-seitig auf das Status-Feld. custom_fields kommen mit der Liste mit, kein Einzelabruf nötig.
 */
function findDealsForDokuErstellung() {
  const treffer = [];
  let cursor = null;
  do {
    const path = `deals?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
    const response = fetchPipedriveRaw(path);
    const data = response.data || [];
    data.forEach(deal => {
      const status = deal.custom_fields && deal.custom_fields[DOKU_STATUS_FIELD_KEY];
      if (String(status) === String(DOKU_STATUS_OPTION_TRIGGER)) treffer.push(deal);
    });
    cursor = response.additional_data && response.additional_data.next_cursor;
  } while (cursor);
  return treffer;
}

/**
 * Verarbeitet einen Deal: Doc erzeugen, in Projektdokumentation-Unterordner ablegen, Link +
 * Status zurückschreiben. Gibt {status, docUrl, kunde, completeness, detail} zurück -- wirft NICHT
 * bei fachlichen Grenzfällen (fehlender Kundenordner etc.), das sind SOFT_ERROR, keine Exception.
 */
function processDeal(deal) {
  const cf = deal.custom_fields || {};
  const kundenordnerLink = cf[KUNDENORDNER_LINK_FIELD_KEY];
  if (!kundenordnerLink) {
    return { status: 'SOFT_ERROR', docUrl: null, kunde: deal.title, completeness: null, detail: 'Kein Kundenordner-Link am Deal -- Ordnererstellung-bei-Gewonnen muss zuerst laufen' };
  }

  const projektdokuFolder = findProjektdokuUnterordner(kundenordnerLink);
  if (!projektdokuFolder) {
    return { status: 'SOFT_ERROR', docUrl: null, kunde: deal.title, completeness: null, detail: `Unterordner "${PROJEKTDOKU_UNTERORDNER_NAME}" nicht gefunden -- entweder fehlt er im Kundenordner, oder der Kundenordner selbst ist gelöscht/für das Script-Konto nicht freigegeben` };
  }

  const person = deal.person_id ? fetchPipedrive(`persons/${deal.person_id.value || deal.person_id}`) : null;
  const kundenName = person ? person.name : deal.title;
  const completeness = checkFieldCompleteness(cf);

  // Duplikat-Schutz über den tatsächlichen Ordnerinhalt, NICHT nur über das Pipedrive-Status-Feld --
  // sonst legt jeder wiederholte testEinzelDeal()-Lauf (der ohne Status-Check direkt processDeal()
  // aufruft) ein weiteres Doc an. Deckt auch den Fall ab, dass ein früherer Lauf das Doc zwar erzeugt,
  // aber den Status-Patch danach nicht mehr geschafft hat (z.B. der Options-ID-Typfehler vom 17.08.).
  const vorhandenesDoc = findExistingDoc(projektdokuFolder, kundenName);
  if (vorhandenesDoc) {
    const docUrl = vorhandenesDoc.getUrl();
    const linkFehlt = !cf[DOKU_LINK_FIELD_KEY];
    const statusFehlt = String(cf[DOKU_STATUS_FIELD_KEY]) !== String(DOKU_STATUS_OPTION_DONE);
    if ((linkFehlt || statusFehlt) && !DRY_RUN) {
      // Ein früherer Lauf hat das Doc erzeugt, ist aber vor/beim Zurückschreiben gescheitert (siehe
      // F4/F6 im Bau-Log) -- ohne dieses Nachziehen würde der Deal für immer im SOFT_ERROR hängen,
      // weil der Duplikat-Schutz oben jeden weiteren Lauf sofort abbricht, ohne je zu schreiben.
      patchCustomFieldsVerified(deal.id, {
        [DOKU_LINK_FIELD_KEY]: docUrl,
        [DOKU_STATUS_FIELD_KEY]: DOKU_STATUS_OPTION_DONE
      });
      return { status: 'OK', docUrl, kunde: kundenName, completeness, detail: 'Doc existierte bereits -- Link/Status nachgezogen' };
    }
    return { status: 'SOFT_ERROR', docUrl, kunde: kundenName, completeness, detail: 'Doc existiert bereits im Ordner -- kein neues erzeugt (Duplikat-Schutz)' };
  }

  if (DRY_RUN) {
    return { status: 'OK', docUrl: null, kunde: kundenName, completeness, detail: 'DRY_RUN -- kein Doc erzeugt' };
  }

  const doc = buildProjectDoc(deal, person);
  const file = DriveApp.getFileById(doc.getId());
  try {
    file.moveTo(projektdokuFolder); // Shared-Drive-tauglich, anders als addFile/removeFile
  } catch (e) {
    // Ohne Aufräumen bliebe das leere Doc für immer im Drive-Root liegen und der Duplikat-Schutz
    // (der im Zielordner sucht) würde es nie finden -- jeder Folgelauf würde erneut eins anlegen.
    file.setTrashed(true);
    throw new Error(`Verschieben in "${PROJEKTDOKU_UNTERORDNER_NAME}" fehlgeschlagen (${e.message}) -- Doc wurde in den Papierkorb gelegt`);
  }

  const docUrl = doc.getUrl();
  patchCustomFieldsVerified(deal.id, {
    [DOKU_LINK_FIELD_KEY]: docUrl,
    [DOKU_STATUS_FIELD_KEY]: DOKU_STATUS_OPTION_DONE
  });

  return { status: 'OK', docUrl, kunde: kundenName, completeness, detail: 'Doc erzeugt und verlinkt' };
}

/**
 * Sucht ein bereits existierendes Doc mit dem exakten Namen, den buildProjectDoc() vergeben würde.
 * getFilesByName() liefert auch Dateien im Papierkorb zurück -- ohne den isTrashed()-Filter würde
 * ein manuell gelöschtes Doc den Duplikat-Schutz weiter blockieren, obwohl im Ordner sichtbar nichts liegt.
 */
function findExistingDoc(folder, kundenName) {
  const it = folder.getFilesByName(`Projektdokumentation - ${kundenName}`);
  while (it.hasNext()) {
    const f = it.next();
    if (!f.isTrashed()) return f;
  }
  return null;
}

/**
 * Extrahiert die Drive-Ordner-ID aus dem Kundenordner-Link und sucht darin den Unterordner.
 * Gibt null zurück (statt zu werfen) wenn der Kundenordner gelöscht ist oder das Script-Konto
 * keinen Zugriff hat -- das ist ein Setup-/Berechtigungsproblem, kein technisches Versagen, und
 * soll vom Aufrufer als SOFT_ERROR behandelt werden, nicht als HARD_ERROR im generischen catch landen.
 */
function findProjektdokuUnterordner(kundenordnerLink) {
  const match = String(kundenordnerLink).match(/[-\w]{25,}/); // Google-Ordner-IDs sind >=25 Zeichen
  if (!match) return null;
  let kundenordner;
  try {
    kundenordner = DriveApp.getFolderById(match[0]);
  } catch (e) {
    return null;
  }
  const it = kundenordner.getFoldersByName(PROJEKTDOKU_UNTERORDNER_NAME);
  while (it.hasNext()) {
    const f = it.next();
    if (!f.isTrashed()) return f; // getFoldersByName liefert auch Papierkorb-Ordner zurück
  }
  return null;
}

/** Baut das Google Doc mit DocumentApp -- kein zusätzliches OAuth-Scope/API-Freischalten nötig. */
function buildProjectDoc(deal, person) {
  const cf = deal.custom_fields || {};
  const kundenName = person ? person.name : deal.title;
  const adresse = person && person.custom_fields ? formatAdresse(person.custom_fields[ADRESSE_FIELD_KEY], person.custom_fields[PLZ_FIELD_KEY]) : '';

  const doc = DocumentApp.create(`Projektdokumentation - ${kundenName}`);
  const body = doc.getBody();

  body.appendParagraph('PROJEKTDOKUMENTATION').setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(`${kundenName} – ${adresse}`).setHeading(DocumentApp.ParagraphHeading.SUBTITLE);

  body.appendParagraph('1. Projektdetails').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  appendKeyValueTable(body, [
    ['Kunde', kundenName],
    ['Adresse', adresse],
    ['Datum erstellt', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy')],
    ['Netzansuchen eigenständig gestellt', resolveEnumLabel(cf[NETZANSUCHEN_FIELD_KEY], NETZANSUCHEN_ID_TO_NAME)]
  ]);

  body.appendParagraph('2. Kontakt').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  appendKeyValueTable(body, [
    ['E-Mail', person ? getPrimaryContactValue(person.emails) : ''],
    ['Telefonnummer', person ? getPrimaryContactValue(person.phones) : '']
  ]);

  body.appendParagraph('3. Installationsort & Eindeckung').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  appendKeyValueTable(body, [
    ['Dachform', resolveEnumLabel(cf[DACHFORM_FIELD_KEY], DACHFORM_ID_TO_NAME)],
    ['Eindeckung', resolveEnumLabel(cf[EINDECKUNG_FIELD_KEY], EINDECKUNG_ID_TO_NAME)],
    ['Ausrichtung', resolveSetLabels(cf[AUSRICHTUNG_FIELD_KEY], AUSRICHTUNG_ID_TO_NAME)]
  ]);

  body.appendParagraph('4. Verkabelung, Verteiler & Termine').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  appendKeyValueTable(body, [
    ['DC-Verkabelung', formatMeterWert(cf[DC_KABELWEG_FIELD_KEY])],
    ['AC-Verkabelung', formatMeterWert(cf[AC_KABELWEG_FIELD_KEY])],
    ['Ort Verteilerkasten', zeigeWert(cf[ORT_VERTEILER_FIELD_KEY])],
    ['DC-Montagetermin', formatPipedriveDate(cf[DC_TERMIN_FIELD_KEY])],
    ['AC-Montagetermin', formatPipedriveDate(cf[AC_TERMIN_FIELD_KEY])],
    ['Inbetriebnahme-Termin', formatPipedriveDate(cf[IB_TERMIN_FIELD_KEY])]
  ]);

  body.appendParagraph('5. Anlagendetails & Lieferumfang').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  const anlagendetails = cf[ANLAGENDETAILS_FIELD_KEY];
  if (anlagendetails) {
    // Verkaufte_Artikel_Summary aus dem sevdesk-Sync ist mehrzeilig -- als ein appendParagraph
    // würde die Auflistung ihre Struktur verlieren (ein Textblock statt einer Liste), genau in der
    // Sektion, wegen der diese Doku überhaupt gebaut wird.
    String(anlagendetails).split(/\r?\n/).filter(zeile => zeile.trim()).forEach(zeile => {
      body.appendListItem(zeile.trim()).setGlyphType(DocumentApp.GlyphType.BULLET);
    });
  } else {
    body.appendParagraph('(leer)');
  }

  body.appendParagraph('6. Lieferplanung').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  appendKeyValueTable(body, [
    ['Geplante Materiallieferung', formatPipedriveDate(cf[LIEFERTERMIN_FIELD_KEY])]
  ]);

  body.appendParagraph('7. Notizen').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  appendKeyValueTable(body, [
    ['Interne Notizen', zeigeWert(cf[NOTIZEN_INTERN_FIELD_KEY])],
    ['Sonstige Mitteilung Kunde', zeigeWert(cf[NOTIZEN_KUNDE_FIELD_KEY])]
  ]);

  const partnerId = cf[MONTAGEPARTNER_FIELD_KEY];
  if (partnerId) {
    body.appendParagraph('8. Montagepartner').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph(MONTAGEPARTNER_ID_TO_NAME[partnerId] || zeigeWert(partnerId));
  }

  doc.saveAndClose();
  return doc;
}

function appendKeyValueTable(body, rows) {
  const table = body.appendTable();
  rows.forEach(([key, value]) => {
    const row = table.appendTableRow();
    row.appendTableCell(key);
    row.appendTableCell(zeigeWert(value));
  });
}

/** v2 Person-Kontaktfelder sind Arrays von {value, label, primary}. */
function getPrimaryContactValue(arr) {
  if (!arr || !arr.length) return '';
  const primary = arr.find(e => e.primary) || arr[0];
  return primary.value || '';
}

/**
 * Address-Custom-Fields liefern ein Objekt mit Subfeldern (postal_code, locality,
 * formatted_address, value). Subfelder nur befüllt, wenn per Google-Maps-Autocomplete angelegt --
 * bei freier Texteingabe steht alles in value. Beide Fälle abdecken.
 */
function formatAdresse(adressFeld, plzFeld) {
  const adresse = adressFeld && typeof adressFeld === 'object'
    ? (adressFeld.formatted_address || adressFeld.value || '')
    : (adressFeld ? String(adressFeld) : '');
  const plzText = plzFeld ? String(plzFeld) : '';
  // Bei Google-Maps-Autocomplete steckt die PLZ oft schon in formatted_address -- nicht doppelt
  // anhängen. Bei freier Texteingabe (wie im Ordnernamen-Pattern von Ordnererstellung-bei-Gewonnen)
  // steht die PLZ separat und muss angehängt werden, sonst fehlt sie im Doc-Kopf komplett.
  const plzSchonDrin = plzText && adresse.includes(plzText);
  const teile = [adresse, !plzSchonDrin ? plzText : ''].filter(Boolean);
  return teile.length ? teile.join(', ') : '(leer)';
}
