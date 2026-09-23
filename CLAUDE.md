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
| **D4** | **Shared Secrets im Klartext committet.** Einzige Auth auf Web-Apps mit `ANYONE_ANONYMOUS`, die Produktiv-Deals patchen (alle vier stehen seit 09.09. einheitlich auf `ANYONE_ANONYMOUS`). Vorlage für den Fix steht daneben: `Ordnererstellung-bei-Gewonnen/Config.gs:102` liest korrekt aus ScriptProperties. **Bewusst vertagt.** | `Bundesland-aus-PLZ/Webhook.js:19`, `Montagepartner-aus-Bundesland/Webhook.js:23`, `Projektdoku-Generator/Webhook.js:21` |
| **D4b** | **Der Webhook-Relay ist ein anonymer offener Proxy.** `?target=<URL>` ohne Allowlist: leitet Methode, Body und alle Header weiter, folgt 3 Redirects, und `?debug=1` gibt den echten Antwort-Body zurück (SSRF-Leseprimitive). Zusammen mit D4 ein fremdbedienbarer Pfad auf die Web-Apps. Fix: `target`-Host gegen Allowlist (`script.google.com` **und** `script.googleusercontent.com` für Hop 2), sonst 403. Den unbedingten `200` dabei **nicht** entfernen. **Nicht gefixt.** | Cloudflare-Worker `wispy-band-24d4`, nicht in Git — gelesen im Dashboard 11.09.2026 |
| **D5** | ✅ **Teil 1 erledigt 09.09.2026** — beide `PLACEHOLDER_*`-Keys sind aus `FIELD_KEYS` entfernt (`SM_FS_Typ` → D6, `Montage_Elektro_Summary` → verworfen, die 4 Beträge stehen einzeln als Nummern-Felder am Deal). Der Check kann erstmals grün werden. ⚠️ **Teil 2 offen und jetzt gewichtiger:** der Groß-/Kleinschreibungs-Mismatch (`ENUM_OPTION_IDS.Zahlungseingang_erhalten` vs. `FIELD_KEYS.zahlungseingang_erhalten`) lässt Option-ID 207 still unvalidiert — der Check meldet ab jetzt „OK“ und prüft sie trotzdem nicht. | `Sevdesk-Pipdrive_sync/syncengine.js:1257`, `fieldkeysandmapping.js:68` vs. `:24` |
| ~~**D6**~~ | ✅ **Erledigt 09.09.2026.** `SM_FS_Typ` ist restlos entfernt — nicht „entschärft", sondern die Idee gekillt: die **Ausführungsart pflegt der Seller von Hand**, ein abgeleiteter Wert hätte die Handeingabe bei jedem Sync überschrieben. Damit fällt auch D5 Teil 1 von zwei auf einen Platzhalter-Fehler. | `Sevdesk-Pipdrive_sync/fieldkeysandmapping.js` (Kommentar am Ende von `FIELD_KEYS`) |

### ❓ Nur Valentin kann das klären

