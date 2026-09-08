# Sevdesk-Pipdrive_sync

Pollt sevdesk nach angenommenen Aufträgen, ordnet sie einem Pipedrive-Deal zu, klassifiziert die Artikelpositionen und schreibt Hardware- und Pauschalfelder auf den Deal.

**Das komplexeste Live-Projekt im Repo** (~2.700 Zeilen). [Editor öffnen](https://script.google.com/home/projects/1pfqKbOFNUQYaZZg-k2odn2RSZ3CmbOZSZBtFqnvKldxpvHw8EUGbBoIP/edit)

| | |
|---|---|
| Trigger | `syncPendingOrders()`, **alle 5 Minuten** (seit 26.08.2026, vorher 15) |
| `DRY_RUN` | `false` (`syncengine.js:37`) |
| Log-Sheet | `1Icpc12eOBEmp2674cdKFVa1PCP7m-AHSRlSwNeiwmeo`, Tab `Sync-Log` |
| Alarm-Mail | `valentin@rp-energietechnik.at` (hardcodiert, `syncengine.js:495`) |

---

## 🔴 Go-Live-Blocker: Status 500 wird kaum gesetzt

Der Poller filtert hart auf `status=500` („Angenommen"). In der Praxis wird der Status selten gesetzt — von 26 geprüften, in Pipedrive **gewonnenen** Deals hatten **22 den sevdesk-Status 200**.

**Für die große Mehrheit real gewonnener Aufträge löst der Sync also nie aus.** Das ist keine Fehlfunktion des Codes, sondern eine Annahme über den Arbeitsablauf, die nicht zutrifft. Entweder das Team setzt den Status verlässlich, oder der Filter muss anders aussehen.

## 🔴 Weitere offene Befunde

Details in [`../docs/BEFUNDE-2026-09-01.md`](../docs/BEFUNDE-2026-09-01.md).

| # | |
|---|---|
| **D5** | `pruefeKonfiguration()` (`syncengine.js:1239`) kann **nie grün werden** — zwei `PLACEHOLDER_*`-Keys erzeugen dauerhaft FEHLER. Ein immer roter Check wird nicht mehr gelesen. Zusätzlich überspringt er durch einen Groß-/Kleinschreibungs-Mismatch genau eine Enum-Prüfung: `ENUM_OPTION_IDS` nutzt `Zahlungseingang_erhalten` (`fieldkeysandmapping.js:52`), `FIELD_KEYS` nutzt `zahlungseingang_erhalten` (`:24`) → Option-ID 207 wird nie validiert. |
| **D6** | `SM_FS_Typ: { 'SM': null, 'FS': null }` (`fieldkeysandmapping.js:56`). Heute harmlos. Trägt jemand nur den echten `field_code` ein, ohne die Option-IDs, **wird das Feld auf jedem synchronisierten Deal geleert** — mit nichts als einer `Logger.log`-Warnung. Der Header-Kommentar lädt genau zu diesem halben Fix ein. |
| **D7** | `logSyncResult()` (`:328`) macht `openById` **und** `appendRow` pro Datensatz, bis zu 25× pro 5-Min-Tick ≈ **7.200 Sheets-Calls/Tag**. Jedes andere Projekt puffert längst. |
| **D8** | Die Laufzeit-Stoppuhr startet bei `:1423`, die sevdesk-Pagination läuft bei `:1387` davor. Der Kommentar bei `:1350` gibt es zu. Der Guard greift dadurch nie. |
| **D11** | Schreibt die Angebotsnummer und sucht sofort per `itemSearch` darauf (`:850`, `:1192`). Pipedrives Suchindex ist eventually consistent → „Kein Deal gefunden", Fehlerzähler steigt, nach 5 Versuchen wird der Auftrag geparkt. |
| **D12** | `dealFields` ohne `?limit=500` in `zahlungseingang.js:318`, `fieldsetup.js:100` und `:117` → meldet existierende Felder als „existiert nicht (mehr)". Betrifft ausgerechnet die Funktionen, deren Zweck das Finden eines Feldcodes ist. |
| **D19** | Stilles `break` bei >1000 Aufträgen (`:1393`), stilles `break` bei 2000 (`zahlungseingang.js:63`). |

---

## Zuordnung Auftrag → Deal

Zwei Wege, in dieser Reihenfolge:

1. **Angebotsnummer** — `sevdesk_angebotsnummer` (`9935f33d1f8c5575da1aa3bdf1c2329bed92398b`) über `/itemSearch/field` mit `match=exact`
2. **Kundennummer** als Fallback — `sevdesk_kunden_id` (`8926e917db5b38f34fccc43fe74f05a9730e247e`)

Bei Mehrfachtreffern wird über den Deal-Status aufgelöst. Aufträge ohne Treffer werden geparkt, täglich neu versucht und **nach 14 Tagen endgültig aufgegeben**.

> **Duplikat geklärt:** Es gab zwei Angebotsnummer-Felder. Gültig ist `9935f33d…`. Das zweite (`e442e2f3803eedfe77a2e4d7c5e180d33093e067`) ist das abzuräumende Duplikat — die Memory beschreibt es widersprüchlich, maßgeblich ist der Code.

---

## Was geschrieben wird

Hardware (Module Anzahl/Bezeichnung/Marke, Speicher-kWh, WR-Leistung, System-Marke, Wallbox, Notstrom, Heizstab) und vier Pauschalen (Montage, Elektroinstallation, Elektromaterial, Technische Projektierung), dazu eine Artikel-Summary. Alle `field_code`s stehen in [`../docs/REFERENZ-Pipedrive-AppsScript.md`](../docs/REFERENZ-Pipedrive-AppsScript.md).

**Zwei Felder sind noch `PLACEHOLDER_*`:** `Montage_Elektro_Summary` und `SM_FS_Typ`. Bei `SM_FS_Typ` unbedingt D6 lesen, bevor der Code eingetragen wird.

---

## Wichtige Funktionen

| Zweck | |
|---|---|
| Trigger-Einstieg | `syncPendingOrders()` (`:1348`), angelegt via `SETUP_EINMALIG_createTrigger()` (`:1288`) |
| Konfigurationsprüfung | `pruefeKonfiguration()`, `pruefeZahlungseingangKonfiguration()` — letztere deckt Option 207 ab, die die generische überspringt |
| Feld-Codes finden | `checkExistingFields()`, `showFieldOptions()` — ⚠️ beide von D12 betroffen |
| Geparkte Aufträge | `zeigeGeparkteAuftraege()`, `entparkeAuftraege()` |
| State | `zeigeSyncStateGroesse()`, `resetSyncState()` — Props: `SYNCED_ORDERS`, `SYNCED_ANZAHLUNGSRECHNUNGEN`, `ALARM_TAEGLICH` |
| Zahlungseingang | `syncZahlungseingaenge()` (`zahlungseingang.js:272`) — `ZAHLUNGSEINGANG_DRY_RUN = true`, **kein Trigger**, Entwurf |

Die `ARCHIV_*`-Funktionen werfen absichtlich — erledigte Einmal-Migrationen.

**`SYNCED_ORDERS` ist nicht unbegrenzt:** Script Properties fassen 9 KB pro Wert; `syncengine.js:420` beziffert die reale Kapazität auf ~115 Aufträge. Es gibt eine 90-Tage-Aufräumung, aber die Grenze bleibt.

---

## sevdesk-API

| | |
|---|---|
| Base | `https://my.sevdesk.de/api/v1` |
| Auth | Header `Authorization`, **ohne** `Bearer`-Präfix |
| Status „Angenommen" | `500` |
| Test | Deal 7253 · Kunde Stefan Schießtl, Kundennummer 4010 |

---

## Umfeld

Verwandt, aber getrennt: `Deepcore-Automatisierung` liest dieselbe sevdesk-Quelle und schreibt in ein **Google Sheet** statt nach Pipedrive. Eigener State-Key, eigenes Projekt.

Deploy-Regeln und Repo-Konventionen: [`../CLAUDE.md`](../CLAUDE.md)
