# Fortschritt-Script

Befüllt zwei Pipedrive-Deal-Felder automatisch, damit niemand mehr händisch Fortschritt klickt.

| Feld | field_code | Typ | Inhalt |
|---|---|---|---|
| `Erledigt` | `8f3f8e44…5ac7` | `set` | die tatsächlich erreichten Meilensteine |
| `Fortschritt` | `dfa17bef…a448` | Text | `▰▰▰▰▱▱▱▱▱▱▱ 4/11 · ✓ Anzahlung da · wa:Kunde` |

Das alte `fa77cb3c…ab44` war `varchar_auto` (Autocomplete). Pipedrive lässt Feldtypen nachträglich
nicht ändern, deshalb ein neues Textfeld — das alte wurde am 2026-08-17 **gelöscht**.

⚠️ `Sheet-Sync` referenziert diesen Code noch (`FORTSCHRITT_FIELD_KEY`, `FORTSCHRITT_LABELS`) und
liest ihn in `NetzanmeldungEskalation.gs` Zeile 53. Das stürzt nicht ab — ein gelöschtes Feld liefert
`undefined` —, aber die ODER-Bedingung kann nie mehr wahr werden. Die Eskalation läuft über den
`Netzstatus`-Check daneben weiter. Aufzuräumen: die toten Bedingung und die verwaisten Konstanten.

Beide Felder sind **ausschließlich script-beschrieben**. Das Script liest sonst nur — es setzt keine
Stages um, legt keine Aktivitäten an, schickt keine Mails und schreibt kein `Wartet auf`.

Gebaut nach `PLAN-Fortschritt-Script.md` (2026-08-13).

---

## Dateien

| Datei | Inhalt |
|---|---|
| `Config.gs` | Domain, field_codes, Option-IDs, Stage-IDs, `DRY_RUN`, Dashboard-Schalter, API-Wrapper |
| `Regeln.gs` | `erledigtRegeln()` (die Regeltabelle), `WARTET_AUF_KURZ`, `baueFortschrittText()`, Lesehilfen |
| `Code.gs` | Hauptlauf: laden, berechnen, diffen, schreiben, loggen |
| `SetupHelpers.gs` | `pruefeKonfiguration()`, Tests, Trigger, Debug-Helfer |

## Funktionen im Editor (alle parameterlos, per ▷ startbar)

| Funktion | Zweck |
|---|---|
| `pruefeKonfiguration()` | gleicht alle Option-/Stage-IDs gegen die echte API ab |
| `testEinzelDeal()` | rechnet `TEST_DEAL_ID` durch, schlüsselt alle 11 Regeln einzeln auf |
| `testRandfaelle()` | rechnet `TEST_DEAL_IDS_RANDFAELLE` durch (0/11, 11/11, Storniert, Verschoben) |
| `aktualisiereFortschritt()` | manueller Lauf über alle gewonnenen Deals |
| `aktualisiereFortschrittPerTrigger()` | Ziel des 15-Minuten-Triggers |
| `installTriggers()` | 15-Minuten-Trigger einrichten (idempotent) |
| `resetVollauf()` | Resume-Cursor löschen |
| `listDealFieldsHelper()` | alle Deal-Felder mit Typ und Options-IDs |
| `listStagesHelper()` | alle Stages mit ID und Pipeline |
| `listAktivitaetsBetreffe()` | welche Betreffe erledigte Aktivitäten wirklich tragen |
| `schreibeEinzelDealLive()` | schreibt **nur** `TEST_DEAL_ID` wirklich — ohne `DRY_RUN` umzustellen |
| `testLeerenSetWert()` | klärt empirisch, ob `[]` oder `null` ein `set`-Feld leert |
| `dumpLiveState()` | kompletter Live-Zustand: Schalter, Trigger, Properties, Feldtypen |

