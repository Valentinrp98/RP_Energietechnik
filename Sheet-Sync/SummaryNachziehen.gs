// ============================================================================
// Einmal-Wartung (25.09.2026): Spalte "Anlagengröße (Module)" in allen Partner-Sheets mit der
// aktuellen Verkaufte_Artikel_Summary aus Pipedrive überschreiben.
//
// Hintergrund: Die WR-Zeile der Summary zeigt jetzt Modell + Hybrid ("1x Sigenergy Energy
// Controller 20kW (Hybrid)" statt "1x Sigenergy WR 20 kW"). In Pipedrive zieht das
// summaryNachziehen*() im Projekt Sevdesk-Pipdrive_sync (syncengine.js) nach -- DIESE Funktion
// hier bringt den neuen Text danach in die bestehenden Sheet-Zeilen.
//
// Warum nicht einfach syncPipedriveToSheetFields() (FieldSync.gs)? Die würde ALLE
// pipedrive_to_sheet-Felder mitziehen (Termine, Sonstige Infos) -- der 15-Min-Timer dafür ist
// bewusst noch nicht installiert. Hier wird nur die eine Spalte angefasst.
//
// Reihenfolge: 1) summaryNachziehenScharf() im sevdesk-Projekt, 2) anlagendetailsNachziehenTrocken(),
// 3) Log-Tab prüfen, 4) anlagendetailsNachziehenScharf().
//
// Bewusst KEINE gelbe Zelle/Notiz wie bei syncPipedriveToSheetFields(): reine Formatänderung, sonst
// leuchten hunderte Zellen gelb und echte Änderungen gehen darin unter.
// ============================================================================

function anlagendetailsNachziehenTrocken() { anlagendetailsNachziehen_(true); }
function anlagendetailsNachziehenScharf()  { anlagendetailsNachziehen_(false); }

function anlagendetailsNachziehen_(trocken) {
  starteLauf(trocken ? 'anlagendetailsNachziehenTrocken' : 'anlagendetailsNachziehenScharf');
  const summary = { geaendert: 0, gleich: 0, leerInPipedrive: 0, nichtGewonnen: 0 };
  let partnerVerarbeitet = 0;

  // Alle gewonnenen Deals einmal paginiert (wie syncPipedriveToSheetFields) statt pro Zeile.
  const dealMap = {};
  let cursor = null;
  do {
    const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/deals?status=won&limit=500&sort_by=id&sort_direction=asc`
      + `&custom_fields=${ANLAGENDETAILS_FIELD_KEY}`
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
        return; // TODO_-Sheet (z.B. KOLLSTAR) -- überspringen
      }
      const dealIdCol = findColumnIndexByHeader(sheet, COL.dealId);
      const modulCol = findColumnIndexByHeader(sheet, COL.module);
      if (!dealIdCol || !modulCol) {
        Logger.log(`${partner}: Spalte "${COL.dealId}" oder "${COL.module}" fehlt -- übersprungen`);
        return;
      }
      const anzahlZeilen = Math.max(sheet.getLastRow() - 1, 0);
      if (anzahlZeilen === 0) return;
      partnerVerarbeitet++;

      const werte = sheet.getRange(2, 1, anzahlZeilen, sheet.getLastColumn()).getValues();
      for (let i = 0; i < werte.length; i++) {
        const dealId = werte[i][dealIdCol - 1];
        if (!dealId) continue;
        const deal = dealMap[dealId];
        if (!deal) { summary.nichtGewonnen++; continue; }

        const neu = String((deal.custom_fields || {})[ANLAGENDETAILS_FIELD_KEY] || '').trim();
        // Leere Summary in Pipedrive nie über einen bestehenden Sheet-Text schreiben.
        if (!neu) { summary.leerInPipedrive++; continue; }
        const alt = String(werte[i][modulCol - 1] || '').trim();
        if (alt === neu) { summary.gleich++; continue; }

        summary.geaendert++;
        if (trocken) {
          logRow('pipedrive→sheet', dealId, partner, 'Anlagendetails (Summary)', 'DRY-RUN',
                 `ALT: ${zeigeWert(alt)} | NEU: ${neu}`);
          continue;
        }
        // Pro Zelle schreiben, nicht setValues() auf den Block (Partner könnte parallel tippen).
        sheet.getRange(i + 2, modulCol).setValue(neu);
        logRow('pipedrive→sheet', dealId, partner, 'Anlagendetails (Summary)', 'geschrieben',
               `ALT: ${zeigeWert(alt)} | NEU: ${neu}`);
      }
    });
  } finally {
    Logger.log(`${trocken ? 'TROCKEN' : 'SCHARF'}: ${JSON.stringify(summary)}, Partner: ${partnerVerarbeitet}`);
    logLaufEnde(partnerVerarbeitet === 0 ? 'KETTE_BLOCKIERT' : 'OK',
                Object.assign({ modus: trocken ? 'trocken' : 'scharf', partnerVerarbeitet }, summary));
    flushLog();
  }
}
