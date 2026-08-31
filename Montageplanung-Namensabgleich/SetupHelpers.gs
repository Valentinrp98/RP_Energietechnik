// ============================================================
// Einmalige Format-Einrichtung pro Partner-Sheet
// ============================================================
// Reine Zellformatierung, kein Datenzugriff auf Pipedrive.

// Richtet Checkbox-Format ein für die drei Felder, die laut Sheet-Sync/Config.gs SYNC_FIELD_CONFIG
// tatsächlich als Checkbox definiert sind (verifiziert im Code, nicht nur aus Erinnerung):
//   - Netzanmeldung eingereicht (C) -- valueType checkbox_to_option
//   - IB erledigt (O) -- valueType checkbox_to_date, erzeugt zusätzlich eine Pipedrive-Aktivität
//   - Fertigmeldung (P) -- valueType checkbox_to_date, setzt zusätzlich Netzstatus
// DC Termin/AC Termin/IB Termin sind bewusst KEINE Checkboxen -- normale bidirektionale
// Datumsfelder, die sowohl RP als auch der Partner direkt beschreiben dürfen.
// Google Sheets zeigt Checkboxen intern als WAHR/FALSCH, das ist beabsichtigt. Die drei Spalten
// waren in den Kopiervorlagen nie befüllt (nur B bis J), insertCheckboxes() macht daraus sauber
// unchecked-Checkboxen ohne etwas zu überschreiben.
// FIX 31.08.2026 (Valentins Vorgabe): für ALLE Partner in TARGET_SHEETS statt nur
// AKTUELLER_PARTNER -- reine Zellformatierung, kein Pipedrive-Zugriff, deshalb auch für noch
// nicht befüllte Partner-Sheets unbedenklich (anders als die Trigger-Funktionen in Sheet-Sync).
function richteCheckboxenEin() {
  Object.keys(TARGET_SHEETS).forEach(partner => {
    const sheetId = TARGET_SHEETS[partner];
    if (!sheetId) {
      Logger.log('WARNUNG: keine Sheet-ID für "%s" -- übersprungen.', partner);
      return;
    }
    const spreadsheet = SpreadsheetApp.openById(sheetId);
    const tab = getTargetTab(spreadsheet, partner);
    const letzteDatenzeile = Math.max(tab.getLastRow(), 2);
    const letzteZeileMitPuffer = letzteDatenzeile + 200; // Platz für künftige neue Zeilen

    // FIX 31.08.2026: vor dem Umformatieren pruefen, ob in den drei Spalten schon Werte stehen,
    // die KEINE Boolean sind. insertCheckboxes() setzt eine Datenvalidierung -- vorhandene
    // Fremdwerte bleiben stehen, werden aber als ungueltig markiert, und das faellt in einem
    // 82-zeiligen Sheet niemandem auf. Realistischer Fall: die Altlisten hatten in der
    // Netzanmeldung-Spalte teils TRUE/FALSE, am Ende einer Liste aber auch Freitext-Kuerzel
    // ("s"/"a", Bedeutung bis heute ungeklaert, siehe project_montage_sheets_migration). Wurden
    // die mitmigriert, wuerde diese Funktion sie lautlos entwerten.
    // Deshalb: Rohwerte mitloggen statt nur "fertig" zu melden (CLAUDE.md-Regel).
    const letzteEcht = tab.getLastRow();
    if (letzteEcht >= 2) {
      [COL.NETZANMELDUNG, COL.IB_ERLEDIGT, COL.FERTIGMELDUNG].forEach(spalte => {
        const werte = tab.getRange(2, spalte, letzteEcht - 1, 1).getValues();
        const fremd = [];
        werte.forEach((r, idx) => {
          const v = r[0];
          if (v !== '' && v !== null && typeof v !== 'boolean') fremd.push('Zeile ' + (idx + 2) + ': "' + v + '"');
        });
        if (fremd.length) {
          Logger.log('WARNUNG [%s] Spalte %s: %s Nicht-Checkbox-Werte gefunden, werden durch die Validierung als ungueltig markiert -- bitte vorher klaeren: %s',
            partner, spalte, fremd.length, fremd.slice(0, 10).join(' | '));
        }
      });
    }

    tab.getRange(2, COL.NETZANMELDUNG, letzteZeileMitPuffer - 1, 1).insertCheckboxes();
    tab.getRange(2, COL.IB_ERLEDIGT, letzteZeileMitPuffer - 1, 1).insertCheckboxes();
    tab.getRange(2, COL.FERTIGMELDUNG, letzteZeileMitPuffer - 1, 1).insertCheckboxes();

    Logger.log('Checkboxen eingerichtet für "%s": Spalte %s (Netzanmeldung eingereicht), %s (IB erledigt), %s (Fertigmeldung), Zeile 2 bis %s.',
      partner, COL.NETZANMELDUNG, COL.IB_ERLEDIGT, COL.FERTIGMELDUNG, letzteZeileMitPuffer);
  });
}
