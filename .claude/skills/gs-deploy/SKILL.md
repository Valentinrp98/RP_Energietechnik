---
name: gs-deploy
description: Google-Apps-Script-Code-Änderungen in diesem Repo live schalten (clasp push in den Browser-Editor) und danach committen. Trigger — nach jeder Code-Änderung an einem Projekt in diesem Repo, oder wenn Valentin "push", "deploy", "live schalten" sagt.
---

# GS Deploy

Standard-Workflow für alle Projekte in `RP-Google-Scripts` (Entscheidung 2026-08-21). Ersetzt den alten
Ansatz "Browser-Editor ist Source of Truth, nie `clasp push`" — Valentin will keinen manuellen
Copy-Paste-Schritt in den Apps-Script-Editor mehr. **Lokaler Code ist jetzt Source of Truth, der Editor
nur noch Laufzeit-Umgebung.** Das dreht die alte Grundannahme um: früher konnte ein Push versehentlich
Valentins Browser-Testarbeit zerstören, jetzt kann ein Push versehentlich eine direkte Browser-Änderung
zerstören, von der Claude nichts weiß (siehe "Der zentrale Risiko-Punkt" unten).

## Ablauf pro Änderung

1. **Vorprüfung, nur beim allerersten Push eines Projekts** — siehe Abschnitt "Neues Projekt binden".
2. **appsscript.json geändert?** Falls die Änderung das Manifest betrifft (neue Scopes, neue Advanced
   Services, neue Trigger-Einträge) — VOR dem Push kurz an Valentin melden, nicht erst danach. Grund:
   neue Scopes können dazu führen, dass eine bereits installierte Zeit-Trigger nach dem Push einmal neu
   autorisiert werden muss (siehe unten), sonst schlägt der nächste automatische Lauf leise fehl.
