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
| **D5** | ✅ **Teil 1 erledigt 09.09.2026** — kein `PLACEHOLDER_*` mehr in `FIELD_KEYS`, `pruefeKonfiguration()` (`syncengine.js:1257`) kann erstmals grün werden. ⚠️ **Teil 2 offen:** Groß-/Kleinschreibungs-Mismatch — `ENUM_OPTION_IDS` nutzt `Zahlungseingang_erhalten` (`fieldkeysandmapping.js:68`), `FIELD_KEYS` nutzt `zahlungseingang_erhalten` (`:24`) → Option-ID 207 wird nie validiert. Der Check meldet ab jetzt „OK" und überspringt sie trotzdem — ein grüner Check mit stiller Lücke ist irreführender als ein roter. |
| ~~**D6**~~ | ✅ **Erledigt 09.09.2026** — `SM_FS_Typ` ist komplett entfernt, damit auch die „geladene Waffe". Siehe unten „Was NICHT geschrieben wird". |
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

Bei Mehrfachtreffern wird über den Deal-Status aufgelöst. Aufträge ohne Treffer werden geparkt, gestaffelt neu versucht (Park-Tag + Tag 1 stündlich, Tag 2 alle 2 h, Tag 3 alle 3 h, ab Tag 4 täglich -- seit 24.09.2026) und **nach 14 Tagen endgültig aufgegeben**.

> **Duplikat geklärt:** Es gab zwei Angebotsnummer-Felder. Gültig ist `9935f33d…`. Das zweite (`e442e2f3803eedfe77a2e4d7c5e180d33093e067`) ist das abzuräumende Duplikat — die Memory beschreibt es widersprüchlich, maßgeblich ist der Code.

---

## Was geschrieben wird

Hardware (Module Anzahl/Bezeichnung/Marke, Speicher-kWh, WR-Leistung, System-Marke, Wallbox, Notstrom, Heizstab) und vier Pauschalen (Montage, Elektroinstallation, Elektromaterial, Technische Projektierung), dazu eine Artikel-Summary. Alle `field_code`s stehen in [`../docs/REFERENZ-Pipedrive-AppsScript.md`](../docs/REFERENZ-Pipedrive-AppsScript.md).

**Neu 09.09.2026: `Gesamtsumme_Brutto`** (`4af5a8d4ff079ac13a13b6de092748479fbe3d13`, Pipedrive-Typ **Text**). Quelle ist `order.sumGross` vom sevdesk-Auftrag — nicht die Summe der Positionen, weil sevdesk Rabatte und Steuer dort schon eingerechnet hat. sevdesk liefert den Wert als String (`"27140.39"`), `formatiereBruttoSumme()` (`syncengine.js:149`) macht daraus `27.140,39 €`. Fehlt oder ist die Summe ≤ 0, wird das Feld **geleert** statt `0,00 €` zu schreiben. Weil der Wert am Auftrag hängt und nicht an den Positionen, nehmen `writeArticleFieldsToDeal()` und `formatiereErkannteFelder()` seit 09.09. das `order`-Objekt als zusätzlichen Parameter.

**Kein `PLACEHOLDER_*` mehr (09.09.2026).** Beide Platzhalter-Keys sind aus `FIELD_KEYS` verschwunden — siehe unten. `pruefeKonfiguration()` kann damit erstmals grün werden.

### Was NICHT geschrieben wird

**„Montage_Elektro_Summary"** — Textfeld mit `Montage 3200€ | E-Install 1400€ | E-Material 650€ | Projekt. 490€`, ab 01.09.2026 für Christof gedacht (kurze Zusammenfassung statt Suche in der langen Hardware-Summary).

**Verworfen am 09.09.2026 (Entscheidung Valentin):** das Pipedrive-Feld wurde nie angelegt, der `PLACEHOLDER`-Key hielt `pruefeKonfiguration()` dafür dauerhaft rot. Die vier Beträge stehen längst einzeln und strukturiert am Deal (`Montage_`/`Elektroinstallation_`/`Elektromaterial_`/`Technische_Projektierung_Pauschale_EUR`, alle Typ Nummer) — eine Textkopie derselben Zahlen bringt nichts dazu. **Der String wird weiter gebaut und landet im Sync-Log** (`aggregated.montageSummary` → `formatiereErkannteFelder()`), nur nicht mehr in einem Deal-Feld. Die Setup-Funktion heißt jetzt `VERWORFEN_createMontageElektroSummaryFeld()` (`fieldsetup.js:71`) und wirft. Ein Feld dafür wäre nur für eine **Listenansicht oder einen Filter** ein echter Grund — vorher mit Christof klären.

> **Nachtrag 11.09.2026 — die Begründung oben gilt nur noch halb.** „Textkopie derselben Zahlen"
> stimmt bei Pauschalaufträgen. Bei **REGIE**-Aufträgen nicht: dort bleiben die Zahlenfelder
> bewusst leer (Stundensatz ist kein Endbetrag), und die Summary ist die *einzige* Stelle, an der
> „Montage REGIE 89€/Std" überhaupt darstellbar ist — ein Feld vom Typ Nummer kann das nicht.
> Damit hat das verworfene Feld erstmals ein inhaltliches Argument, nicht nur ein Komfort-Argument.
> Entscheidung weiterhin offen, siehe Abschnitt „REGIE vs. Pauschale" unten.

