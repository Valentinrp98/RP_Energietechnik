---
name: project-deepcore-automatisierung
description: "Google-Apps-Script-Projekt: wenn sevdesk-Auftrag 'Angenommen' wird, automatisch neue Zeile in Deep-Core-Verkaufsliste (Google Sheet) mit VK netto + Artikeldaten befüllen"
metadata:
  node_type: memory
  type: project
  modified: 2026-08-25T14:40:54.417Z
  originSessionId: 779999f9-feaf-47c8-b1e2-ecb0e26bcfef
---

## Zweck
"Deep Core" ist eine Team-/Verkaufsliste bei RP Energietechnik (Google Sheet "Deep Core List 2026", Tab "Aufträge", gid 324098770). Ziel: sobald ein sevdesk-Auftrag den Status "Angenommen" (500) erreicht, wird automatisch eine neue Zeile mit den Auftragsdaten in die richtige Monats-Sektion eingetragen.

**Why:** Verkäufer sollen die technischen/finanziellen Auftragsdaten nicht händisch nachtragen.
**How to apply:** Eigenständiges Projekt, nutzt aber dieselbe Artikel-Erkennungslogik wie [[project_sevdesk_pipedrive_sync]]. Sheet-Link: https://docs.google.com/spreadsheets/d/1dqUQ3TNXtFojx86DYWd6Sa4sInPCFpFUWrqf10g7JhY (aktuell eine KOPIE zum Testen, nicht das Live-Sheet — User hat das bewusst so gemacht, "damit nichts kaputt geht").

## Sheet-Struktur (Tab "Aufträge")
Spalten A–AS: `Kundenname | Team | Projekt | Kaufart | Monat | VK netto | EK netto | Handelsspanne | Handelsspanne % | Lieferung eingeplant | Förderung beantragt | Lieferung abgeschlossen | Module (Stk/Summe) | Dachart (Stk/Summe) | Dachart 2 | Wechselrichter (Stk/Summe) | Wechselrichter 2 | Speicher | Notstrom | Smartmeter | Zubehör | Zubehör 2 | Sonstige Kosten | Notizen | Angebots-Nr.`

Zeilen sind in Monats-Blöcke gruppiert (Jänner … jeweils mit "Gesamt [Monat]"-Summenzeile). Pro Monat existieren reichlich vorformatierte Leerzeilen (August ~34) mit Dropdowns/Formeln fertig eingerichtet, "Monat"-Spalte vorausgefüllt, nur Kundenname/Werte fehlen.

**Wichtig fürs Schreiben:** Die Pufferzeilen enthalten Formeln (EK netto, Handelsspanne, Handelsspanne %). Ein naives Vollzeilen-`setValues()` würde die zerstören → Code liest den Block vorher per `getFormulas()` und schreibt Formeln unverändert zurück.

## Datenherkunft pro Feld
- **Automatisch aus sevdesk:** Kundenname, VK netto, Module/Dachart/Wechselrichter/Speicher/Notstrom/Smartmeter/Zubehör (Art + Stk + Summe), Sonstige Kosten, Angebotsnummer
- **Bleibt leer, manuell vom Verkäufer:** Team (Verkäufer-Name), Projekt (SM/FS/Upsale), Kaufart (Kauf/Finanzierung)
- Zeile wird **neu befüllt** (nicht wie im sevdesk-Pipedrive-Projekt eine bestehende Zeile gematcht/geupdated). Daraus folgt die zentrale Regel: **ein Auftrag darf nur GENAU EINMAL verarbeitet werden** — ein zweiter Durchlauf erzeugt keine Aktualisierung, sondern eine Dublette.

## Dropdown-Verhalten — VERIFIZIERT per Screenshot
- **Kundenname-Spalte:** Dropdown vorhanden, aber nicht strikt — freier Text möglich.
- **Artikel-Spalten:** Datenvalidierung ist **NICHT** mit dem Material-Katalog-Tab verknüpft — es ist eine **fix eingetragene Liste direkt in der Validierungsregel**. Der Katalog-Tab ist nur unabhängige Preisreferenz.
- **Regel ist STRIKT: "Eingabe ablehnen"**, Darstellung "Chip".
- **Offen/zu testen:** Ob Apps Script `setValues()` diese Validierung überhaupt trifft — Script-Writes umgehen Datenvalidierung normalerweise (Validierung greift bei UI-Eingabe). Deshalb schreibt der Code den UNSICHER-Eintrag standardmäßig **nicht** (`SCHREIBE_UNSICHER_LABEL = false`), sondern lässt die Namenszelle leer und erklärt in Notizen. Erst live prüfen, dann ggf. umstellen.