`dumpLiveState()` gibt es, weil Git nur den Code sichert — kaputtgegangen ist bei RP bisher immer die
**Verdrahtung** (v1-Webhook, `DRY_RUN` auf true stehengeblieben, doppelter Trigger). Das ist R7 aus
`FIXES-INDEX-2026-08-13.md`. Vor und nach jedem Scharfschalten einmal laufen lassen und die Ausgabe
in die Projektnotizen legen. Der API-Token wird dabei nie ausgegeben, nur seine Länge.

---

## Lokale Tests

Die Rechenteile (Ableitungsregeln, Fortschritt-Text, Diff-Logik, PATCH-Guard, Ampel-Status) laufen
ohne Pipedrive und ohne Sheets — sie sind lokal in node testbar:

```powershell
cd ..\_tests\Fortschritt-Script
.\run-tests.ps1
```

102 Tests, u.a. der Idempotenz-Nachweis aus Testplan-Schritt 9 (unveränderter Deal ⇒ kein Write, keine
Log-Zeile) und die Regression, dass die echten **Sales**-Aktivitätsbetreffe den Fulfillment-Fortschritt
nicht beeinflussen. **Nach jeder Regeländerung einmal laufen lassen** — billiger als ein DRY-Vollauf.

Die Testdateien liegen bewusst **außerhalb** dieses Ordners: eine zusätzliche `.js` im clasp-`rootDir`
würde bei einem versehentlichen `clasp push` dieselben Konstanten ein zweites Mal deklarieren, und
dann startet das Apps-Script-Projekt gar nicht mehr. Das Runner-Script baut alle `.gs` zu einem
Script zusammen und bildet damit auch nach, dass in Apps Script alle Dateien einen Scope teilen —
Namenskollisionen fallen dort genauso auf wie im Editor.

## Offene TODOs — ohne die startet der Hauptlauf nicht

`pruefeKonfiguration()` **bricht ab** (es warnt nicht), solange etwas davon offen ist:

Erledigt (2026-08-17 gegen die echte API verifiziert): `PIPEDRIVE_API_TOKEN`, Stage 24
(`STAGE_ID_VERSCHOBEN_STORNIERT` — es gibt **keine** zwei getrennten Stages, siehe `Config.gs`),
`AUSFUEHRUNGSART_FIELD_KEY`, `IB_ERLEDIGT_AM_FIELD_KEY`.

Noch offen:

1. **Feldtyp `Fortschritt` muss ein Textfeld sein.** `pruefeKonfiguration()` lässt DRY-Läufe bei
   `varchar_auto` durch, verweigert aber LIVE. Meldet die Prüfung weiterhin `varchar_auto`, dann
   zeigt `FORTSCHRITT_FIELD_KEY` entweder noch aufs alte Feld — oder das neue wurde versehentlich
   wieder als „Autocomplete" angelegt statt als „Text". `dumpLiveState()` gibt den field_code mit
   aus und unterscheidet die zwei Fälle.
2. **`LEERWERT_FUER_SET`** — einmal mit `testLeerenSetWert()` klären, siehe unten.
3. **`DASHBOARD_SHEET_ID` + `DASHBOARD_ENABLED`** — sobald das Automations-Dashboard existiert.

---

## Feldtyp entscheidet über das Schreib- und Leseformat

In `Sheet-Sync` wurde am 2026-08-17 eine Options-**ID** in das Feld `Fortschritt` geschrieben, das
`varchar_auto` ist. Antwort: HTTP 400, *„Expected 'string' as autocomplete custom field value"*.

Der Kommentar dort schließt daraus, eine Options-Liste beweise nicht, dass ein Feld `enum` ist.
**Das war eine Verwechslung** — der Feld-Dump vom 2026-08-17 zeigt: `Fortschritt` hat *gar keine*
Optionen, die 11 Meilenstein-Optionen gehören zu `Erledigt`. Der 400er kam davon, dass in ein
Textfeld geschrieben wurde, nicht von einem getarnten enum.

Aktueller, geprüfter Stand: **alle Quellfelder dieses Scripts sind echte `enum`-Felder** und liefern
numerische Option-IDs. Trotzdem eingebaut, als Absturzsicherung:

