---
name: gs-deploy
description: Google-Apps-Script-Code-Änderungen in diesem Repo live schalten (clasp push in den Browser-Editor) und danach committen. Trigger — nach jeder Code-Änderung an einem Projekt in diesem Repo, oder wenn Valentin "push", "deploy", "live schalten" sagt.
---

# GS Deploy

Standard-Workflow für alle Projekte in `RP-Google-Scripts` (Entscheidung 2026-08-21). Ersetzt den alten
Ansatz "Browser-Editor ist Source of Truth, nie `clasp push`" — Valentin will keinen manuellen
Copy-Paste-Schritt in den Apps-Script-Editor mehr, sondern dass Claude direkt pusht. Damit ist der
lokale Code jetzt Source of Truth, der Editor nur noch Laufzeit-Umgebung.

## Ablauf pro Änderung

1. **Vorprüfung (nur beim allerersten Push eines Projekts nötig):**
   - `.clasp.json` muss existieren. Fehlt es, ist das Projekt noch nicht an ein Apps-Script-Projekt
     gebunden — vor dem Push klären, ob es das schon gibt (`clasp clone <scriptId>`) oder ob es ein
     komplett neues, leeres Projekt ist (dann ist ein einmaliger Push in ein leeres Projekt unkritisch).
   - Keine Datei darf im selben Projektordner doppelt als `.gs` UND `.js` vorliegen (gleicher Basename) —
     sonst bricht `clasp push` mit "Conflicting files found" ab.
2. Im jeweiligen Projektordner: `clasp push`.
3. **Push schlägt fehl:** stoppen, Fehler an Valentin melden, NICHT committen.
4. **Push erfolgreich:** `git add <projektordner>`, dann `git commit -m "<Projektname>: <kurze Beschreibung>"`.
   Ein Commit pro inhaltlicher Änderung — viele kleine Commits sind hier gewünscht, nicht vermeiden.
5. **Nie automatisch `git push` zum GitHub-Remote.** Das passiert nur auf explizite Ansage
   ("push jetzt", "Feierabend-Push", o.ä.).

## Warum push vor commit (nicht umgekehrt)

Ziel ist, dass der Git-Verlauf immer exakt dem entspricht, was im Apps-Script-Editor tatsächlich live
ist — kein Drift zwischen "committed" und "deployed". Ein Commit ohne erfolgreichen Push wäre eine Lüge
im Log.

## Bekannte Fallen

- **`scriptExtensions` in `.clasp.json`:** mehrere Projekte haben noch `[".js", ".gs"]` (beide erlaubt)
  statt einer einzigen Extension. Stand 2026-08-21 keine Duplikate vorhanden, aber bei neu angelegten
  Dateien im Auge behalten (nicht versehentlich dieselbe Datei als `.gs` und `.js` anlegen).
- **Fünf Projektordner ohne `.clasp.json`** (Stand 2026-08-21): `Deepcore-Automatisierung`,
  `Fortschritt-Script`, `Namensabgleich-Fulfillment-Uebernahme`, `TimeTree-Export`, `_tests`. Dort geht
  `clasp push` nicht, bis geklärt ist, ob/wie sie gebunden werden sollen.
- **Repo liegt in OneDrive:** gelegentliche Dateisperren durch OneDrive-Sync können `git add`/`clasp push`
  kurz zum Stolpern bringen — einfach erneut versuchen, kein echter Fehler.
- **`DRY_RUN`-Schalter bleiben die eigentliche Sicherheitsbremse**, nicht der Git/Push-Workflow selbst.
  Ein Push macht Code sofort im Editor verfügbar, aber ob ein Massenlauf tatsächlich schreibt, hängt
  weiterhin von `DRY_RUN`/`FORCE_OVERWRITE` im jeweiligen Script ab.
