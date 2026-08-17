# PLAN — Fortschritt-Script (Pipedrive)

**Stand:** 2026-08-13
**Status:** Bauauftrag, noch kein Code geschrieben
**Rolle:** Dieses Dokument ist das vollständige Briefing für den Bau. Danach folgt ein Code-Review gegen genau diese Punkte.

---

## 1. Ziel

Zwei Pipedrive-Deal-Custom-Fields automatisch befüllen, damit niemand mehr händisch Fortschritt klickt:

| Feld | field_code | Typ | Inhalt |
|---|---|---|---|
| `Erledigt` | `8f3f8e44c657ad9fdd2e171f2d5ed6ac8c565ac7` | `set` (Mehrfachauswahl) | die tatsächlich erreichten Meilensteine |
| `Fortschritt` | `fa77cb3c2a12790f5de5879ccb7b076b5c98ab44` | `varchar_auto` | eine lesbare Kartenzeile für die Listenansicht |

Beide Felder sind **ausschließlich script-beschrieben**. Niemand setzt sie manuell, sie sind nie Pflichtfeld.

**Nicht im Scope:** Stages umsetzen, Aktivitäten anlegen, Mails senden, `Wartet auf` schreiben. Das Script liest nur und schreibt genau diese zwei Felder.

---

## 2. Ableitungsregeln `Erledigt`

Modus: **Spiegel.** Bei jedem Lauf wird die komplette Menge neu berechnet und gesetzt — Haken können also auch wieder verschwinden, wenn das Quellfeld zurückgesetzt wird. Damit ist das Script idempotent und selbstheilend.

| # | Option | ID | Quelle |
|---|---|---|---|
| 1 | Erstgespräch | 223 | erledigte Aktivität am Deal, Betreff enthält `erstgespräch` |
| 2 | Netz übergeben | 224 | `Netzstatus` ∈ {183 übergeben, 184 eingereicht, 185 Zählpunkt da, 186 Fertigmeldung raus} |
| 3 | Zählpunkt da | 225 | `Netzstatus` ∈ {185, 186} **ODER** `Einspeisezählpunkt (ZPN)` nicht leer |
| 4 | AR raus | 226 | `AR versendet` = 206 |
| 5 | Anzahlung da | 227 | `Zahlungseingang erhalten` = 207 |
| 6 | Geliefert | 228 | `Liefertermin` gesetzt UND ≤ heute |
| 7 | Zweitgespräch | 229 | erledigte Aktivität am Deal, Betreff enthält `zweitgespräch` |
| 8 | Montiert | 230 | `AC-Termin` gesetzt UND ≤ heute |
| 9 | IB erfolgt | 231 | `IB-Termin` gesetzt UND ≤ heute |
| 10 | Förderzusage | 232 | `Förderzusage erhalten` = 209 **ODER** `Förderstatus` ∈ {191 zugesagt, 193 abgerechnet} |
| 11 | Fertigmeldung | 233 | `Fertigmeldung am` gesetzt UND ≤ heute |

Die Regeln gehören in **eine einzige deklarative Tabelle im Code** (`ERLEDIGT_REGELN`), nicht in eine if-Kaskade. Jede Regel = `{ optionId, label, quelle(deal, aktivitaeten) → boolean }`. Neue Meilensteine sollen eine Zeile sein, kein Umbau.

Benötigte field_codes:

```
Netzstatus                    df60049565c7aecc52febb2ef5ecb911a761c2c6
Einspeisezählpunkt (ZPN)      86f6ce58bb7129c5c4e312038342f601713c7742
AR versendet                  d54cfede7b837b9f1f135a24f14e6c1c5fe7d85a
Zahlungseingang erhalten      ddbfed2a1cdc25c2be460b9a825e056cca2d0284
Liefertermin                  c0a676d8db66f0cb6300e8160e1401355a226990
AC-Termin                     0277ea7463b980044e0062e46467979ccc292127
IB-Termin                     ba820255728739b29c451287808fbe18f1c94b8e
Förderzusage erhalten         574d9469760b0e993af058654a7c827a81150cb4
Förderstatus                  fe61797bd9d9e4990a2f5735b8c4de1919c7fa11
Fertigmeldung am              69dd6586f2a762a912b9131dee404acf711fc1a5
Wartet auf                    b7342c374d4e7d76f9ec3772d95efd5944c97e29
```

