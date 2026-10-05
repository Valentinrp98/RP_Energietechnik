// ===== PARTNERWECHSEL EINZELN (02.10.2026, Anlass: Deal 7024 Neubauer ALE -> Kreuzeder) =====
//
// Partnerwechsel.gs räumt automatisch nur bei Wechseln NACH Greensky auf (PARTNERWECHSEL_ZIELE).
// Für jeden anderen Wechsel, den Valentin von Hand in Pipedrive macht, hier dieselbe Logik für
// EINEN Deal: alte Zeile beim vorherigen Partner sichern (JSON ins Log) + löschen, Kundenordner von
// dessen "Montage offen" ins "Montage offen" des neuen Partners verschieben.
//
// Voraussetzung: Die Zeile beim NEUEN Partner steht schon (sonst bricht es ab -- nie löschen,
// bevor die neue Zeile sicher da ist). Schreibt NIE nach Pipedrive (nur GET des Deals).
//
// Ausführen: partnerwechsel7024() im Editor. Ergebnis im Ausführungsprotokoll + Log-Sheet.

// 05.10.: war falsch (s.u.) -- mit "_" aus dem Editor-Dropdown genommen, damit sie nicht statt des
// Rückwegs erwischt wird (VP hat sie 05.10. zweimal versehentlich gestartet, beide Male folgenlos).
function partnerwechsel7024NachKreuzederAlt_() {
  partnerwechselEinzeln_(7024, 'Kreuzeder (OÖ, SBG)');
}

// ===== RÜCKWEG 7024 -> ALE (05.10.2026, VP: „nein macht ale!“) =====
// St. Valentin 4300 = NÖ -> laut Regel ALE. Der Wechsel zu Kreuzeder am 02.10. war falsch.
// Alte ALE-Zeile 64 aus dem Log (02.10., Aktion "partnerwechsel", "Zeile gesichert"). Händisch drin
// war nur "Netzanmeldung eingereicht" (ALE am 25.09.) -- Rest sind Sync-Werte.
const BACKUP_7024_ALE = {
  'Netzanmeldung eingereicht': true,
  'Erstellungsdatum': '2026-09-14T07:00:00.000Z'
};

/**
 * Voraussetzung: Montagepartner am Deal in Pipedrive steht schon auf ALE (sonst Abbruch).
 * 1. ALE-Zeile anlegen (bzw. nachfüllen, falls syncNeueZeilen() schneller war)
 * 2. Backup-Werte zurück: leere Zellen + Erstellungsdatum immer (= seit wann ALE den Auftrag hat)
 * 3. partnerwechselEinzeln_(): Kreuzeder-Zeile sichern + löschen, Ordner nach ALE "Montage offen"
 * Schreibt NIE nach Pipedrive.
 */
function partnerwechsel7024ZurueckAle() {
  const ALE = 'ALE-Engineering (NÖ, Wien, BGL)';
  const lock = LockService.getScriptLock();
  lock.waitLock(120000);
  starteLauf('partnerwechsel7024ZurueckAle');
  try {
    const deal = fetchPipedrive('deals/7024');
    const cf = deal.custom_fields || {};
    const partner = MONTAGEPARTNER_ID_TO_NAME[cf[MONTAGEPARTNER_FIELD_KEY]];
    if (partner !== ALE) {
      Logger.log(`ABBRUCH: Deal 7024 hat Partner "${partner}" -- erst in Pipedrive auf ALE stellen.`);
      return;
    }

    const cache = neuerSheetCache();
    const ergebnis = createSheetRowForDeal(deal, cache);
    Logger.log(`ALE-Zeile: [${ergebnis.code}] ${ergebnis.text}`);
    if (['angelegt', 'nachgefuellt', 'existiert'].indexOf(ergebnis.code) === -1) {
      Logger.log('ABBRUCH: ALE-Zeile steht nicht -- Kreuzeder-Zeile bleibt.');
      return;
    }

    const eintrag = cachePartnerEintrag(ALE, cache);
    const zeile = cacheDealIdZeilen(eintrag, cacheSpaltenIndex(eintrag, COL.dealId))['7024'];
    Object.entries(BACKUP_7024_ALE).forEach(([header, wert]) => {
      const col = cacheSpaltenIndex(eintrag, header);
      if (!col) return;
      const zelle = eintrag.sheet.getRange(zeile, col);
      const istDatum = header === COL.erstellungsdatum;
      const vorher = zelle.getValue();
      if (vorher !== '' && vorher !== false && !istDatum) return;
      zelle.setValue(istDatum ? new Date(wert) : wert);
      logRow('partnerwechsel', 7024, ALE, header, 'aus Backup', `Zeile ${zeile}: ${zeigeWert(vorher)} -> ${wert}`);
    });
    flushLog();
    Logger.log(`ALE Zeile ${zeile}: Backup-Werte zurückgeschrieben.`);

    partnerwechselEinzeln_(7024, ALE);
  } finally {
    flushLog();
    lock.releaseLock();
  }
}

