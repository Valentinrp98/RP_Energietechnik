# Projektdoku-Generator

Erzeugt ein formatiertes Google Doc pro PV-Deal (Kundendaten, Installation, Verkabelung,
Anlagendetails) aus Pipedrive-Daten und legt es im Kundenordner ab -- statt manueller Word-Doku.

Ausgelöst über das bestehende Enum-Feld "Projektdokumentation-Partner" am Deal
(`d33a358f840e5e1ccade4e1f88cd9109ae3e63f4`), mit den Optionen "Projektdoku rdy for creation"
(Trigger für den nächsten Lauf) und "Projektdoku erstellt und abgelegt" (fertig). Das Feld ist
gleichzeitig Trigger UND Idempotenz-Marker -- kein Script-Property-State nötig (vermeidet die
9-KB/~285-Einträge-Falle). Zusätzlich prüft `processDeal()` den tatsächlichen Ordnerinhalt
(Duplikat-Schutz über den Doc-Namen), nicht nur das Statusfeld -- deckt auch den Fall ab, dass ein
früherer Lauf das Doc erzeugt, aber den Status-Patch danach nicht mehr geschafft hat (self-healing:
Link/Status werden dann nachgezogen).

**Zwei Auslöser, hybrid (seit 2026-08-21):** ein `change.deal`-Webhook reagiert sofort, wenn das
Statusfeld auf einen der Trigger-Werte gesetzt wird -- der ursprüngliche Tages-Trigger (02:00 Uhr)
bleibt zusätzlich als Backup aktiv, falls ein Webhook-Event verloren geht (Pipedrive-eigene
Retry-/Ban-Logik) oder Pipedrive den Webhook nach 3 Tagen Dauerausfall automatisch löscht. Beide
Pfade rufen dieselbe `processDeal()`-Logik auf und sind über den
tatsächlichen Ordnerinhalt idempotent -- ein doppelt verarbeitetes Event legt kein zweites Doc an.

Nutzt den bereits von `Ordnererstellung-bei-Gewonnen` angelegten Kundenordner (liest dessen
Kundenordner-Link-Feld `5c442fe317da26ed4f60504e2b912df7e3116c5b`) und legt das Doc in dessen
Unterordner `2_Projektdokumentation` ab -- keine eigene Partner-Ordner-Zuordnung nötig.
Voraussetzung: `Ordnererstellung-bei-Gewonnen` muss für den Deal schon gelaufen sein, sonst
SOFT_ERROR (kein Bug, siehe Log).

## Dateien
- `Config.js` -- alle field_codes/Options-IDs, `DRY_RUN`/`MAX_LAUFZEIT_MS`, API-Helfer
  (`fetchPipedrive`, `patchCustomFieldsVerified`), Logging, Anzeige-Helfer (`resolveEnumLabel` etc.)
- `DocGeneration.js` -- `generateDailyProjectDocumentation()`, `processDeal(deal)`, `buildProjectDoc()`
- `SetupHelper.js` -- Trigger anlegen, `checkConfiguration()`, `listDealFieldsHelper()`, `testEinzelDeal()`
- `Webhook.js` -- `doPost()` (Web-App-Empfang), Webhook-Registrierung/-Diagnose
  (`SETUP_EINMALIG_registerWebhook()`, `checkWebhookRegistration()`, `loescheWebhookMitId()`)

## Phase 1 (MVP) -- bewusste Einschränkungen
- Anlagendetails (Module, Speicher, etc.) kommen aus dem vom sevdesk-Sync befüllten Freitextfeld
  "Verkaufte_Artikel_Summary", nicht direkt aus sevdesk -- entkoppelt dieses Script von dessen
  Go-Live-Checkliste. Siehe `project_sevdesk_pipedrive_sync`.
- Logging läuft in ein eigenes Sheet ("LOG_Projektdoku-Generator"), aber mit dem Schema, das für
  das geplante zentrale Automations-Dashboard entschieden wurde (OK/SOFT_ERROR/HARD_ERROR) --
  späterer Umzug ist nur ein ID-Wechsel, kein Rewrite.

## Setup-Reihenfolge
1. `PIPEDRIVE_API_TOKEN` in Script Properties setzen
2. `checkConfiguration()` ausführen -- muss "alles passt" melden (prüft alle field_codes UND alle
   hartcodierten Options-IDs gegen die echten Pipedrive-Felder, inkl. Feldtyp des Status-Felds)
3. `testEinzelDeal()` bei `DRY_RUN = true` gegen einen echten Deal mit Kundenordner testen
4. `DRY_RUN = false`, `testEinzelDeal()` nochmal -- Doc liegt in `2_Projektdokumentation` (nicht im
   Drive-Root), Link + Status stehen am Deal, Log-Sheet zeigt die Zeile
5. Gegenprobe: `testEinzelDeal()` ein drittes Mal -- muss "Doc existiert bereits" melden (oder bei
   fehlendem Link/Status "Link/Status nachgezogen"), auf keinen Fall ein zweites Doc
6. `SETUP_EINMALIG_createDailyTrigger()` einmalig ausführen
7. Ersten echten Tageslauf im Log-Sheet gegenchecken

## Setup Webhook (zusätzlich zum Tages-Trigger, nach obigen Schritten)
1. Deploy > New deployment > Web app -- **Execute as: Me**, **Who has access: Anyone** (kein
   Google-Login, sonst kommt Pipedrive nie durch). URL kopieren.
2. In `Webhook.js`: `WEBHOOK_SHARED_SECRET` auf einen zufälligen String setzen (z.B. einmal
   `Utilities.getUuid()` in der Konsole ausführen), `WEBHOOK_SUBSCRIPTION_URL` = kopierte Web-App-URL
   **plus** `?secret=<derselbe String>` am Ende.
3. `SETUP_EINMALIG_registerWebhook()` ausführen.
4. `checkWebhookRegistration()` ausführen -- muss `version=2.0 (ok)`, `event_action=change (ok)`,
   `event_object=deal (ok)`, genau ein Treffer melden.
5. Testweise einen Deal in Pipedrive auf "Projektdoku rdy for creation" setzen, Log-Sheet prüfen
   (Detail-Spalte beginnt mit `[Webhook]`) -- sollte binnen Sekunden erscheinen, nicht erst um 02:00.
6. Tages-Trigger NICHT deaktivieren -- bleibt als Backup (siehe oben).

## Bekannte offene Punkte
Siehe `FIXES-2026-08-17.md` und `BAU-LOG-2026-08-17.md` im selben Ordner für den vollständigen
Verlauf (gefixte Bugs, Testergebnisse, noch offene Punkte).
