// ===== KERNLOGIK =====
// Täglicher Trigger ruft generateDailyProjectDocumentation() auf. Sucht Deals mit
// Dokumentation-Status = "Doku erstellen", baut pro Deal ein Google Doc und schaltet den Status
// danach auf "Erstellt". Das Statusfeld ist gleichzeitig Trigger UND Idempotenz-Marker -- kein
// Script-Property-State nötig, kein N+1 (Listen-Endpunkte liefern custom_fields gleich mit).

/** Einstiegspunkt für den täglichen Zeit-Trigger. */
function generateDailyProjectDocumentation() {
  starteLauf('generateDailyProjectDocumentation');

  // Ein manuell gestartetes testEinzelDeal() parallel zum Tageslauf könnte denselben Deal doppelt
  // verarbeiten -- der Duplikat-Schutz greift erst, wenn Lauf A das Doc schon in den Zielordner
  // verschoben hat. Der Lock ist billiger als der Fehlerfall (zwei Docs, zwei Links).
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log(`[${_laufId}] Ein anderer Lauf hält den Lock -- dieser Lauf wird übersprungen.`);
    return;
  }

  const summary = { verarbeitet: 0, uebersprungen: 0, fehler: 0, abgebrochen: 0 };
  try {
    // Config gegen die echte API prüfen, BEVOR geschrieben wird. Ohne das läuft der Tages-Trigger
    // auch mit halb konfigurierter Config (z.B. DOKU_STATUS_OPTION_NEU_ERSTELLEN noch als
    // TODO-Platzhalter) einfach los und verhält sich unauffällig falsch.
    const configProbleme = checkConfiguration();
    if (configProbleme.length > 0) {
      logRow(null, null, null, 'KETTE_BLOCKIERT', null, null,
             `Lauf nicht gestartet -- checkConfiguration(): ${configProbleme.join(' | ')}`);
      Logger.log(`[${_laufId}] Lauf blockiert, ${configProbleme.length} Config-Problem(e).`);
      return;
    }

    const deals = findDealsForDokuErstellung();
    Logger.log(`[${_laufId}] ${deals.length} Deal(s) mit Status "Doku erstellen"/"Doku neu erstellen" gefunden`);

    for (const { deal, forceRegenerate } of deals) {
      if (Date.now() - _laufStart > MAX_LAUFZEIT_MS) {
        summary.abgebrochen = deals.length - summary.verarbeitet - summary.uebersprungen - summary.fehler;
        // SOFT_ERROR, nicht OK: ein abgebrochener Lauf ist kein sauber durchgelaufener Lauf. Als
        // 'OK' geloggt wäre die Zeile beim Filtern im Log-Sheet nicht von einem Volllauf zu unterscheiden.
        logRow(null, null, null, 'SOFT_ERROR', null, null, `Laufzeit-Limit erreicht -- ${summary.abgebrochen} Deal(s) offen, werden im nächsten Lauf erledigt`);
        break;
      }
      try {
        const result = processDeal(deal, forceRegenerate);
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
    lock.releaseLock();
  }
  Logger.log(`[${_laufId}] Lauf beendet: ${JSON.stringify(summary)}`);
}

/**
 * Paginiert durch alle nicht gelöschten Deals (status-Parameter bewusst weggelassen -- v2 kennt
 * kein "all_not_deleted", ohne Parameter liefert v2 laut Doku alle nicht gelöschten) und filtert
 * client-seitig auf das Status-Feld. custom_fields kommen mit der Liste mit, kein Einzelabruf nötig.
 * Markiert jeden Treffer mit forceRegenerate, je nachdem welcher der beiden Trigger-Werte stand.
 */
function findDealsForDokuErstellung() {
  const treffer = [];
  let cursor = null;
  do {
    // encodeURIComponent ist Pflicht: der Cursor ist ein opaker Token, der '+', '/' und '=' enthalten
    // kann. Unencodiert wird ein '+' serverseitig als Leerzeichen gelesen -> falscher/ungültiger
    // Cursor -> übersprungene oder wiederholte Seiten, und ein Treffer-Deal wird nie gefunden.
    const path = `deals?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const response = fetchPipedriveRaw(path);
    const data = response.data || [];
    data.forEach(deal => {
      const status = String(deal.custom_fields && deal.custom_fields[DOKU_STATUS_FIELD_KEY]);
      if (status === String(DOKU_STATUS_OPTION_TRIGGER)) treffer.push({ deal, forceRegenerate: false });
      else if (status === String(DOKU_STATUS_OPTION_NEU_ERSTELLEN)) treffer.push({ deal, forceRegenerate: true });
    });
    cursor = response.additional_data && response.additional_data.next_cursor;
  } while (cursor);
  return treffer;
}

/**
 * Verarbeitet einen Deal: Doc erzeugen, in Projektdokumentation-Unterordner ablegen, Link +
 * Status zurückschreiben. Gibt {status, docUrl, kunde, completeness, detail} zurück -- wirft NICHT
 * bei fachlichen Grenzfällen (fehlender Kundenordner etc.), das sind SOFT_ERROR, keine Exception.
 *
 * forceRegenerate=true (Status "Projektdoku neu erstellen"): ein bereits vorhandenes Doc wird
 * VERWORFEN (Papierkorb) und komplett neu gebaut -- für den Fall, dass beim ersten Lauf nur
 * Module+Name da waren (reicht für SM) und jetzt die restlichen Felder für FS nachgetragen wurden.
 */
function processDeal(deal, forceRegenerate) {
  const cf = deal.custom_fields || {};

  // Verlorene/gelöschte Deals überspringen: GET /deals ohne status-Parameter liefert auch "lost"
  // mit, und ein verlorener Deal soll keine Partner-Doku im Kundenordner bekommen. 'open' bleibt
  // erlaubt -- die Doku wird bewusst früh (Teildaten, "SM") erzeugt, oft vor dem Gewonnen-Setzen.
  if (deal.status === 'lost' || deal.status === 'deleted') {
    return { status: 'SOFT_ERROR', docUrl: null, kunde: deal.title, completeness: null, detail: `Deal-Status "${deal.status}" -- keine Doku erzeugt. Wenn doch gewollt, Deal-Status in Pipedrive korrigieren.` };
  }

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
  const adresse = person && person.custom_fields
    ? formatAdresse(person.custom_fields[ADRESSE_FIELD_KEY], person.custom_fields[PLZ_FIELD_KEY])
    : { text: '(leer)', warnung: null };

  // Duplikat-Schutz über den tatsächlichen Ordnerinhalt, NICHT nur über das Pipedrive-Status-Feld --
  // sonst legt jeder wiederholte testEinzelDeal()-Lauf (der ohne Status-Check direkt processDeal()
  // aufruft) ein weiteres Doc an. Deckt auch den Fall ab, dass ein früherer Lauf das Doc zwar erzeugt,
  // aber den Status-Patch danach nicht mehr geschafft hat (z.B. der Options-ID-Typfehler vom 17.08.).
  const vorhandenesDoc = findExistingDoc(projektdokuFolder, docDateiName(deal, kundenName), cf[DOKU_LINK_FIELD_KEY]);
  if (vorhandenesDoc && !forceRegenerate) {
    const docUrl = vorhandenesDoc.getUrl();
    const linkFehlt = !cf[DOKU_LINK_FIELD_KEY];
    const statusFehlt = String(cf[DOKU_STATUS_FIELD_KEY]) !== String(DOKU_STATUS_OPTION_DONE);
    // Netzstatus-Check läuft HIER, außerhalb des Nachzieh-Ifs: sonst würde ein Deal, dessen Doc schon
    // länger fertig ist (Link+Status stimmen bereits), bei jedem künftigen Lauf am Duplikat-Schutz
    // abprallen, OHNE je die Chance auf den Netzstatus-Bump zu bekommen -- z.B. genau die Deals, die
    // VOR diesem Feature schon fertig erzeugt wurden. Guard in versucheNetzstatusUebergeben() selbst
    // sorgt dafür, dass das trotzdem nur einmal greift (offen/leer -> übergeben, nie zurück).
    const netzstatusHinweis = !DRY_RUN ? versucheNetzstatusUebergeben(deal.id, cf, adresse.text) : null;
    if ((linkFehlt || statusFehlt) && !DRY_RUN) {
      // Ein früherer Lauf hat das Doc erzeugt, ist aber vor/beim Zurückschreiben gescheitert (siehe
      // F4/F6 im Bau-Log) -- ohne dieses Nachziehen würde der Deal für immer im SOFT_ERROR hängen,
      // weil der Duplikat-Schutz oben jeden weiteren Lauf sofort abbricht, ohne je zu schreiben.
      schreibeLinkUndStatus(deal.id, docUrl);
      return { status: 'OK', docUrl, kunde: kundenName, completeness, detail: baueDetail('Doc existierte bereits -- Link/Status nachgezogen', netzstatusHinweis) };
    }
    return { status: 'SOFT_ERROR', docUrl, kunde: kundenName, completeness, detail: baueDetail('Doc existiert bereits im Ordner -- kein neues erzeugt (Duplikat-Schutz)', netzstatusHinweis) };
  }

  if (DRY_RUN) {
    return { status: 'OK', docUrl: vorhandenesDoc ? vorhandenesDoc.getUrl() : null, kunde: kundenName, completeness, detail: baueDetail(vorhandenesDoc ? 'DRY_RUN -- würde altes Doc verwerfen und neu erzeugen' : 'DRY_RUN -- kein Doc erzeugt', null, adresse.warnung) };
  }

  const doc = buildProjectDoc(deal, person, adresse.text);
  const file = DriveApp.getFileById(doc.getId());
  try {
    file.moveTo(projektdokuFolder); // Shared-Drive-tauglich, anders als addFile/removeFile
  } catch (e) {
    // Ohne Aufräumen bliebe das leere Doc für immer im Drive-Root liegen und der Duplikat-Schutz
    // (der im Zielordner sucht) würde es nie finden -- jeder Folgelauf würde erneut eins anlegen.
    file.setTrashed(true);
    throw new Error(`Verschieben in "${PROJEKTDOKU_UNTERORDNER_NAME}" fehlgeschlagen (${e.message}) -- Doc wurde in den Papierkorb gelegt`);
  }

  // forceRegenerate: das alte Doc erst JETZT verwerfen, nachdem das neue steht und im Zielordner
  // liegt. Vorher (Trash zuerst) hätte ein Fehler in buildProjectDoc()/moveTo() -- Drive-Quota,
  // Berechtigung, Laufzeit-Abbruch -- die bestehende Kundendoku in den Papierkorb geräumt, ohne
  // eine neue zu hinterlassen: Datenverlust bei einem Vorgang, der eigentlich nur aktualisiert.
  let trashHinweis = null;
  if (vorhandenesDoc) {
    try {
      vorhandenesDoc.setTrashed(true);
    } catch (e) {
      // Kein throw: das neue Doc ist fertig und verlinkt, nur die alte Datei bleibt liegen. Muss
      // aber sichtbar sein -- sonst liegen zwei gleichnamige Docs im Ordner und der Namensteil des
      // Duplikat-Schutzes könnte beim nächsten Lauf das veraltete erwischen.
      trashHinweis = `ACHTUNG: altes Doc konnte nicht in den Papierkorb gelegt werden (${e.message}) -- manuell löschen`;
    }
  }

  // file.getUrl() statt doc.getUrl(): das Document-Objekt ist nach saveAndClose() geschlossen,
  // Metadaten-Zugriffe darauf funktionieren nur laut undokumentiertem Verhalten. Das File-Handle
  // liegt hier ohnehin schon vor.
  const docUrl = file.getUrl();
  schreibeLinkUndStatus(deal.id, docUrl);
  const netzstatusHinweis = versucheNetzstatusUebergeben(deal.id, cf, adresse.text);

  return { status: 'OK', docUrl, kunde: kundenName, completeness, detail: baueDetail(vorhandenesDoc ? 'Doc neu erzeugt (altes verworfen) und verlinkt' : 'Doc erzeugt und verlinkt', trashHinweis, adresse.warnung, netzstatusHinweis) };
}

/**
 * Setzt Netzstatus auf "übergeben" -- aber NUR wenn er noch "offen"/leer ist, und NUR wenn
 * Modul-Daten (Anlagendetails) UND eine Adresse da sind. Das ist der Punkt, an dem die Projektdoku
 * für den Montagepartner tatsächlich brauchbar wird -- Sheet-Sync/NetzanmeldungEskalation.gs nimmt
 * genau dieses Signal als Fristbeginn für die Netzanmeldungs-Eskalation.
 *
 * Schreibt NIE rückwärts: ein Deal, der schon bei "eingereicht"/"Zählpunkt da"/"Fertigmeldung raus"
 * steht, darf durch ein späteres forceRegenerate nicht auf "übergeben" zurückfallen -- sonst zählt
 * die Eskalation ab dann falsch und Fortschritt-Script zeigt den falschen Meilenstein.
 *
 * Eigener try/catch statt durchwerfen: ein Fehler hier soll die eigentlich erfolgreiche Doc-Erzeugung
 * nicht nachträglich zu HARD_ERROR machen (gleiches Prinzip wie beim trashHinweis oben) -- stattdessen
 * sichtbare Warnung in der Detail-Spalte.
 */
function versucheNetzstatusUebergeben(dealId, cf, adresseText) {
  const hatUebergabeDaten = !!cf[ANLAGENDETAILS_FIELD_KEY] && adresseText !== '(leer)';
  const nochOffenOderLeer = !cf[NETZSTATUS_FIELD_KEY] || String(cf[NETZSTATUS_FIELD_KEY]) === String(NETZSTATUS_OFFEN);
  if (!hatUebergabeDaten || !nochOffenOderLeer) return null;
  try {
    patchCustomFieldsVerified(dealId, { [NETZSTATUS_FIELD_KEY]: NETZSTATUS_UEBERGEBEN });
    return 'Netzstatus auf "übergeben" gesetzt';
  } catch (e) {
    return `ACHTUNG: Netzstatus konnte nicht auf "übergeben" gesetzt werden (${e.message})`;
  }
}

/**
 * Schreibt Link und Status in ZWEI getrennten, jeweils verifizierten PATCHes -- Link zuerst.
 *
 * Vorher gingen beide Felder in einem Call raus. Übernahm Pipedrive den Status (enum, ID) und
 * verwarf den Link still (falscher Feldtyp, Feld gelöscht), stand der Deal auf "erstellt und
 * abgelegt" OHNE Link -- und weil findDealsForDokuErstellung() nur auf die Trigger-Werte filtert,
 * fand ihn kein Folgelauf mehr: der Link wäre nie nachgetragen worden, trotz HARD_ERROR im Log.
 * In dieser Reihenfolge bleibt der Deal bei einem Link-Fehler auf dem Trigger-Wert stehen und der
 * nächste Lauf zieht ihn über den Nachzieh-Pfad in processDeal() nach.
 */
function schreibeLinkUndStatus(dealId, docUrl) {
  patchCustomFieldsVerified(dealId, { [DOKU_LINK_FIELD_KEY]: docUrl });
  patchCustomFieldsVerified(dealId, { [DOKU_STATUS_FIELD_KEY]: DOKU_STATUS_OPTION_DONE });
}

/**
 * Dateiname des Docs -- mit Deal-ID, weil der Kundenordner NICHT pro Deal existiert:
 * Ordnererstellung-bei-Gewonnen benennt ihn "{Name} - {Adresse}" und verwendet einen vorhandenen
 * Ordner wieder. Zwei Deals derselben Person an derselben Adresse (z.B. Anlagen-Erweiterung)
 * landen also im selben Ordner. Ohne die Deal-ID im Namen hätte der zweite Deal das Doc des
 * ersten als "existiert bereits" erkannt, dessen Link bekommen und selbst nie eine Doku.
 * Die Überschrift IM Doc bleibt ohne Deal-ID -- nur der Dateiname trägt sie.
 */
function docDateiName(deal, kundenName) {
  return `Projektdokumentation - ${kundenName} (Deal ${deal.id})`;
}

/** Detail-Spalte aus Hauptmeldung + optionalen Warnungen, ohne leere Trenner. */
function baueDetail(...teile) {
  return teile.filter(Boolean).join(' | ');
}

/**
 * Sucht ein bereits existierendes Doc -- zuerst über den in Pipedrive gespeicherten Link, dann über
 * den Namen, den buildProjectDoc() vergeben würde.
 *
 * Der gespeicherte Link ist der stabilere Anker: bekommt ein Deal nachträglich eine Person zugeordnet
 * oder wird die Person umbenannt, ändert sich der Doc-Name -- die reine Namenssuche findet das
 * vorhandene Doc dann nicht mehr und legt beim nächsten Trigger ein zweites daneben.
 * getFileById()/getFilesByName() liefern auch Dateien im Papierkorb -- ohne isTrashed()-Filter würde
 * ein manuell gelöschtes Doc den Duplikat-Schutz weiter blockieren, obwohl im Ordner nichts liegt.
 */
function findExistingDoc(folder, dateiName, gespeicherterLink) {
  if (gespeicherterLink) {
    const match = String(gespeicherterLink).match(/[-\w]{25,}/);
    if (match) {
      try {
        const verlinkt = DriveApp.getFileById(match[0]);
        if (!verlinkt.isTrashed()) return verlinkt;
      } catch (e) {
        // Link zeigt auf eine endgültig gelöschte oder nicht freigegebene Datei -- unten über den
        // Namen weitersuchen, statt hier abzubrechen.
      }
    }
  }
  const it = folder.getFilesByName(dateiName);
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

/**
 * Baut das Google Doc mit DocumentApp -- kein zusätzliches OAuth-Scope/API-Freischalten nötig.
 * adresse kommt fertig formatiert von processDeal(), damit ein dort erkannter PLZ-Widerspruch
 * gemeinsam mit dem Ergebnis ins Log-Sheet wandert und nicht in dieser Funktion verpufft.
 */
function buildProjectDoc(deal, person, adresse) {
  const cf = deal.custom_fields || {};
  const kundenName = person ? person.name : deal.title;

  const doc = DocumentApp.create(docDateiName(deal, kundenName));
  const body = doc.getBody();

  body.appendParagraph('PROJEKTDOKUMENTATION').setHeading(DocumentApp.ParagraphHeading.TITLE);
  // Kein hängender Gedankenstrich, wenn keine Adresse da ist (Deal ohne verknüpfte Person).
  const untertitel = adresse && adresse !== '(leer)' ? `${kundenName} – ${adresse}` : kundenName;
  body.appendParagraph(untertitel).setHeading(DocumentApp.ParagraphHeading.SUBTITLE);

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
    body.appendParagraph(resolveEnumLabel(partnerId, MONTAGEPARTNER_ID_TO_NAME));
  }

  // DocumentApp.create() legt das Doc mit einem leeren Absatz an; alles oben wird DAHINTER
  // angehängt. Ohne Entfernen beginnt jede Kundendoku mit einer Leerzeile über dem Titel.
  const ersterAbsatz = body.getChild(0);
  if (ersterAbsatz.getType() === DocumentApp.ElementType.PARAGRAPH
      && ersterAbsatz.asParagraph().getText() === '') {
    body.removeChild(ersterAbsatz);
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
 * Baut den Adress-String für den Doc-Kopf und gibt {text, warnung} zurück.
 *
 * Address-Custom-Fields liefern ein Objekt mit Subfeldern (postal_code, locality,
 * formatted_address, value). Subfelder nur befüllt, wenn per Google-Maps-Autocomplete angelegt --
 * bei freier Texteingabe steht alles in value. Beide Fälle abgedeckt.
 *
 * Das separate PLZ-Feld wird NICHT mehr blind angehängt. Belegt (reference_pipedrive_plz_
 * unzuverlaessig): bei RP widerspricht das PLZ-Feld regelmäßig der Adresse, und keine der beiden
 * Quellen ist die verlässlichere -- bei Deal 7177 stünde sonst "…, 2340 Mödling, 1230" im Doc-Kopf.
 * Im Feld stand real auch schon eine Telefonnummer, deshalb die 4-Ziffern-Prüfung.
 * Regel: hat die Adresse selbst eine PLZ, gewinnt sie; ein Widerspruch wandert als Warnung ins
 * Log-Detail statt ins Doc (Prinzip aus CLAUDE.md -- nicht raten, entscheidbar machen).
 */
function formatAdresse(adressFeld, plzFeld) {
  const istObjekt = adressFeld && typeof adressFeld === 'object';
  const adresse = istObjekt
    ? (adressFeld.formatted_address || adressFeld.value || '')
    : (adressFeld ? String(adressFeld) : '');

  const plzRoh = plzFeld ? String(plzFeld).trim() : '';
  const plzFeldWert = /^\d{4}$/.test(plzRoh) ? plzRoh : ''; // österreichische PLZ sind immer 4-stellig
  // PLZ aus der Adresse: bevorzugt das Subfeld (nur bei Maps-Autocomplete befüllt), sonst die
  // erste 4-stellige Zahl im Text.
  const plzSubfeld = istObjekt && adressFeld.postal_code ? String(adressFeld.postal_code).trim() : '';
  const plzInAdresse = plzSubfeld || (adresse.match(/\b\d{4}\b/) || [''])[0];

  const teile = [adresse];
  let warnung = null;
  if (plzRoh && !plzFeldWert) {
    warnung = `PLZ-Feld enthält keine 4-stellige PLZ ("${plzRoh}") -- ignoriert, bitte in Pipedrive korrigieren`;
  } else if (plzFeldWert && !plzInAdresse) {
    teile.push(plzFeldWert); // Adresse ohne PLZ (freie Texteingabe) -- PLZ-Feld ist die einzige Quelle
  } else if (plzFeldWert && plzInAdresse && plzFeldWert !== plzInAdresse) {
    warnung = `PLZ-Konflikt: Adressfeld "${plzInAdresse}" vs. PLZ-Feld "${plzFeldWert}" -- im Doc steht die Adresse unverändert, bitte prüfen`;
  }

  const text = teile.filter(Boolean).join(', ');
  return { text: text || '(leer)', warnung };
}