3. **Trifft die Änderung die Kernfunktion eines aktiv getriggerten Projekts?** (Liste siehe "Aktive
   Trigger" unten.) Wenn ja: kurz benennen, was sich ändert und wann der nächste automatische Lauf
   greift ("Sheet-Sync hat einen 15-Min-Trigger, das läuft mit dem Push sofort in den nächsten
   Durchlauf"). Bei reinen Test-/Debug-Helper-Funktionen, die von keinem Trigger aufgerufen werden,
   ist das nicht nötig.
4. Im jeweiligen Projektordner: `clasp push --force` (siehe "Warum --force" unten).
5. **Push schlägt fehl:** stoppen, Fehler an Valentin melden, NICHT committen.
6. **Push erfolgreich:** `git add <projektordner>`, dann `git commit -m "<Projektname>: <kurze
   Beschreibung>"`. Ein Commit pro inhaltlicher Änderung — viele kleine Commits sind gewünscht.
7. **Nie automatisch `git push` zum GitHub-Remote.** Nur auf explizite Ansage ("push jetzt",
   "Feierabend-Push", o.ä.) — und davor den Secrets-Check unten einmal durchgehen.

## Der zentrale Risiko-Punkt: clasp push ersetzt den GESAMTEN Dateibestand

Die Apps-Script-API, die `clasp push` benutzt, schreibt nicht nur die geänderten Dateien, sie **ersetzt
den kompletten Dateibestand des Projekts** durch das, was lokal existiert. Für jede Datei, die lokal
nicht (mehr) im richtigen Ordner mit der richtigen Extension liegt, gilt: nach dem Push ist sie im
Editor weg — ohne Warnung, ohne Rückfrage.

Praktische Konsequenz: **wenn Valentin zwischendurch direkt im Browser etwas ändert oder eine neue
Datei anlegt (z.B. beim Debuggen), und danach ein Push aus diesem Repo läuft, ohne dass die
Browser-Änderung vorher lokal nachgezogen wurde, ist sie ersatzlos weg.** Das ist die exakte
Kehrseite des alten Risikos (früher konnte `clasp push` Valentins Browser-Arbeit zerstören — dagegen
gab's die "nie push"-Regel; jetzt ist es andersrum, und es gibt dafür keine technische Bremse mehr).

**Faustregel:** Wenn seit dem letzten Push Zeit vergangen ist und unklar ist, ob im Editor manuell was
angefasst wurde — kurz nachfragen, statt einfach zu pushen. Bei Projekten, die ausschließlich über
Claude/dieses Repo bearbeitet werden, ist das Risiko gering; bei den Partner-Sheets/Fremdkonten-Projekten
(andere Google-Konten im Spiel) höher.

**Optionaler Drift-Check, wenn Zweifel bestehen** (kostet nichts, zerstört nichts, weil er in einen
Scratch-Ordner pullt statt lokal zu überschreiben):
```
mkdir /tmp/clasp-check && cp .clasp.json /tmp/clasp-check/
cd /tmp/clasp-check && clasp pull
diff -rq /tmp/clasp-check <projektordner> --exclude=.clasp.json
```
Zeigt Unterschiede an, ohne den lokalen Stand zu berühren. Danach `/tmp/clasp-check` löschen.

## Warum --force

In dieser (nicht-interaktiven) Umgebung kann kein Ja/Nein-Prompt beantwortet werden — `clasp push` ohne
`--force` würde bei einer Manifest-Änderung (appsscript.json) auf eine interaktive Bestätigung warten und
hängen bleiben. `--force` überspringt NUR diese eine Bestätigung. Es gibt sonst keinen Unterschied zu
einem normalen Push, und es gibt (siehe oben) ohnehin keine allgemeine Drift-Prüfung, die `--force`
zusätzlich abschalten würde — die Absicherung gegen überschriebene Browser-Änderungen muss also aus
diesem Skill kommen, nicht aus clasp selbst.

## Warum push vor commit (nicht umgekehrt)

Ziel ist, dass der Git-Verlauf immer exakt dem entspricht, was im Apps-Script-Editor tatsächlich live
ist — kein Drift zwischen "committed" und "deployed". Ein Commit ohne erfolgreichen Push wäre eine Lüge
im Log.

## Neues Projekt binden (kein `.clasp.json` vorhanden)

NICHT `clasp clone` verwenden (zieht den leeren Remote-Stand und vermischt sich mit den schon
vorhandenen lokalen Dateien). Stattdessen `.clasp.json` von Hand anlegen:
```json
{
  "scriptId": "<von Valentin>",
  "rootDir": "",
  "scriptExtensions": [".js"],
  "htmlExtensions": [".html"],
  "jsonExtensions": [".json"],
  "filePushOrder": [],
  "skipSubdirectories": true
}
```
- `scriptExtensions` nur auf die tatsächlich verwendete Extension setzen (im Projektordner nachsehen,
  nicht raten) — nie beide (`.js` und `.gs`) gleichzeitig erlauben.
- `skipSubdirectories: true`, wenn irgendein Unterordner existiert (z.B. `_backup_v1`) — sonst versucht
  `clasp push` gleichnamige Dateien aus Haupt- und Unterordner gleichzeitig zu pushen → "Conflicting
  files"-Falle über Ordner statt Extension.
- Dann `clasp push --force` — befüllt das leere Zielprojekt einmalig, unkritisch weil noch nichts Echtes
  drinsteht.
- **Möglicher Fehler beim allerersten Push in ein neues Projekt: "User has not enabled the Apps Script
  API".** Der Toggle unter `https://script.google.com/home/usersettings` ist pro Google-KONTO, nicht
  global — auch wenn er bei anderen RP-Scripts schon aktiv war, kann er beim Konto, dem das jeweilige
  Sheet/Script gehört, noch aus sein. Valentin bittet, im richtigen Konto einmalig zu aktivieren, danach
  erneut pushen.

## Aktive Trigger — Referenzliste (unvollständig, bei Unsicherheit fragen)

Das ist aus Code/Repo NICHT ableitbar (Trigger sind Projekteinstellung, nicht Teil der Dateien) — diese
Liste muss von Valentin bestätigt/aktualisiert werden, sonst veraltet sie unbemerkt:
- **Sevdesk-Pipdrive_sync:** läuft produktiv (Sync-Log mit echten Deal/Auftrag-Paaren vorhanden) —
  vermutlich aktiver Zeit-Trigger. Vor Pushes, die die Kernsync-Funktion ändern, besonders aufpassen.
- **Sheet-Sync, Ordnererstellung-bei-Gewonnen:** Stand 2026-08-17 laut Memory bewusst OHNE aktivierte
  Trigger ("Hardware muss stehen"). Ob sich das seither geändert hat: unklar, nicht neu bestätigt.
- **Bundesland-aus-PLZ, Montagepartner-aus-Bundesland, Projektdoku-Generator:** so gebaut, dass sie nur
  manuell (per Funktionsaufruf im Editor) laufen, kein Zeit-Trigger vorgesehen — Push ist hier
  risikoärmer, weil nichts automatisch mitläuft.
- **Deepcore-Automatisierung:** noch nicht live, kein Trigger.

## Secrets-Check vor jedem `git push` zum GitHub-Remote

Stand 2026-08-21 geprüft: alle Projekte lesen Tokens ausschließlich über
`PropertiesService.getScriptProperties().getProperty(...)`, keine hardcodierten Werte gefunden. Vor
jedem tatsächlichen `git push` zum Remote kurz draufschauen, ob ein neu committeter Diff einen
literalen Token/Secret enthält (nicht nur den Property-Key-Namen) — besonders wenn ein Copy-Paste aus
einem Test/Debug-Lauf im Spiel war. Repo-Sichtbarkeit (public/private) mit Valentin einmal klären, falls
noch offen.

## Bekannte Fallen (Setup/Umgebung)

- **Vier Projektordner noch ohne `.clasp.json`** (Stand 2026-08-21): `Fortschritt-Script`,
  `Namensabgleich-Fulfillment-Uebernahme`, `TimeTree-Export`, `_tests`. Dort geht `clasp push` nicht,
  bis geklärt ist, ob/wie sie gebunden werden sollen.
- **Repo liegt in OneDrive:** gelegentliche Dateisperren durch OneDrive-Sync können `git add`/`clasp
  push` kurz zum Stolpern bringen — einfach erneut versuchen, kein echter Fehler.
- **`DRY_RUN`-Schalter bleiben die eigentliche Sicherheitsbremse**, nicht der Git/Push-Workflow selbst.
  Ein Push macht Code sofort im Editor verfügbar, aber ob ein Massenlauf tatsächlich schreibt, hängt
  weiterhin von `DRY_RUN`/`FORCE_OVERWRITE` im jeweiligen Script ab.
- **Push validiert keinen Code.** Apps Script prüft Syntax/Logik erst beim tatsächlichen Ausführen, nicht
  beim Push. Ein Tippfehler geht ohne Fehlermeldung live und fällt erst beim nächsten (evtl.
  automatischen) Lauf auf.
- **Zwei parallele Bearbeiter-Quellen vermeiden:** nicht gleichzeitig im selben Projektordner per Claude
  pushen UND direkt im Editor tippen — siehe Risiko-Punkt oben.
