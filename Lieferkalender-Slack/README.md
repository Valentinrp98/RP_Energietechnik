# Lieferkalender-Slack ("Ernst")

Meldet Termin-Aenderungen aus Pipedrive-Pipeline 2 (Fulfillment) nach Slack.
Ueberwacht werden vier Datumsfelder am Deal: **Liefertermin, DC-Termin,
AC-Termin, IB-Termin**.

Das Script ist **rein lesend gegenueber Pipedrive**. Geschrieben wird nur ins
eigene Google Sheet und nach Slack.

**LIVE seit 11.09.2026, 13:44.** `DRY_RUN = false`, zwei Zeit-Trigger aktiv.
Erste echte Meldung 13:45 ("HEUTE Lieferung", Deal 6952).

- Editor: https://script.google.com/home/projects/1N1Q1XRvCtR6uUIIxZMM-NmaiP0xsGrXuR03cu3GQyWeRXrwjc28VTb4P/edit
- scriptId: `1N1Q1XRvCtR6uUIIxZMM-NmaiP0xsGrXuR03cu3GQyWeRXrwjc28VTb4P`
- Sheet: `11lekovl_J-701s9xmbFHOxYodNta-9rVXa-MFCxjF8U`
- Channel: **#ernst-knows** (`C0C0Q6JML23`)

---

## Wie es funktioniert — zwei verschiedene Mechanismen

Die Meldungen entstehen auf zwei voellig unterschiedliche Arten. Das ist der
wichtigste Punkt zum Verstehen des Projekts.

### 1. Aenderungs-Meldungen (gesetzt / verschoben / geloescht)

Pipedrive sagt nicht "dieses Feld wurde gerade geaendert". Der Listen-Endpoint
liefert nur den **aktuellen** Stand. Um "gerade gesetzt" von "steht schon seit
drei Wochen drin" zu unterscheiden, braucht das Script ein **Gedaechtnis**.

Das ist der Tab **Snapshot**: eine Zeile pro Deal mit dem Stand des letzten
Laufs. Jeder Lauf vergleicht Snapshot gegen Pipedrive:

| Snapshot (alt) | Pipedrive (neu) | Ereignis |
|---|---|---|
| leer | `2026-09-18` | **gesetzt** |
| `2026-09-11` | `2026-09-18` | **verschoben** (beide Daten in der Meldung) |
| `2026-09-11` | leer | **geloescht** |
| `2026-09-18` | `2026-09-18` | nichts |

Am Ende des Laufs wird der Snapshot neu geschrieben und ist damit der "alte"
Stand fuer den naechsten Lauf.

**Der Snapshot-Tab ist gleichzeitig die Liefer-Uebersicht**, die urspruenglich
das Ziel war: Deal-ID, Kunde, PLZ, Montagepartner, Stage und alle vier Termine
in einer Tabelle. Eine Datenstruktur, zwei Zwecke.

### 2. Datums-Meldungen (vorher / am Tag)

Die loest niemand in Pipedrive aus — der Ausloeser ist der Kalender. Hier wird
nicht verglichen, sondern gerechnet: `Termin minus N Tage == heute?`

Diese Regeln feuern bei jedem Lauf erneut, auch wenn sich nichts geaendert hat.
Bei einem 15-Minuten-Trigger waeren das 96 Posts pro Deal und Tag. Deshalb ist
der **Doppelpost-Schutz hier zwingend**, nicht optional — siehe unten.

---

## Steuerung: der Tab "Regeln"

Alles, was gemeldet wird, steht in diesem Tab. Eine Regel aendern heisst **eine
Zelle im Sheet aendern** — kein `clasp push`, kein Deployment, geht auch vom
Handy.