- **Option-Registry** (`fuelleOptionRegistry()`, kostet keinen zusätzlichen API-Call): `leseOptionIds()`
  löst auch Label-Strings zurück auf IDs auf. **Aktuell wirkungslos.** Relevant nur, falls ein
  Quellfeld je neu und anders getypt angelegt wird — dann käme `"Zählpunkt da"` statt `185`, `Number()`
  machte `NaN` daraus, die Regel griffe nie, und der Lauf sähe mit lauter `0/11` gesund aus.
- Ein Wert, der **weder** Option-ID **noch** bekanntes Label ist, wird als `SOFT_ERROR` mit Rohwert
  gemeldet statt stillschweigend als „nicht erfüllt" durchzugehen.
- `pruefeKonfiguration()` bricht ab, wenn `Erledigt` nicht `set` ist — ein Array von IDs in ein
  Textfeld wäre ein 400er.

## Zwei Punkte, die aus der Doku *nicht* zu beantworten waren

### 1. Wie leert man ein `set`-Feld? — gemessen, geklärt

Im Spiegel-Modus muss `Erledigt` leerbar sein, wenn keine Regel greift. Womit — `[]` oder `null` —
steht **nicht** in der Pipedrive-v2-Doku: die beschreibt fürs Schreiben nur „new value is an array of
ids (e.g. `[3, 7]`)" und schweigt zum Leeren. Die im Netz kursierende Aussage „nimm `null`" ließ sich
in keiner Primärquelle bestätigen — also mit `testLeerenSetWert()` am echten Deal gemessen:

```
[]    -> HTTP 400 ERR_SCHEMA_VALIDATION_FAILED
         "Expected non-empty 'array' as value for multi options custom field '...'.
          Use null to clear the field."
null  -> funktioniert, Feld ist danach leer
```

**Ergebnis: `null`.** Die API sagt es in der Fehlermeldung selbst, nur eben nirgends in der Doku —
und das gilt für alle `set`-Felder, nicht nur für dieses. `LEERWERT_FUER_SET = null` ist damit belegt
statt geraten. Der Test schreibt **echt** (und stellt den Ausgangswert wieder her), läuft deshalb nur
mit `TEST_LEERER_SET_ERLAUBT = true` und sollte danach wieder auf `false`.

### 2. Feldtyp `Fortschritt`

`varchar_auto` heißt: jeder je geschriebene Wert landet dauerhaft in der Vorschlagsliste des Feldes.
Das gewählte Format erzeugt grob 400+ distinkte Werte und müllt die Liste unbrauchbar zu — und
derselbe Feldtyp hat beim ZPN-Feld schon einen 400er beschert.

Das Script erzwingt die Entscheidung mechanisch statt sie zu dokumentieren und zu hoffen:

- Typ ist `varchar_auto` **und `DRY_RUN = true`** → Hinweis, Lauf erlaubt (Testen geht).
- Typ ist `varchar_auto` **und `DRY_RUN = false`** → **Abbruch**, es wird nichts geschrieben.
- Bewusst trotzdem live: `FORTSCHRITT_AUTOCOMPLETE_AKZEPTIERT = true` — dann aber den
  ZPN-Retry-Workaround aus `Sheet-Sync/FieldSync.gs` übernehmen.

---

## 🔴 Zwei Schreiber auf `Fortschritt` — Go-Live-Blocker, Entscheidung nötig

`Sheet-Sync` schreibt **in dasselbe Feld** `fa77cb3c…` (`Fortschritt`) wie dieses Script. Das ist
kein theoretischer Konflikt, es steht so im Code:

```javascript
// Sheet-Sync/Config.gs
const IB_ERLEDIGT_FIELD_KEY = FORTSCHRITT_FIELD_KEY;   // = fa77cb3c…
{ label: 'IB erledigt', …, checkedOptionValue: FORTSCHRITT_LABELS.IbErfolgt }  // schreibt "IB erfolgt"
```