**„Ausführungsart" (SM/FS)** — `cc80ad5daf0788dba60b3da3931681edd3dd2c87`, enum, `Full Service`=154 / `Selbstmontage`=155 / `Hybrid`=156.

**Absichtlich ausgelassen (Entscheidung Valentin, 09.09.2026): der Seller trägt die Ausführungsart in Pipedrive selbst ein.** Bis 09.09. leitete das Script den Wert aus den Positionen ab (Montage-/Elektro-Position vorhanden ⇒ „FS") und hätte damit bei jedem Sync die Handeingabe überschrieben. Der `field_code` ist bekannt und steht bewusst nur hier, nicht in `FIELD_KEYS`. Regressions-Test: `_tests/Sevdesk-Pipdrive_sync/test-gesamtsumme-brutto.js` schlägt fehl, sobald der Key wieder im PATCH landet.

---

## Wichtige Funktionen

| Zweck | |
|---|---|
| Trigger-Einstieg | `syncPendingOrders()` (`:1348`), angelegt via `SETUP_EINMALIG_createTrigger()` (`:1288`) |
| Konfigurationsprüfung | `pruefeKonfiguration()`, `pruefeZahlungseingangKonfiguration()` — letztere deckt Option 207 ab, die die generische überspringt |
| Feld-Codes finden | `checkExistingFields()`, `showFieldOptions()` — ⚠️ beide von D12 betroffen |
| Verworfene Setups | `VERWORFEN_createMontageElektroSummaryFeld()`, `ARCHIV_*` — werfen absichtlich |
| Geparkte Aufträge | `zeigeGeparkteAuftraege()`, `entparkeAuftraege()` |
| State | `zeigeSyncStateGroesse()`, `resetSyncState()` — Props: `SYNCED_ORDERS`, `SYNCED_ANZAHLUNGSRECHNUNGEN`, `ALARM_TAEGLICH` |
| Zahlungseingang | `syncZahlungseingaenge()` (`zahlungseingang.js:272`) — `ZAHLUNGSEINGANG_DRY_RUN = true`, **kein Trigger**, Entwurf |

Die `ARCHIV_*`-Funktionen werfen absichtlich — erledigte Einmal-Migrationen.

## REGIE vs. Pauschale (11.09.2026)

sevdesk verrechnet Montage auf zwei Arten, und **im Positionspreis sieht man den Unterschied nicht**:

| Artikelname | `unity.id` | Preis 89 bedeutet |
|---|---|---|
| `MONTAGEARBEITEN (PAUSCHAL)` | 7 (Pauschale) | 89 € Endbetrag |
| `MONTAGEARBEITEN (REGIE)` | **9 (Stunde)** | **89 € pro Stunde, Summe offen** |

Bis 11.09.2026 schrieb der Sync in beiden Fällen `89` in `Montage_Pauschale_EUR`. Aufgefallen an
Order 30321086: der Montagepartner hätte „Montage kostet 89 €" gelesen und damit geplant, obwohl
bei ~10 Stunden 890 € anfallen. **Eine falsche Zahl ist schlechter als ein leeres Feld** — leer
führt zur Rückfrage, `89` sieht nach einer Antwort aus.

Jetzt: bei REGIE bleibt das Zahlenfeld `null`, der Stundensatz wandert als
`Montage REGIE 89€/Std` in `montageSummary` (Sync-Log). Erkannt über zwei unabhängige Indikatoren
(`EINHEIT_STUNDE` = `unity.id` 9, `REGIE_IM_NAMEN` = `(REGIE)` im Artikelnamen) — fällt einer aus,
trägt der andere. Regressionstest: `node _tests/Sevdesk-Pipdrive_sync/test-regie-vs-pauschale.js`,
**13 Tests**, inklusive Gegenproben, dass Pauschalen *nicht* mitgesperrt werden.

⚠️ **Deals, die vor dem 11.09.2026 mit einem REGIE-Auftrag synchronisiert wurden, tragen die
falsche Zahl weiterhin** — der Fix wirkt erst beim nächsten Sync dieses Auftrags, und der
Duplikat-Schutz verhindert einen automatischen Neulauf. Betroffene Deals von Hand leeren oder
gezielt per `syncDirektAufBekannterDeal(dealId, orderId)` neu schreiben.

**Lokaler Test (neu 09.09.2026):** `node _tests/Sevdesk-Pipdrive_sync/test-gesamtsumme-brutto.js` — lädt `fieldkeysandmapping.js` + `syncengine.js` in einen `vm`-Context mit Apps-Script-Stubs und prüft den PATCH-Payload, den `writeArticleFieldsToDeal()` an Pipedrive schicken würde. Kein Netzwerk, kein Token, kein Schreibzugriff. **24 Tests, alle grün** — drei davon sind Regressions-Schutz: sie schlagen an, falls die Ausführungsart wieder ins PATCH rutscht, falls `Montage_Elektro_Summary` in `FIELD_KEYS` zurückkommt oder falls irgendein Key wieder ein `PLACEHOLDER` ist.

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