| Spalte | Bedeutung |
|---|---|
| `Aktiv` | `ja` / `nein` — Regel abschalten ohne sie zu loeschen |
| `Feld` | `Liefertermin` · `DC-Termin` · `AC-Termin` · `IB-Termin` |
| `Ereignis` | `gesetzt` · `verschoben` · `geloescht` · `vorher` · `am Tag` |
| `Tage davor` | nur bei `vorher` — Zahl, z.B. `2` |
| `Channel-ID` | Slack-ID, beginnt mit `C` (oder `G` bei privaten Channels). **Nicht der Name** — beim Umbenennen bricht sonst alles. |
| `Vorlage` | der Nachrichtentext mit Platzhaltern |

Gelesen wird nach **Header-Namen**, nicht nach Spaltenposition — die Spalten
duerfen also verschoben werden. (Lehre aus den Partner-Sheets, wo 5 von 6 eine
andere Reihenfolge hatten.)

Mehrere Zeilen pro Feld sind der Normalfall. Eine Kadenz 14/7/2/0 Tage vorher
waeren vier Zeilen mit Ereignis `vorher`.

### Platzhalter

| Platzhalter | Inhalt |
|---|---|
| `{dealId}` | 5829 |
| `{kunde}` | Deal-Titel |
| `{plz}` | PLZ der Person — **siehe Warnung unten** |
| `{partner}` | Montagepartner (ALE, Berger, …) |
| `{deallink}` | `https://rp-energietechnik.pipedrive.com/deal/5829` |
| `{datum}` | das relevante Datum der Meldung, z.B. `Fr, 18.09.2026` |
| `{altdatum}` / `{neudatum}` | nur sinnvoll bei `verschoben` |
| `{liefertermin}` `{dc}` `{ac}` `{ib}` | alle vier Termine des Deals |
| `{stage}` | Stage-ID |
| `{tage}` | die Zahl aus "Tage davor" |
| `{feld}` | Feldname der Regel |
| `{ordnerlink}` | Kundenordner in Drive |

**Bewusst NICHT dabei:** kWp/Speicher (stehen in "Anlagendetails", Fuellstand
ungemessen) und Telefonnummer (haengt an der Person, braucht einen Extra-Call).
Beides steht im Deal — dafuer ist `{deallink}` da.

Ein Platzhalter, den es nicht gibt (Tippfehler `{kwpp}`), wird **nicht still
stehen gelassen**, sondern erzeugt eine Warnung im Log.

### Syntax in der Spalte "Vorlage"

Slack versteht **mrkdwn**, nicht Markdown — das ist nicht dasselbe:

| gewollt | schreiben |
|---|---|
| **fett** | `*fett*` — EIN Stern, nicht zwei |
| _kursiv_ | `_kursiv_` |
| `code` | Backticks |
| Link mit Text | `<{deallink}|Deal {dealId} oeffnen>` |
| Zeilenumbruch | `
` als **zwei Zeichen** in der Zelle |

Zum Umbruch: Alt+Enter in der Zelle funktioniert auch, ist aber beim
Copy-Paste einer ganzen Regel-Tabelle nicht durchzuhalten — mehrzeilige Zellen
zerreissen dabei. Deshalb `
`.

Leere Platzhalter raeumen sich selbst auf: aus `{kunde} · {plz} · {partner}`
wird bei fehlender PLZ nicht `Muster ·  · ALE`, sondern `Muster · ALE`.
Das gilt fuer `·`, `( )` und `[ ]`.

### Ein Symbol pro Ereignisklasse, nicht pro Terminart

Vorgabe Valentin: ✅ gesetzt · ↪️ verschoben · 🗑️ geloescht · ➡️ Erinnerung.

Beim Ueberfliegen des Channels zaehlt **"muss ich reagieren?"**, und das haengt
am Ereignis, nicht daran, ob es DC oder AC ist. Ein Symbol pro Terminart waere
die Sortierung, die man beim Lesen gerade nicht braucht.

`setzeVorlagenNeu()` schreibt nur die Spalte `Vorlage` neu (nach
Feld|Ereignis|Tage gematcht) und loggt ALT/NEU pro Zeile. Channel-ID und
`Aktiv` bleiben unangetastet. Damit sind Text-Updates aus dem Code moeglich,
ohne den Tab zu loeschen — aber Achtung: **eigene Texte werden dabei
ueberschrieben.**

