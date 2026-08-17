# Sheet-Sync

Zwei Aufgaben, beide zeitgesteuert bzw. edit-getriggert:
1. **Neue Zeilen anlegen**: für gewonnene Deals mit gesetztem Ordner-Link (von
   `Ordnererstellung-bei-Gewonnen` gesetzt) aber noch fehlender Zeile im Partner-Sheet.
2. **Feld-Sync in beide Richtungen**: pro Feld konfigurierbar in `Config.gs` (`SYNC_FIELD_CONFIG`),
   z.B. Montagepartner trägt ZPN im Sheet ein -> Pipedrive-Feld wird aktualisiert.

## Dateien
- `Config.gs` -- alle IDs/Feldcodes, Spalten-Header-Namen, `SYNC_FIELD_CONFIG`, DRY_RUN-Schalter
- `RowCreation.gs` -- `syncNeueZeilen()`, legt fehlende Zeilen an
- `FieldSync.gs` -- `handleSheetEdit()` (Sheet->Pipedrive, sofort bei Eingabe) und
  `syncPipedriveToSheetFields()` (Pipedrive->Sheet, zeitgesteuert)
- `SetupHelpers.gs` -- Trigger installieren, Debug-/Testfunktionen

## Vor dem ersten Test -- diese TODOs in Config.gs ausfüllen
1. **KUNDENORDNER_LINK_FIELD_KEY**: derselbe field_code wie in `Ordnererstellung-bei-Gewonnen`
   (muss identisch sein, sonst wird "fertig" nicht erkannt)
2. **PARTNER_SHEET_CONFIG**: für ALE ist die Sheet-ID schon eingetragen (siehe unten), aber der
   Ziel-Tab noch offen. Für Berger/Greensky/KOLLSTAR/Kreuzeder fehlen Sheet-ID UND Tab-Name noch
   komplett.
3. **In jedem Partner-Sheet/-Tab einmalig manuell**: neue Spalte "Deal-ID" in Zeile 1 anlegen
   (Name ist als alleiniger Schlüssel nicht eindeutig -- im ALE-Sheet tauchen mehrere Namen
   doppelt auf, siehe unten)
4. **SYNC_FIELD_CONFIG**: `pipedriveFieldKey` für ZPN eintragen, sobald das Feld in Pipedrive
   existiert (`listDealFieldsHelper()` zum Nachschauen). Bei Bedarf weitere Felder ergänzen
   (z.B. Finance-Sheet-Häkchen, sobald das Finance-Sheet ebenfalls eine Deal-ID-Spalte hat).
5. **Schreibrechte prüfen**: das ALE-Sheet gehört `andre@nova-energietechnik.at`, nicht dem
   RP-Pipedrive-Script-Account -- vor Go-Live sicherstellen, dass Schreibzugriff besteht, sonst
   scheitert jeder Zeilen-/Feld-Schreibversuch mit einem Berechtigungsfehler.

## Setup-Reihenfolge
1. TODOs in Config.gs ausfüllen (siehe oben)
2. In Script Properties setzen: `PIPEDRIVE_API_TOKEN`
3. Mit `testCreateSheetRow()` bei DRY_RUN=true gegentesten
4. `installTriggers()` ausführen (idempotent -- entfernt vorher automatisch alte eigene Trigger,
   kann also gefahrlos mehrfach laufen)
5. Mit `listInstalledTriggers()` prüfen, dass alles angelegt wurde
6. Testlauf gegenchecken im Log-Sheet ("LOG_Sheet-Sync")
7. Wenn alles passt: `DRY_RUN` auf `false` stellen

## Sheets -- korrigierte Zuordnung (Stand 2026-08-12, per Drive-Metadaten verifiziert)
Die ursprüngliche Zuordnung in einer früheren Version dieser Doku war falsch (IDs und Inhalte
vertauscht, ein Sheet nie erfolgreich gelesen aber trotzdem beschrieben) -- hier der korrigierte Stand:
- **`1wQVOuOvWHsQRHxK3Upx39s4ryWvN7TWjP0nUYmZ9tlE`** = "Montageplanung Ale" (Drive-Titel), gehört
  `andre@nova-energietechnik.at`. Kein Beispiel-Sheet, sondern das echte ALE-Arbeits-Sheet.
  Mehrere Tabs: "WIEN NÖ", "STMK", "ALT" -- welcher Tab für neue Zeilen aktiv ist, ist noch mit
  Valentin zu klären (siehe TODO-Kommentar in Config.gs). Spalten: Name, Einspeisezählpunkt,
  DC-Termin, AC-Termin, Materiallieferung, Link zum Kundenordner, Abgeschlossen.
- **`1yPcgiDJD0Gua7dEBmPaPMbkhSPg7Namc`** = "Copy of Finance Tracking.xlsx" -- das echte
  Finance-Tracking-Sheet (~130 Auftragszeilen: KUNDE, TEAM, Status, AZ/SZ, Handelsspanne),
  ABER als hochgeladene .xlsx-Datei, kein natives Google Sheet. `SpreadsheetApp.openById()`
  funktioniert damit nicht direkt -- müsste erst als Google Sheet konvertiert/neu angelegt werden,
  bevor hier Feld-Sync-Einträge dafür ergänzt werden.
- **`1O4unL6O3SvnSp2EA2e0IDMq25h3VWIhD1knkMup1gdo`** = "Copy of Deep Core List 2026", natives
  Google Sheet, enthält laut Vorschau u.a. einen Marketing-/Leads-Tab -- Inhalt/Relevanz für
  diese Sync-Kette noch nicht geklärt, wurde noch nie vollständig gelesen (zu groß für einen
  Lesevorgang). Vor Nutzung erst klären, ob das überhaupt zum Finance-/Montagepartner-Sync gehört.
