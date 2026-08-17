# RP-Automatisierungen — Architekturentscheidungen

Stand 2026-08-13. Vier Themen: Backup, Dashboard, Logging, Partner-Sheets (Notizen + Buttons).
Alles hier ist Review + Plan, **nichts davon ist gebaut**. Was ich von dir brauche, steht ganz unten.

---

## 0. Zuerst: dein aktueller Stand ist nicht gesichert

Letzter Commit: **12.08. 12:51**. Seitdem uncommitted:

```
 M Bundesland-aus-PLZ/Code.js              (CUTOFF_DATE-Filter)
 D Bundesland-aus-PLZ/PlzBundeslandMap.js
 M Montagepartner-aus-Bundesland/Code.js
 M Ordnererstellung-bei-Gewonnen/*.gs      (4 Dateien)
 M Sheet-Sync/*.gs                         (4 Dateien)
?? Ordnererstellung-bei-Gewonnen/.clasp.json
?? Sheet-Sync/.clasp.json
```

Das ist die komplette Arbeit vom 13.08. plus die Fixes vom 12.08. abends. Existiert nur auf
diesem Laptop (OneDrive hat eine Kopie, GitHub nicht). Bevor irgendwas anderes passiert:

```powershell
cd C:\Users\valen\OneDrive\Documents\RP\Claude_Work_RP\RP-Google-Scripts
git add .
git commit -m "Sheet-Sync + Ordnererstellung Fixes, CUTOFF_DATE, clasp-Verknüpfungen"
git push
```

Nicht über `sync-all-scripts.ps1` — das macht vorher `clasp pull` und würde die lokalen
Dateien mit dem Editor-Stand überschreiben. Siehe Punkt 1.2.

---

## 1. Backup-Strategie

### 1.1 Was heute gut ist

Das Grundprinzip stimmt und bleibt: **Browser-Editor ist Source of Truth, Git ist Backup,
`clasp push` gibt es nicht.** Ein Repo für alle Projekte, ein Commit pro Sync — richtig,
weil die Projekte inhaltlich eine Kette sind und man sie gemeinsam zurückrollen will.
Keine Tokens im Code (alles in Script Properties) — das ist der Punkt, an dem die meisten
solchen Repos scheitern, und der sitzt.

### 1.2 Die Lücke, die wirklich weh tun kann

`sync-all-scripts.ps1` behandelt einen fehlgeschlagenen oder leeren `clasp pull` als Warnung
und macht danach trotzdem `git add . && git commit && git push`.

Konkretes Szenario, das schon mit einem Fuß in der Tür steht: bei
`Ordnererstellung-bei-Gewonnen` liegt der Code lokal, aber (Stand 12.08.) noch nicht im
Editor-Projekt — das ist dort vermutlich noch das leere Default-`Code.gs`. Ein Sync-Lauf
zieht dieses Default runter, überschreibt deine vier sorgfältig geschriebenen `.gs`-Dateien,
committet die Löschung und pusht sie. Das Backup zerstört den Stand, den es sichern soll.
Rückholbar über Git-History, aber nur wenn du es merkst.

**Fix (drei Zeilen Logik):** nach dem Pull pro Projekt prüfen, ob der Pull Dateien *entfernt*
oder ein `Code.gs` mit dem Apps-Script-Default (`function myFunction()`) geliefert hat. Wenn
ja: `git checkout -- <projekt>` und das Projekt als "übersprungen" melden, statt zu committen.
Erst wenn der Pull plausibel ist, darf er ins Commit.

Zusätzlich, kleiner:
- Der Kommentarblock in Zeile 11–14 ist veraltet (Bundesland/Montagepartner haben inzwischen
  `.clasp.json`). Veraltete Kommentare im Backup-Werkzeug sind gefährlicher als anderswo.
- `Read-Host` am Ende blockiert — solange das drinsteht, kann der Sync nie automatisch laufen.
  Als `-NoPause`-Schalter bauen.
- Keine `.gitignore`. `sync-log.txt` wird bei jedem Lauf mitcommittet und macht jedes Diff
  unlesbar. Gehört ignoriert.