### Die 14 Startregeln

`befuelleRegelnMitStartwerten()` legt genau das an, was am 10.09. festgelegt
wurde:

| Feld | Ereignisse |
|---|---|
| Liefertermin | gesetzt · verschoben · geloescht · 1 Tag vorher · am Tag |
| DC-Termin | gesetzt · 2 Tage vorher · am Tag |
| AC-Termin | gesetzt · 2 Tage vorher · am Tag |
| IB-Termin | gesetzt · 2 Tage vorher · am Tag |

Die Texte sind Platzhalter-Formulierungen. **Valentin schreibt sie um** — dafuer
ist der Tab da. Die Funktion ueberschreibt nichts, wenn der Tab schon Zeilen hat.

---

## Setup — Reihenfolge

1. **Slack-App "Ernst"** auf `https://api.slack.com/apps` anlegen
   (*From scratch*, RP-Workspace).
   Bot Token Scopes: `chat:write`, `chat:write.public`, `channels:read`.
   Installieren → Bot Token (`xoxb-…`) kopieren.
2. **Channel anlegen** und den Bot einladen: im Channel `/invite @Ernst`.
   Channel-ID holen: Rechtsklick auf den Channel → Link kopieren, die ID am
   Ende beginnt mit `C`.
3. **Apps-Script-Projekt anlegen** (`clasp create`) und pushen.
4. **Script Properties** setzen (Projekteinstellungen → Skripteigenschaften):
   - `PIPEDRIVE_API_TOKEN`
   - `SLACK_BOT_TOKEN` = `xoxb-…`

   Tokens gehoeren NICHT in den Code (Befund D4).
5. `legeSheetAnUndZeigeId()` ausfuehren → legt Sheet + Tabs an, loggt die ID.
   (Der Tab "Laeufe" entsteht beim ersten Lauf von selbst.)
6. **`SHEET_ID` in `Config.gs` eintragen** (steht noch auf `TODO_SHEET_ID`) und pushen.
7. `befuelleRegelnMitStartwerten()` → legt die 14 Zeilen an.
8. **Channel-ID in Spalte "Channel-ID"** eintragen (im Sheet, alle 14 Zeilen).
9. `pruefeKonfiguration()` → prueft alles, legt nichts an, sendet nichts.
   Muss `=== Konfiguration vollstaendig ===` loggen.
10. `testePost()` → eine Nachricht mit Testdaten in den Channel der ersten Regel.
    Zeigt, ob das Layout im Slack-Client lesbar ist. Ignoriert `DRY_RUN` bewusst.
11. `initialisiereSnapshotJetzt()` → fuellt das Gedaechtnis mit dem Ist-Stand,
    postet nichts. Ignoriert `DRY_RUN` bewusst.
    **Warum eine eigene Funktion:** ein DRY-Lauf schreibt den Snapshot nicht
    (das ist der Sinn von DRY), also misst ein DRY-Lauf ohne befuellten
    Snapshot gar nichts — jeder Deal gilt als "neu", und
    gesetzt/verschoben/geloescht bleiben stumm. Die Alternative waere, kurz
    `DRY_RUN = false` zu setzen und schnell wieder zurueck. Genau bei diesem
    Flag-Geschiebe bleibt man scharf, ohne es zu merken.
12. `sweep()` bei `DRY_RUN = true` → das Log zeigt, was gepostet WUERDE.
    **Muss 0 Meldungen ergeben** (Idempotenz-Beweis, siehe Verifikation).
13. Scharf schalten: `DRY_RUN = false`, dann `installiereTrigger()`.
    Der zaehlt danach nach, statt "installiert" zu behaupten — erwartet
    werden **2** CLOCK-Trigger. `zeigeTrigger()` zeigt den Stand jederzeit.

---

## Verifikation