### Bewusst offene Annahmen (im DRY-Vollauf zu prüfen, nicht vorab wegdiskutieren)

- **„Geliefert" über `Liefertermin` ≤ heute** unterstellt, dass ein verschobener Termin auch im Feld korrigiert wird. Wenn im DRY-Lauf auffällig viele alte Deals „geliefert" sind, obwohl sie es nicht sind, muss die Regel auf die Stage umgestellt werden.
- **„Montiert" über `AC-Termin`** funktioniert bei Full Service. Bei `Ausführungsart = Selbstmontage` gibt es evtl. gar keinen AC-Termin → diese Deals hängen dauerhaft auf „nicht montiert". Im DRY-Lauf nach Ausführungsart aufschlüsseln.
- **Betreff-Matching der Gespräche ist per Definition fragil.** Deshalb: bei jedem Treffer den tatsächlichen Aktivitäts-Betreff mitloggen, damit sichtbar wird, worauf gematcht wurde.

---

## 3. Format `Fortschritt`

```
▰▰▰▰▱▱▱▱▱▱▱ 4/11 · Anzahlung da · wa:Kunde
```

Aufbau, in dieser Reihenfolge:

1. **Balken**, 11 Segmente, `▰` (U+25B0) gefüllt / `▱` (U+25B1) leer. Muss zuerst stehen — dann sortiert die Pipedrive-Listenansicht alphabetisch automatisch nach Fortschritt.
2. **Zähler** `n/11`.
3. **Letzter erledigter Schritt** = die in der Reihenfolge aus Abschnitt 2 *höchste* erfüllte Regel (nicht die zuletzt gesetzte — die Quellfelder tragen keinen Zeitstempel).
4. **`wa:` + Wartet-auf**, abgekürzt. Weggelassen, wenn `Wartet auf` leer ist.

```javascript
const WARTET_AUF_KURZ = {
  171: 'RP', 172: 'Kunde', 173: 'Partner', 174: 'Lieferant',
  175: 'Netz', 176: 'Förder', 177: 'Leasing'
};
```

Trennzeichen ` · ` (U+00B7). Blockzeichen statt Emoji — Emoji rendern in Pipedrive-Listen inkonsistent und kosten Spaltenbreite.

**Sonderzustände überschreiben den Balken komplett** (nicht anhängen), damit tote Deals in der Liste sofort auffallen:

| Zustand | Ausgabe |
|---|---|
| Stage = Storniert | `✖ Storniert` |
| Stage = Verschoben | `⏸ Verschoben` |
| 11/11 | `▰▰▰▰▰▰▰▰▰▰▰ 11/11 ✓` |

Die Stage-IDs für Storniert/Verschoben sind noch nicht erhoben → als Konstanten oben im Config-Block, mit `TODO_`-Marker, und `pruefeKonfiguration()` muss sie gegen `GET /api/v2/stages` verifizieren.

### ⚠️ Feldtyp-Empfehlung — vor dem Bau entscheiden

`Fortschritt` ist aktuell **`varchar_auto` = Autocomplete**. Jeder je geschriebene Wert landet dauerhaft in der Vorschlagsliste des Feldes. Das gewählte Format erzeugt grob **400+ distinkte Werte** → die Autocomplete-Liste wird unbrauchbar zugemüllt (und dieser Feldtyp hat uns beim ZPN-Feld schon einen 400er beschert).

