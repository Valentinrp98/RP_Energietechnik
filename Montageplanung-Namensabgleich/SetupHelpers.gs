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
// Google Sheets zeigt Checkboxen intern als WAHR/FALSCH, das ist beabsichtigt. Für
// AKTUELLER_PARTNER aus Config.gs, mit Puffer für künftige neue Zeilen. Die drei Spalten waren
// in den Kopiervorlagen nie befüllt (nur B bis J), insertCheckboxes() macht daraus sauber
// unchecked-Checkboxen ohne etwas zu überschreiben.
function richteCheckboxenEin() {
  const spreadsheet = SpreadsheetApp.openById(TARGET_SHEET_ID);
  const tab = getTargetTab(spreadsheet);
  const letzteDatenzeile = Math.max(tab.getLastRow(), 2);
  const letzteZeileMitPuffer = letzteDatenzeile + 200; // Platz für künftige neue Zeilen

  tab.getRange(2, COL.NETZANMELDUNG, letzteZeileMitPuffer - 1, 1).insertCheckboxes();
  tab.getRange(2, COL.IB_ERLEDIGT, letzteZeileMitPuffer - 1, 1).insertCheckboxes();
  tab.getRange(2, COL.FERTIGMELDUNG, letzteZeileMitPuffer - 1, 1).insertCheckboxes();

  Logger.log('Checkboxen eingerichtet für "%s": Spalte %s (Netzanmeldung eingereicht), %s (IB erledigt), %s (Fertigmeldung), Zeile 2 bis %s.',
    AKTUELLER_PARTNER, COL.NETZANMELDUNG, COL.IB_ERLEDIGT, COL.FERTIGMELDUNG, letzteZeileMitPuffer);
}