| Check | Erwartung |
|---|---|
| `pruefeKonfiguration()` | `✅` bei Slack-Token, allen vier field_codes, Sheet, Tabs, Bot ist Channel-Mitglied |
| `testePost()` | Nachricht kommt an, Absendername ist **Ernst**, Umlaute korrekt, `{…}` nirgends sichtbar |
| `initialisiereSnapshotJetzt()` | `0 Meldungen`, Snapshot-Tab hat eine Zeile pro Deal (90 am 11.09.2026) |
| **Zweiter `sweep()` direkt danach** | **`0 Meldungen`** — das ist der Idempotenz-Beweis. Kommt hier etwas, ist der Diff kaputt (meist Date-vs-String, siehe unten). |
| Einen Testtermin in Pipedrive setzen, `sweep()` | genau **eine** Meldung "gesetzt" |
| Denselben Termin verschieben, `sweep()` | genau **eine** Meldung "verschoben" mit altem UND neuem Datum |
| `sweep()` nochmal | 0 Meldungen |
| Log-Tab | eine Zeile pro gesendeter Meldung, Spalte `Schluessel` gefuellt |

---

## Fallen, die hier schon geloest sind

- **Slack antwortet auch bei Fehlern mit HTTP 200.** Der Erfolg steht in
  `json.ok`. Nie dem Statuscode trauen. — geloest in `fetchSlackJson`
  (uebernommen aus dem Geburtstagskalender).
- **`status`-Parameter bei Pipedrive v2**: kennt nur `open|won|lost|deleted`,
  `all_not_deleted` wirft HTTP 400. Und `status:"won"` wird bei RP schon bei der
  Anlage gesetzt und traegt **kein** Liefersignal. → wird gar nicht erst
  uebergeben.
- **Sheets liefert ein Datumsfeld als `Date`-Objekt, nicht als String.** Ohne
  Normalisierung (`alsDatumsText`) sieht jeder Lauf eine Abweichung und meldet
  jedes Mal "verschoben" — bei 15-Minuten-Trigger 96 Falschmeldungen pro Deal
  und Tag.
- **`new Date("2026-09-18")` wird als UTC gelesen** und kippt in Wien auf den
  Vortag. Deshalb rechnet `tageVorher()` mit `new Date(Jahr, Monat-1, Tag)`.
- **Frisch uebernommene Deals**: ein Deal, der im letzten Snapshot nicht stand,
  meldet seine vorhandenen Termine NICHT als "gerade gesetzt" (`istNeuerDeal`).
  Datumsbasierte Regeln feuern trotzdem.
- **Verschwundene Deals sind nicht geloescht.** `GET /deals` liefert nur
  nicht-archivierte Deals und hat keinen `include_archived`-Schalter. Solche
  Zeilen bleiben im Snapshot stehen und bekommen einen **Hinweis**, statt als
  "Termin geloescht" gemeldet zu werden. Ein Mensch entscheidet.
- **Doppelpost-Schutz**: Schluessel
  `<dealId>|<feld>|<ereignis>|<tage>|<termindatum>` im Log-Tab. Das
  **Termindatum steckt im Schluessel** — wird ein Termin verschoben, darf die
  Erinnerung fuer das NEUE Datum erneut feuern. Log wird nach 120 Tagen
  ausgeduennt.
- **Fehlgeschlagener Slack-Post** erzeugt KEINE Log-Zeile → wird beim naechsten
  Lauf erneut versucht. Ein kaputter Channel reisst den Lauf nicht mit.
- **Snapshot wird ZULETZT geschrieben** und nur bei vollstaendigem Lauf. Bricht
  der Lauf ab, sieht der naechste dieselbe Aenderung wieder — verpasste Meldung
  ist besser als verlorene.
- **`LockService.tryLock(5000)`**, nicht `waitLock(30000)`: laeuft der Vorgaenger
  noch, ist Ueberspringen richtig — der naechste Trigger kommt in 15 Minuten.
- **Konfigurationsfehler sind laut.** Unbekanntes Feld, unbekanntes Ereignis,
  fehlende oder unplausible Channel-ID → sichtbare `⚠️`-Warnung mit Zeilennummer.
  Eine Regel, die wegen eines Tippfehlers nie feuert, ist der schlimmere Fall.

---