**Empfehlung: Feldtyp in Pipedrive auf `varchar` (einfacher Text) umstellen, bevor das Script scharf geht.** Dann ist die Varianz im String völlig egal. Das Feld ist noch leer, es geht dabei nichts verloren. Falls das nicht gemacht wird: der ZPN-Retry-Workaround aus `Sheet-Sync/FieldSync.gs` muss übernommen werden.

---

## 4. Architektur

**Eigenes, komplett separates Apps-Script-Projekt** `Fortschritt-Script`. Nicht als Datei in ein bestehendes Projekt packen — geteilte Konstanten wie `PIPEDRIVE_DOMAIN` / `fetchPipedrive` / `logRow` kollidieren projektweit und das Projekt startet dann gar nicht.

**Dateien:**

| Datei | Inhalt |
|---|---|
| `Config.gs` | Domain, field_codes, Option-IDs, Stage-IDs, `DRY_RUN`, Log-/Dashboard-Sheet-IDs |
| `Regeln.gs` | `ERLEDIGT_REGELN` + `WARTET_AUF_KURZ` + `baueFortschrittText()` |
| `Code.gs` | Hauptlauf, Laden, Diff, Schreiben, Logging |
| `SetupHelpers.gs` | `pruefeKonfiguration()`, `testEinzelDeal()`, `installTriggers()`, `resetVollauf()` |
| `README.md` | Kurzfassung + Go-Live-Ablauf |

**Ablauf pro Lauf:**

1. Alle gewonnenen Deals **einmal paginiert** laden (`limit=100`, Cursor über `additional_data.next_cursor`). `custom_fields` kommen bei Listen-Endpunkten mit — **kein Einzelabruf pro Deal.**
2. Alle **erledigten Aktivitäten einmal paginiert** laden und in eine `Map<deal_id, [betreff…]>` legen. Kein Call pro Deal (das wären 437 Calls/Lauf).
3. Pro Deal: Soll-`Erledigt` (Array Option-IDs, aufsteigend sortiert) und Soll-`Fortschritt` (String) berechnen.
4. **Diff gegen den Ist-Zustand.** Nur bei echter Abweichung PATCHen.
5. Ergebnis loggen.

**Trigger:** zeitgesteuert alle 15 Minuten, gleiches Muster wie `Sheet-Sync`. `installTriggers()` muss **idempotent** sein (eigene Trigger vorher löschen), sonst läuft nach dem zweiten Klick alles doppelt.

---

## 5. Sicherheitsregeln — nicht verhandelbar

Das sind die Punkte, an denen dieselbe Klasse Fehler in den bestehenden Scripts schon zugeschlagen hat.

1. **🔴 Diff-Pflicht.** Es wird **nur** geschrieben, wenn sich `Erledigt` oder `Fortschritt` tatsächlich ändert. Blindes PATCHen bei jedem Lauf heißt: 437 Deals × 96 Läufe = **41.952 Writes/Tag** gegen ~20.000 UrlFetch-Kontingent — und jeder Write ist in Pipedrive ein „Deal aktualisiert"-Ereignis.

2. **🔴 Automations-Check vor Go-Live.** Die Pipedrive-API kennt kein „silent update" — API-Writes triggern Automations genau wie Klicks. Die geplante Automation **A1** (Trigger „Deal aktualisiert", Bedingung Status = Gewonnen → 4–5 Aktivitäten + Slack) würde bei jedem Fortschritt-Write erneut feuern. Vor dem ersten scharfen Lauf muss geprüft und im Log dokumentiert werden, welche Automations auf „Deal aktualisiert" hängen. Aktueller Stand laut Projektnotizen: keine aktiven Automations vorhanden — das ist **vor dem Lauf neu zu verifizieren, nicht anzunehmen.**

3. **🔴 Kein stiller Nullschreibvorgang.** Ein `undefined` in `custom_fields` wird von `JSON.stringify` entfernt; der PATCH geht mit leerem Objekt raus, Pipedrive antwortet **200**, und das Log meldet Erfolg, obwohl nichts geschrieben wurde. Vor jedem PATCH prüfen, dass das zu schreibende Objekt tatsächlich befüllt ist — sonst `HARD_ERROR`, nicht „gesetzt".

