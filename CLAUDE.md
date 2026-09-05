# RP-Google-Scripts

Google-Apps-Script-Monorepo für RP Energietechnik. 16 Unterordner, jeder ein **eigenes** Apps-Script-Projekt (eigene `.clasp.json`, eigener Namensraum). Automatisiert Pipedrive, Google Drive, Google Sheets und sevdesk rund um den PV-Fulfillment-Prozess.

**Bevor du hier irgendetwas baust:** [`docs/REFERENZ-Pipedrive-AppsScript.md`](docs/REFERENZ-Pipedrive-AppsScript.md) — alle `field_code`s, Enum-Option-IDs, Drive-Ordner-IDs und die API-Fallen, die schon einmal Zeit gekostet haben.

---

## 🔴 Zuerst lesen: offene Befunde

Review vom **2026-09-01**, 25 Befunde. Langfassung mit Wirkung und Fix-Skizze: [`docs/BEFUNDE-2026-09-01.md`](docs/BEFUNDE-2026-09-01.md).
**Nichts davon ist gefixt** — der Durchgang war bewusst nur Review + Doku.

### P0 — wirkt jetzt, still

| # | Was | Wo |
|---|---|---|
| **D1** | **Deepcore schreibt live in die Test-Kopie.** `DRY_RUN = false` bei einer Sheet-ID, die der Code selbst „⚠️ AKTUELL NUR DIE TEST-KOPIE" nennt. Das Script *appended* nur, korrigiert nie — jede Zeile im falschen Sheet fehlt dauerhaft im echten, und `DEEPCORE_SYNCED_ORDERS` markiert sie als erledigt, also backfillt späteres Umbiegen **nicht**. | `Deepcore-Automatisierung/sheetwriter.js:19` + `syncengine.js:30` |
| **D2** | **Sheet-Sync verliert Partner-Edits.** `handleSheetEdit` und `verarbeitePendingCellEdits` machen beide Read-Modify-Write auf `PENDING_CELL_EDITS`. Im ganzen Projekt gibt es **null** `LockService`-Aufrufe. Ein onEdit zwischen Load und Save wird überschrieben — kein Fehler, keine Notiz. Läuft heute bei ALE + Kreuzeder. | `Sheet-Sync/FieldSync.gs:52/78` vs. `:108/161` |
| **D3** | **Einmal-Trigger werden nie gelöscht.** Beide Stellen erzeugen `.after()`-Trigger; kein `deleteTrigger` zielt darauf, die Handler löschen sich nicht selbst. Nach ~20 Bursts wirft `.create()`, wird nur geloggt — und die Queue wird nie wieder verarbeitet. | `Sheet-Sync/Config.gs:698`, `Projektdoku-Generator/Webhook.js:300` |
| **D4** | **Shared Secrets im Klartext committet.** Einzige Auth auf Web-Apps mit `ANYONE_ANONYMOUS`/`ANYONE`, die Produktiv-Deals patchen. Vorlage für den Fix steht daneben: `Ordnererstellung-bei-Gewonnen/Config.gs:102` liest korrekt aus ScriptProperties. **Bewusst vertagt.** | `Bundesland-aus-PLZ/Webhook.js:19`, `Montagepartner-aus-Bundesland/Webhook.js:23`, `Projektdoku-Generator/Webhook.js:21` |
| **D5** | **sevdesk-`pruefeKonfiguration()` kann nie grün werden** (zwei `PLACEHOLDER_*`-Keys → dauerhaft FEHLER) und überspringt durch einen Groß-/Kleinschreibungs-Mismatch genau die eine Enum-Prüfung: `ENUM_OPTION_IDS` nutzt `Zahlungseingang_erhalten`, `FIELD_KEYS` nutzt `zahlungseingang_erhalten`. | `Sevdesk-Pipdrive_sync/syncengine.js:1239`, `fieldkeysandmapping.js:52` vs. `:24` |
| **D6** | **`SM_FS_Typ` ist eine geladene Waffe.** `{ 'SM': null, 'FS': null }` — heute harmlos, weil der Platzhalter-`field_code` vorher abbricht. Trägt jemand nur den echten Code ein, ohne die Option-IDs, wird das Feld auf **jedem** synchronisierten Deal geleert. Nur eine `Logger.log`-Warnung. | `Sevdesk-Pipdrive_sync/fieldkeysandmapping.js:56` |