## Kernproblem: sevdesk-Artikelnamen ≠ Deep-Core-Katalog-Namen
- Mismatch-Beispiel: sevdesk `AIKO-GLAS-GLAS NEOSTAR FULL BLACK 475 WP` vs. Katalog `AIKO-GLAS-GLAS HOCHLEISTUNGS-SOLARMODUL FULL BLACK 475 WP` (+ DARK BLACK) — sevdesk hat eine neuere Serie (NEOSTAR), die im Dropdown fehlt. Da bei 475 WP zwei AIKO-Kandidaten gleichauf liegen, geht der Fall **bewusst in UNSICHER** statt zu raten.
- Match-Beispiel: `SUNOVA-...FULL BLACK 460 WP` matcht exakt.
- Die "Sigenergy Set Hybrid TP2 X kW / Y kWh"-Kombis im Katalog sind KEINE sevdesk-Artikel — sevdesk führt WR und Batteriemodul als separate SKUs.

**Lösung:** Kategorie zuerst über Keywords, dann Kennwert (kW/kWh/WP) extrahieren, dann gegen die Dropdown-Liste matchen (exakt → eindeutiger Kennwert → Kennwert+eindeutige Marke). Kein sicherer Treffer → UNSICHER + Original-Name in Notizen-Spalte.

