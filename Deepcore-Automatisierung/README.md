# Deepcore-Automatisierung

Pollt sevdesk nach angenommenen Aufträgen (Status `500`) und befüllt pro Auftrag eine vorformatierte Pufferzeile im Monatsblock des „Deep Core"-Sheets.

[Editor öffnen](https://script.google.com/home/projects/11yWak9ypgCKOh0GnGfskmlWDBy-8GMa6w_up68H7cQ2OjpywGpz1yuqL/edit)

---

## 🔴 Vor allem anderen: die Sheet-ID prüfen

```js
// sheetwriter.js:19
const DEEPCORE_SHEET_ID = '1dqUQ3TNXtFojx86DYWd6Sa4sInPCFpFUWrqf10g7JhY'; // ⚠️ AKTUELL NUR DIE TEST-KOPIE
// syncengine.js:30
const DRY_RUN = false;
```

**Live-Schreibung in ein Sheet, das der Code selbst als Test-Kopie bezeichnet.**

Das ist hier schlimmer als anderswo, weil dieses Script **nur anfügt und nie korrigiert** (siehe Kopfkommentar in `syncengine.js`). Jede Zeile, die in der Test-Kopie landet, fehlt dauerhaft im echten Sheet — und `DEEPCORE_SYNCED_ORDERS` trägt den Auftrag als erledigt ein, **ein späteres Umbiegen der ID backfillt also nicht**.

**Erste Handlung:** Im Editor nachsehen, ob der 15-Min-Trigger (`trigger15MinAnlegen()`, `syncengine.js:543`) läuft. Trigger-Status ist aus dem Code nicht ableitbar.

Wenn ja und die ID ist falsch:
1. Trigger aus
2. Notieren, welche Aufträge schon in der Test-Kopie stehen
3. `DEEPCORE_SHEET_ID` auf das echte Sheet
4. Diese Order-IDs aus `DEEPCORE_SYNCED_ORDERS` entfernen (`resetDeepCoreSyncState()` löscht **alles** — dann greift `IGNORIERE_AUFTRAEGE_VOR` als Netz)
5. `DRY_RUN = true`, ein Lauf, Log lesen
6. Erst dann scharf

Details als **D1** in [`../docs/BEFUNDE-2026-09-01.md`](../docs/BEFUNDE-2026-09-01.md).

---

## Die eine Regel

**Ein Auftrag darf genau einmal verarbeitet werden.** Es wird keine bestehende Zeile gematcht, sondern immer eine neue Pufferzeile befüllt — ein zweiter Lauf über denselben Auftrag erzeugt keine Aktualisierung, sondern eine **zweite Zeile**.

Deshalb speichert der State nur „erledigt ja/nein" und ignoriert spätere Änderungen am Auftrag bewusst. (v1 verglich den Update-Zeitstempel und legte bei jeder sevdesk-Änderung eine Dublette an.)

---

## Inbetriebnahme — Reihenfolge einhalten

| # | Funktion | |
|---|---|---|
| 1 | `pruefeKonfiguration()` | Tab, Spalten, Pufferzeilen prüfen |
| 2 | `pruefeDropdownListen()` | Katalog-Drift gegen die Artikel-Dropdowns prüfen |
| 3 | `testMappingOnly()` | Artikel-Erkennung ohne API |
| 4 | `seedSyncStateOhneSchreiben()` | **Nicht überspringen.** Markiert alle heute schon angenommenen Aufträge als erledigt, ohne sie zu schreiben. Ohne diesen Schritt kippt der erste Lauf den kompletten sevdesk-Bestand ins Sheet. |
| 5 | `DRY_RUN = true`, `syncPendingOrdersToDeepCore()` manuell, Log lesen | |
| 6 | `DRY_RUN = false` + `trigger15MinAnlegen()` | |

Zweites Netz, falls Schritt 4 vergessen wird: `IGNORIERE_AUFTRAEGE_VOR = '2026-08-01'` (`syncengine.js:37`).

---

## Schreibstrategie

Nur zwei zusammenhängende Blöcke (A–F und M–AS), je ein `setValues()`. Bestehende Formeln in diesen Blöcken (EK netto, Handelsspanne, Summen) werden vorher per `getFormulas()` gelesen und unverändert zurückgeschrieben — sonst zerstört das Blockschreiben die vorformatierten Formeln der Pufferzeile.

Die Zielzeile ist die erste mit passendem Monat in Spalte E **und** leerem Kundennamen. Eine „Gesamt [Monat]"-Blockgrenze muss deshalb nicht gesucht werden.

**Team, Projekt und Kaufart bleiben absichtlich leer** — manuelle Nacharbeit durch den Verkäufer.

---

## Unsichere Artikel-Treffer

`SCHREIBE_UNSICHER_LABEL = false` (`sheetwriter.js:26`): Bei unsicherem Match werden nur Stück und Summe geschrieben, die Namenszelle bleibt leer (die Erklärung steht ohnehin in der Notizen-Spalte).

Erst auf `true` stellen, wenn `UNSICHER_LABEL` in **jeder** Artikel-Dropdown-Liste ergänzt ist — prüfbar mit `pruefeDropdownListen()`.

---

## Schalter & Konstanten

| | |
|---|---|
| `DRY_RUN` | `false` ⚠️ (`syncengine.js:30`) |
| `MAX_ORDERS_PER_RUN` | 25 |
| `MAX_RUNTIME_MS` | 4,5 Min |
| `IGNORIERE_AUFTRAEGE_VOR` | `2026-08-01` |
| `MAX_STATE_EINTRAEGE` | 600 (Script Properties fassen 9 KB pro Wert) |
| State-Key | `DEEPCORE_SYNCED_ORDERS` — eigener Key, unabhängig vom Pipedrive-Sync |
| Log-Tab | `DeepCore-Sync-Log`, legt sich bei Bedarf selbst an |
| Tab | `Aufträge`, 2 Header-Zeilen, Daten ab Zeile 3 |

---

## ⚠️ `_backup_v1/`

Enthält eine vollständige Kopie aller drei Dateien — **35 doppelte Top-Level-Deklarationen** (`MAX_RUNTIME_MS`, `COL`, `DEEPCORE_SHEET_ID`, `syncOrderToDeepCore`, …).

Das geht nur gut, weil `.clasp.json` `"skipSubdirectories": true` setzt. **Wird das Flag je gekippt, startet das Projekt gar nicht mehr** — Apps Script lädt alle Dateien in einen Namensraum. Es ist das einzige Projekt im Repo mit einem Unterordner.

---

## Umfeld

sevdesk-Grundlagen und alle Pipedrive-Konstanten: [`../docs/REFERENZ-Pipedrive-AppsScript.md`](../docs/REFERENZ-Pipedrive-AppsScript.md)
Deploy-Regeln: [`../CLAUDE.md`](../CLAUDE.md)

Verwandt, aber getrennt: `Sevdesk-Pipdrive_sync` schreibt aus derselben sevdesk-Quelle in **Pipedrive-Deal-Felder**. Eigener State-Key, eigenes Projekt — nicht verwechseln.