### 1.3 Was Git gar nicht sichert — und schon zugeschlagen hat

Git sichert Code. Kaputt gegangen ist bisher aber die **Verdrahtung**, nicht der Code:

- Webhook war als v1 statt v2 registriert → hätte nie ausgelöst, sah gesund aus
- Trigger doppelt installiert / gar nicht installiert
- `DRY_RUN` stand auf `true`, während alle dachten, es läuft scharf (581 Deals, dann nochmal
  325 beim Montagepartner)
- Script Properties (Token, Resume-Cursor, Log-Sheet-IDs) existieren nur in Google

Nichts davon steht im Repo. Deshalb gehört zum Backup ein zweiter Teil: **eine Funktion pro
Projekt, die den Live-Zustand ausliest** — installierte Trigger, registrierte Webhooks, gesetzte
Property-*Namen* (nie Werte!), Wert von `DRY_RUN`, Deployment-URL. Ergebnis in eine Zeile im
Dashboard. Damit siehst du auf einen Blick "läuft scharf / läuft trocken / hat gar keinen
Trigger", statt es in sechs Editor-Tabs nachzusehen.

Das ist gleichzeitig die Antwort auf "wie merken wir, dass ein Script gar nicht mehr läuft".

### 1.4 Zielbild

| Ebene | Was | Wie oft |
|---|---|---|
| Code | `clasp pull` → Commit → Push (mit Guard aus 1.2) | nach jeder getesteten Änderung im Browser |
| Meilenstein | `git tag golive-<projekt>-<datum>` | bei jedem Scharfschalten |
| Verdrahtung | `dumpLiveState()` → Dashboard-Tab "Konfiguration" | täglich per Trigger |
| Daten | Pipedrive-Export + Log-Sheets | vor jedem Massenlauf |

Der Tag ist billig und rettet die Frage "welche Version hat eigentlich den 6570-Deal-Vollauf
gefahren". Der Daten-Export vor Massenläufen ist die einzige Absicherung gegen einen Bulk-Write,
der 6000 Felder falsch befüllt — Pipedrive hat kein Undo.

### 1.5 Offener Punkt: Repo liegt in OneDrive

`.git` in einem OneDrive-Ordner ist die klassische Quelle für korrupte Index-/Pack-Dateien,
weil OneDrive Dateien beim Sync auslagern und ersetzen kann, während Git sie schreibt.
Bei einem Rechner und seltenen Commits ist das Risiko klein, aber real. Sauberer wäre
`C:\Users\valen\dev\RP-Google-Scripts` und GitHub als einzige Off-Machine-Kopie.
Mittlere Priorität — kein Grund, heute etwas umzuräumen, aber beim nächsten Setup nicht
wiederholen.

---

## 2. Dashboard

Die Architektur aus der letzten Runde bleibt: **ein zentrales Sheet, jedes Script schreibt
eine Zeile pro Lauf**, Zweit-Tab mit `QUERY()` als Übersicht. Die Zellenrechnung geht
locker auf. Drei Punkte waren offen, hier meine Entscheidung dazu.

### 2.1 Ampel-Kriterium — die Fehlerzahl reicht nicht

Der Montagepartner-Lauf von gestern Abend:

```
DURCHGELAUFEN. 6571 Deals. {"gesetzt":0,"uebersprungen":6246,"dryRun":325,"fehler":0}
```

Null Fehler, sauber durchgelaufen, und trotzdem ein kompletter Nulllauf — das Bundesland-Feld
war leer, also gab es nichts abzuleiten. Jede Ampel, die nur Fehler zählt, hätte das grün
gemeldet. Dasselbe Muster nochmal beim Sheet-Sync-Testlauf: 0 von 437 gewonnenen Deals
bekämen eine Zeile, weil der Ordner-Link fehlt. Zweimal dieselbe Klasse.

Deshalb: jeder Lauf meldet nicht nur Zähler, sondern **den häufigsten Übersprungen-Grund**.
Ist das ein Grund, der auf ein Vorgänger-Script zeigt ("kein Bundesland", "kein Ordner-Link",
"keine Deal-ID"), gibt es einen eigenen Status:

