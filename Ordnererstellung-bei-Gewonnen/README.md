# Ordnererstellung bei Gewonnen

Sobald ein Pipedrive-Deal auf Status "Gewonnen" wechselt: legt den Kundenordner im richtigen
Montagepartner-Unterordner in Drive an und schreibt den Ordner-Link zurück ins Deal.

Kein Sheet-Kontakt -- das übernimmt das separate Projekt `Sheet-Sync`, das erkennt "Ordner-Link
ist gesetzt" als Signal, dass hier fertig gearbeitet wurde.

## Dateien
- `Config.gs` -- alle IDs/Feldcodes, DRY_RUN-Schalter
- `FolderCreation.gs` -- `processGewonnenDeal(dealId)`, die Kernlogik
- `WebhookHandler.gs` -- `doPost(e)`, nimmt Pipedrive-Webhook entgegen
- `SetupHelpers.gs` -- Webhook registrieren, Debug-/Testfunktionen

## Vor dem ersten Test -- diese TODOs in Config.gs ausfüllen
1. **KUNDENORDNER_LINK_FIELD_KEY**: Neues Text/URL-Custom-Field "Kundenordner-Link" am Deal in
   Pipedrive anlegen, dann `listDealFieldsHelper()` ausführen und den `field_code` eintragen.
2. **PARTNER_TO_DRIVE_FOLDER_ID**: für jeden der 5 Montagepartner (ALE, Berger, Greensky,
   KOLLSTAR, Kreuzeder) die Ordner-ID des jeweiligen Partner-Hauptordners in Drive eintragen.

## Setup-Reihenfolge
1. TODOs in Config.gs ausfüllen (siehe oben)
2. In Script Properties setzen: `PIPEDRIVE_API_TOKEN`, `WEBHOOK_SECRET` (selbst einen
   zufälligen String ausdenken, z.B. per Passwortgenerator)
3. Mit `testEinzelDeal()` oder `processAusgewaehlteDeals()` bei DRY_RUN=true gegentesten
4. Als Web App deployen (Bereitstellen > Neue Bereitstellung > Web App, "Wer hat Zugriff: Jeder")
5. `registerPipedriveWebhook(webAppUrl)` mit der URL aus Schritt 4 einmalig ausführen
6. Testlauf gegenchecken im Log-Sheet (wird beim ersten Lauf automatisch angelegt: "LOG_Ordnererstellung bei Gewonnen")
7. Wenn alles passt: `DRY_RUN` auf `false` stellen