4. **🔴 `pruefeKonfiguration()`** gleicht alle hartcodierten Option-IDs (Erledigt, Netzstatus, Förderstatus, Wartet auf, die Checkbox-Enums) und die Stage-IDs gegen die echte API ab (`GET /api/v2/dealFields`, `GET /api/v2/stages`). Muss vor jedem Vollauf laufen und bei Abweichung **abbrechen**, nicht warnen.

5. **`set`-Feld leeren:** Sind keine Regeln erfüllt, muss klar sein, ob Pipedrive `[]` oder `null` erwartet. **Gegen die v2-Doku prüfen, nicht aus Erinnerung entscheiden** — und der leere Fall gehört in den Einzeldeal-Test.

6. **API-Basics:** Auth-Header `x-api-token` (kein `Bearer`, kein `?api_token=`). Bei `GET /api/v2/deals` **kein `status`-Parameter** mit v1-Werten — `all_not_deleted` gibt es in v2 nicht (HTTP 400). Für „nur gewonnene" ist `status=won` gültig.

7. **Retry-Wrapper:** bei 429/5xx exponentielles Backoff, bei 4xx sofort abbrechen. Ein 4xx wird durch Warten nicht besser.

8. **Resume-Cursor** in `ScriptProperties` + freiwilliger Abbruch nach ~4,5 Min für den einmaligen Vollauf über *alle* Deals. Im 15-Min-Dauerbetrieb über ~440 gewonnene Deals wird er nicht greifen, muss aber existieren.

9. **`DRY_RUN`** als Konstante in `Config.gs`, Default `true`.

10. **Keine Funktionen mit Parametern** für alles, was man im Editor per ▷ startet — der Button ruft ohne Argumente auf, der Parameter ist dann `undefined`. Test-Deal-IDs gehören in Konstanten.

11. **Log-Sheet-Handle einmal cachen**, Zeilen in einem Array puffern, am Ende **ein** `setValues()`. Kein `appendRow` pro Zeile, kein `openById` pro Zeile.

---

## 6. Logging

Zwei Ziele:

**a) Eigenes Detail-Log-Sheet** (self-bootstrapping über Script Property, wie beim Field-Setup-Script), eine Zeile **nur für tatsächlich geänderte Deals** plus eine Zusammenfassungszeile pro Lauf. Ein Vollauf-Log über alle 437 Deals bei 96 Läufen/Tag sprengt sonst mittelfristig das 10-Mio.-Zellen-Limit.

Spalten: `Timestamp | Deal-ID | Titel | Erledigt vorher | Erledigt nachher | Fortschritt vorher | Fortschritt nachher | ausgelöst durch | Status | Detail`

„ausgelöst durch" = welche Regel neu gegriffen hat. Bei den Gesprächs-Regeln zusätzlich der gematchte Aktivitäts-Betreff.

**b) Zusammenfassungszeile ins zentrale Automations-Dashboard**, Schema aus dem Dashboard-Konzept:
`Timestamp | Script-Name | Lauf-Typ | Status | Verarbeitet | Übersprungen | Fehler | Detail`
mit `OK` / `SOFT_ERROR` (fachlicher Grenzfall, bewusst übersprungen) / `HARD_ERROR` (API-Fehler, Config-Fehler, leerer Patch).

Das Dashboard-Sheet existiert noch nicht — die Sheet-ID als `TODO_` anlegen und den Dashboard-Write hinter einem Schalter `DASHBOARD_ENABLED` (Default `false`), damit das Script ohne Dashboard lauffähig ist.

---

## 7. Testplan