## ⚠️ Zur PLZ

`{plz}` haengt an der **Person**, nicht am Deal — sie kommt also nicht im
Deal-Sweep mit. Dafuer laeuft ein zweiter Bulk-Sweep ueber `/persons`, und zwar
**nur dann, wenn ueberhaupt eine Vorlage `{plz}` benutzt**.

Es gibt zwei Quellen (PLZ-Feld und Adressfeld der Person). **Beide sind bei RP
nachweislich unzuverlaessig und widersprechen sich teils** (belegt an Deal 7177
und 6804, siehe `docs/CHECK-Kette-PLZ-Bundesland-Montagepartner-2026-09-10.md`,
K1). Im PLZ-Feld stand auch schon eine Telefonnummer.

Deshalb wird hier **nicht geraten**:
- alles, was keine 4-stellige AT-PLZ ist, wird verworfen
- weichen die beiden Quellen ab, zeigt die Meldung **beide**:
  `2340 ⚠️ (PLZ-Feld: 1230)`

Aus der PLZ wird in diesem Script **keine Folgeentscheidung** abgeleitet (kein
Bundesland, keine Partner-Zuordnung). Sie ist reine Anzeige.

---

## Was uebernommen wurde statt neu gebaut

| Baustein | Quelle |
|---|---|
| `fetchSlackJson` (Token, `json.ok`, 429-Retry) | `Geburtstagskalender-Sync/Config.gs:121` |
| `chat.postMessage`-Muster | `Geburtstagskalender-Sync/Geburtstagspost.gs:48` |
| Cursor-Pagination + weicher Ausstieg | `Fortschritt-Script/Code.gs:92-101` |
| Trigger-Installation (alte erst loeschen) | `Geburtstagskalender-Sync/Setup.gs:31-43` |
| field_codes, Option-IDs, Address-Subfelder | `docs/REFERENZ-Pipedrive-AppsScript.md` |

Neu ist praktisch nur die Diff-Logik.

---

## Dateien

| Datei | Inhalt |
|---|---|
| `Config.gs` | field_codes, Tokens, Betriebsschalter, Slack-HTTP |
| `PipedriveClient.gs` | Deal-Sweep, Personen-/PLZ-Sweep, Feld-Leser |
| `Regeln.gs` | liest und validiert den Regeln-Tab |
| `Snapshot.gs` | Gedaechtnis + Liefer-Uebersicht |
| `Meldungen.gs` | Text bauen, Doppelpost-Schutz, senden |
| `Lauf.gs` | `sweep()` — die Funktion am Trigger |
| `Setup.gs` | Setup-, Pruef- und Trigger-Funktionen |

### Funktionen in `Setup.gs`, die man von Hand aufruft

| Funktion | Tut was | Postet? |
|---|---|---|
| `legeSheetAnUndZeigeId()` | Sheet + Tabs anlegen | nein |
| `befuelleRegelnMitStartwerten()` | die 14 Zeilen anlegen — **nur wenn der Tab leer ist** | nein |
| `setzeVorlagenNeu()` | nur die Spalte `Vorlage` ueberschreiben | nein |
| `pruefeKonfiguration()` | alle fuenf Checks, legt nichts an | nein |
| `testePost()` | eine Nachricht mit Testdaten, Praefix `_[TEST, keine echten Daten]_` | **ja**, ignoriert `DRY_RUN` |
| `initialisiereSnapshotJetzt()` | Snapshot auf den Ist-Stand setzen | nein, ignoriert `DRY_RUN` |
| `installiereTrigger()` | alte `sweep`-Trigger weg, zwei neue, danach nachzaehlen | nein |
| `zeigeTrigger()` | Ist-Stand der Trigger anzeigen | nein |

---

## Trigger

- `sweep()` alle **15 Minuten** → Aenderungs-Erkennung
- `sweep()` taeglich **~07:15** → die datumsbasierten Regeln

Belegt sind bei RP schon 02:00, 03:00, 04:00 und 08:00. Beide Trigger rufen
dieselbe Funktion; der Doppelpost-Schutz macht das unschaedlich.

