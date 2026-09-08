# Ordnererstellung bei Gewonnen

> ## ⚠️ Diese README ist teilweise veraltet — nachgeprüft 2026-09-01
>
> | Behauptung unten | Tatsächlich |
> |---|---|
> | Offene TODOs (`WEB_APP_URL` nicht gesetzt, Webhook nicht registriert) | **Alle erledigt.** Web-App deployed, Webhook seit 26.08. live (`is_active: 1`). |
> | „5 Montagepartner" | **7** — Tiroler Partner (Option 243) und Vorarlberg Partner (244) kamen am 20.08. dazu, `Config.gs:52-60` |
> | `registerPipedriveWebhook(webAppUrl)` **mit** Parameter | Die Funktion nimmt **keinen** Parameter. `Config.gs:74-78` erklärt ausführlich warum: der ▷-Button ruft ohne Argumente auf, ein Parameter würde als `undefined` durchgehen und einen kaputten Webhook auf die URL „undefined" registrieren. |
> | Setup-Schritt „`DRY_RUN` auf false stellen" | **Schon geschehen** (`Config.gs:90`) |
>
> **Dieses Projekt macht zwei Dinge vorbildlich** — als Vorlage nutzen:
> - **Secret aus Script Properties** (`getWebhookSecret()`, `Config.gs:102`) statt hardcodiert. Die drei
>   anderen Webhook-Projekte haben es im Klartext im Code (siehe D4).
> - **Self-Trigger-Guard in der richtigen Form** („nichts geändert", nicht „alles gefüllt"),
>   `KundendatenSnapshot.gs:71-80`, mit dem behobenen Bug bei `:62-70` dokumentiert.
>
> ### 🔴 Offene Befunde
> - **D13** — `listPipedriveWebhooks()` (`SetupHelpers.gs:54`) ruft `/api/v2/webhooks`, obwohl Webhooks
>   v1 sind. `registerPipedriveWebhook()` (`:30`) und `loescheWebhookMitId()` (`:77`) machen es richtig.
>   Ausgerechnet die eine Diagnose, die eine kaputte Registrierung zeigen würde, bricht die Regel.
> - **D14** — `KundendatenSnapshot.gs:144-147`: beim allerersten Lauf ohne gespeicherten Cursor wirft
>   `setProperty(key, null)`. Dazu fehlt bei `:148` das `encodeURIComponent` um den Cursor.
> - **D18** — `FolderCreation.gs:32` nutzt `waitLock(30000)` auf dem Webhook-Pfad. Pipedrives
>   Antwortfenster ist ~10 s; alle anderen Webhooks nutzen `tryLock(5000)`. `SetupHelpers.gs:63-69`
>   dokumentiert den daraus entstandenen Vorfall — die Diagnose wurde geschrieben, der Code nicht geändert.
> - **D22** — `FolderCreation.gs:140-143` zitiert einen Config-Kommentar, der am 27.08. korrigiert wurde.
>
> Details: [`../docs/BEFUNDE-2026-09-01.md`](../docs/BEFUNDE-2026-09-01.md)

---

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