### ❓ Nur Valentin kann das klären

- **Läuft Deepcores 15-Min-Trigger?** Von außen nicht prüfbar. [Editor öffnen](https://script.google.com/home/projects/11yWak9ypgCKOh0GnGfskmlWDBy-8GMa6w_up68H7cQ2OjpywGpz1yuqL/edit) → Trigger. **Das ist die erste Handlung, wenn hier wieder gearbeitet wird.**
- **Zeigt `DEEPCORE_SHEET_ID` absichtlich auf die Test-Kopie**, oder wurde das Umbiegen vergessen?

### P1 — beißt unter Last

`D7` sevdesk-Log macht `openById` + `appendRow` **pro Datensatz**, alle 5 Min → ~7.200 Sheets-Calls/Tag (`syncengine.js:328`; alle anderen Projekte puffern längst) · `D8` Laufzeit-Stoppuhr startet **nach** der teuren Pagination, der Guard greift also nie (`syncengine.js:1387/1423`, `Fortschritt-Script/Code.gs:92`) · `D9` `findNextEmptyRowFor` macht ~800 einzelne `getValue()` pro neuer Zeile (`Sheet-Sync/Config.gs:469`) · `D10` `openById` in der Queue-Schleife ohne Cache (`FieldSync.gs:123`) · `D11` schreibt Angebotsnummer und sucht sofort per `itemSearch` darauf — Index-Delay, Auftrag wird nach 5 Fehlversuchen geparkt (`syncengine.js:850/1192`) · `D12` `dealFields` ohne `?limit=500` → meldet existierende Felder als „existiert nicht" (`zahlungseingang.js:318`, `fieldsetup.js:100/117`) · `D13` `/api/v2/webhooks` obwohl Webhooks v1 sind, ausgerechnet in der einen Diagnose, die eine kaputte Registrierung zeigen würde (`Ordnererstellung/SetupHelpers.gs:54`) · `D14` Backfill-Cursor: `setProperty(key, null)` wirft beim ersten Lauf, dazu fehlendes `encodeURIComponent` (`KundendatenSnapshot.gs:144`) · `D15` `klassifiziereUndVerschiebe` verschiebt nichts, es *kopiert* — ohne Existenzprüfung, zweiter Lauf zahlt Anthropic doppelt (`Klassifikation.gs:184`).

### P2/P3 — Altlasten

`D16` form-prefill hat **gar keinen** Retry · `D17` vier Kommentare behaupten „2s, 4s, 8s", real sind es 2s und 4s · `D18` `waitLock(30000)` auf dem Webhook-Pfad, Pipedrives Fenster ist ~10s (`Ordnererstellung/FolderCreation.gs:32`) · `D19` stille `break`s bei Pagination-Grenzen · `D20` `status=won`-Filter lässt re-öffnete Deals lautlos aus dem Sync fallen · `D21`–`D25` toter Code, widersprüchliche Kommentare, 3 leere `Script ID.txt`.

### Sauber geprüft — nicht nochmal aufrollen

Kein `?api_token=` auf einer v2-URL · kein `Bearer`-Missbrauch · kein `status=all_not_deleted` in Live-Code · kein `.name`/`.key` auf v2-Feld-Metadaten · `custom_fields`-Patches sind überall gegen `undefined` abgesichert (Ausnahme ist nur D6) · **keine Self-Trigger-Schleife mehr** — alle Guards haben die richtige „nichts geändert"-Form.

---

## Deployment

**Lokaler Code ist Source of Truth** (Entscheidung 21.08.2026). Der Browser-Editor ist nur noch Laufzeitumgebung. Die ältere Regel „Browser ist Source of Truth, niemals `clasp push`" ist **aufgehoben** — sie steht noch in `ARCHITEKTUR-2026-08-13.md` und in ein paar Memory-Dateien.

```bash
clasp push --force        # im jeweiligen Projektordner
```

### ⚠️ Bei Webhook-Projekten reicht `clasp push` NICHT

Web-App-Deployments sind **versioniert**, Zeit-Trigger nicht. Ein Zeit-Trigger führt sofort den neu gepushten Code aus — eine Web-App-URL bleibt auf dem alten Stand, bis die Deployment aktualisiert wird. Die bei Pipedrive registrierte `subscription_url` zeigt sonst weiter auf alten Code, während Push und Commit grün aussehen.

```bash
clasp deploy --deploymentId <ID aus der subscription_url>
```

**Niemals „New deployment"** — das erzeugt eine zweite URL, und der registrierte Webhook zeigt weiter auf die alte. Im UI: Bereitstellen → Bereitstellungen **verwalten** → ✎ → Neue Version.

Die vier Webhook-Projekte und ihre Deployment-IDs:

| Projekt | deploymentId |
|---|---|
| Bundesland-aus-PLZ | `AKfycbz6qogKvDL1wpO5bkITp8W9h2f6wHoha_QK6JtsJD7Cil9rF-dpeJqa8WQR391HmIA60Q` |
| Montagepartner-aus-Bundesland | `AKfycbwdb-CW4Rnj97F0_dWGPu5oBWCPX9WX5lsLxNY3pKM4Ay1uZL5qghixDaodvNy9oe1MqA` |
| Projektdoku-Generator | `AKfycbz0ugT-r9AkiKeiKqM1gpzQi1IZAoRje4uXjau92OXdYrfIgKQS6hn4VHcCVEvsEActFA` |
| Ordnererstellung-bei-Gewonnen | `AKfycbwOT0kO7tcxfEsgJ412zOvTzb2p3IuUXxnbcQfAkPwB4h8n8vQ-QGbDSe8Gg0YpQ4o7` |

**Nach jedem `clasp deploy` die Zugriffsberechtigung gegenchecken.** Bekannter Fehlerfall (24.08.): Sie rutschte von „Jeder" auf „Jeder mit einem Google-Konto", und `/exec` antwortete mit HTTP 401 statt der normalen 302 — Googles Zugriffsverweigert-Seite, **kein** Bot-Schutz, auch wenn sie so aussieht. `appsscript.json`s `webapp.access: ANYONE` wird beim Versions-Redeploy nicht zuverlässig neu übernommen.

**Alle vier laufen über einen Cloudflare-Relay:** `https://wispy-band-24d4.valentin-be0.workers.dev/`
Apps-Script-Web-Apps antworten auf jeden Aufruf zuerst mit HTTP 302. Pipedrive wertet das als Fehlschlag und löscht den Webhook nach 3 Tagen Dauerausfall. Der Relay vollzieht die Weiterleitung nach und gibt ein sauberes 200 zurück. Seit 24.08. live und end-to-end verifiziert. **Nie `WEB_APP_URL` direkt bei Pipedrive registrieren.**

### 🚫 `sync-all-scripts.ps1` nicht benutzen

Es *pullt* (Editor → lokal), also genau verkehrt herum zum heutigen Workflow, und würde lokale Arbeit überschreiben. Außerdem listet es nur 7 der 11 clasp-Projekte — Dateien-Klassifikation-Pilot, Montageplanung-Namensabgleich, Projektdoku-Generator und Deepcore fehlen, ein „sync all" überspringt sie stillschweigend. Hat keine Aufrufer mehr.

---

## Projektübersicht

Editor-Link-Muster: `https://script.google.com/home/projects/<scriptId>/edit`

### Live

| Projekt | scriptId | Auslöser | `DRY_RUN` |
|---|---|---|---|
| **Bundesland-aus-PLZ** — leitet Bundesland aus der PLZ der Person ab | [`1Rez1Bwt…sFVHy`](https://script.google.com/home/projects/1Rez1BwtFgGP4bzkSQiK8dTBiDCyCNP4vNlOWE6IPwJsd1fxk_U8sFVHy/edit) | Webhook + Tages-Trigger 02:00 | `false` |
| **Montagepartner-aus-Bundesland** — leitet den Partner aus dem Bundesland ab | [`1syrD6zG…D3z9KN`](https://script.google.com/home/projects/1syrD6zGu5gB0hKHZFUd9qHrM_8u7tSj89HGcNfkOZTcmaW2JSID3z9KN/edit) | Webhook + Tages-Trigger 03:00 (1 h nach Bundesland) | `false` |
| **Ordnererstellung-bei-Gewonnen** — legt bei Gewinn den Kundenordner an, schreibt Link + Kundendaten-Snapshot zurück | [`1uLXgsn4…KXodO`](https://script.google.com/home/projects/1uLXgsn4axnhOUb_3jQfgvZmmjr1vRFJgfki7X9azfDCH5P6JKheXKodO/edit) | **nur** Webhook, kein Zeit-Trigger | `false` |
| **Projektdoku-Generator** — baut pro Deal ein Google Doc und legt es im Kundenordner ab | [`1F5wPoZ-…cAffs`](https://script.google.com/home/projects/1F5wPoZ-11wzSXo7Td6S5KTuCFRb4BIyLzLFwdD6C0z6tWnsm6SFcAffs/edit) | Webhook + Tages-Trigger 02:00 | `false` (Feld-Duplizierer separat `true`) |
| **Sevdesk-Pipdrive_sync** — pollt angenommene sevdesk-Aufträge, schreibt Artikel-/Pauschalfelder auf den Deal | [`1pfqKbOF…GBBoIP`](https://script.google.com/home/projects/1pfqKbOFNUQYaZZg-k2odn2RSZ3CmbOZSZBtFqnvKldxpvHw8EUGbBoIP/edit) | **5-Min-Trigger** (seit 26.08., vorher 15) | `false` (Zahlungseingang separat `true`, ohne Trigger) |
| **Sheet-Sync** — Zwei-Wege-Sync Partner-Sheets ↔ Pipedrive | [`1mjBXdIy…v0Inl`](https://script.google.com/home/projects/1mjBXdIyxlV1TpZhPGQCtmW1CEyZTNCaZS8UgwC99aBvrYp0xKPNv0Inl/edit) | **15-Min-Trigger für `syncNeueZeilen` läuft** (am Log verifiziert 02.09.: 57 Läufe am 1.9., 23+ am 2.9.). onEdit nur Canary ALE + Kreuzeder. Kein Timer für `syncPipedriveToSheetFields`. | `false` (seit 31.08.) |
| **Deepcore-Automatisierung** ⚠️ | [`11yWak9y…z1yuqL`](https://script.google.com/home/projects/11yWak9ypgCKOh0GnGfskmlWDBy-8GMa6w_up68H7cQ2OjpywGpz1yuqL/edit) | 15-Min-Trigger — **Status unbestätigt, siehe D1** | `false` |

### Dry-Run / unfertig

| Projekt | scriptId | Stand |
|---|---|---|
| **Fortschritt-Script** — spiegelt 11 Meilensteine in `Erledigt` + rendert einen Fortschrittsbalken | **kein `.clasp.json`** | Fertig entwickelt, aber nie im Editor angelegt. Einziges Projekt mit lokalen Node-Tests (`_tests/`, 102 Tests). |
| **Montageplanung-Namensabgleich** — matcht Namen aus Partner-Planungssheets auf Pipedrive-Personen | [`15it5Xl0…-n-hu`](https://script.google.com/home/projects/15it5Xl0RvJz7gSfXTZ5dCtO3VdPNIGD3g_g8EFtUF31B414fF7T-n-hu/edit) | `DRY_RUN = true`, schreibt **nur ins Sheet**, nie nach Pipedrive. Aktuell auf Partner GREENSKY. |
| **Dateien-Klassifikation-Pilot** — klassifiziert Deal-Dateien per Claude Vision | [`1omWg706…qdy_4y`](https://script.google.com/home/projects/1omWg706JZvfeKjLmF77EB0AE2sbJNB_HntnC-0XsvU-ndvPhC_qdy_4y/edit) | Pilot auf Deal 7253. Rückschreib-Pfad ist **inert**: `DOKUMENTE_ERKANNT_FIELD_KEY = null`. Modell `claude-haiku-4-5-20251001`. |
| **Pipedrive-form-prefill-mail-trigger** — baut vorausgefüllte Google-Forms-Links | [`1uYcCTBn…9ZhLK6`](https://script.google.com/home/projects/1uYcCTBnXAJpb6Nj98ZV0FiBqNgE9EXnL0j5NnTcqmtsJKRjlL59ZhLK6/edit) | Halbfertig, **kein `DRY_RUN`**. Trotz Namen gibt es keine Mail-Funktion — `buildPrefilledLinkFromDeal` liefert nur `{link, email, name}` und hat einen Parameter, ist also nicht per ▷ startbar. |
| **Telefon-Qualifizierung** — Format-Check (kostenlos) + Existenz-Check (**AbstractAPI**, 100/Monat kostenlos) auf Personen-Telefonnummern vor dem Setter-Anruf | [`1rrTD2zi…P5SPQrzi-`](https://script.google.com/home/projects/1rrTD2ziFw8pbd7Ergp4wEI-35VFIAgNMoAYvcYIW5PtKl_iG1SPQrzi-/edit) | Neu 05.09.2026, **noch nie gelaufen** (Ergebnis-Sheet `1SGrdAYP…d4H24` enthält nur die Kopfzeile). ⚠️ **`WRITE_TO_PIPEDRIVE = true`** — der erste Lauf schreibt live auf die Person: Prüfergebnis + Originalnummer + Prüfdatum, **nie die Nummer selbst**. Alle Script Properties sind gesetzt, `testEinzelneNummer()` lief erfolgreich; die drei Person-Felder existieren (`95c6d839…`, `c3c4c472…`, `8b212abf…`). `MAX_EXISTENZ_CHECKS_PRO_LAUF` steht auf 50 für den Erst-Batch, danach zurück auf ~5. Siehe `Telefon-Qualifizierung/README.md`. |
| **Geburtstagskalender-Sync** — Geburtstage aus einem Slack-Profilfeld als jährliche Ganztags-Events in einen gemeinsamen Kalender „RP Geburtstage" | **kein `.clasp.json`** | Neu 05.09.2026, `DRY_RUN = true`, nie gelaufen. Blockiert auf vier manuellen Schritten (Apps-Script-Projekt anlegen, Slack-Custom-Field „Geburtstag", Slack-App + Bot-Token, Mitarbeiter tragen ein) — siehe `Geburtstagskalender-Sync/README.md`. |

### Tot / abgeschlossen — nicht weiterbauen

| Projekt | |
|---|---|
| **Drive-Ordner-Automation** | Überholter Prototyp; die Aufgabe macht heute `Ordnererstellung-bei-Gewonnen`. **Gefährlich:** kein `DRY_RUN`, keine Existenzprüfung — zweimal ausführen erzeugt Duplikat-Ordner. |
| **Namensabgleich-Fulfillment-Uebernahme** | Erledigter One-off (55 Kunden nach Fulfillment verschoben). Kein `.clasp.json`, kein `appsscript.json`. |
| **TimeTree-Export** | Korrekt **kein** Apps-Script-Projekt — Browser-Konsole + Node-CLI. |

---

## Konventionen

Diese Muster sind im Repo bereits gelebt. Neue Scripts erben sie, statt sie neu zu erfinden.

- **`DRY_RUN` default `true`**, `FORCE_OVERWRITE` default `false` (überspringt befüllte Felder). Macht Wiederholungsläufe gefahrlos.
- **`pruefeKonfiguration()` vor jedem Massenlauf** — gleicht hartcodierte IDs gegen die echte API ab. Der Check muss **grün werden können**; ein dauerhaft roter Check wird nicht mehr gelesen (siehe D5).
- **Log puffern**, nicht `appendRow` pro Zeile. Referenz: `Ordnererstellung/Config.gs:155`.
- **Retry** mit Backoff bei 429/5xx, sofortiger Abbruch bei 4xx. Ein 4xx wird durch Warten nicht besser.
- **Laufzeit-Guard:** Cursor in `ScriptProperties`, freiwilliger Abbruch nach ~4,5 Min. **Die Stoppuhr vor dem teuren Teil starten**, sonst greift sie nie (D8).
- **`LockService`** bei allem, was parallel laufen kann — und bei **jedem** Read-Modify-Write auf eine Script-Property (D2). Auf dem Webhook-Pfad `tryLock(5000)`, nicht `waitLock(30000)`: Pipedrives Antwortfenster ist ~10 s.
- **Self-Trigger-Guard heißt „nichts geändert", nie „alles gefüllt".** Ein „alles gefüllt"-Guard terminiert nicht. Referenz: `Ordnererstellung/KundendatenSnapshot.gs:71`.
- **Feld-Codes zur Laufzeit per Label auflösen** statt hartcodieren. `Montageplanung-Namensabgleich/Config.gs:121` macht das als einziges — Anlass: die hartcodierten Codes waren nach 16 Tagen veraltet.
- **Ein Projekt = ein Apps-Script-Projekt.** Zwei Dateien mit demselben `const` im selben Projekt starten nicht. Ein `_backup_v1/`-Unterordner braucht zwingend `skipSubdirectories: true` (nur Deepcore hat einen, und hat das Flag korrekt).
- **Kein Parameter in Funktionen, die im Editor gestartet werden.** Der ▷-Button ruft ohne Argumente auf → `undefined`.

---

## Doku im Repo

| Datei | |
|---|---|
| [`docs/REFERENZ-Pipedrive-AppsScript.md`](docs/REFERENZ-Pipedrive-AppsScript.md) | **Aktuell.** field_codes, Enum-IDs, Drive-/Sheet-IDs, alle API-Fallen. Erste Anlaufstelle. |
| [`docs/BEFUNDE-2026-09-01.md`](docs/BEFUNDE-2026-09-01.md) | **Aktuell.** Die 25 Befunde in Langform. |
| `ARCHITEKTUR-2026-08-13.md` | ⚠️ **Teilweise überholt** — Header beachten. §1.1 („`clasp push` gibt es nicht") gilt nicht mehr. |
| `FIXES-INDEX-2026-08-13.md` | ⚠️ **Etwa zur Hälfte erledigt** — Status pro Eintrag im Header-Abschnitt. |
| `.claude/skills/gs-deploy/SKILL.md` | Deploy-Ablauf. |

READMEs gibt es in: Fortschritt-Script, Montageplanung-Namensabgleich, Namensabgleich-Fulfillment-Uebernahme, Ordnererstellung-bei-Gewonnen, Projektdoku-Generator, Sheet-Sync, TimeTree-Export, Deepcore-Automatisierung, Sevdesk-Pipdrive_sync, Drive-Ordner-Automation.

---

## Arbeitsweise in diesem Repo

- **Valentin arbeitet oft mit mehreren Claude-Sessions parallel.** Vor `git add -A` prüfen, ob fremde frische Änderungen im Working Tree liegen.
- **Nie ungefragt nach Pipedrive schreiben.** Auch Lesezugriffe laufen in einer Sandbox — leere Ergebnisse heißen nicht „nichts da".
- **Code zum Kopieren nicht als Chat-Codeblock**, sondern die lokale Datei aktuell halten und den Pfad nennen.
- **Bei RP-Scripts immer den Editor-Link mitgeben**, nicht nur den Projektnamen.
- **Kein `vscode://`-Link** — die sind nicht klickbar. Reiner absoluter Pfad.
