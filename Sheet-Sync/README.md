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
2. **PARTNER_TO_SHEET_ID**: für jeden der 5 Montagepartner die Sheet-ID der jeweiligen
   Google-Sheets-Datei eintragen
3. **In jedem Partner-Sheet einmalig manuell**: neue Spalte "Deal-ID" in Zeile 1 anlegen
   (Name ist als alleiniger Schlüssel nicht eindeutig -- siehe Analyse, mehrere Kunden mit
   gleichem Namen tauchen im Beispiel-Sheet doppelt auf)
4. **SYNC_FIELD_CONFIG**: `pipedriveFieldKey` für ZPN eintragen, sobald das Feld in Pipedrive
   existiert (`listDealFieldsHelper()` zum Nachschauen). Bei Bedarf weitere Felder ergänzen
   (z.B. Finance-Sheet-Häkchen, sobald das Finance-Sheet ebenfalls eine Deal-ID-Spalte hat).

## Setup-Reihenfolge
1. TODOs in Config.gs ausfüllen (siehe oben)
2. In Script Properties setzen: `PIPEDRIVE_API_TOKEN`
3. Mit `testCreateSheetRow()` bei DRY_RUN=true gegentesten
4. `installTriggers()` einmalig ausführen (zeitgesteuerte Trigger + onEdit-Trigger pro Partner-Sheet)
5. Mit `listInstalledTriggers()` prüfen, dass alles angelegt wurde
6. Testlauf gegenchecken im Log-Sheet ("LOG_Sheet-Sync")
7. Wenn alles passt: `DRY_RUN` auf `false` stellen

## Bereits erledigte Vorarbeit / gelesene Sheets
- Finance-Tracking-Sheet (`1O4unL6O3SvnSp2EA2e0IDMq25h3VWIhD1knkMup1gdo`): ~130 Auftragszeilen,
  darunter im selben Tab ein separater Cashflow-/Abbauplan-Bereich -- ein künftiges Script darf
  nur den Auftrags-Zeilenbereich anfassen, nicht den Bereich darunter.
- Beispiel-Montagepartner-Sheet (`1yPcgiDJD0Gua7dEBmPaPMbkhSPg7Namc`): Spalten Name,
  Einspeisezählpunkt, DC-Termin, AC-Termin, Materiallieferung, Link zum Kundenordner,
  Abgeschlossen. Zuordnung zu welchem Partner noch offen.