- `OK` — sauber
- `SOFT_ERROR` — fachlicher Grenzfall, bewusst übersprungen (OÖ-Mehrdeutigkeit, PLZ-Müll)
- `HARD_ERROR` — technisch kaputt (4xx/5xx, Config-Fehler, unbekannte Option-ID)
- `KETTE_BLOCKIERT` — **neu**: Lauf war fehlerfrei, hat aber fast nichts getan, weil ein
  Vorgänger nicht geliefert hat

Regel für die Ampel: rot bei `HARD_ERROR`, **orange bei `KETTE_BLOCKIERT`**, gelb bei
`SOFT_ERROR` über Schwelle, sonst grün.

Zweite Spalte, die dazugehört: **`Modus` (LIVE / DRY)**. Beide Nulllauf-Vorfälle hatten als
Mitursache, dass niemand wusste, in welchem Modus das Script gerade steht. Ein Script, das
laut Plan produktiv laufen soll und `DRY` meldet, ist gelb — nicht grün.

### 2.2 Rollout — und warum das die richtige erste Library ist

Nicht alle sechs Scripts auf einmal patchen. Jedes Script wird vor seinem Go-Live ohnehin
nochmal angefasst; der Dashboard-Aufruf kommt bei der Gelegenheit rein. Reihenfolge nach
Go-Live-Nähe: sevdesk-Sync → Sheet-Sync → Ordnererstellung → Bundesland/Montagepartner
(die laufen manuell, brauchen es zuletzt).

Aber: der Logger wäre die **fünfte Kopie** derselben Hilfsfunktion. `fetchPipedrive`,
`patchPipedrive`, Retry-Wrapper und Log-Sheet existieren schon 4× in leicht abweichenden
Varianten — genau der Zustand, der das Zusammenlegen von Projekten heute verhindert
(Konstanten-Kollisionen). Der Dashboard-Logger ist der ideale erste Kandidat für eine echte
Apps-Script-Library `RPLog`:

- er ist neu, also kollidiert er mit nichts Bestehendem
- er ist klein (~30 Zeilen) und wird **einmal pro Lauf** aufgerufen, nicht pro Datensatz —
  der Library-Overhead pro Aufruf ist damit völlig egal
- alle sechs Projekte brauchen exakt dieselbe Version

Ehrlicher Nachteil: Libraries muss man versionieren und in jedem Projekt die Version pinnen,
sonst zieht eine Änderung sofort überall durch. Bei einem Logger ist genau das erwünscht.
Wenn das funktioniert, wandern `fetchPipedrive` & Co. später nach — dann mit gepinnter Version.

### 2.3 Dashboard-Sheet anlegen

Das Sheet lege ich nicht an (Drive read-only). Stattdessen bekommst du eine
`setupDashboard()`-Funktion, die du einmal im Editor startest: sie legt das Sheet an, schreibt
die Kopfzeile, baut den Übersichts-Tab mit den `QUERY()`-Formeln und loggt die ID, die du dann
in die Script Properties der anderen Projekte einträgst.

### 2.4 Ein Sheet, das niemand öffnet, ist kein Monitoring

Dazu gehört ein täglicher `dashboardDigest()` um ~07:00, der dir **nur bei Auffälligkeiten**
eine Mail schickt (rot oder orange in den letzten 24h). Keine tägliche Grün-Mail — die
ignorierst du nach zwei Wochen, und dann auch die rote.

---

## 3. Logging Pipedrive ↔ Google Sheets

### 3.1 Drei Ebenen statt einer

Heute schreiben die Scripts **eine Zeile pro Datensatz pro Lauf** — 6571 Zeilen × 8 Spalten
für einen Lauf, bei dem 325 Dinge passiert sind. Für einen einmaligen Backfill ok, im
Dauerbetrieb sprengt es das Sheet und niemand liest es. Sauber getrennt:

| Ebene | Inhalt | Wo | Aufbewahrung |
|---|---|---|---|
| **Lauf-Log** | 1 Zeile pro Lauf, alle Scripts | zentrales Dashboard | für immer |
| **Änderungs-Log** | nur was sich geändert hat + Fehler + Grenzfälle | Sheet pro Script | 90 Tage, dann Monats-Tab |
| **Debug** | alles andere ("übersprungen, bereits gesetzt") | `Logger.log`, Ausführungsprotokoll | ~7 Tage, kostet keine Zellen |