Hakt ein Montagepartner „IB erledigt" im Sheet an, schreibt Sheet-Sync den Text `IB erfolgt` nach
`Fortschritt`. Dieses Script berechnet dort alle 15 Minuten `▰▰▰… n/11 · … · wa:…` und würde den
Wert wieder überschreiben — und umgekehrt. Beide Konzepte führen das Feld als „nur Script", aber es
sind zwei verschiedene Scripts mit verschiedenen Formaten.

**Auch die Plan-Annahme „das Feld ist noch leer, es geht nichts verloren" gilt damit nicht mehr** —
Sheet-Sync befüllt es inzwischen aktiv.

Die naheliegende Auflösung (Entscheidung Valentin):

- `Fortschritt` gehört **allein** diesem Script als Anzeige-Zeile.
- Der Eintrag `IB erledigt` in `Sheet-Sync/SYNC_FIELD_CONFIG` entfällt oder zeigt auf `Erledigt`
  (`8f3f8e44…`). Fachlich braucht es ihn ohnehin nicht mehr: dieses Script leitet „IB erfolgt" aus
  dem IB-Termin ab. Die **Aktivität** beim Anhaken (`erzeugtAktivitaetBeimAnhaken`) ist wertvoll und
  sollte bleiben — nur der Feld-Write nicht.

Solange das offen ist: dieses Script **nicht** live schalten, sonst kämpfen die beiden gegeneinander.

### Was daran fachlich gut zusammenpasst

Kein Konflikt, sondern Absicht: Sheet-Sync schreibt bei „Fertigmeldung" und „Netzanmeldung
eingereicht" den **`Netzstatus`**, und dieses Script liest ihn für die Regeln 2, 3 und 11. Der
Montagepartner hakt also im Sheet ab → Sheet-Sync setzt `Netzstatus` → hier wächst der Balken.
Die Kette funktioniert, sie darf sich nur nicht auf demselben Zielfeld überschneiden.

---

## Go-Live-Ablauf (Testplan aus dem Plan)

| # | Schritt | Abbruchkriterium |
|---|---|---|
| 1 | `pruefeKonfiguration()` | alles grün, sonst stopp |
| 2 | `testEinzelDeal()`, DRY | berechnete Menge von Hand gegen die Pipedrive-Oberfläche prüfen |
| 3 | `testRandfaelle()`, DRY | 0/11, 11/11, Storniert, Verschoben verhalten sich wie erwartet |
| 4 | `aktualisiereFortschritt()`, DRY | **Verteilung prüfen.** Fast alle auf `0/11` ⇒ Regeln stimmen nicht (das Script meldet dann selbst `KETTE_BLOCKIERT`). Zusätzlich nach Ausführungsart aufschlüsseln, Laufzeit + Callzahl messen |
| 5 | Automations-Check in Pipedrive | dokumentieren, was auf „Deal aktualisiert" hängt |
| 6 | Feldtyp `Fortschritt` umstellen | `varchar_auto` → `varchar` |
| 7 | `testRandfaelle()` mit `DRY_RUN = false` | 2–3 Deals live, in der Oberfläche visuell kontrollieren |
| 8 | `aktualisiereFortschritt()` live | Log-Verteilung gegen den DRY-Lauf gegenprüfen |
| 9 | **direkt danach nochmal** | **0 Änderungen.** Der Idempotenz-Beweis — schreibt er wieder, ist der Diff kaputt |
| 10 | `installTriggers()` | nach 1 h Log prüfen: Läufe mit 0 Änderungen sind der Normalfall |

Schritt 9 ist der wichtigste Test. Bei einem kaputten Diff wären es 437 × 96 ≈ **42.000 Writes/Tag**
gegen ein Kontingent von ~20.000 — und jeder Write ist in Pipedrive ein „Deal aktualisiert"-Ereignis.

### Automations-Check (Schritt 5) — nicht überspringen

