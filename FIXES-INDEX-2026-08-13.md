# Fix-Index — alle Projekte, Stand 2026-08-13

Pro Projektordner liegt eine `FIXES-2026-08-13.md` mit den Details. Hier die Übersicht plus
die Punkte, die das Repo selbst betreffen.

Die Begründungen und der größere Plan (Backup-Strategie, Dashboard, Logging-Doktrin,
Notizen/Buttons) stehen in
`C:\Users\valen\OneDrive\Documents\RP\Claude_Work_RP\RP-Google-Scripts\ARCHITEKTUR-2026-08-13.md`

Legende: 🔴 blockt / kann Daten kaputt machen · 🟡 vor Dauerbetrieb · ⚪ Aufräumen

---

## Repo & Backup (diese Ebene)

Datei: `C:\Users\valen\OneDrive\Documents\RP\Claude_Work_RP\RP-Google-Scripts\sync-all-scripts.ps1`

| # | Prio | Punkt |
|---|---|---|
| R1 | 🔴 | **14 geänderte Dateien uncommitted**, letzter Commit 12.08. 12:51 — die gesamte Arbeit vom 13.08. existiert nur lokal |
| R2 | 🔴 | Fehlgeschlagener/leerer `clasp pull` wird als Warnung behandelt, danach läuft `git add . && commit && push` trotzdem → das Backup kann den Stand zerstören, den es sichert |
| R3 | 🔴 | Konkreter Fall dazu: `Ordnererstellung-bei-Gewonnen` liegt lokal, im Editor vermutlich noch das leere Default-`Code.gs` — ein Sync würde die 4 `.gs`-Dateien überschreiben. Ebenso `Bundesland-aus-PLZ/Code.js`, dessen CUTOFF-Änderung nie in den Editor kam |
| R4 | 🟡 | Keine `.gitignore` — `sync-log.txt` wird bei jedem Lauf mitcommittet und macht jedes Diff unlesbar |
| R5 | 🟡 | `Read-Host` am Ende blockiert → der Sync kann nie automatisch laufen. Als `-NoPause`-Schalter bauen |
| R6 | 🟡 | Kommentarblock Zeile 11–14 ist veraltet (behauptet, Bundesland/Montagepartner hätten kein `.clasp.json` — haben sie inzwischen) |
| R7 | 🟡 | Git sichert nur Code, nicht die **Verdrahtung** (Trigger, Webhooks, `DRY_RUN`, Script Properties). Genau die ist bisher kaputtgegangen, nie der Code → `dumpLiveState()` pro Projekt |
| R8 | ⚪ | `git tag golive-<projekt>-<datum>` bei jedem Scharfschalten |
| R9 | ⚪ | `.git` liegt in OneDrive — bekannte Quelle für korrupte Index-/Pack-Dateien. Mittlere Priorität, beim nächsten Setup vermeiden |

**Erster Schritt, unabhängig von allem anderen:**
```powershell
cd C:\Users\valen\OneDrive\Documents\RP\Claude_Work_RP\RP-Google-Scripts
git add .
git commit -m "Sheet-Sync + Ordnererstellung Fixes, CUTOFF_DATE, clasp-Verknüpfungen"
git push
```
Nicht über `sync-all-scripts.ps1` — wegen R2/R3.

---

## Bundesland-aus-PLZ

`C:\Users\valen\OneDrive\Documents\RP\Claude_Work_RP\RP-Google-Scripts\Bundesland-aus-PLZ\FIXES-2026-08-13.md`

| # | Prio | Punkt |
|---|---|---|
| B1 | 🔴 | Lokale Datei ≠ Editor: `CUTOFF_ENABLED`/`CUTOFF_DATE` nur lokal, `clasp pull` würde es kommentarlos zurücknehmen |
| B2 | 🔴 | `FEHLER`-Rückgaben landen im `uebersprungen`-Topf — Konfigurationsfehler sind in der Zusammenfassung unsichtbar |
| B3 | 🟡 | Keine Nulllauf-Erkennung (das Montagepartner-Script hat sie) |
| B4 | 🟡 | Grenzfall-Liste stammt aus dem 1200er-DRY-Lauf, der Vollauf über 6570 fand weitere (z.B. Deal 6885) |
| B5 | 🟡 | `plzAusFreitext()` kann eine vierstellige Hausnummer für eine PLZ halten |
| B6–B8 | ⚪ | Personen-Vorabladung bei jedem Resume, unbegrenzter Log-Puffer, "bereits gesetzt"-Zeilen im Sheet |

---

## Montagepartner-aus-Bundesland