Die entscheidende Regel: **"nichts passiert" gehört nicht ins Sheet.** 6246 Zeilen
"übersprungen (bereits gesetzt)" sind keine Information, sie sind Rauschen, das die 3 echten
Fehler unsichtbar macht.

### 3.2 Vier Dinge, die jede Log-Zeile braucht

1. **Lauf-ID.** Am Anfang jedes Laufs `Utilities.getUuid().slice(0,8)`, in jede Zeile dieses
   Laufs und in die Dashboard-Zeile. Damit springst du von einer roten Dashboard-Zeile per
   Filter exakt auf die zugehörigen Detailzeilen, statt über Zeitstempel zu raten. Kostet
   eine Spalte, spart jedes Mal fünf Minuten.
2. **Vorher → Nachher**, nicht nur der neue Wert. `FieldSync.gs` macht das in der Zell-Notiz
   schon richtig — das gehört in alle Scripts. Ein Änderungslog ohne alten Wert kann die
   Frage "wer hat das kaputtgemacht" nicht beantworten.
3. **Rohwert bei Validierungsfehlern.** Steht schon in deinen Regeln, hat die Telefonnummer
   im PLZ-Feld gefunden. Konsequent überall.
4. **Auslöser**: Trigger / manuell / Webhook / Sheet-Edit. Bei einem Fehler ist die erste
   Frage immer "wer hat das gestartet".

### 3.3 Aufräumen automatisch

Am Anfang jedes Laufs: wenn das Änderungs-Log mehr als ~20.000 Zeilen hat, die ältesten in
einen Monats-Tab verschieben und löschen. Ein `deleteRows`-Aufruf. Ohne das läuft jedes
Log-Sheet irgendwann in die 10-Mio.-Zellen-Grenze und stirbt mitten in einem Lauf — und zwar
genau dann, wenn viel los ist.

---

## 4. Notizen — zwei völlig verschiedene Dinge

### 4.1 Im Sheet, für den Partner: Zell-Notizen

Der Ansatz in `FieldSync.gs` ist richtig. Regeln, damit er auch bei 200 Zeilen trägt:

- **Notiz = Zustand, nicht Chronik.** Immer überschreiben, nie anhängen. Sonst wächst sie
  unbegrenzt und wird nach vier Wochen nicht mehr gelesen.
- **Fehlertexte übersetzen.** Aktuell landet `err.message` roh in der Notiz — der Partner
  liest dann `Pipedrive API-Fehler 400 bei "deals/7253": {...}`. Er soll eine
  Handlungsanweisung sehen: *"Konnte nicht übermittelt werden. Bitte RP informieren
  (Code 400)."* Die technische Meldung gehört ins Log, nicht ans Sheet.
- **Farbe für Fehler, Notiz für Details.** Eine Notiz sieht man nur beim Hovern. Ein
  fehlgeschlagener Sync bekommt zusätzlich einen roten Zellhintergrund, den man beim Scrollen
  sieht. Kein Dauergrün bei Erfolg — sonst ist das ganze Sheet grün und sagt nichts mehr.
- **Keine internen Daten in Notizen.** Keine Deal-IDs, keine field_codes, keine Stacktraces.

**Ein Loch, das noch offen ist:** die Spalten DC-/AC-/IB-Termin und Materiallieferung sind
`pipedrive_to_sheet`. Schreibt der Partner dort etwas rein, ist es beim nächsten 15-Minuten-Lauf
kommentarlos weg. Er merkt nichts, wir merken nichts, und er ruft an. Zwei Möglichkeiten:
Spalten per `protect()` sperren (wie die Deal-ID-Spalte) und eine Notiz "wird von RP gepflegt"
setzen — oder beim Überschreiben eines abweichenden Werts eine Notiz hinterlassen. Ich würde
sperren: klarer, und es zwingt uns, einen echten Rückkanal zu bauen (siehe 5.2).