Die Pipedrive-API kennt kein „silent update": API-Writes triggern Automations genau wie Klicks. Die
geplante Automation **A1** (Trigger „Deal aktualisiert", Bedingung Status = Gewonnen → 4–5
Aktivitäten + Slack) würde bei jedem Fortschritt-Write erneut feuern. Laut Projektnotizen gibt es
aktuell keine aktiven Automations — das ist **vor dem ersten scharfen Lauf neu zu verifizieren,
nicht anzunehmen.**

---

## Call-Budget pro Lauf

| Posten | Calls |
|---|---|
| `pruefeKonfigurationIntern()` (dealFields + stages) | 2 |
| gewonnene Deals, `limit=100` | ~5 bei ~440 Deals |
| erledigte Aktivitäten, `limit=500` (Doku-Maximum) | 1 pro 500 Aktivitäten |
| PATCHes | nur bei echter Änderung, im Dauerbetrieb ~0 |

Bei 96 Läufen/Tag bleibt das grob im niedrigen vierstelligen Bereich — deutlich unter den ~20.000
UrlFetch-Calls/Tag eines Gratis-Kontos. Der teure Posten ist der Aktivitäten-Vorabzug; er wächst mit
der Gesamtzahl erledigter Aktivitäten, deshalb steht `MAX_AKTIVITAETEN_SEITEN` als Notbremse drin
und die Seitenzahl wird jeden Lauf geloggt. Wird das eng: `updated_since` einführen.

---

## Logging

**Detail-Log** (`LOG_Fortschritt-Script`, legt sich beim ersten Lauf selbst an) — eine Zeile **nur
für tatsächlich geänderte Deals** plus Fehler plus eine Zusammenfassungszeile pro Lauf:

```
Zeitstempel | Lauf-ID | Deal-ID | Titel | Erledigt vorher | Erledigt nachher |
Fortschritt vorher | Fortschritt nachher | ausgelöst durch | Status | Detail
```

„ausgelöst durch" nennt die neu greifende Regel **mit Beleg** — Rohwert des Quellfelds bzw. der
tatsächliche Aktivitäts-Betreff (`+ Anzahlung da ← Zahlungseingang erhalten=207`). Entfallene Haken
erscheinen als `− …`, weil der Spiegel-Modus Haken auch wieder entfernen kann.

Unveränderte Deals werden **nicht** geloggt: 437 Zeilen „nichts passiert" pro Lauf machen die drei
echten Fehler unsichtbar und sprengen mittelfristig das 10-Mio.-Zellen-Limit. Ab `LOG_MAX_ZEILEN`
wandern die ältesten Zeilen automatisch in einen Archiv-Tab.

### SOFT_ERROR vs. HARD_ERROR

Sauber getrennt, statt alles zu „übersprungen" zu machen:

| Fall | Status | Deal wird geschrieben? |
|---|---|---|
| Quellwert unlesbar (z.B. Liefertermin `31.12.2026` statt `2026-12-31`) | `SOFT_ERROR` | ja — nur die betroffene Regel greift nicht |
| Regelfunktion wirft | `HARD_ERROR` | nein |
| `Wartet auf`-Option unbekannt | `HARD_ERROR` | nein |
| PATCH-Nutzlast leer/unvollständig | `HARD_ERROR` | nein (Abbruch **vor** dem Call) |
| Konfigurationsabweichung | `HARD_ERROR` | nein — der ganze Lauf bricht ab |

SOFT_ERRORs werden **mit Rohwert** gemeldet (`Liefertermin: Wert "Bauer" ist kein Datum…`) — genau
so kam heraus, dass in einem PLZ-Feld eine Telefonnummer stand. Ins Sheet geht daraus **eine
gesammelte Zeile pro Lauf**, nicht eine pro Deal: bei einem 15-Minuten-Trigger wären das sonst 96
identische Zeilen pro Tag und Deal. Die vollständige Liste steht im Ausführungsprotokoll.

**Dashboard** (eine Zeile pro Lauf, hinter `DASHBOARD_ENABLED`):