- **Läuft Deepcores 15-Min-Trigger?** Von außen nicht prüfbar. [Editor öffnen](https://script.google.com/home/projects/11yWak9ypgCKOh0GnGfskmlWDBy-8GMa6w_up68H7cQ2OjpywGpz1yuqL/edit) → Trigger. **Das ist die erste Handlung, wenn hier wieder gearbeitet wird.**
- **Zeigt `DEEPCORE_SHEET_ID` absichtlich auf die Test-Kopie**, oder wurde das Umbiegen vergessen?

### P1 — beißt unter Last

`D7` sevdesk-Log macht `openById` + `appendRow` **pro Datensatz**, alle 5 Min → ~7.200 Sheets-Calls/Tag (`syncengine.js:328`; alle anderen Projekte puffern längst) · `D8` Laufzeit-Stoppuhr startet **nach** der teuren Pagination, der Guard greift also nie (`syncengine.js:1387/1423`, `Fortschritt-Script/Code.gs:92`) · `D9` `findNextEmptyRowFor` macht ~800 einzelne `getValue()` pro neuer Zeile (`Sheet-Sync/Config.gs:469`) · `D10` `openById` in der Queue-Schleife ohne Cache (`FieldSync.gs:123`) · `D11` schreibt Angebotsnummer und sucht sofort per `itemSearch` darauf — Index-Delay, Auftrag wird nach 5 Fehlversuchen geparkt (`syncengine.js:850/1192`) · `D12` `dealFields` ohne `?limit=500` → meldet existierende Felder als „existiert nicht" (`zahlungseingang.js:318`, `fieldsetup.js:100/117`) · `D13` `/api/v2/webhooks` obwohl Webhooks v1 sind, ausgerechnet in der einen Diagnose, die eine kaputte Registrierung zeigen würde (`Ordnererstellung/SetupHelpers.gs:54`) · `D14` Backfill-Cursor: `setProperty(key, null)` wirft beim ersten Lauf, dazu fehlendes `encodeURIComponent` (`KundendatenSnapshot.gs:144`) · ~~`D15` `klassifiziereUndVerschiebe` verschiebt nichts, es *kopiert* — ohne Existenzprüfung, zweiter Lauf zahlt Anthropic doppelt (`Klassifikation.gs:184`).~~ **ERLEDIGT 17.09.2026:** Idempotenzpruefung `findeBereitsEinsortiert()` sitzt jetzt **vor** dem Claude-Call; Log sagt „kopiert“ statt „verschoben“.

### P2/P3 — Altlasten

`D16` form-prefill hat **gar keinen** Retry · `D17` vier Kommentare behaupten „2s, 4s, 8s", real sind es 2s und 4s (**Dateien-Klassifikation-Pilot am 17.09.2026 korrigiert**, die uebrigen offen) · `D18` `waitLock(30000)` auf dem Webhook-Pfad, Pipedrives Fenster ist ~10s (`Ordnererstellung/FolderCreation.gs:32`) · `D19` stille `break`s bei Pagination-Grenzen · `D20` `status=won`-Filter lässt re-öffnete Deals lautlos aus dem Sync fallen · `D21`–`D25` toter Code, widersprüchliche Kommentare, 3 leere `Script ID.txt`.

### Kettencheck PLZ → Bundesland → Montagepartner (2026-09-10)

Die Kette ist **strukturell schlüssig** — Option-IDs über alle vier Projekte zeichengleich, alle 9 Bundesländer auf 5 Partner gemappt, alle 7 Partner mit Drive-Ordner. Offen sind drei fehlende Sicherheitsnetze, Langfassung in [`docs/CHECK-Kette-PLZ-Bundesland-Montagepartner-2026-09-10.md`](docs/CHECK-Kette-PLZ-Bundesland-Montagepartner-2026-09-10.md):

- **K1 🔴** PLZ-Feld und Adressfeld der Person werden **nie gegeneinander geprüft** (nur Fallback, wenn das PLZ-Feld leer ist). Beide können der falsche sein (belegt: Deal 7177 und 6804). Falsche PLZ → falscher Partner → Kundenordner im Drive des falschen Partners, und `FORCE_OVERWRITE = false` sieht den Wert nie wieder an.
- **K2 🟡** Eine **Korrektur am Bundesland erreicht den Partner nicht** — steht der Partner schon, wird übersprungen. Kein automatischer „passt Partner zum Bundesland"-Check.
- **K3 🟡** `CUTOFF_DATE` (01.06.2026) blockiert **alte Deals, die jetzt gewonnen werden** — am 04.09. schon einmal per Hand umgangen, wiederholt sich.
- Nebenbefund: **8 der 11 Grenzfall-PLZ sind für den Partner belanglos** (beide Kandidaten-Bundesländer führen zum selben Partner). Nur 4442, 8863 und 8974 kippen ihn wirklich.

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
| **Sheet-Sync** — Zwei-Wege-Sync Partner-Sheets ↔ Pipedrive | [`1mjBXdIy…v0Inl`](https://script.google.com/home/projects/1mjBXdIyxlV1TpZhPGQCtmW1CEyZTNCaZS8UgwC99aBvrYp0xKPNv0Inl/edit) | **5-Min-Trigger für `syncNeueZeilen`** (von 15 auf 5 Min umgestellt 10.09.2026; davor am Log verifiziert 02.09.: 57 Läufe am 1.9., 23+ am 2.9.). Kontingent: **entschärft am 10.09.2026** durch Lauf-Cache in `RowCreation.gs` (ein `openById` + ein Kopfzeilen-Read + ein Deal-ID-Spalten-Read pro *Partner* pro Lauf statt pro Kandidat) — am Log gemessen **54 s → 14 s** bei identischen Zählern, also 288 Läufe/Tag × 14 s ≈ **1,1 h von 6 h/Tag Trigger-Gesamtlaufzeit** (Workspace-Limit, gilt pro Nutzer über ALLE Script-Projekte). Vor dem Umbau waren es ~4,3 h und damit zu knapp für Dauerbetrieb. **Nachfüllen leerer Zellen seit 10.09.2026:** eine bestehende Zeile wird nicht mehr blind mit `existiert` übersprungen, sondern in ihren *leeren* Zellen ergänzt (`fuelleLeereZellenNach()`); gefüllte Zellen bleiben unangetastet, Notizen ebenfalls. Anlass war Deal 5476 — die Deal-ID kam vom Namensabgleich, damit galt die Zeile als vorhanden und blieb zwei Wochen halb leer. Kostet **keine** zusätzlichen API-Calls — nachgetragen wird nur, was schon im Deal-Objekt steckt (Ordner-Link, Anlagengröße, Sonstige Infos, Termine, Erstellungsdatum). Adresse/PLZ/Telefon/Kundenname bleiben bewusst draußen: die erste Fassung lud dafür die Person nach und lief damit bei jedem Lauf in denselben Leerabruf — 198 s statt 14 s bei 0 Nachträgen, am Log aufgefallen und am 10.09.2026 sofort zurückgebaut. Neuer Lauf-Zähler `nachgefuellt`, Log-Aktion `zeile nachfüllen`. **`Erstellungsdatum` wird beim Nachfüllen bewusst mit dem *Laufdatum* gestempelt**, nicht mit dem echten Anlagedatum der Zeile — im Einmal-Lauf vom 10.09.2026 bekamen dadurch 48 Zeilen den 10.09.2026. Von Valentin am 10.09.2026 so entschieden (Spalte ist für den Partner Referenz, keine harte Angabe); nicht erneut aufrollen. onEdit nur Canary ALE + Kreuzeder. Kein Timer für `syncPipedriveToSheetFields`. **Zusätzlich Tages-Trigger 05:00 für `pruefeWebhookErreichbarkeit`** (seit 09.09.) — prüft die vier Webhook-Deployments und schreibt das Ergebnis ins Log-Sheet. | `false` (seit 31.08.) |
| **Deepcore-Automatisierung** ⚠️ | [`11yWak9y…z1yuqL`](https://script.google.com/home/projects/11yWak9ypgCKOh0GnGfskmlWDBy-8GMa6w_up68H7cQ2OjpywGpz1yuqL/edit) | 15-Min-Trigger — **Status unbestätigt, siehe D1** | `false` |
| **Lieferkalender-Slack** (Slack-App „Ernst") — meldet Änderungen an Liefer-/DC-/AC-/IB-Termin aus Pipeline 2 nach **#ernst-knows**; gesteuert über den Sheet-Tab „Regeln", **schreibt nie nach Pipedrive** | [`1N1Q1XRv…b4`](https://script.google.com/home/projects/1N1Q1XRvCtR6uUIIxZMM-NmaiP0xsGrXuR03cu3GQyWeRXrwjc28VTb4P/edit) | **15-Min-Trigger + Tages-Trigger 07:15**, beide auf `sweep()` (live seit 11.09.2026 13:44). Datumsregeln („vorher"/„am Tag") feuern erst ab 7 Uhr — sonst käme „HEUTE Lieferung" um 00:07 und wäre wegen des Doppelpost-Schutzes zugleich der einzige Post des Tages. Lauf-Protokoll im Sheet-Tab „Laeufe", eine Zeile pro Lauf auch bei 0 Meldungen. **Seit 21.09.2026** zusätzlich die CT-Kundenerinnerung (`CtTermine.gs`): CT-Termine kommen aus Pipedrive-**Activities** (Betreff-Marker `(CT)`, hängen an der PERSON, nicht am Deal), Ernst schickt Valentin eine DM mit fertigem `wa.me`-Link — abgeschickt wird per menschlichem Klick, es geht nichts automatisch an Kunden raus. | `false` (seit 11.09.) |

### Dry-Run / unfertig

| Projekt | scriptId | Stand |
|---|---|---|
| **Fortschritt-Script** — spiegelt 11 Meilensteine in `Erledigt` + rendert einen Fortschrittsbalken | **kein `.clasp.json`** | Fertig entwickelt, aber nie im Editor angelegt. Einziges Projekt mit lokalen Node-Tests (`_tests/`, 102 Tests). |
| **Montageplanung-Namensabgleich** — matcht Namen aus Partner-Planungssheets auf Pipedrive-Personen | [`15it5Xl0…-n-hu`](https://script.google.com/home/projects/15it5Xl0RvJz7gSfXTZ5dCtO3VdPNIGD3g_g8EFtUF31B414fF7T-n-hu/edit) | `DRY_RUN = true`, schreibt **nur ins Sheet**, nie nach Pipedrive. Aktuell auf Partner GREENSKY. |
| **Dateien-Klassifikation-Pilot** — klassifiziert Deal-Dateien per Claude Vision | [`1omWg706…qdy_4y`](https://script.google.com/home/projects/1omWg706JZvfeKjLmF77EB0AE2sbJNB_HntnC-0XsvU-ndvPhC_qdy_4y/edit) | Pilot auf Deal 7253. Rückschreib-Pfad ist **inert**: `DOKUMENTE_ERKANNT_FIELD_KEY = null`. Modell `claude-haiku-4-5-20251001`. **Stand 17.09.2026:** Anthropic-Schicht liegt in `Claude.gs`. Vor dem ersten Lauf `checkConfiguration()` (prüft jetzt auch Key/Modell echt und die Kundenordner-Struktur), dann `kostenVoranschlag()` — sagt die Kosten eines Echtlaufs voraus, ohne einen bezahlten Call zu machen. PDFs über `MAX_INPUT_TOKENS_PRO_DATEI` werden nicht klassifiziert. Prompt-Caching ist geprüft und **nicht** anwendbar (Haiku 4.5 braucht 4096 Token Mindestlänge, der Prompt hat ~600). |
| **Pipedrive-form-prefill-mail-trigger** — baut vorausgefüllte Google-Forms-Links | [`1uYcCTBn…9ZhLK6`](https://script.google.com/home/projects/1uYcCTBnXAJpb6Nj98ZV0FiBqNgE9EXnL0j5NnTcqmtsJKRjlL59ZhLK6/edit) | Halbfertig, **kein `DRY_RUN`**. Trotz Namen gibt es keine Mail-Funktion — `buildPrefilledLinkFromDeal` liefert nur `{link, email, name}` und hat einen Parameter, ist also nicht per ▷ startbar. |
| **Telefon-Qualifizierung** — Format-Check (kostenlos) + Existenz-Check (**AbstractAPI**, 100/Monat kostenlos) auf Personen-Telefonnummern vor dem Setter-Anruf | [`1rrTD2zi…P5SPQrzi-`](https://script.google.com/home/projects/1rrTD2ziFw8pbd7Ergp4wEI-35VFIAgNMoAYvcYIW5PtKl_iG1SPQrzi-/edit) | Neu 05.09.2026, **noch nie gelaufen** (Ergebnis-Sheet `1SGrdAYP…d4H24` enthält nur die Kopfzeile). ⚠️ **`WRITE_TO_PIPEDRIVE = true`** — der erste Lauf schreibt live auf die Person: Prüfergebnis + Originalnummer + Prüfdatum, **nie die Nummer selbst**. Alle Script Properties sind gesetzt, `testEinzelneNummer()` lief erfolgreich; die drei Person-Felder existieren (`95c6d839…`, `c3c4c472…`, `8b212abf…`). `MAX_EXISTENZ_CHECKS_PRO_LAUF` steht auf 50 für den Erst-Batch, danach zurück auf ~5. Siehe `Telefon-Qualifizierung/README.md`. |
| **Geburtstagskalender-Sync** — Geburtstage aus einem Slack-Profilfeld als jährliche Ganztags-Events in einen gemeinsamen Kalender „RP Geburtstage" | **kein `.clasp.json`** | Neu 05.09.2026, `DRY_RUN = true`, nie gelaufen. Blockiert auf vier manuellen Schritten (Apps-Script-Projekt anlegen, Slack-Custom-Field „Geburtstag", Slack-App + Bot-Token, Mitarbeiter tragen ein) — siehe `Geburtstagskalender-Sync/README.md`. |
| **Closer-Score** — bewertet nach der Fulfillment-Uebergabe die Eingabequalitaet des Deal-Besitzers (Presale/Closer) und schickt ihm eine Slack-DM mit Ampel, Punktzahl und Maengelliste; **schreibt nie nach Pipedrive**, einzige Schreiboperation ist die DM | [`1GwG-S9D…rzbc2gH`](https://script.google.com/home/projects/1GwG-S9DEU8mx5cbkKYAcXn-9oySr_pQT825VRZ43LDLQL5-8Srzbc2gH/edit) | **Seit 22.09.2026 scharf im FREIGABE-Modus**: `DRY_RUN = false`, `BETRIEBSMODUS = 'freigabe'` (löst `TEST_ALLES_AN_MICH` ab). Valentin bekommt jede Nachricht zuerst als Vorlage; ✅ schickt sie an den Closer, ❌ verwirft sie, ohne Reaktion passiert nichts — `pruefeFreigaben()` (Freigabe.gs) fragt alle 15 Min per `reactions.get` nach. Geht eine Nachricht an einen Closer raus, bekommt Valentin eine Bestätigung (`KOPIE_AN_VALENTIN`) — im Thread der Vorlage. ⚠️ Braucht **`reactions:read`** am Bot-Token. Geprüft wird nur der Emoji-Name, nicht wer reagiert hat — das `users`-Array ist laut Slack-Doku unvollständig. Die DM-Channel-ID (`D…`) aus der Sende-Antwort muss mitgespeichert werden, die User-ID reicht `reactions.get` nicht. Torwaechter ist **Pipeline 2 + befuelltes `Verkaufte_Artikel_Summary`** — nicht `status: won` (Befund D20). **Empfaenger ist `creator_user_id`, NICHT `owner_id`** — belegt durch `diagnoseCloserFelder()` am 17.09.: owner_id hat ueber alle 86 Deals nur 2 verschiedene Werte (Valentin 85x, weil die Fulfillment-Uebernahme umhaengt), creator_user_id hat 5 (Marco 74x, André 8x, Manuel 2x, Sean 1x, Sergen 1x). Einstellbar ueber `CLOSER_FELD` in `Config.gs`. ✅ 23.09.2026 gegengeprueft: creator_user_id meint wirklich den Verkaeufer. Die Dominanz (Marco 81 von 96) ist echte Verteilung, kein Feldfehler. **`CLOSER_SLACK_IDS` ist seit 23.09. befuellt** — nicht von Hand pflegen, sondern `baueCloserMapping()` (Mapping.gs) laufen lassen: matcht Pipedrive gegen Slack ueber die Firmen-E-Mail und druckt den fertigen Config-Block. Manuel Wimmer ist raus aus der Firma (bleibt ungemappt), Sven Mlinar hat noch keinen Deal. Testdeals stehen in `IGNORIERTE_DEALS` (7253 "AI TEST") und werden schon in `holeFulfillmentDeals()` gefiltert. `testeDmAnMich()` schickt echte Test-DMs, hart an Valentin (kann konstruktionsbedingt niemanden sonst erreichen). Weiter: Tokens in die ScriptProperties, `installiereTrigger()` (taeglich 09:00 + Freigabe-Pruefung alle 15 Min). **Der erste Lauf mit leerem Zustand seedet den Bestand selbst** und verschickt dafür nichts — `seedeBestandOhneDM()` ist nur noch das Handwerkzeug dafür. Die DM ist seit 21.09. in **drei Themen** gegliedert (Dach & Anlage / Förderung & Finanzierung / Unterlagen & Notizen), Einzelpunkte je Feld entfallen. Punktemaximum ist **28 ohne / 31 mit Finanzierung** (die Spec sagte bis 16.09. faelschlich 25/28). Spec: `docs/SPEC-Closer-Score.md`. |

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
- **Wer einen Fehler wegdämpft, muss ihn woanders sichtbar machen.** Der Cloudflare-Relay gibt Pipedrive unbedingt 200 zurück (damit der Webhook nicht nach 3 Tagen gelöscht wird) — dadurch fiel der Montagepartner-Webhook vom 24.08. bis 04.09. unbemerkt aus: Pipedrive sah 200, das Log-Sheet sah nichts, weil gar kein Script-Code lief. Gegenmittel ist der tägliche `pruefeWebhookErreichbarkeit()` in `Sheet-Sync/WebhookHealth.gs`, der die `/exec`-URLs direkt fragt (nicht über den Relay) und auf die Weiterleitung zur Google-Anmeldeseite prüft — nicht auf den Status-Code, der je nach GET/POST unterschiedlich ausfällt.
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