| # | Schritt | Erwartung / Abbruchkriterium |
|---|---|---|
| 1 | `pruefeKonfiguration()` | alle Option-IDs und Stage-IDs grün, sonst Stopp |
| 2 | `testEinzelDeal()`, DRY, fixe Deal-ID | berechnete Menge von Hand gegen die Pipedrive-Oberfläche gegengeprüft |
| 3 | Randfälle einzeln, DRY | Deal ohne jeden Meilenstein (`0/11`), 11/11-Deal, stornierter Deal, verschobener Deal |
| 4 | **DRY-Vollauf über alle gewonnenen Deals** | Verteilung ausgeben: wie viele Deals je Zählerstand. Fast alle auf `0/11` ⇒ Ableitungsregeln stimmen nicht. Zusätzlich nach `Ausführungsart` aufschlüsseln (Selbstmontage-Frage aus Abschnitt 2). Laufzeit + Call-Anzahl messen. |
| 5 | Automations-Check in Pipedrive | dokumentieren, was auf „Deal aktualisiert" hängt |
| 6 | Feldtyp `Fortschritt` klären | `varchar_auto` → `varchar` umstellen (siehe Abschnitt 3) |
| 7 | 2–3 Deals live (`DRY_RUN = false`, Einzeldeal-Funktion) | in der Oberfläche visuell kontrollieren |
| 8 | Vollauf live | Log-Verteilung gegen den DRY-Lauf gegenprüfen |
| 9 | zweiter Vollauf direkt danach | **0 Änderungen.** Das ist der Idempotenz-Beweis — schreibt er wieder, ist der Diff kaputt und wir haben 41.952 Writes/Tag. |
| 10 | `installTriggers()`, 15-Min-Trigger scharf | nach 1 h Log prüfen: Läufe mit 0 Änderungen sind der Normalfall |

Schritt 9 ist der wichtigste Test im ganzen Plan.

---

## 8. Vorbedingungen, die nicht das Script lösen kann

- **Feldtyp `Fortschritt`** (Abschnitt 3) — Entscheidung Valentin.
- **Duplikat `Task - List`** — das alte Mehrfachoptionsfeld überlappt inhaltlich mit `Erledigt`. Der Plan war „Option 2: `Task - List` ignorieren, sobald das Script läuft". Das Script rührt `Task - List` **nicht** an. Vor dem Löschen prüfen, ob es bei bestehenden Deals Werte trägt. Nicht Teil dieses Bauauftrags.
- **Stage-IDs Storniert / Verschoben** müssen erhoben werden.
- **Aktivitäten-Betreffe** für Erst-/Zweitgespräch: hängt daran, dass Automation A1 sie mit stabilem Betreff anlegt. A1 existiert noch nicht → bis dahin greifen Regel 1 und 7 nur, wo jemand händisch so betitelte Aktivitäten angelegt hat. Das ist erwartetes Verhalten, kein Bug, muss aber im DRY-Lauf sichtbar sein.

---

## 9. Worauf das Review schauen wird

1. Schreibt das Script bei unverändertem Zustand wirklich **nichts**? (Schritt 9)
2. Gibt es irgendwo einen Call **pro Deal** — Deals, Aktivitäten oder Log-Sheet?
3. Kann ein PATCH mit leerem oder unvollständigem `custom_fields` rausgehen und trotzdem als Erfolg geloggt werden?
4. Bricht `pruefeKonfiguration()` bei einer Abweichung ab, oder warnt es nur?
5. Sind die Erledigt-Regeln eine Datentabelle oder eine if-Kaskade?
6. Sind Regel-Treffer im Log nachvollziehbar (welche Regel, welcher Rohwert / welcher Aktivitäts-Betreff)?
7. Sind alle ▷-startbaren Funktionen parameterlos?
8. Ist `installTriggers()` idempotent?
9. Wird zwischen `SOFT_ERROR` und `HARD_ERROR` sauber unterschieden, oder wird alles zu „übersprungen"?
10. Steht irgendein API-Detail im Code, das aus Erinnerung statt aus der v2-Doku stammt?