```
Timestamp | Lauf-ID | Script-Name | Lauf-Typ | Modus | Status | Verarbeitet | Übersprungen | Fehler | Detail
```

Status: `OK` / `SOFT_ERROR` / `HARD_ERROR` / `KETTE_BLOCKIERT`. Letzteres greift, wenn der Lauf
fehlerfrei war, aber ≥90 % der Deals auf `0/11` stehen oder gar keine Deals ankamen — genau das
Muster der beiden realen Nullläufe (Montagepartner, Sheet-Sync), die eine reine Fehlerzähl-Ampel
grün gemeldet hätte.

---

## Bewusste Abweichungen vom Plan

Vier Stellen weichen ab. Jede hat einen Grund, der in der Sache liegt:

1. **Regeltabelle in einer Funktion** (`erledigtRegeln()`) statt als `const ERLEDIGT_REGELN`.
   Apps Script wertet die `.gs`-Dateien eines Projekts in **nicht garantierter Reihenfolge** aus. Ein
   Top-Level-`const`, das `ERLEDIGT_OPTION_IDS` aus `Config.gs` liest, wäre ein ReferenceError beim
   Projektstart, wenn `Regeln.gs` zuerst ausgewertet wird — dann läuft *nichts* mehr. In der Funktion
   werden die Konstanten erst beim Aufruf aufgelöst. Inhaltlich bleibt es eine flache Datentabelle.
2. **`quelle()` gibt einen Beleg-String zurück statt `boolean`.** Ein String ist truthy, die
   Auswertung bleibt identisch — aber der Beleg trägt den Rohwert bzw. den Aktivitäts-Betreff direkt
   ins Log. Ohne das wäre „welche Regel hat worauf gematcht" nicht beantwortbar.
3. **Log-/Dashboard-Schema um `Lauf-ID` (und `Modus`) erweitert.** Der Plan verweist für das
   Dashboard-Schema ausdrücklich auf das Dashboard-Konzept, und das legt beide als Pflichtspalten
   fest: `Modus` (ein Script, das produktiv laufen soll und `DRY` meldet, ist gelb, nicht grün) und
   die `Lauf-ID` als Filtersprung von der Dashboard-Zeile ins Detail-Log.
4. **`LockService` ergänzt** (nicht im Plan). Ein manueller Start, der in einen laufenden
   Trigger-Lauf gerät, würde dieselben Deals gleichzeitig patchen.

## Aus den anderen RP-Projekten übernommen

Beim Abgleich mit den bestehenden Scripts nachgezogen, damit dieses Projekt nicht aus der Reihe fällt:

| Muster | Woher | Warum hier |
|---|---|---|
| Header `PROJEKT: … / DATEI IM EDITOR: … --> kompletten Inhalt ersetzen` | alle gereiften Scripts | Copy-Paste in den Editor ohne Rätselraten |
| `CUTOFF_ENABLED` / `CUTOFF_DATE` | `Bundesland-aus-PLZ` (M5 rügt das Fehlen in Montagepartner) | das Script läuft über **alle** gewonnenen Deals, auch jahrealte, die dauerhaft mit irreführendem `0/11` in der Liste stünden |
| `dumpLiveState()` | R7, bisher nirgends umgesetzt | Git sichert den Code, nicht die Verdrahtung |
| begrenzter Log-Puffer (`LOG_PUFFER_MAX`) | B7 (dort hielt der Puffer 6570 Zeilen im Speicher) | greift beim ersten Vollauf |
| `PROP_LOG_SHEET_ID` mit-versionieren bei Spaltenänderung | `BUNDESLAND_LOG_SHEET_ID_V3` | neue Spalten → frisches Sheet statt Werte in alten Spalten |
| Option-Registry für `autocomplete` | `Sheet-Sync`, live gelernt 2026-08-17 | siehe eigener Abschnitt oben |