`C:\Users\valen\OneDrive\Documents\RP\Claude_Work_RP\RP-Google-Scripts\Montagepartner-aus-Bundesland\FIXES-2026-08-13.md`

| # | Prio | Punkt |
|---|---|---|
| M1 | 🔴 | Vier Kommentare zu Salzburg, zwei davon falsch — genau der Mechanismus hinter dem `all_not_deleted`-Fehler |
| M2 | 🔴 | Lauf muss wiederholt werden, sobald der Bundesland-Vollauf durch ist (6247 Deals warten) |
| M3 | 🟡 | "Bereits gesetzt"-Zeilen loggen Bundesland und Kandidaten als leer — verschenkt die Prüfung der 325 manuellen Zuordnungen |
| M4 | 🟡 | ~400 OÖ-Deals bleiben still liegen → Pipedrive-**Aktivität** statt nur Log (mit Idempotenz-Prüfung!) |
| M5–M6 | ⚪ | Kein CUTOFF-Gegenstück, Log-Puffer/Rauschen |

---

## Ordnererstellung-bei-Gewonnen

`C:\Users\valen\OneDrive\Documents\RP\Claude_Work_RP\RP-Google-Scripts\Ordnererstellung-bei-Gewonnen\FIXES-2026-08-13.md`

| # | Prio | Punkt |
|---|---|---|
| O1 | 🔴 | `previous.status !== 'won'` ist true, wenn `previous` nur geänderte Felder enthält → jede Änderung an einem gewonnenen Deal gilt als frischer Gewinn |
| O2 | 🔴 | `version: '2.0'` fehlt bei der Registrierung; Webhooks-Endpoint unter v2 vor Go-Live gegen die Doku prüfen; Registrierung wirft nicht bei Fehler |
| O3 | 🔴 | Kein Webhook-Filter → ein Bulk-Lauf über 6570 Deals löst 6570 Web-App-Aufrufe aus |
| O4 | 🟡 | DRY-RUN steigt aus, **bevor** geprüft wird, ob "Montage offen" existiert → falsches grünes Licht |
| O5 | 🟡 | `debugAdressFeld(dealId)` hat einen Parameter → ▷-Button ruft mit `undefined` auf |
| O6 | 🟡 | Adress-Feldstruktur weiterhin geraten — Ordnernamen sind später kaum korrigierbar |
| O7 | 🟡 | 437 gewonnene Altdeals bekommen nie einen Ordner (Webhook wirkt nicht rückwirkend) |
| O8–O9 | ⚪ | Log-Handle nicht gecacht, Partner fehlt in einer Log-Zeile |

---

## Sheet-Sync

`C:\Users\valen\OneDrive\Documents\RP\Claude_Work_RP\RP-Google-Scripts\Sheet-Sync\FIXES-2026-08-13.md`

| # | Prio | Punkt |
|---|---|---|
| S1 | 🔴 | **41.952 API-Calls/Tag** bei 437 Deals (1 Call pro Zeile pro 15-Min-Lauf), Gratis-Kontingent ~20.000 → Fix bringt Faktor 87 |
| S2 | 🔴 | `findColumnIndexByHeader()` in der innersten Schleife: 1748 Kopfzeilen-Lesevorgänge pro Lauf |
| S3 | 🔴 | Partner kann in RP-Spalten (DC/AC/IB-Termin) schreiben, der nächste Lauf überschreibt es kommentarlos |
| S4 | 🟡 | Kein Rückkanal für Termine → `Wunschtermin`-Spalte. ⚠️ Überschneidung mit dem Retool-Projekt "Terminfindung", Entscheidung nötig |
| S5 | 🟡 | `err.message` roh in der Zell-Notiz — der Partner liest unseren Debug-Output |
| S6 | 🟡 | Zwei API-Calls pro geänderter Zelle (bei 30 eingefügten ZPNs = 60 Calls) |
| S7 | 🟡 | Fehlgeschlagene Edits werden nie wiederholt — Wert steht für immer nur im Sheet |
| S8 | 🟡 | Der bekannte ZPN-`autocomplete`-400er ist nicht abgefangen |
| S9–S10 | ⚪ | DRY_RUN/Testumgebung, Log-Sheet ohne Aufräumen |

Ausbau-Ideen (welche Spalten/Häkchen/Aktionen noch dazukommen könnten) separat in
`C:\Users\valen\OneDrive\Documents\RP\Claude_Work_RP\RP-Google-Scripts\Sheet-Sync\IDEEN-Felder-und-Aktionen.md`

---

## Sevdesk-Pipedrive-Sync