### 4.2 In Pipedrive, für uns: Note vs. Aktivität

Die wichtigste Regel überhaupt an dieser Stelle:

> **Note = Chronik. Aktivität = Arbeitsauftrag.**

Eine Note kann man ignorieren, und im Deal-Feed *wird* sie ignoriert, sobald dort 40 davon
stehen. Eine überfällige Aktivität steht in Pipedrive rot in der Liste und hat einen
Zuständigen. Alles, wo ein Mensch etwas tun muss, ist eine Aktivität — nicht eine Note:

- Montagepartner nicht automatisch bestimmbar (OÖ) → Aktivität "Montagepartner manuell wählen"
- Grenzfall-PLZ → Aktivität "Bundesland prüfen" mit der Adresse im Text
- Partner meldet ein Problem → Aktivität mit Fälligkeit

Notes dagegen für Nachvollziehbarkeit ohne Handlungsbedarf: "Ordner angelegt", "ZPN vom
Partner übernommen: X". Und auch das sparsam — nicht jeder Sync-Vorgang, sonst ist der Feed tot.

**Zwei Fallen, die hier garantiert zuschlagen:**

1. **Idempotenz.** Vor dem Anlegen prüfen, ob am Deal schon eine offene Aktivität mit demselben
   Betreff hängt. Ohne diese Prüfung legt ein 15-Minuten-Trigger 96 identische Aktivitäten
   pro Tag und Deal an. Bei ~400 OÖ-Deals ist das ein Massenereignis.
2. **Notes laufen über die v1-API** (`/v1/notes`), nicht v2 — vor dem Bauen gegen die Doku
   prüfen, nicht aus dem Gedächtnis. Gleiches gilt für Aktivitäten.

---

## 5. Partner-Sheets: Buttons und Infoaustausch

### 5.1 Das Prinzip zuerst: eine Spalte, ein Eigentümer

Jede Spalte gehört entweder dem Partner oder RP. Nie beiden. Bidirektionaler Sync ohne
Konfliktregel verliert garantiert Daten, und zwar leise. Die aktuelle `SYNC_FIELD_CONFIG`
ist schon so gebaut — das sollte als Prinzip festgeschrieben sein, nicht als Zufall:

| Partner schreibt | RP schreibt (Partner nur lesen) |
|---|---|
| Zählpunkt (ZPN) | DC-/AC-/IB-Termin |
| Terminvorschlag | Materiallieferung |
| Fertigmeldung | Link zum Kundenordner |
| Anmerkung | Deal-ID (gesperrt) |

Und: **ein Sheet pro Partner, nie ein gemeinsames mit Filter.** Ein Filter ist kein
Zugriffsschutz — er wird einfach entfernt. Relevant, weil in Finance-Tracking und Deep Core
Margen und Handelsspannen stehen; davon darf nie etwas in ein Partner-Sheet wandern.

### 5.2 Buttons, nach Nutzen sortiert

Technisch: das Sheet-Sync-Projekt ist standalone, also kommt das Menü über einen
installierbaren `onOpen`-Trigger pro Partner-Sheet. Vorteil, und der ist groß: der Trigger
läuft **unter deinem Konto**, nicht unter dem des Partners — der Partner braucht also keinerlei
Pipedrive-Zugang und autorisiert nichts. (Zeichnung + "Skript zuweisen" wäre die Alternative,
läuft aber als klickender Nutzer — für Partner unbrauchbar.) Einmal praktisch testen, bevor
wir darauf aufbauen.

1. **Fertigmeldung** — als Checkbox-Spalte, nicht als Button (gehört pro Zeile). Partner hakt
   ab → Pipedrive-Feld/Stage setzt sich, Drive-Ordner wandert von "Montage offen" nach "Montage
   abgeschlossen". Das ist der Informationsfluss, der heute per Anruf und WhatsApp läuft.
   **Höchster Nutzen von allen.**