**Bewusst *nicht* übernommen: `FORCE_OVERWRITE`.** In den anderen Scripts heißt das „ein bereits
gefülltes Feld trotzdem überschreiben". Dieses Script arbeitet im Spiegel-Modus und überschreibt
grundsätzlich, auch nach unten — ein solcher Schalter wäre entweder wirkungslos oder würde die
Selbstheilung abschalten. Die Bremse ist hier die Diff-Pflicht. Steht auch so in `Config.gs`, damit
die Abweichung nicht wie ein Versehen aussieht.

**Noch nicht in `sync-all-scripts.ps1` eingetragen** — bewusst: dort steht `Fortschritt-Script` erst
drin, wenn ein `.clasp.json` existiert. Ein `clasp pull` ohne Verknüpfung schlägt fehl, und das
Sync-Script committet danach trotzdem (R2/R3) — das würde diese Dateien überschreiben.

Zusätzlich eingebaut, ohne im Plan zu stehen: Umlaut-Toleranz beim Betreff-Matching
(`Erstgespräch` = `Erstgespraech`), Label-Abgleich der Erledigt-Optionen (nicht nur ID-Existenz —
sonst fällt nicht auf, wenn eine Option inzwischen etwas anderes bedeutet), und `Wartet auf` wird in
**beide** Richtungen geprüft: eine Option, die Pipedrive kennt und das Script nicht, lässt jeden
betroffenen Deal ungeschrieben.

## Geparkt: Stage-Fallback als zweite Quelle

Aus dem DRY-Vollauf vom 2026-08-17: von 437 gewonnenen Deals standen **436 auf `0/11`**, weil die
Fulfillment-Felder erst am 10.08. angelegt wurden und die Termine bis heute in den Partner-Sheets
bzw. im Finance-Sheet leben. Deshalb ist `CUTOFF_ENABLED = true` ab 01.07.2026 — der Altbestand
bekommt keinen irreführenden Leerbalken.

Die Stages der Fulfillment-Pipeline sind aber nach genau diesen Meilensteinen benannt, die
Information ist also längst da:

| Stage | ⇒ Meilenstein |
|---|---|
| `5_Anzahlung erhalten` (14) | Anzahlung da |
| `6_Geliefert` (21) | Geliefert |
| `7_Montiert` (20) | Montiert |
| `8_In Betrieb genommen` (22) | IB erfolgt |
| `9_Abgerechnet und abgeschlossen` (23) | alle davor |

Als **ODER-Bedingung** neben dem jeweiligen Feld wäre das eine Zeile pro Regel, und weil die Stages
eine Reihenfolge haben, gilt „Stage X oder weiter". Damit würden auch Altdeals brauchbare Balken
bekommen, ohne dass jemand 437 Deals von Hand nachpflegt.

**Bewusst noch nicht gebaut** (Valentin, 2026-08-17) — erst wenn die Feld-Variante im Betrieb steht.
Netzstatus, Förderung und die beiden Gespräche haben keine Stage-Entsprechung und bleiben in jedem
Fall feldbasiert.

## Noch nicht erledigt

- **`.clasp.json` fehlt** — das Apps-Script-Projekt existiert noch nicht. Erst im Browser anlegen,
  Code hineinkopieren, dann verbinden. Reihenfolge beachten: `sync-all-scripts.ps1` macht
  `clasp pull` und würde diese Dateien mit einem leeren Default-`Code.gs` überschreiben, solange das
  Editor-Projekt leer ist.
- **`Task - List`** (altes Mehrfachauswahl-Feld, überlappt inhaltlich mit `Erledigt`) wird von diesem
  Script **nicht** angefasst. Vor dem Löschen prüfen, ob es bei bestehenden Deals Werte trägt.
- **Regel 1 und 7** (Erst-/Zweitgespräch) greifen nur, wo jemand händisch so betitelte Aktivitäten
  angelegt hat, solange Automation A1 nicht existiert. Erwartetes Verhalten, kein Bug — der Lauf
  macht es sichtbar (`listAktivitaetsBetreffe()` zeigt die echten Betreffe).