`C:\Users\valen\OneDrive\Documents\RP\Claude_Work_RP\RP-Google-Scripts\Sevdesk-Pipdrive_sync\FIXES-2026-08-13.md`

| # | Prio | Punkt |
|---|---|---|
| V1 | 🔴 | `SYNCED_ORDERS` wächst monoton in **eine** Script Property (Limit 9 KB) → bei ~285 Aufträgen wirft `setProperty()`, danach 15-Minuten-Endlosschleife mit echten Pipedrive-Writes |
| V2 | 🔴 | Unzuordenbare Aufträge werden ewig wiederholt und belegen die 25 Batch-Plätze → Warteschlange verstopft, sieht im Log gesund aus |
| V3 | 🔴 | **Kein Retry** bei 429/5xx — ausgerechnet im einzigen Script mit 15-Minuten-Takt |
| V4 | 🟡 | `Module_Anzahl` ohne `|| null` → stille Nicht-Schreibung, Log meldet SUCCESS |
| V5 | 🟡 | Log-Schreibfehler werden verschluckt, der Sync läuft blind weiter |
| V6–V8 | ⚪ | Extra-Call bei der Gegenprobe, kein `pruefeKonfiguration()`, stilles `break` bei >1000 Aufträgen |

**Sofort messbar:** `Logger.log(JSON.stringify(getSyncState()).length)` — über ~7000 heißt,
V1 wird bald akut.

---

## Drive-Ordner-Automation (Prototyp)

`C:\Users\valen\OneDrive\Documents\RP\Claude_Work_RP\RP-Google-Scripts\Drive-Ordner-Automation\FIXES-2026-08-13.md`

| # | Prio | Punkt |
|---|---|---|
| D1 | 🔴 | Schreibt ohne DRY_RUN in **denselben** Dummy-Ordner, in dem die echte Ordnererstellung getestet wird — ein versehentliches ▷ legt sofort Testordner an |
| D2 | 🟡 | Projekt ist abgelöst → im Editor auf `[ALT] …` umbenennen, README dazu |
| D3–D4 | ⚪ | Inkonsistentes Namens-Sanitizing, alte API-Experimente im Dropdown |

---

## Pipedrive-form-prefill-mail-trigger

`C:\Users\valen\OneDrive\Documents\RP\Claude_Work_RP\RP-Google-Scripts\Pipedrive-form-prefill-mail-trigger\FIXES-2026-08-13.md`

| # | Prio | Punkt |
|---|---|---|
| P1 | 🟡 | Kein Retry |
| P2 | 🟡 | `person_id` nicht defensiv aufgelöst (`.value || …`) |
| P3 | 🟡 | Veraltete Options-Mappings führen zu still unvollständigen Formularen — `pruefeKonfiguration()` fehlt |
| P4–P5 | ⚪ | `TEST_EMAIL` statt einheitlichem `DRY_RUN`, Adress-Struktur ungeprüft |

---

## Was projektübergreifend gleich falsch/gleich gut ist

**Vier Kopien** von `fetchPipedrive` / `patchPipedrive` / Retry-Wrapper / Log-Sheet, in leicht
abweichenden Varianten — deshalb hat `Sevdesk-Pipdrive_sync` als einziges keinen Retry und
`Bundesland-aus-PLZ` als einziges keinen `fehler`-Zähler. Das ist kein Stilproblem, es ist
die Ursache dafür, dass Fixes nur in drei von vier Projekten ankommen.

→ Library `RPPipedrive` / `RPLog`, beginnend mit dem Dashboard-Logger (Begründung in
`ARCHITEKTUR-2026-08-13.md`, Abschnitt 2.2).

**Gut und überall gleich:** kein Token im Code (alles in Script Properties), `DRY_RUN`-Schalter,
self-bootstrapping Log-Sheets, Resume-Cursor mit Zeitbudget in den beiden Vollauf-Scripts.

---

## Vorschlag Reihenfolge

1. **R1** committen (fünf Minuten, verhindert Totalverlust)
2. **R2–R6** `sync-all-scripts.ps1` härten — sonst gefährdet jeder weitere Sync die Arbeit
3. **B1** Editor/lokal in Einklang bringen, dann **B2**
4. **M2** Bundesland-Vollauf produktiv, danach Montagepartner nachziehen
5. **V1/V3** sevdesk — das ist das Projekt, das als nächstes live geht
6. **S1/S2** Sheet-Sync-Kontingent, bevor irgendein Trigger dort scharf wird
7. **O1–O4** Ordnererstellung, zusammen mit dem Webhook-Test
8. Dashboard (`setupDashboard()`), dann Anbindung in der Reihenfolge der Go-Lives
