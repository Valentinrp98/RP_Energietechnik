# Projektdoku-Generator

Erzeugt ein formatiertes Google Doc pro PV-Deal (Kundendaten, Installation, Verkabelung,
Anlagendetails) aus Pipedrive-Daten und legt es im Kundenordner ab -- statt manueller Word-Doku.

Ausgelöst NICHT über Stage-Wechsel/Webhook, sondern über das bestehende Enum-Feld
"Projektdokumentation-Partner" am Deal (`d33a358f840e5e1ccade4e1f88cd9109ae3e63f4`), mit den
Optionen "Projektdoku rdy for creation" (Trigger für den nächsten Lauf) und "Projektdoku erstellt
und abgelegt" (fertig). Das Feld ist gleichzeitig Trigger UND Idempotenz-Marker -- kein
Script-Property-State nötig (vermeidet die 9-KB/~285-Einträge-Falle). Zusätzlich prüft
`processDeal()` den tatsächlichen Ordnerinhalt (Duplikat-Schutz über den Doc-Namen), nicht nur das
Statusfeld -- deckt auch den Fall ab, dass ein früherer Lauf das Doc erzeugt, aber den
Status-Patch danach nicht mehr geschafft hat (self-healing: Link/Status werden dann nachgezogen).

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

## Bekannte offene Punkte
Siehe `FIXES-2026-08-17.md` und `BAU-LOG-2026-08-17.md` im selben Ordner für den vollständigen
Verlauf (gefixte Bugs, Testergebnisse, noch offene Punkte).
