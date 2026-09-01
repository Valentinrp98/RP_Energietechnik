// ===== KERNLOGIK =====
// Pipedrive-Deal-Files holen, per Claude Vision klassifizieren, in den passenden Unterordner
// des (von Ordnererstellung-bei-Gewonnen bereits angelegten) Kundenordners einsortieren.

// MIME-Typen, die wir überhaupt an Claude schicken -- alles andere (z.B. .docx) ist "unsicher"
// per Definition, kein Vision-Call nötig.
const UNTERSTUETZTE_MIME_TYPEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

/**
 * Kompletter Ablauf für einen Deal: Deal-Files holen, jede unterstützte Datei klassifizieren,
 * bei eindeutigem Ergebnis in den Kundenordner verschieben (bzw. bei DRY_RUN nur loggen).
 * Gibt eine Zusammenfassung {verarbeitet, unsicher, fehler} zurück.
 */
function processDeal(dealId) {
  const deal = fetchPipedrive(`deals/${dealId}`);
  const cf = deal.custom_fields || {};
  const kundenOrdnerLink = cf[KUNDENORDNER_LINK_FIELD_KEY];

  // FIX 27.08.2026: stand vorher "&& !DRY_RUN" -- damit war der DRY-Lauf der TEUERE Modus. Ein
  // Deal ohne Kundenordner-Link wurde im DRY-Lauf nicht uebersprungen, sondern alle Dateien
  // heruntergeladen und an Claude geschickt (echtes Geld), um dann "wuerde verschieben" zu loggen.
  // LIVE haette derselbe Deal bei Kosten 0 abgebrochen. Ein DRY-Lauf soll den Echtlauf vorhersagen,
  // nicht mehr kosten als er.
  if (!kundenOrdnerLink) {
    logRow(dealId, null, null, 'SOFT_ERROR', 'Kundenordner-Link ist am Deal nicht gesetzt -- Ordnererstellung-bei-Gewonnen muss zuerst gelaufen sein');
    return { verarbeitet: 0, unsicher: 0, fehler: 1 };
  }

  const dateien = holeDealFiles(dealId);
  if (dateien.length === 0) {
    logRow(dealId, null, null, 'übersprungen', 'keine Dateien am Deal');
    return { verarbeitet: 0, unsicher: 0, fehler: 0 };
  }

  const kundenOrdner = kundenOrdnerLink ? oeffneOrdnerAusLink(kundenOrdnerLink) : null;

  let verarbeitet = 0, unsicher = 0, fehler = 0;
  const erkannteKategorien = new Set();
  dateien.forEach(datei => {
    try {
      const { status, kategorie } = klassifiziereUndVerschiebe(dealId, datei, kundenOrdner);
      if (status === 'unsicher') unsicher++;
      else if (status === 'fehler') fehler++;
      else {
        verarbeitet++;
        if (kategorie) erkannteKategorien.add(kategorie);
      }
    } catch (e) {
      fehler++;
      logRow(dealId, datei.name, null, 'FEHLER', String(e));
    }
  });

  // Ein PATCH pro Deal statt pro Datei -- vermeidet Race/Overwrite zwischen mehreren Dateien
  // desselben Laufs und reduziert API-Calls. Nur bei LIVE und wenn das Feld konfiguriert ist
  // (siehe Config.gs) -- solange DOKUMENTE_ERKANNT_FIELD_KEY null ist, kein Fehler, einfach Skip.
  if (!DRY_RUN && DOKUMENTE_ERKANNT_FIELD_KEY && erkannteKategorien.size > 0) {
    try {
      schreibeDokumenteErkannt(dealId, deal, erkannteKategorien);
    } catch (e) {
      logRow(dealId, null, null, 'FEHLER', `Dokumente-erkannt-Feld schreiben: ${e}`);
    }
  }

  return { verarbeitet, unsicher, fehler };
}

/**
 * Schreibt die erkannten Kategorien als Optionen ins Pipedrive-Mehrfachauswahl-Feld
 * "Dokumente erkannt" -- gemerged mit bereits vorhandenen Optionen. Ein PATCH mit nur den neuen
 * IDs würde frühere Läufe überschreiben (siehe CLAUDE.md "Es gibt kein silent update" -- gilt
 * genauso fürs versehentliche Löschen bestehender Werte wie fürs Nicht-Schreiben).
 * ACHTUNG: Response-Schema für Mehrfachauswahl-Felder in v2 (Array numerischer Options-IDs) ist
 * aus der Doku abgeleitet, nicht live verifiziert -- beim ersten LIVE-Lauf gegenprüfen.
 */
