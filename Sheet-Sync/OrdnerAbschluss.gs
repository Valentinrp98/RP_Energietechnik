// ===== ORDNER-ARCHIVIERUNG NACH FERTIGMELDUNG =====
// Verschiebt den Kundenordner von "Montage offen" nach "Montage abgeschlossen", sobald "Montage
// abgeschlossen" im Sheet angehakt wurde -- aber NICHT sofort, sondern erst ORDNER_VERSCHIEBEN_
// WARTETAGE Tage nach der Fertigmeldung (Config.gs). Das lässt Zeit für Nacharbeit/Korrekturen,
// bevor der Ordner als endgültig fertig einsortiert wird. Für einen täglichen Trigger gedacht
// (siehe installTriggers() in SetupHelpers.gs).

function verschiebeAbgeschlosseneOrdner() {
  if (MONTAGE_ABGESCHLOSSEN_AM_FIELD_KEY.startsWith('TODO_')) {
    Logger.log('MONTAGE_ABGESCHLOSSEN_AM_FIELD_KEY noch nicht in Config.gs eingetragen -- nichts zu tun.');
    return;
  }

  const heute = new Date();
  let cursor = null;
  let geprueft = 0;
  const summary = { verschoben: 0, uebersprungen: 0, dryRun: 0, fehler: 0 };

  do {
    const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/deals?status=won&limit=100`
      + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const response = callPipedriveWithRetryRaw(url);
    const deals = response.data || [];
    cursor = response.additional_data?.next_cursor || null;

    deals.forEach(deal => {
      geprueft++;
      const cf = deal.custom_fields || {};
      const abgeschlossenAm = cf[MONTAGE_ABGESCHLOSSEN_AM_FIELD_KEY];
      if (!abgeschlossenAm) return; // noch nicht als "Montage abgeschlossen" fertiggemeldet

      const tageSeitFertigmeldung = (heute - new Date(abgeschlossenAm)) / (1000 * 60 * 60 * 24);
      if (tageSeitFertigmeldung < ORDNER_VERSCHIEBEN_WARTETAGE) {
        summary.uebersprungen++; // Wartefrist noch nicht um
        return;
      }

      const ordnerLink = cf[KUNDENORDNER_LINK_FIELD_KEY];
      if (!ordnerLink) {
        logRow('pipedrive_to_sheet', deal.id, null, 'Ordner-Verschiebung', 'FEHLER', 'Fertiggemeldet, aber kein Kundenordner-Link am Deal -- Ordnererstellung-bei-Gewonnen geprüft?');
        summary.fehler++;
        return;
      }

      try {
        const ergebnis = verschiebeKundenOrdner(ordnerLink, DRY_RUN);
        if (ergebnis === 'bereits_verschoben') {
          summary.uebersprungen++; // idempotent -- schon erledigt, kein Fehler
          return;
        }
        const detail = `${MONTAGE_ABGESCHLOSSEN_ORDNERNAME}, ${Math.floor(tageSeitFertigmeldung)} Tage seit Fertigmeldung`;
        if (ergebnis === 'waere_verschoben') {
          logRow('pipedrive_to_sheet', deal.id, null, 'Ordner-Verschiebung', 'DRY-RUN', `würde nach "${detail}" verschieben`);
          summary.dryRun++;
        } else {
          logRow('pipedrive_to_sheet', deal.id, null, 'Ordner-Verschiebung', 'verschoben', `nach "${detail}"`);
          summary.verschoben++;
        }
      } catch (err) {
        logRow('pipedrive_to_sheet', deal.id, null, 'Ordner-Verschiebung', 'FEHLER', err.message);
        Logger.log(`FEHLER bei Ordner-Verschiebung für Deal ${deal.id}: ${err.message}`);
        summary.fehler++;
      }
    });
  } while (cursor);

  Logger.log(`Fertig. ${geprueft} gewonnene Deals geprüft. ${JSON.stringify(summary)}`);
}

/**
 * Verschiebt den Kundenordner von "Montage offen" nach "Montage abgeschlossen". Idempotent:
 * liegt er schon im Zielordner, passiert nichts (kein Fehler). Wirft, wenn die erwartete
 * Struktur nicht stimmt (z.B. liegt nicht direkt unter "Montage offen") -- lieber auffallen als
 * automatisch etwas falsch verschieben. dryRun=true liest nur, schreibt/verschiebt nichts.
 */
function verschiebeKundenOrdner(ordnerLink, dryRun) {
  const kundenOrdner = holeOrdnerAusLink(ordnerLink);
  const elternIter = kundenOrdner.getParents();
  if (!elternIter.hasNext()) {
    throw new Error('Kundenordner hat keinen übergeordneten Ordner.');
  }
  const aktuellerEltern = elternIter.next();

  if (aktuellerEltern.getName() === MONTAGE_ABGESCHLOSSEN_ORDNERNAME) {
    return 'bereits_verschoben';
  }
  if (aktuellerEltern.getName() !== MONTAGE_OFFEN_ORDNERNAME) {
    throw new Error(`Kundenordner liegt unter "${aktuellerEltern.getName()}", nicht unter "${MONTAGE_OFFEN_ORDNERNAME}" -- manuell prüfen statt automatisch verschieben.`);
  }

  const partnerRootIter = aktuellerEltern.getParents();
  if (!partnerRootIter.hasNext()) {
    throw new Error(`"${MONTAGE_OFFEN_ORDNERNAME}" hat keinen übergeordneten Partner-Root-Ordner.`);
  }
  const partnerRoot = partnerRootIter.next();

  const zielIter = partnerRoot.getFoldersByName(MONTAGE_ABGESCHLOSSEN_ORDNERNAME);
  if (!zielIter.hasNext()) {
    throw new Error(`Unterordner "${MONTAGE_ABGESCHLOSSEN_ORDNERNAME}" fehlt im Partner-Root -- manuell anlegen.`);
  }
  const zielOrdner = zielIter.next();

  if (dryRun) return 'waere_verschoben';
  kundenOrdner.moveTo(zielOrdner);
  return 'verschoben';
}

/** Extrahiert die Drive-Ordner-ID aus einer Kundenordner-URL und liefert das Folder-Objekt. */
function holeOrdnerAusLink(ordnerLink) {
  const match = ordnerLink.match(/[-\w]{25,}/);
  if (!match) {
    throw new Error(`Konnte keine Ordner-ID aus "${ordnerLink}" extrahieren.`);
  }
  return DriveApp.getFolderById(match[0]);
}