`installiereTrigger()` loescht vorher alle alten `sweep`-Trigger und zaehlt
danach nach. `zeigeTrigger()` listet den Ist-Stand, ohne etwas zu aendern.

### Nachtsperre — `RUHEZEIT_BIS_STUNDE = 7`

Die datumsbasierten Regeln fragen "ist `heute` == Termindatum?". `heute` kippt
um Mitternacht — der 15-Minuten-Trigger laeuft also um **00:07** das erste Mal
mit dem neuen Datum. Und weil der Doppelpost-Schutz greift, waere dieser
Nachtlauf **zugleich der einzige Post des Tages**: "HEUTE Lieferung" kaeme jede
Nacht um viertel nach zwoelf und waere am Morgen weggescrollt.

Darum feuern `vorher` und `am Tag` erst ab 07:00. Die Diff-Regeln laufen rund
um die Uhr weiter — die haengen daran, dass ein Mensch etwas aendert, und
nachts aendert niemand etwas.

---

## Lauf-Protokoll — Tab "Laeufe"

Eine Zeile pro Lauf, **auch bei 0 Meldungen und auch bei Absturz**:
Zeitpunkt, Dauer, Deals, Meldungen, Modus (`DRY`/`live`), Hinweis.
500 Zeilen Historie, dann rollt der Tab.

Der Grund: ein stiller Channel heisst entweder "nichts zu melden" oder "das
Script laeuft seit Dienstag nicht mehr" — von aussen sehen die identisch aus.
Dieselbe Falle wie beim Cloudflare-Relay, das immer 200 meldete und damit tote
Webhooks maskiert hat.

Damit gibt es drei Protokolle mit drei Aufgaben:

| Wo | Was | Lebensdauer |
|---|---|---|
| Apps-Script-Ausfuehrungsprotokoll | jede Zeile des Laufs, zum Debuggen | 7 Tage |
| Tab **Log** | jede *gesendete* Meldung + Dedup-Schluessel | 120 Tage |
| Tab **Laeufe** | jeder Lauf, auch der leere | 500 Laeufe |

---

## Betriebskosten pro Lauf (gemessen)

| Call | Bringt | Kosten |
|---|---|---|
| `GET /deals?pipeline_id=2` | alle 90 Deals **inkl. custom_fields** | 1 Call, ~1 s |
| `GET /persons?limit=500` | nur die PLZ (haengt an der Person) | 14 Calls, ~4 s |

Der Personen-Sweep laeuft **nur, wenn eine Vorlage `{plz}` benutzt**. `limit`
steht bewusst auf 500 statt 100: bei ~7000 Personen sind das 14 Calls statt 70
— pro Lauf, und beim 15-Minuten-Trigger der Unterschied zwischen 1.344 und
6.720 Calls am Tag.

---

## Offen

- [ ] **Nachrichtentexte von Valentin** — was drinsteht, sind Platzhalter.
      Der Tab "Regeln", Spalte `Vorlage`, ist genau dafuer da: aenderbar ohne
      `clasp push`, auch vom Handy.
- [ ] **Pipedrive-Automation A1 pruefen** (`Fortschritt-Script/README.md:241`)
      — falls die schon nach Slack postet, gibt es zwei Absender fuer dieselbe
      Sache. Faellt auf, sobald der erste echte Termin eingetragen wird.

### Erledigt am 11.09.2026

- [x] `SHEET_ID`, Slack-App, Token, Channel-ID, `clasp create`, Go-Live
- [x] **Archivierte Deals sind ungefaehrlich** — im Code nachgesehen, nicht
      angenommen: `sweep()` laeuft nur ueber die Deals, die Pipedrive gerade
      liefert. Ein verschwundener Deal wird gar nicht geprueft und kann deshalb
      kein "geloescht" ausloesen. Seine Snapshot-Zeile bleibt mit dem Hinweis
      "nicht mehr in Pipeline 2 (archiviert, verschoben oder geloescht?)"
      stehen. Sichtbar, aber still.