function schreibeDokumenteErkannt(dealId, deal, erkannteKategorien) {
  const bestehendeIds = deal.custom_fields && Array.isArray(deal.custom_fields[DOKUMENTE_ERKANNT_FIELD_KEY])
    ? deal.custom_fields[DOKUMENTE_ERKANNT_FIELD_KEY]
    : [];
  const neueIds = Array.from(erkannteKategorien)
    .map(k => DOKUMENTE_ERKANNT_OPTION_IDS[k])
    .filter(id => id !== undefined);
  const zusammengefasst = Array.from(new Set([...bestehendeIds, ...neueIds]));
  if (zusammengefasst.length === bestehendeIds.length) return; // nichts Neues zu schreiben

  const response = UrlFetchApp.fetch(`https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/deals/${dealId}`, {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify({ custom_fields: { [DOKUMENTE_ERKANNT_FIELD_KEY]: zusammengefasst } }),
    headers: { 'x-api-token': getApiToken() },
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code !== 200) {
    logRow(dealId, null, null, 'FEHLER', `Dokumente-erkannt-Feld PATCH fehlgeschlagen: HTTP ${code} ${response.getContentText()}`);
    return;
  }
  logRow(dealId, null, null, 'OK', `Dokumente-erkannt-Feld aktualisiert: ${JSON.stringify(zusammengefasst)}`);
}

/** Holt alle Datei-Metadaten für einen Deal. Files-API existiert nur in v1 (siehe Plan). */
function holeDealFiles(dealId) {
  const result = fetchPipedriveV1(`deals/${dealId}/files`);
  return result || [];
}

/** Öffnet den Kundenordner anhand des in Pipedrive gespeicherten Drive-Links. */
function oeffneOrdnerAusLink(link) {
  const match = link.match(/[-\w]{25,}/); // Google-Datei-/Ordner-IDs sind >=25 Zeichen
  if (!match) throw new Error(`Kundenordner-Link hat kein erkennbares Ordner-ID-Format: ${link}`);
  return DriveApp.getFolderById(match[0]);
}

/**
 * Lädt eine einzelne Datei herunter, klassifiziert sie per Claude und verschiebt sie bei
 * eindeutigem Ergebnis in den passenden Unterordner.
 * Rückgabe: { status: 'verschoben' | 'unsicher' | 'fehler', kategorie: string|null }.
 */
function klassifiziereUndVerschiebe(dealId, datei, kundenOrdner) {
  const blob = downloadPipedriveFile(datei.id, datei.name);
  const mimeType = blob.getContentType();
  if (!UNTERSTUETZTE_MIME_TYPEN.includes(mimeType)) {
    logRow(dealId, datei.name, null, 'unsicher', `MIME-Typ "${mimeType}" nicht unterstützt (kein Bild/PDF) -- nicht klassifiziert`);
    return { status: 'unsicher', kategorie: null };
  }

  const klassifikation = klassifiziereDatei(blob, mimeType, datei.name);
  logRow(dealId, datei.name, klassifikation.kategorie, klassifikation.kategorie === 'unsicher' ? 'unsicher' : 'klassifiziert', klassifikation.begruendung, klassifikation.usage);

  if (klassifikation.kategorie === 'unsicher') return { status: 'unsicher', kategorie: null };

  // hasOwnProperty statt direktem Zugriff: die Kategorie kommt aus einem Claude-Call ueber ein
  // Dokument, das Fremdinput ist (Prompt Injection in einer Kunden-PDF ist der realistische Vektor).
  // Ohne diese Pruefung laeuft der Lookup die Prototype-Chain hoch -- kategorie: "constructor"
  // liefert eine truthy Function, die dann als Ordnername an getFoldersByName() ginge, statt hier
  // saubere eine FEHLER-Zeile zu erzeugen.
  const zielBekannt = Object.prototype.hasOwnProperty.call(ZIEL_UNTERORDNER, klassifikation.kategorie);
  const zielUnterordnerName = zielBekannt ? ZIEL_UNTERORDNER[klassifikation.kategorie] : null;
  if (!zielUnterordnerName) {
    logRow(dealId, datei.name, klassifikation.kategorie, 'FEHLER', `Kategorie "${klassifikation.kategorie}" hat keinen Zielordner in ZIEL_UNTERORDNER (Config.gs)`);
    return { status: 'fehler', kategorie: klassifikation.kategorie };
  }

  if (DRY_RUN || !kundenOrdner) {
    logRow(dealId, datei.name, klassifikation.kategorie, 'DRY-RUN', `würde nach "${zielUnterordnerName}" verschieben`);
    return { status: 'verschoben', kategorie: klassifikation.kategorie };
  }

  const zielOrdnerIter = kundenOrdner.getFoldersByName(zielUnterordnerName);
  if (!zielOrdnerIter.hasNext()) {
    logRow(dealId, datei.name, klassifikation.kategorie, 'FEHLER', `Zielunterordner "${zielUnterordnerName}" fehlt im Kundenordner`);
    return { status: 'fehler', kategorie: klassifikation.kategorie };
  }
  const zielOrdner = zielOrdnerIter.next();

  // Datei-ID an den Namen hängen, um Kollisionen bei mehreren Fotos gleicher Kategorie zu
  // vermeiden (siehe Plan, "Offene technische Punkte").
  const eindeutigerName = `${datei.name} (Pipedrive-Datei ${datei.id})`;
  blob.setName(eindeutigerName);
  zielOrdner.createFile(blob);

  logRow(dealId, datei.name, klassifikation.kategorie, 'verschoben', `nach "${zielUnterordnerName}"`);
  return { status: 'verschoben', kategorie: klassifikation.kategorie };
}

/**
 * Lädt den Binärinhalt einer Pipedrive-Datei. Eigener Fetch statt fetchPipedriveV1(), weil die
 * Antwort hier ein Binary-Blob ist, kein JSON (siehe Plan, "Offene technische Punkte" --
 * Response-Schema war vor dem ersten echten Testlauf nicht zu 100% sicher).
 */
function downloadPipedriveFile(fileId, dateiname) {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v1/files/${fileId}/download`;
  const response = UrlFetchApp.fetch(url, {
    headers: { 'x-api-token': getApiToken() },
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code !== 200) {
    throw new Error(`Download fehlgeschlagen für Datei ${fileId} ("${dateiname}"): HTTP ${code}`);
  }
  return response.getBlob();
}

/**
 * Klassifiziert eine Datei per Claude Vision in genau eine von 4 Kategorien.
 * Erzwungener Tool-Call statt Freitext-Parsing -- vermeidet das Pipedrive-"stille
 * Nicht-Schreibung"-Analogon: ein leicht abweichendes Antwortformat, das im Log gut aussieht,
 * aber nicht auswertbar ist.
 */
function klassifiziereDatei(blob, mimeType, dateiname) {
  const base64 = Utilities.base64Encode(blob.getBytes());
  const contentBlock = mimeType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mimeType, data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } };

  const payload = {
    model: CLAUDE_MODEL,
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: [
        contentBlock,
        {
          type: 'text',
          text: `Diese Datei ("${dateiname}") stammt aus einem Photovoltaik-Kundendeal in Pipedrive. ` +
            'Ordne sie in genau eine Kategorie ein:\n' +
            '- stromrechnung: eine Stromrechnung/Jahresabrechnung eines Energieversorgers\n' +
            '- dachfoto: ein Foto des Dachs/der Dachfläche, auf der die PV-Anlage montiert werden soll\n' +
            '- zaehlerpunkt: ein Foto/Dokument des Stromzählers bzw. Zählerpunkts\n' +
            '- unsicher: passt in keine der drei Kategorien, oder du bist dir nicht sicher\n' +
            'Antworte NUR über den Tool-Call "klassifikation", nicht im Fließtext.'
        }
      ]
    }],
    tools: [{
      name: 'klassifikation',
      description: 'Meldet das Klassifikationsergebnis für eine Datei.',
      input_schema: {
        type: 'object',
        properties: {
          kategorie: { type: 'string', enum: ['stromrechnung', 'dachfoto', 'zaehlerpunkt', 'unsicher'] },
          begruendung: { type: 'string', description: 'Kurze Begründung, 1 Satz.' }
        },
        required: ['kategorie', 'begruendung']
      }
    }],
    tool_choice: { type: 'tool', name: 'klassifikation' }
  };

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: {
      'x-api-key': getAnthropicApiKey(),
      'anthropic-version': ANTHROPIC_API_VERSION
    },
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code !== 200) {
    throw new Error(`Claude-API-Fehler ${code} bei Klassifikation von "${dateiname}": ${response.getContentText()}`);
  }

  const data = JSON.parse(response.getContentText());
  const toolUse = (data.content || []).find(block => block.type === 'tool_use' && block.name === 'klassifikation');
  if (!toolUse) {
    throw new Error(`Claude hat keinen "klassifikation"-Tool-Call zurückgegeben für "${dateiname}": ${response.getContentText()}`);
  }
  return Object.assign({}, toolUse.input, { usage: data.usage });
}