function partnerwechselEinzeln_(dealId, erwarteterPartner) {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/deals/${dealId}`;
  const deal = callPipedriveWithRetryRaw(url).data;
  const cf = deal.custom_fields || {};
  const neuerPartner = MONTAGEPARTNER_ID_TO_NAME[cf[MONTAGEPARTNER_FIELD_KEY]];

  // Schutz gegen Tippfehler bei der Deal-ID: Partner am Deal muss der erwartete sein.
  if (neuerPartner !== erwarteterPartner) {
    Logger.log(`ABBRUCH: Deal ${dealId} hat Partner "${neuerPartner}", erwartet "${erwarteterPartner}".`);
    return;
  }

  const cache = neuerSheetCache();
  const neu = cachePartnerEintrag(neuerPartner, cache);
  if (neu.fehler) {
    Logger.log(`ABBRUCH: Sheet von ${neuerPartner} nicht lesbar: ${neu.fehler}`);
    return;
  }
  const neuZeile = cacheDealIdZeilen(neu, cacheSpaltenIndex(neu, COL.dealId))[String(dealId)];
  if (!neuZeile) {
    Logger.log(`ABBRUCH: Deal ${dealId} steht noch NICHT im Sheet von ${neuerPartner} -- erst Zeile anlegen.`);
    return;
  }
  Logger.log(`Deal ${dealId} steht bei ${neuerPartner} in Zeile ${neuZeile}.`);

  let alteZeilen = 0;
  Object.keys(PARTNER_SHEET_CONFIG).forEach(alterPartner => {
    if (alterPartner === neuerPartner) return;
    const eintrag = cachePartnerEintrag(alterPartner, cache);
    if (eintrag.fehler) return;
    const dealIdCol = cacheSpaltenIndex(eintrag, COL.dealId);
    if (!dealIdCol) return;
    const zeile = cacheDealIdZeilen(eintrag, dealIdCol)[String(dealId)];
    if (!zeile) return;
    alteZeilen++;
    Logger.log(`Alte Zeile bei ${alterPartner}: Zeile ${zeile} -> wird gesichert + gelöscht, Ordner wird umgezogen.`);
    verarbeiteAlteZeile_(deal, cf, alterPartner, neuerPartner, eintrag, zeile);
  });

  // Keine alte Zeile: Ordner kann trotzdem noch beim alten Partner liegen.
  if (alteZeilen === 0) {
    const elternIter = holeOrdnerAusLink(cf[KUNDENORDNER_LINK_FIELD_KEY]).getParents();
    const elternId = elternIter.hasNext() ? elternIter.next().getId() : null;
    const alterPartner = Object.keys(PARTNER_ORDNER_IDS).find(p =>
      p !== neuerPartner && holeMontageOffenId_(p) === elternId);
    if (alterPartner) {
      const ergebnis = pruefeOrdnerUmzug_(cf[KUNDENORDNER_LINK_FIELD_KEY], alterPartner, neuerPartner, false);
      logRow('partnerwechsel', dealId, neuerPartner, 'Ordner', ergebnis.startsWith('verschoben') ? 'OK' : 'MANUELL_KLAEREN',
        `${alterPartner} -> ${neuerPartner} (keine alte Sheet-Zeile, von Hand gestartet): ${ergebnis}`);
      Logger.log(`Keine alte Zeile. Ordner: ${ergebnis}`);
    } else {
      Logger.log('Keine alte Zeile, Ordner liegt bei keinem anderen Partner in "Montage offen" -- nichts zu tun.');
    }
  }
  flushLog();
  Logger.log('Fertig. Details im Log-Sheet (Aktion "partnerwechsel").');
}