## Build-Stand (2026-08-21, live gebunden & gepusht)
Code lokal unter `C:\Users\valen\OneDrive\Documents\RP\Claude_Work_RP\RP-Google-Scripts\Deepcore-Automatisierung\` (katalogundmapping.js, sheetwriter.js, syncengine.js, appsscript.json). v1 liegt unverändert in `_backup_v1/`.

**Gebunden und live gepusht** — Script-ID `11yWak9ypgCKOh0GnGfskmlWDBy-8GMa6w_up68H7cQ2OjpywGpz1yuqL`, `.clasp.json` vorhanden. Deployment läuft jetzt über den [[project_gs_deploy_workflow]]-Skill: lokaler Code ist Source of Truth, Claude pusht per `clasp push --force`, committet danach lokal (kein GitHub-Push ohne explizite Ansage). `TEST_ORDER_ID` ist auf `'29871057'` gesetzt (Order 2026-609-A, Milazim Dervishaj — echter Live-Kunde, bisher nur mit lesenden Testfunktionen geprüft).

**`pruefeDropdownListen()` bestätigt (2026-08-21, zweiter Durchlauf nach den Katalog-Fixes):** module 5/5, dachart 13/13, wechselrichter 27/27, speicher 12/12, notstrom 3/3, zubehoer 8/8 — alle exakt deckungsgleich. Einzige verbleibende Abweichung war smartmeter (4 im Code/3 im Sheet, `Sigenergy Power Sensor TPX - CH` existiert im echten Sheet nicht) — entfernt und erneut gepusht.

### Im Review gefundene und behobene Fehler (v1 → v2)
1. **Erstlauf-Flut:** leerer State = ALLE angenommenen sevdesk-Aufträge landen auf einen Schlag im aktuellen Monat und fressen den Puffer leer. → `seedSyncStateOhneSchreiben()` + Cutoff-Datum + harter Abbruch bei leerem State und >25 offenen Aufträgen.
2. **Dublettenbug:** State war `{orderId: updateTimestamp}` — jede spätere sevdesk-Änderung galt als "neu" und erzeugte eine ZWEITE Zeile. → State speichert jetzt nur noch IDs.
3. **9-KB-Property-Limit** (siehe [[reference_apps_script_limits.md]]): State wuchs unbegrenzt. → gedeckelt auf 600 IDs, älteste fliegen raus.
4. **~35 einzelne `setValue()` + `openById()` pro Zeile.** → 2 Block-`setValues()`, Sheet-Handle gecacht.
5. **Formelzerstörung** durch Blockschreiben → `getFormulas()` lesen und zurückschreiben.
6. **Monat aus Laufdatum statt Auftragsdatum** — am 31.08. abends angenommener Auftrag landete im September. → `order.orderDate`.
7. **Monatsvergleich per `===`** auf den Rohwert — ein Leerzeichen im Sheet und es wird gar keine Zeile gefunden. → trim + Aliase (Januar/Jänner, Maerz/März) + Datum-Fallback.
8. **`kW|kWh`-Regex-Alternative** liest "6 kWh" als 6 kW; Kandidaten ohne Einheit im Namen (`FRONIUS Symo GEN24 10.0 Plus`, `BYD ... HVM 13.8`) wurden gar nicht erkannt und liefen immer in UNSICHER. → eigene `extractCandidateValue()` mit Reihenfolge kWh→kW→WP + Dezimal-Fallback.
9. **`.find()` bei mehreren Marken-Kandidaten** nahm still den ersten. → nur bei GENAU einem Markentreffer.
10. **Kein Retry** bei 429/5xx, kein Response-Code-Check. → exponentieller Backoff, 4xx bricht sofort ab.
11. **Kein LockService** — Testlauf + Trigger konnten dieselbe freie Zeile finden. → Script-Lock + `SpreadsheetApp.flush()`.
12. **`appendRow` pro Log-Zeile** → Log wird gepuffert, ein `setValues()` am Lauf-Ende.
13. Kein DRY_RUN (CLAUDE.md-Standard) → `DRY_RUN = true` als Default; im DRY_RUN wird der State bewusst NICHT fortgeschrieben.
14. Slot-1/Slot-2-Zuordnung war Zufallsreihenfolge → sortiert nach Nettosumme absteigend.

### Zweiter Review-Durchgang (gleicher Tag, über die eigenen v2-Änderungen)
15. **Stiller 0-Preis:** `p.priceNet !== undefined ? p.priceNet : p.price` ist bei `priceNet: null` TRUE, und `Number(null)` ist 0 — der Positionspreis wäre lautlos auf 0 gefallen. → Helfer `ersteZahl([...], standard)` nimmt den ersten Kandidaten, der eine echte Zahl ergibt; eine echte 0 bleibt erhalten. Mit 9 Fällen in Node getestet.
16. **`testFullSync()` erzeugte im Live-Modus eine Dublette:** die Testfunktion schrieb die Zeile, vermerkte den Auftrag aber nicht im State → der 15-Min-Trigger legte kurz darauf eine zweite Zeile an. → vermerkt jetzt bei `DRY_RUN=false` im State.
17. **`seedSyncStateOhneSchreiben()` konnte still scheitern:** bei >600 angenommenen Aufträgen wurden IDs wegen des 9-KB-Limits verworfen, die Aufträge galten damit als nicht erledigt. → laute Warnung mit genauer Zahl + Verweis auf `IGNORIERE_AUFTRAEGE_VOR` als verbleibenden Schutz. State dedupliziert jetzt außerdem.
18. **`pruefeDropdownListen()` wäre hart gecrasht**, falls die Validierung doch ein Bereichsverweis statt einer festen Liste ist (`getCriteriaValues()[0]` ist dann ein Range, kein Array) — ausgerechnet der Fall, den die Funktion klären soll. → beide Fälle abgefangen.
19. `pruefeKonfiguration()` zeigt jetzt zusätzlich, **welche Zellen einer leeren Pufferzeile Formeln tragen** — entscheidet, ob die Summen-Spalten überschrieben werden dürfen.

Mapping-Logik wurde lokal in Node gegen 14 echte Artikelnamen getestet: alle 14 Kategorien korrekt, 2 bewusst UNSICHER (AIKO NEOSTAR 475 mehrdeutig, HUAWEI Wallbox nicht im Katalog).

### Dritter Review-Durchgang (2026-08-20)
20. **"SIGENERGY Battery Controller BC inkl. Bodenmontageset" wäre als Speicher fehlklassifiziert worden** — enthält "Batter(y)", greift also die speicher-Regel, ist aber nur das Steuergerät/Montagekit fürs Speichersystem, kein Speicher selbst. Exakt dieselbe Falle stand schon als Kommentar im sevdesk-Pipedrive-Projekt, ist aber bei der Deep-Core-Neufassung der Kategorien wieder verlorengegangen. → "Battery Controller" jetzt explizit in der zubehoer-Regel VOR der speicher-Prüfung.
21. **Dachart-Regex war zu breit:** bloßes "Montageset" hätte auch "SIGENERGY Bodenmontageset"/"Wandmontageset" (Montage fürs Speichersystem, kein Dach-Bezug) und "MODULHALTERUNG BALKON" (Balkonkraftwerk-Zubehör) in die Dachart-Spalte gezogen. → verengt auf `MONTAGESET PV` (echte Dach-Montagesysteme haben immer dieses Muster), die drei Ausreißer wandern jetzt in "zubehoer".
22. **Marken-Disambiguierung erkannte Farbvarianten nicht:** bei gleichem Kennwert (z.B. 475 WP) verglich der Code nur das erste Wort ("AIKO") — das steht bei "FULL BLACK" und "DARK BLACK" gleich da, beide blieben also UNSICHER, obwohl der sevdesk-Name ("...NEOSTAR FULL BLACK 475 WP") die Farbe explizit nennt. → Vergleich zählt jetzt alle Wörter (≥3 Zeichen) des Kandidaten gegen den sevdesk-Namen; eindeutig nur bei genau einem Höchstwert. Löst den Fall jetzt korrekt zu "FULL BLACK" auf.
23. `testFullSync()` lief ohne den LockService-Schutz, den `syncPendingOrdersToDeepCore()` nutzt — Testlauf + zufällig gleichzeitiger Trigger hätten dieselbe freie Zeile finden können. → gleicher Lock jetzt auch dort.

### Vierter Review-Durchgang — echter Live-Test mit realem sevdesk-Auftrag (2026-08-21)
User hat `pruefeKonfiguration()`, `pruefeDropdownListen()`, `testMappingOnly()`, `debugSevdeskRohdaten()`+`testFetchSevdeskOnly()` (mit echter Order 2026-609-A / Milazim Dervishaj — **nur lesend getestet, nichts geschrieben**), `seedSyncStateOhneSchreiben()` und einen DRY-Lauf durchgeführt. Ergebnis: mehrere fundamentale Fehlannahmen aufgedeckt.

24. **⚠️ OFFEN, User-Entscheidung nötig:** `pruefeKonfiguration()` zeigt nur für August eine freie Pufferzeile — Jänner–Juli und September–Dezember haben AKTUELL KEINE. Ohne Gegenmaßnahme scheitert der erste angenommene Auftrag im September (bei aktuellem Datum ~10 Tage entfernt). Frage an User: legt er die Pufferzeilen selbst rechtzeitig an, oder soll eine Auto-Anlage-Funktion gebaut werden?
25. **`*_SUMME`-Spalten sind SUMIF-Formeln** (Name+Stk. → Preis aus dem "Einkauf"-Tab nachschlagen), die direkt in `EK_NETTO` einfließen (`=IFERROR(O+R+U+X+AA+AD+AG+AJ+AM+AP+AQ;0)`). Der Code hätte sie mit dem sevdesk-Betrag überschrieben und die Neuberechnung dauerhaft zerstört. → `writeRowToDeepCore()` schreibt jetzt NUR noch Name + Stk. je Kategorie, Summe bleibt Formel.
26. **`SONSTIGE_KOSTEN` ist eine manuell kuratierte Spalte** (historisch z.B. "500 E-Material", "13000 Sigenergy 50er WR..."), keine Formel, aber auch kein sinnvolles Ziel für pauschale sevdesk-Dienstleistungspositionen (Transportkosten, Planung, Fernwartung, ...). → Script schreibt hier nichts mehr automatisch, erkannte Positionen landen nur als Hinweistext in den Notizen.
27. **Dachart-Dropdown-Werte waren komplett falsch:** echte Werte sind nur die Kurzform (`ZIEGEL`, `PREFA`, `FLACHDACH OST/WEST`, ...), nicht `MONTAGESET PV ... ZIEGEL`. → Katalog korrigiert; da Dachart keinen Kennwert (kW/kWh) hat, matcht jetzt ein Wort-Score gegen den vollen Kandidaten-Pool.
28. **Notstrom:** echter Wert ist `SIGENERGY Gateway` (kurz), nicht `...Umschaltbox Dreiphasig`. Korrigiert.
29. **"Power Sensor & Communication Modul" ist laut echtem Dropdown ein SMARTMETER-Artikel, kein Zubehör** — widerlegt die ursprüngliche Annahme aus der Einkauf-Tab-Tabellenlayout-Interpretation. Kategorie-Zuordnung UND Katalog korrigiert (`zubehoer_combo` → `smartmeter_combo`).
30. **Reiner Kennwert-Abgleich (kW/kWh) ohne Wort-Check hätte falsch gematcht:** Live-Test zeigte, dass `findDropdownMatch()` bei genau 1 Kandidaten mit passendem Kennwert diesen ungeprüft übernahm — dadurch wurde "SIGENERGY Hybrid Wechselrichter 10.0 kW..." fälschlich auf "SIGENERGY Energy Controller 10kW" gemappt (zwei verschiedene Sigenergy-Produktfamilien, nur zufällig gleiche kW-Zahl). → `findDropdownMatch()` verlangt jetzt IMMER zusätzlich mindestens 1 eindeutigen Wort-Treffer, auch bei nur einem Kennwert-Kandidaten. Löst nebenbei auch das Dachart-Kurzwort-Problem (Punkt 27) mit demselben Mechanismus.
31. Fehlende Dropdown-Werte ergänzt: Speicher (`BYD Battery-Box Premium HVM 8.3`), Wechselrichter (9 "Sigenergy Set Hybrid TP2 X kW / Y kWh"-Kombis + `Sigen Hybrid Wechselrichter 12.0 kW TP2 dreiphasig` — sind laut echtem Dropdown reale Einträge, aber NICHT als kombinierter WR+Speicher-Merge implementiert, siehe unten).
32. `TECHNISCHE PROJEKTIERUNG` (reale sevdesk-Position) wurde nicht erkannt, weil die Regex nur `Projektbetreuung` kannte → `Projektierung` ergänzt.

**Bewusst NICHT gebaut (User-Entscheidung 2026-08-21, "passt"):** Automatisches Zusammenführen von WR+Speicher zu einem "Set Hybrid"-Kombi-Dropdown-Eintrag. Getrennte Einträge sind für die EK-Formel gleichwertig korrekt, nur kosmetisch anders als die historische Konvention.

### Fünfter Review-Durchgang — User-Feedback nach zweitem Live-Test (2026-08-21)
User hat den zweiten `pruefeDropdownListen()`-Lauf (jetzt saubere Kategorien, aber Namens-Abweichungen unverändert bestätigt — siehe unten warum) und `testFetchSevdeskOnly()` erneut mit derselben Order 2026-609-A laufen lassen, dann drei Entscheidungen getroffen:

1. **Auto-Pufferzeilen bauen lassen** (statt selbst zu pflegen) — `sorgeFuerFreieZeile()` in sheetwriter.js: sucht die "Gesamt {Monat}"-Zeile, fügt 10 neue Zeilen darüber ein, übernimmt Format+Datenvalidierung+Formeln (NICHT Werte) von der Zeile direkt darüber, setzt den Monat. Läuft NUR im Live-Betrieb, nie im DRY_RUN (Zeileneinfügen ist eine echte Mutation).
2. **Set-Hybrid-Kombi bleibt getrennt** — kein Merge gebaut (s.o.).
3. **Wichtige Design-Frage beantwortet:** Was, wenn ein im Juli GESCHRIEBENES Angebot erst im August ANGENOMMEN wird? → Monat wurde bisher aus dem Angebots-Erstellungsdatum berechnet (order.orderDate/create) — falsch, das hätte das Juli-Angebot in den (vollen) Juli-Block gezwungen. Jetzt: Monat kommt aus `order.update` (beste verfügbare Näherung für "Zeitpunkt der Annahme", da sevdesk keinen dedizierten Status-Zeitstempel liefert, aber ein Statuswechsel `update` mit hochzieht).
4. **Zusätzlicher Dubletten-Schutz auf User-Vorschlag** ("schauen ob Name schon drinnen ist oder so"): statt Namensvergleich (unsicher bei Namensgleichheit) wird auf **Angebotsnummer** geprüft — `angebotsnummerBereitsVorhanden()` durchsucht die komplette Angebots-Nr.-Spalte vor dem Schreiben. Ergänzt den Script-Property-State (der nur innerhalb dieses Scripts wirkt) um einen Schutz gegen bereits-manuell-angelegte Zeilen.

**Warum die Dropdown-Namen im zweiten `pruefeDropdownListen()`-Lauf immer noch als "Abweichung" auftauchen, obwohl der Katalog schon auf die kurzen Namen (ZIEGEL, PV-ZAUN, ...) korrigiert war:** `pruefeDropdownListen()` vergleicht `KNOWN_DROPDOWN_VALUES` (die Katalog-Konstante) gegen die ECHTE Sheet-Validierungsregel — das ist unabhängig vom Matching-Fix und zeigt nur, ob der Katalog selbst aktuell ist. Die Ausgabe im zweiten Log war identisch zum ersten, weil die KORREKTUR bereits vor dem zweiten Lauf gemacht wurde und nichts Neues an Abweichung mehr zu finden war (reine Bestätigung, kein neuer Fehler). Wichtig: die eigentliche MATCHING-Verbesserung (Wort-Score) wirkt sich erst in `testMappingOnly()`/`testFetchSevdeskOnly()` aus, nicht in `pruefeDropdownListen()`.

## Projekt gebunden und live (2026-08-21)
Script-ID `11yWak9ypgCKOh0GnGfskmlWDBy-8GMa6w_up68H7cQ2OjpywGpz1yuqL`. Deployment läuft über [[project_gs_deploy_workflow]] (`clasp push --force`, danach lokaler Commit, kein GitHub-Push ohne Ansage). Dritter `pruefeDropdownListen()`-Lauf bestätigt: ALLE 7 Kategorien deckungsgleich mit dem echten Sheet (auch `smartmeter` nach Entfernen von `Sigenergy Power Sensor TPX - CH`, das im echten Sheet nicht existiert).

### Sechster Review-Durchgang — echter Bug im Wort-Score-Matching selbst gefunden (2026-08-21)
`testFetchSevdeskOnly()` zeigte weiterhin den falschen Match ("SIGENERGY Hybrid Wechselrichter 10.0 kW..." → "SIGENERGY Energy Controller 10kW"), den Fix #30 eigentlich beheben sollte. Ursache: der Wort-Score prüfte per `nameNorm.includes(w)` — reine TEILSTRING-Suche im GESAMTEN sevdesk-Namen, nicht Wort-für-Wort-Gleichheit. Das Kandidaten-Wort `"energy"` matchte als Teilstring in `"sigENERGY"` (derselbe Markenname!) und zählte fälschlich als zusätzlicher Treffer — dadurch gewann "Energy Controller" mit 2 Treffern gegen "Fronius Symo GEN24 10.0 Plus" mit nur 1, statt beide bei 1 zu landen (unentschieden → UNSICHER).

**Fix:** sevdesk-Name wird jetzt selbst in Wörter zerlegt (`nameWoerter`), Vergleich per exakter Array-Mitgliedschaft (`nameWoerter.includes(w)`) statt Teilstring-Suche auf dem Gesamtstring.

**Debugging-Ablauf, der zum Fund führte** (nützliches Muster für künftige Fälle): 1) `clasp pull` in einen Scratch-Ordner, `diff` gegen lokal → ausgeschlossen, dass eine parallele Session einen älteren Stand gepusht hat (kein Diff). 2) Direkte Node-Nachstellung der echten Funktionen per `eval(fs.readFileSync(...))` — dabei zuerst selbst in dieselbe Falle getappt: ein Template-Literal (Backtick-String) zum Zusammenbauen von Debug-Code verschluckt `\s`/`\d` (nicht erkannte Escape-Sequenzen werden in Template-Strings zum literalen Zeichen ohne Backslash), was die Diagnose kurz in die falsche Richtung schickte. Fix: Debug-Code als separate Datei lesen und per String-Konkatenation (nicht Template-Literal) zusammenbauen, dann `eval()`.
Mit 9 Testfällen in Node gegen die echte Datei verifiziert (inkl. FULL/DARK BLACK, ZIEGEL/PV-ZAUN, Gateway-Kurzform), dann gepusht + committet.

## ⚠️ ERSTER ECHTER SCHREIBVORGANG (2026-08-21, 18:54)
User hat `DRY_RUN` direkt im Apps-Script-Editor auf `false` gestellt (nicht über Claude/Push) und `testFullSync()` für Order 2026-609-A (Milazim Dervishaj) ausgeführt — **hat wirklich in Zeile 165 (August) geschrieben**, SUCCESS im Log, Auftrag im Sync-State als erledigt vermerkt. Ergebnis passt zu den vorherigen Dry-Run-Vorhersagen (4 unsicher, 2 in Notizen ausgelagert).

**Wichtig für künftige Sessions:** Claudes lokale Datei hatte zu dem Zeitpunkt noch `DRY_RUN = true` — der Live-Editor-Stand war schon `false`. Beim nächsten Push wäre das sonst stillschweigend zurückgedreht worden (genau das Risiko aus [[project_gs_deploy_workflow]]). Lokal nachgezogen auf `false`, BEVOR der nächste Push (Logging-Umbau) rausging. **Faustregel bestätigt: vor jedem Push kurz fragen/prüfen, ob zwischenzeitlich im Editor manuell was geändert wurde — hier hätte ein Push ohne Nachfragen die Live-Einstellung überschrieben.**

Live-Sheet steht damit jetzt real auf DRY_RUN=false — der nächste automatische/manuelle Sync-Lauf schreibt echt. Trigger (`trigger15MinAnlegen()`) ist NOCH NICHT gesetzt — bisher nur Einzelaufträge per `testFullSync()`.

## Detailliertes Sync-Log gebaut (2026-08-21, User-Wunsch: "logt genau was passiert")
`DeepCore-Sync-Log`-Tab von 7 auf 19 Spalten erweitert: Zeitstempel, Modus, Status, Angebotsnummer, Kundenname, Zielzeile, Monat, VK netto, dann je eine Spalte pro Kategorie (Module/Dachart/Wechselrichter/Speicher/Notstrom/Smartmeter/Zubehör — zeigt "Name (Stk.x, Summe€)" oder "⚠️ UNSICHER [war: ...]"), Unsicher-Anzahl, Sonstige-Kosten-Hinweis, Ausgelagerte Positionen, Fehler. Alte 7-Spalten-Zeilen bleiben stehen, neuer Header wird mit Trenn-Notiz darunter angelegt (Migration, kein Datenverlust). `logDeepCoreSyncResult()` nimmt jetzt ein Objekt statt Positionsparameter.

### Vor dem Live-Gang zu erledigen (Reihenfolge steht im Kopf von syncengine.js)
1. `pruefeKonfiguration()` — Tab-Name "Aufträge", Spalten A–AS, freie Pufferzeilen je Monat
2. `pruefeDropdownListen()` — liest die ECHTEN Validierungslisten aus dem Sheet und zeigt Drift gegen `KNOWN_DROPDOWN_VALUES` im Code, plus ob "Eingabe ablehnen" wirklich aktiv ist
3. `testMappingOnly()` — Artikel-Erkennung ohne API
4. `debugSevdeskRohdaten()` — **noch ungeprüfte sevdesk-Feldnamen verifizieren:** `order.sumNet` (VK netto), `OrderPos.price` vs. `priceNet` (Netto-Einzelpreis?), `contact.name` vs. `surename`/`familyname`
5. `seedSyncStateOhneSchreiben()` — Altbestand als erledigt markieren
6. DRY-Lauf, Log lesen, dann `DRY_RUN = false` und `trigger15MinAnlegen()`

### Noch offen (Stand 2026-08-25, Ende Session)
1. **Call mit Marco morgen (2026-08-26)** — mitnehmen: (a) Namens-Vereinheitlichung sevdesk↔Sheet-Dropdown (Marcos ursprünglicher Punkt), (b) Gegencheck "10.0/12.0 kW TP2 dreiphasig" = Paket? (Einkauf-Tab-Preise 700-850€ sprechen dagegen), (c) die 3 echten Katalog-Lücken `Battery Controller BC` (nur als B2B-Produkt im Sheet vorhanden, nicht als Zubehör), `SparSmart KI`, `EcoFlow`-Speicher — kommen nirgends im Sheet vor, (d) "JA Solar 455 WP" hat 9 Schreibweisen in sevdesk.
2. **Trigger (`trigger15MinAnlegen()`) noch NICHT ausgeführt** — läuft weiterhin nur manuell.
3. **`DEEPCORE_SHEET_ID` zeigt noch auf die Test-Kopie**, nicht das echte Deep-Core-Sheet — Umstellung bewusst vertagt.
4. **Modul-Wattzahlen 495 WP (AIKO) und 445 WP (SUNOVA)** im Einkauf-Tab verifiziert NICHT vorhanden (nur 450/460/475/490) — echte Dropdown-Ergänzung nötig, aber warten bis nach dem Call (gesammelt machen).
5. **3 schon geschriebene Zeilen** (Tobias Knittelfelder, Iris Obermaier, Elpidio Morales) mit "12.0 kW TP2" + separater Speicher-UNSICHER-Notiz — nach der Paket-Frage im Call nochmal gegenchecken, ob da wirklich was falsch ist (nach aktueller Preis-Evidenz vermutlich nicht).
6. Puffer-Erschöpfung: aktuell nur Log-Warnung, keine Auto-Insert-Logik für neue Pufferzeilen (bewusst, Puffer reicht dank `sorgeFuerFreieZeile()`)
7. Anbindung ans zentrale [[project_automations_dashboard]]-Log

## Siebter Review-Durchgang — erste echte Live-Aufträge über den Poll-Lauf (2026-08-25)
Trigger (`trigger15MinAnlegen()`) läuft immer noch NICHT — alles bisher über manuelles Ausführen von `syncPendingOrdersToDeepCore()`. Erster echter Poll-Lauf hat 4 neue Aufträge sauber verarbeitet: 2026-624-A, 623-A, 617-A, 593-A (0 offen, kein Fehler).

**Zwei echte Bugs beim Sichten der geschriebenen Notizen gefunden und gefixt (nicht Sheet-Content-Problem):**
33. **"MODULOPTIMIERUNG bei Teilverschattung" fiel komplett durch alle Kategorie-Regeln** (landete unkategorisiert im `[?]`-Sammeltopf) — die Zubehör-Regex kannte nur `OPTIMIERER`, der reale sevdesk-Name heißt aber "...OPTIMIERUNG". → Regex verbreitert auf `OPTIMIER` (fängt beide).
34. **"SIGENERGY Communication Modul" alleine (nicht in Kombi mit Power Sensor)** hatte gar keinen Regex-Treffer, ebenfalls `[?]`. → als eigener Treffer in die smartmeter-Regex aufgenommen (`Communication Modul` als zusätzliche Alternative).

Beide Fixes gepusht + committet (`c7c41ec`).

**Audit-Tooling gebaut** (rein lesend, kein Schreibrisiko): `auditGesamtenProduktkatalog()` und `auditAktuellenProduktkatalog()` (nur letzte 6 Monate, Filter über `/Order`-Erstellungsdatum + `/OrderPos` paginiert, ohne Pro-Auftrag-N+1) in syncengine.js. Zweck: alle jemals/kürzlich verkauften Artikelnamen gegen Kategorie-Regex + Dropdown-Katalog matchen, um Lücken zu finden, BEVOR sie über echte Aufträge einzeln auffallen.

**Wichtige Einschränkung erkannt:** `auditAktuellenProduktkatalog()` filtert nach Angebots-**Erstellungsdatum**, nicht nach Annahme-Datum — ein altes Angebot, das gerade erst angenommen wird (genau der Use-Case des ganzen Projekts), taucht im "letzte 6 Monate"-Audit u.U. NICHT auf. Deshalb sind die echten Live-Auftrags-Ergebnisse verlässlicher als dieser Audit; der Audit ist nur eine ergänzende Grobsicht.

**Ergebnis Audit + Live-Aufträge zusammengeführt, 7 Dropdown-Ergänzungen an Marco/Team via Slack vorgeschlagen:**
Wechselrichter `SIGENERGY Hybrid Wechselrichter 10.0 kW TP2 dreiphasig`, Speicher `SIGENERGY Batteriemodul 10.0`, Zubehör `SIGENERGY Battery Controller BC`, Zubehör `SIGENERGY SparSmart KI`, Module `AIKO-GLAS-GLAS HOCHLEISTUNGS-SOLARMODUL FULL BLACK 495 WP`, Speicher `EcoFlow STREAM AC Pro 1,9 kWh Speicher`, Module `SUNOVA-GLAS-GLAS HOCHLEISTUNGS-SOLARMODUL FULL BLACK 445 WP`.

**⚠️ Rückmeldung von Marco Benhammadi (Chef, Slack, 2026-08-25 20:41):** "Lass uns dazu morgen kurz calln - es sind schon alle Artikeln vorhanden, müssen hier einfach noch die Bezeichnungen vereinheitlichen." → Die Annahme "6 Artikel fehlen im Dropdown" war falsch — sie EXISTIEREN im Sheet-Dropdown bereits, nur unter anderen Bezeichnungen als in sevdesk. Der eigentliche Fix ist eine Namens-Vereinheitlichung zwischen sevdesk-Artikelnamen und Sheet-Dropdown-Werten, kein neuer Dropdown-Eintrag. **Entscheidung vertagt auf Call mit Marco am 2026-08-26.** Bis dahin NICHTS an `KNOWN_DROPDOWN_VALUES` ändern — erst die echten (vereinheitlichten) Bezeichnungen aus dem Call abwarten, sonst wird wieder auf Verdacht geraten statt verifiziert.

Auch der Datenqualitäts-Fund zu "JA Solar 455 WP" (9 verschiedene Schreibweisen in sevdesk: JASOLAR-GLAS-GLAS / JA Solar-GLAS-GLAS / JA-SOLAR-GLAS-GLAS, mit/ohne Leerzeichen, einmal "KWP" statt "WP") ist wahrscheinlich Teil desselben Vereinheitlichungs-Themas — vermutlich auch im Call morgen ansprechen.

**⚠️ Fund (User-Korrektur, 2026-08-25), dann per echtem Sheet-Check WIDERLEGT:** Valentin hatte behauptet, "Sigen Hybrid Wechselrichter 12.0 kW TP2 dreiphasig" sei ein PAKET aus Wechselrichter UND Speicher (Sorge: EK_NETTO würde Speicherkosten doppelt zählen, wenn zusätzlich eine Speicher-Position gefüllt wird). **Direkt im Einkauf-Tab des echten Sheets nachgeschaut** (via Google-Drive-MCP `read_file_content` auf die Sheet-ID, `fileContent` als natürlichsprachliche Tabellen-Repräsentation): EK-Preise widersprechen der Paket-These deutlich — Solo "10.0 kW TP2" kostet 850€, Solo "12.0 kW TP2" kostet 700€, während die echten "Set Hybrid TP2 X kW / Y kWh"-Pakete (WR+Speicher, im selben Einkauf-Tab) 3.125–5.605€ kosten. 700-850€ ist zu wenig für ein Paket inkl. Batterie (ein einzelnes Batteriemodul allein kostet laut Einkauf-Tab schon 1.800-2.300€). **Vorläufige Einschätzung: "12.0/10.0 kW TP2 dreiphasig" sind reine Solo-Wechselrichter-Preise, kein Bundle** — trotzdem im Call morgen (2026-08-26) mit Marco gegenchecken, da er es anders dargestellt hat.

**Nebenbei bestätigt beim selben Sheet-Check:** "Sigen Hybrid Wechselrichter 10.0 kW TP2 dreiphasig" ist ein ECHTER, historisch bereits verwendeter Dropdown-Wert (Zeile Antonio Zivojin, EK 850€) — fehlte nur im Code-Katalog (`KNOWN_DROPDOWN_VALUES.wechselrichter`). **Ergänzt und gepusht** (2026-08-25) — löst die 10-kW-Solo-Wechselrichter-UNSICHER-Fälle künftig automatisch.

**Wichtiger Fund zur "Battery Controller BC"-Lücke:** Im Einkauf-Tab existiert eine "Sigenergy SigenStack"-Produktfamilie (u.a. `Sigenergy SigenStack BC M2-0.5C` 2.144€, `Sigenergy SigenStack Batteriemodul 12.0 kWh` 2.594€, weitere SigenStack-Komponenten) — ABER diese steht in einer eigenen **"B2B"**-Spalte des Einkauf-Tabs, getrennt von den 7 normalen Kategorien (Module/Unterkonstruktion/Sigenergy/Speicher/Umschaltboxen/Smartmeter/Zubehör). Vermutlich Gewerbe-/Großanlagen-Produkte, NICHT die passende Kategorie für sevdesk-Positionen wie "SIGENERGY Battery Controller BC inkl. Bodenmontageset" oder "SIGENERGY Batteriemodul 10.0" — bewusst NICHT automatisch als Match übernommen, um nicht in die falsche Kategorie zu matchen. "SIGENERGY SparSmart KI" und "EcoFlow"-Produkte kommen im gesamten Sheet (Zeilen + Einkauf-Tab) kein einziges Mal vor — echte Lücken, keine Namensvarianten. Alles für den Call morgen mitnehmen.

**Nützliches Werkzeug für künftige Sessions:** Das ganze Sheet lässt sich über `mcp__claude_ai_Google_Drive__read_file_content` mit der Sheet-Datei-ID lesen (liefert `{fileContent: string}` als Markdown-artige Tabellen-Repräsentation aller Tabs inkl. Einkauf-Preis-Tab). Ergebnis ist meist zu groß für den Kontext (>93KB) → landet automatisch in einer Datei unter `tool-results/`; die JSON-Datei mit `node -e "...JSON.parse(...).fileContent..."` in eine Klartext-Datei extrahieren, dann mit Grep durchsuchen. Damit lassen sich Katalog-Fragen (existiert Artikel X? unter welchem Namen? in welcher Spalte?) direkt verifizieren statt zu raten oder auf `pruefeDropdownListen()`-Logs vom User zu warten.
