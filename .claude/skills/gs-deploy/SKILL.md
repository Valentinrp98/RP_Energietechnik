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
   greift ("Sevdesk-Sync hat einen 5-Min-Trigger, das läuft mit dem Push sofort in den nächsten
   Durchlauf"). Bei reinen Test-/Debug-Helper-Funktionen, die von keinem Trigger aufgerufen werden,
   ist das nicht nötig.
4. Im jeweiligen Projektordner: `clasp push --force` (siehe "Warum --force" unten).
   **Bei den vier Webhook-Projekten zusätzlich `clasp deploy --deploymentId` — siehe eigenen Abschnitt
   unten. Ohne den Schritt läuft der Webhook weiter alten Code.**
5. **Push schlägt fehl:** stoppen, Fehler an Valentin melden, NICHT committen.
6. **Push erfolgreich:** `git add <projektordner>` — **NIE `git add -A` oder `git add .` über das ganze
   Repo**, siehe "Parallele Sessions" unten. Dann `git commit -m "<Projektname>: <kurze Beschreibung>"`.
   Ein Commit pro inhaltlicher Änderung — viele kleine Commits sind gewünscht.
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
Diese Maschine läuft **Windows mit PowerShell 5.1** — kein `/tmp`, kein `&&`:
```powershell
$scratch = "$env:TEMP\clasp-check"
New-Item -ItemType Directory -Force $scratch | Out-Null
Copy-Item .clasp.json $scratch
Push-Location $scratch; clasp pull; Pop-Location
# Vergleich (Namen + Größe; für Inhaltsvergleich Get-FileHash nutzen):
Compare-Object (Get-ChildItem $scratch -Exclude .clasp.json) (Get-ChildItem <projektordner> -Exclude .clasp.json) -Property Name, Length
```
Zeigt Unterschiede an, ohne den lokalen Stand zu berühren. Danach `Remove-Item -Recurse -Force $scratch`.

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
  ⚠️ **`Montageplanung-Namensabgleich/.clasp.json` verletzt das heute** (`[".js", ".gs"]`). Es knallt
  aktuell nicht, weil dort nur `.gs`-Dateien liegen — aber die Schutzregel ist dort nicht scharf.
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

## ⚠️ Webhook-Projekte: `clasp push` reicht NICHT

**Web-App-Deployments sind versioniert, Zeit-Trigger nicht.** Ein Zeit-Trigger führt sofort den frisch
gepushten Code aus. Eine Web-App-URL bleibt dagegen auf dem alten Stand, bis die Deployment aktualisiert
wird — die bei Pipedrive registrierte `subscription_url` zeigt also weiter auf alten Code, während Push
und Commit grün aussehen. Genau dieser Fall ist am 26.08.2026 aufgetreten.

Nach `clasp push` bei diesen vier Projekten zusätzlich:

```bash
clasp deploy --deploymentId <ID>
```

| Projekt | deploymentId |
|---|---|
| Bundesland-aus-PLZ | `AKfycbz6qogKvDL1wpO5bkITp8W9h2f6wHoha_QK6JtsJD7Cil9rF-dpeJqa8WQR391HmIA60Q` |
| Montagepartner-aus-Bundesland | `AKfycbwdb-CW4Rnj97F0_dWGPu5oBWCPX9WX5lsLxNY3pKM4Ay1uZL5qghixDaodvNy9oe1MqA` |
| Projektdoku-Generator | `AKfycbz0ugT-r9AkiKeiKqM1gpzQi1IZAoRje4uXjau92OXdYrfIgKQS6hn4VHcCVEvsEActFA` |
| Ordnererstellung-bei-Gewonnen | `AKfycbwOT0kO7tcxfEsgJ412zOvTzb2p3IuUXxnbcQfAkPwB4h8n8vQ-QGbDSe8Gg0YpQ4o7` |

Im UI: Bereitstellen → Bereitstellungen **verwalten** → ✎ → Neue Version.
**Niemals "New deployment"** — das erzeugt eine zweite URL, und der registrierte Webhook zeigt weiter
auf die alte.

**Nach jedem `clasp deploy` die Zugriffsberechtigung gegenchecken.** Bekannter Fehlerfall (24.08.): sie
rutschte von "Jeder" auf "Jeder mit einem Google-Konto", danach antwortete `/exec` mit HTTP 401 statt
der normalen 302 — Googles Zugriffsverweigert-Seite, KEIN Bot-Schutz, auch wenn sie so aussieht.
`appsscript.json`s `webapp.access: ANYONE` wird beim Versions-Redeploy nicht zuverlässig übernommen.

## Aktive Trigger — Referenzliste (aus Code-Kommentaren + Memory, Stand 2026-09-01)

Trigger sind Projekteinstellung und aus den Dateien NICHT direkt ableitbar. Diese Liste ist aus
Code-Kommentaren und Memory rekonstruiert und **muss von Valentin bestätigt werden**.

> 🔴 Die frühere Zeile "Stand 2026-08-21: KEIN Projekt hat einen aktiven Trigger" war **falsch bzw. am
> selben Tag überholt** und hat die Sicherheitsstufe in Schritt 3 entwaffnet. Sie ist entfernt.

Aktiv (Stand 2026-09-01):
- **Sevdesk-Pipdrive_sync** — `syncPendingOrders`, **5-Min-Trigger** (seit 26.08., vorher 15 Min)
- **Bundesland-aus-PLZ** — Webhook + Tages-Trigger 02:00 als Backup
- **Montagepartner-aus-Bundesland** — Webhook + Tages-Trigger 03:00 als Backup
- **Projektdoku-Generator** — Webhook + Tages-Trigger 02:00 als Backup
- **Ordnererstellung-bei-Gewonnen** — nur Webhook, kein Zeit-Trigger
- **Sheet-Sync** — onEdit **nur für die Canary-Partner** ALE-Engineering + Kreuzeder (seit 31.08.).
  Die globalen 15-Min-/Tages-Trigger sind NICHT installiert.
- **Deepcore-Automatisierung** — 15-Min-Trigger vorgesehen, **Status unbestätigt**. Siehe D1 in
  `docs/BEFUNDE-2026-09-01.md` — solange das ungeklärt ist, hier nichts pushen.

**Heißt für Schritt 3:** Ein Push ist bei diesen Projekten sehr wohl zeitkritisch. Vor dem Push
benennen, was sich an der Kernfunktion ändert.

## Secrets-Check vor jedem `git push` zum GitHub-Remote

> 🔴 **Korrektur 2026-09-01.** Die frühere Aussage "alle Projekte lesen Tokens ausschließlich über
> `PropertiesService`, keine hardcodierten Werte gefunden" **stimmt nicht**. Drei Webhook-Projekte haben
> ihr Shared Secret im Klartext im committeten Code:
> - `Bundesland-aus-PLZ/Webhook.js:19`
> - `Montagepartner-aus-Bundesland/Webhook.js:23`
> - `Projektdoku-Generator/Webhook.js:21`
>
> Es ist jeweils die **einzige** Auth auf einer `ANYONE_ANONYMOUS`/`ANYONE`-Web-App, die Produktiv-Deals
> patcht. Vorlage für den Fix: `Ordnererstellung-bei-Gewonnen/Config.gs:102` (`getWebhookSecret()`).
> Bewusst vertagt — Details als D4 in `docs/BEFUNDE-2026-09-01.md`.

**Repo ist privat** (von Valentin bestätigt 2026-08-21) — senkt das Risiko, ersetzt den Check aber
nicht: vor jedem tatsächlichen `git push` zum Remote kurz draufschauen, ob ein neu committeter Diff
einen literalen Token/Secret enthält (nicht nur den Property-Key-Namen) — besonders nach Copy-Paste aus
einem Test/Debug-Lauf. Solange D4 offen ist, gilt: **diese drei Dateien enthalten bekanntermaßen ein
Secret** — das ist kein neuer Fund, sondern der dokumentierte Ist-Zustand.

## Parallele Sessions

Valentin lässt öfter mehrere Claude-Code-Sessions gleichzeitig auf diesem Repo laufen, jede an einem
anderen Projekt (Vorfall 2026-08-21: eine andere Session arbeitete live an `Projektdoku-Generator`,
während diese Session am Deploy-Workflow arbeitete — nur durch einen frischen Datei-Zeitstempel bei
einem `git add -A` aufgefallen). Zwei Regeln, die das entschärfen:
- **Nie `git add -A`/`git add .` über das ganze Repo.** Immer nur den konkreten Projektordner stagen,
  den man gerade selbst bearbeitet hat. Damit kann eine Session unmöglich fremde, unfertige Arbeit einer
  anderen Session mit committen.
- **Vor einem `git add <projektordner>` kurz auf ungewöhnlich frische Datei-Zeitstempel achten**, falls
  in dieser Session an diesem Projekt bisher nichts gemacht wurde. Wirkt verdächtig frisch und passt
  nicht zum eigenen Bearbeitungsstand → nachfragen statt einfach mitzunehmen. Siehe
  [[feedback_parallel_claude_sessions]].
- Verschiedene Projekte parallel in verschiedenen Sessions ist unproblematisch. Riskant wird's nur, wenn
  zwei Sessions GLEICHZEITIG am selben Projektordner arbeiten UND eine davon pusht, während die andere
  noch mittendrin ist — dann überschreibt der Push (voller Dateibestand-Ersatz) die unfertige Arbeit der
  anderen Session.

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