2. **Terminvorschlag** — eigene Spalte "Wunschtermin Partner" (Partner schreibt), RP bestätigt
   in Pipedrive, der bestätigte Termin erscheint in der gesperrten DC-/AC-Spalte. Löst genau
   das Problem aus 4.1. ⚠️ **Überschneidung:** das ist exakt der FS-Ablauf aus deinem
   Retool-Projekt "Terminfindung" (Partner schlägt vor → Kunde bestätigt). Das darf nicht
   zweimal gebaut werden — entweder ist das Partner-Sheet der Vorschlagskanal oder Retool.
   Entscheiden, bevor eine Zeile Code entsteht.
3. **"Jetzt synchronisieren"** (Menü) — der Partner will nicht 15 Minuten warten, um zu sehen,
   ob sein Eintrag angekommen ist. Billig zu bauen, spart die "das Sheet funktioniert nicht"-
   Anrufe.
4. **"Problem melden"** — Dialog mit Freitext → legt eine Aktivität in Pipedrive an, zuständig
   RP. Ersetzt Anrufe durch etwas Nachvollziehbares.
5. **"Kundenordner öffnen"** — braucht keinen Button, der Link steht in der Spalte. Weglassen.

### 5.3 Was RP wirklich vom Partner braucht

Drei Dinge: **Zählpunkt, Termin, Fertigmeldung.** Alles andere ist nice-to-have. Keine Spalte
bauen, die niemand auswertet — jede zusätzliche Spalte ist eine, die der Partner falsch
befüllen kann und die jemand pflegen muss.

Umgekehrt braucht der Partner von uns: Kundenname, Adresse, Kundenordner-Link, die geplanten
Termine, Materiallieferdatum. Kein Deal-Wert, keine Marge, keine anderen Kunden.

---

## 6. Der harte Blocker: API-Kontingent

`syncPipedriveToSheetFields()` macht **einen Pipedrive-Call pro Deal-Zeile pro Lauf**
(`FieldSync.gs`, Zeile 111 — `fetchPipedrive('deals/' + dealId)` in der Schleife).

Rechnung mit den heutigen 437 gewonnenen Deals:

```
437 Deals × 96 Läufe/Tag (alle 15 Min) = 41.952 UrlFetch-Calls/Tag
```

Das Apps-Script-Kontingent liegt bei **~20.000 Calls/Tag für ein Gratis-Konto** und
**~100.000 für Google Workspace**. Auf dem privaten Konto ist das also mehr als das Doppelte
des Erlaubten — der Sync würde jeden Tag um die Mittagszeit stillstehen, mit Fehlern, die wie
Pipedrive-Ausfälle aussehen. Und die Deal-Zahl wächst.

**Fix, klassisches N+1:** einmal `GET /deals?status=won&limit=100` paginiert holen (~5 Calls),
in eine Map nach Deal-ID legen, dann durch die Sheet-Zeilen laufen. Aus 41.952 werden ~480
Calls pro Tag — Faktor 87. `syncNeueZeilen()` macht es in `RowCreation.gs` schon richtig
(nutzt die Deals aus der Liste, kein Einzelabruf); `syncPipedriveToSheetFields()` muss
nachziehen.

Nebenbei ist das ein handfestes Argument für deinen Workspace-Pitch: der Faktor 5 beim
API-Kontingent ist neben dem Shared Drive der zweite Grund, und er ist rechenbar.

---

## 7. Was ich von dir brauche

1. **Sofort committen** (Abschnitt 0) — soll ich die Befehle ausführen?
2. **`sync-all-scripts.ps1` härten** (Guard, `.gitignore`, `-NoPause`) — soll ich das
   umschreiben? Ist eine lokale Datei, kein Apps Script, also kein Editor-Umweg nötig.
3. **Repo aus OneDrive rausziehen** — ja / später / egal?
4. **Terminvorschlag: Partner-Sheet oder Retool?** Blockiert Punkt 5.2.
5. **Dashboard: Library `RPLog` oder Copy-Paste in jedes Projekt?** Meine Empfehlung: Library.
6. **`setupDashboard()` schreiben?** Dann legst du das Sheet mit einem Klick selbst an.

Reihenfolge, die ich vorschlagen würde: 1 → 2 → 6 → `syncPipedriveToSheetFields()`-Fix
(Abschnitt 6) → Rest.
