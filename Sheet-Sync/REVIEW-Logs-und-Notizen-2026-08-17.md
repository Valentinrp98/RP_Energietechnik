# Sheet-Sync — Review Logs & Zell-Notizen

Stand 2026-08-17. Gelesen: `Config.gs`, `FieldSync.gs`, `RowCreation.gs`, `SetupHelpers.gs`,
`OrdnerAbschluss.gs`, `NetzanmeldungEskalation.gs`.

Vorweg: die Punkte aus dem 13.08.-Review sind drin und gut gelöst — N+1 beseitigt (dealMap),
Spaltenindizes einmal aufgelöst, `getValues`/`setValues` statt Einzelzugriffen, dealCache gegen
Mehrfach-Abrufe, ZPN-`autocomplete`-Retry, Fehlertext an der Zelle vom Debug-Output getrennt,
Spaltenschutz auf alle `pipedrive_to_sheet`-Spalten erweitert. Der `checkbox_to_date` /
`checkbox_to_option`-Ansatz sitzt.

Was folgt, ist der nächste Layer: **Notizen** (Abschnitt A), **Logs** (B) und **Bugs, die mir
dabei aufgefallen sind** (C).

---

# A. Zell-Notizen

## 🔴 A1 — Die Gegenrichtung setzt gar keine Notiz. Das ist die eigentliche Lücke.

`handleSingleCellEdit()` setzt eine schöne Notiz, wenn der **Partner** etwas ändert.
`syncPipedriveToSheetFields()` überschreibt Zellen, wenn **RP** etwas ändert — und zwar
**komplett kommentarlos**:

```js
werte[i][col - 1] = pipedriveWert;
geaendert = true;
logRow('pipedrive_to_sheet', dealId, partner, fieldConfig.label, 'geschrieben', `neuer Wert: ${pipedriveWert}`);
```

Konkret: RP verschiebt den DC-Termin von Dienstag auf Freitag. Im Partner-Sheet steht plötzlich
Freitag. Der Monteur, der für Dienstag schon disponiert hat, merkt es im besten Fall beim
nächsten Draufschauen — und weiß nicht, ob er sich verlesen hat oder ob es geändert wurde.
Genau der Anruf, den wir loswerden wollen.

Der alte Wert liegt an der Stelle bereits vor (`aktuellerWert`), die Notiz kostet also fast nichts.

**Umsetzung — wichtig: nicht `setNotes()` über den ganzen Bereich**, das würde die
Erfolgs-Notizen in den ZPN-/Checkbox-Spalten löschen. Vorher lesen, punktuell ersetzen,
einmal zurückschreiben:

```js
const werte   = dataRange.getValues();
const notizen = dataRange.getNotes();     // NEU: bestehende Notizen mitlesen
let geaendert = false;

// ... in der Schleife, direkt nach werte[i][col - 1] = pipedriveWert;
const zeitstempel = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm');
notizen[i][col - 1] = `↻ Von RP geändert am ${zeitstempel}\n`
                    + `vorher: ${aktuellerWert === '' ? '(leer)' : aktuellerWert}\n`
                    + `neu:    ${pipedriveWert}`;

// ... am Ende:
if (geaendert) {
  dataRange.setValues(werte);
  dataRange.setNotes(notizen);
}
```

Dazu eine Farbmarkierung, weil eine Notiz nur beim Hovern sichtbar ist — siehe A5.

---

## 🔴 A2 — Beim Abhaken steht "neu: null" in der Notiz

```js
cell.setNote(`✓ An Pipedrive übermittelt am ${zeitstempel}\nvorher: ${alterWert ?? '(leer)'} -> neu: ${neuerWert}`);
```

Bei `checkbox_to_date` / `checkbox_to_option` ist `neuerWert` beim Entfernen des Hakens `null`.
Der Partner liest dann wörtlich:

> ✓ An Pipedrive übermittelt am 17.08.2026 11:45
> vorher: 2026-08-17 -> neu: null

`null` ist Programmierersprache und das `✓` ist irreführend, weil hier etwas **zurückgenommen**
wurde. Vorschlag: Werte für die Anzeige übersetzen und den Fall unterscheiden:

```js
const zeige = w => (w === null || w === undefined || w === '') ? '(leer)' : String(w);

const notiztext = neuerWert === null
  ? `↩ Eintrag zurückgenommen am ${zeitstempel}\nvorher: ${zeige(alterWert)} -> jetzt: (leer)`
  : `✓ An RP übermittelt am ${zeitstempel}\nvorher: ${zeige(alterWert)} -> neu: ${zeige(neuerWert)}`;
cell.setNote(notiztext);
```

---

## 🟡 A3 — Die Fehlernotiz hat keinen Zeitstempel

```js
cell.setNote('⚠ Konnte nicht an RP übermittelt werden. Bitte RP informieren.');
```

Richtig, dass der Debug-Text raus ist. Aber ohne Zeitstempel kann der Partner nicht erkennen,
ob die Notiz von heute ist oder seit drei Wochen dranhängt — und es fehlt die wichtigste
Information: **sein Eintrag ist nicht angekommen, der Wert in der Zelle gilt nicht.**

```js
const zeitstempel = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm');
cell.setNote(`⚠ NICHT übernommen (${zeitstempel})\n`
           + `Dein Eintrag ist bei RP nicht angekommen. Bitte RP informieren.`);
```

---

## 🟡 A4 — Notizen werden nie aufgeräumt

`✓`-Notizen bleiben für immer stehen. Nach ein paar Monaten hat jede Zelle in den
Partner-Spalten eine Notiz, das kleine schwarze Eck ist überall, und die Notiz sagt nichts
mehr aus als "irgendwann mal übermittelt".

Vorschlag: der tägliche Trigger räumt Erfolgs-Notizen älter als ~30 Tage weg (Fehler-Notizen
**nicht** — die sind ja gerade das offene Problem). Da im Text ein Datum steht, reicht ein
Regex über `getNotes()` und ein `setNotes()` pro Sheet.

Nebenwirkung, die dabei mitgelöst wird: `DRY_RUN` ruft heute `cell.clearNote()` auf. Wird
DRY_RUN mal wieder eingeschaltet, während produktive Notizen dranhängen, werden echte
Bestätigungen gelöscht, sobald jemand die Zelle anfasst. Besser: im DRY-Lauf die Notiz
**setzen** statt löschen — `🧪 DRY-RUN: würde "X" an RP übermitteln (nicht geschrieben)`.
Dann sieht man beim Testen an der Zelle, dass der Trigger überhaupt gefeuert hat.

---

## 🟡 A5 — Notiz allein reicht nicht, Farbe fehlt

Eine Notiz sieht man nur beim Hovern. Beim Scrollen durch 200 Zeilen sieht man sie nie.
Empfehlung, sparsam:

| Fall | Hintergrund |
|---|---|
| Fehler (nicht übermittelt) | hellrot — bleibt, bis es klappt |
| Von RP geändert (A1) | hellgelb — der einzige Fall, der Aufmerksamkeit braucht |
| Erfolg | **keine Farbe** |

Kein Dauergrün bei Erfolg: wenn alles grün ist, sagt grün nichts mehr. Das Gelb aus A1 kann
derselbe Aufräum-Lauf aus A4 nach ein paar Tagen wieder entfernen.

---

## ⚪ A6 — Drei Ereignisse, die der Partner heute gar nicht mitbekommt

1. **Zeile wurde automatisch angelegt** (`createSheetRowForDeal`) — eine Notiz an der
   Namenszelle (`Automatisch angelegt am … aus Pipedrive-Deal 7253`) beantwortet die Frage
   "woher kommt diese Zeile" ein für alle Mal.
2. **Ordner wurde archiviert** (`verschiebeAbgeschlosseneOrdner`) — der Link funktioniert
   weiter (Drive-Links sind ID-basiert), aber der Partner weiß nicht, dass der Auftrag
   abgeschlossen einsortiert wurde. Notiz an der Ordner-Link-Zelle.
3. **RP hat eskaliert** (`meldeEskalation`) — heute erfährt der Monteur davon nur per Anruf.
   Genau der Anruf, den die Eskalation ersetzen soll. Eine Notiz an der Checkbox
   `Netzanmeldung eingereicht`:
   `⏳ Seit 5 Tagen offen — RP hat am 17.08. nachgehakt` — und der Anruf entfällt.

Punkt 3 ist der wertvollste von den dreien: die Eskalation erzeugt aktuell eine Aktivität für
**RP**, aber kein Signal an den, der etwas tun soll.

---

# B. Logging

## 🔴 B1 — `logRow()` macht einen `appendRow()`-Call pro Zeile

```js
function logRow(...) { getLogSheet().appendRow([...]); }
```

`appendRow` ist ein einzelner Sheets-Schreibvorgang. Im **aktuellen DRY_RUN-Zustand** ist das
akut: `syncPipedriveToSheetFields()` loggt pro Zelle, die abweicht — und im DRY-Lauf wird ja
nichts geschrieben, also weichen beim **nächsten** Lauf dieselben Zellen wieder ab.

```
440 Zeilen × 4 pipedrive_to_sheet-Felder = bis zu 1760 appendRow-Calls pro Lauf
× 96 Läufe/Tag
```

Das reißt das 6-Minuten-Limit und macht das Log-Sheet in Tagen unbrauchbar. Die anderen
RP-Scripts haben das Muster schon:

```js
let _logBuffer = [];
function logRow(...) { _logBuffer.push([...]); }
function flushLog() {
  if (!_logBuffer.length) return;
  const sheet = getLogSheet();
  sheet.getRange(sheet.getLastRow() + 1, 1, _logBuffer.length, LOG_HEADER.length).setValues(_logBuffer);
  _logBuffer = [];
}
```
Jede Einstiegsfunktion bekommt ein `try { … } finally { flushLog(); }`.
Bei `handleSheetEdit` (meist 1–2 Zeilen) ist das egal, bei den vier Trigger-Funktionen nicht.

---

## 🔴 B2 — Die Spalte "Richtung" stimmt bei der Hälfte der Aufrufe nicht

Header: `Zeitstempel | Richtung | Deal-ID | Partner/Sheet | Feld | Ergebnis | Detail`

`OrdnerAbschluss.gs` und `NetzanmeldungEskalation.gs` loggen durchgehend mit
`richtung = 'pipedrive_to_sheet'`, obwohl sie **nichts ins Sheet schreiben** — der eine
verschiebt einen Drive-Ordner, der andere legt Pipedrive-Aktivitäten an. Wer später nach
`pipedrive_to_sheet` filtert, bekommt drei völlig verschiedene Vorgangsarten in einem Topf.

Vorschlag: Spalte umdeuten auf **`Aktion`** mit klaren Werten —
`sheet→pipedrive` · `pipedrive→sheet` · `zeile anlegen` · `drive` · `aktivität`.
Bei der Gelegenheit `partnerOderSheet` mitgeben: in beiden neuen Dateien steht dort immer
`null`, obwohl der Partner über `MONTAGEPARTNER_ID_TO_NAME[cf[MONTAGEPARTNER_FIELD_KEY]]`
direkt am Deal hängt.

---

## 🔴 B3 — Keine Lauf-ID, aber jetzt fünf Schreiber im selben Sheet

`syncNeueZeilen`, `syncPipedriveToSheetFields`, `verschiebeAbgeschlosseneOrdner`,
`ueberwacheNetzanmeldungUndKundentermin` und `handleSheetEdit` schreiben alle in dasselbe
Log-Sheet. Die beiden täglichen Trigger stehen sogar **beide auf 06:00** (siehe C1), ihre
Zeilen liegen also verschränkt untereinander.

Ohne Lauf-ID ist "welche Zeilen gehören zu diesem einen Lauf" nicht mehr beantwortbar.

```js
let _laufId = null;
function starteLauf(name) {
  _laufId = Utilities.getUuid().slice(0, 8);
  _laufStart = Date.now();
  return _laufId;
}
```
Zwei zusätzliche Spalten: **Lauf-ID** und **Funktion** (welcher Trigger). Kosten: nichts.
Nutzen: aus einer FEHLER-Zeile heraus per Filter sofort den kompletten Lauf sehen.

---

## 🟡 B4 — Die Zusammenfassungen landen nur im Ausführungsprotokoll

```js
Logger.log(`Fertig. ${geprueft} gewonnene Deals geprüft. ${JSON.stringify(summary)}`);
```

Steht in `syncNeueZeilen`, `verschiebeAbgeschlosseneOrdner` und
`ueberwacheNetzanmeldungUndKundentermin`. Das Ausführungsprotokoll hält ~7 Tage, und niemand
öffnet es freiwillig. Das ist aber genau die Zeile, die man täglich sehen will — und exakt die
Dashboard-Zeile aus `ARCHITEKTUR-2026-08-13.md`.

Eine `logLaufEnde(funktion, status, summary)`-Zeile ins Sheet (später zusätzlich ins Dashboard),
mit `Modus` = LIVE/DRY. Ohne die ist "der Trigger lief heute Nacht sauber" eine Vermutung.

---

## 🟡 B5 — `syncPipedriveToSheetFields()` hat gar keine Abschlussmeldung

Als einzige der vier Trigger-Funktionen loggt sie am Ende **nichts** — weder ins Sheet noch ins
Ausführungsprotokoll. Ein Lauf, der nichts getan hat, ist von einem Lauf, der gar nicht
stattgefunden hat, nicht unterscheidbar.

Dazu zwei stille Ausstiege im selben Code:
```js
try { sheet = openPartnerSheet(partner); } catch (err) { return; }   // 3 Partner: dauerhaft still
if (!dealIdCol) return;                                              // Spalte fehlt: still
if (feldSpalten.length === 0) return;                                // keine Spalte da: still
```
Drei von fünf Partnern stehen auf `TODO_` und werden bei **jedem** Lauf still übersprungen.
Das ist heute richtig, darf aber nicht unsichtbar sein — sonst merkt niemand, wenn ein
konfigurierter Partner wegen eines Tippfehlers im Tab-Namen plötzlich mit übersprungen wird.
Einmal pro Lauf eine Zeile: `2 von 5 Partnern verarbeitet, 3 nicht konfiguriert`.

Das ist der Fall, für den im Dashboard-Konzept `KETTE_BLOCKIERT` steht.

---

## 🟡 B6 — Die FEHLER-Zeile verliert die Deal-ID

```js
} catch (err) {
  logRow('sheet_to_pipedrive', null, sheet.getName(), fieldConfig.label, 'FEHLER', err.message);
```

`dealId` steht hart auf `null` — obwohl der Fehler in den meisten Fällen **nach** dem Auslesen
der Deal-ID auftritt (beim PATCH). Im Log steht dann "FEHLER beim Feld IB erledigt" ohne
jeden Hinweis, **welcher Deal** betroffen ist. Genau die Zeile, bei der man das am dringendsten
braucht.

`dealId` vor dem `try` deklarieren und im catch mitgeben — plus Zeile und Spalte:

```js
let dealId = null;
try { … } catch (err) {
  logRow('sheet→pipedrive', dealId, sheet.getName(), fieldConfig.label, 'FEHLER',
         `Zeile ${row}, Spalte ${col}: ${err.message}`);
}
```

---

## ⚪ B7 — Options-IDs im Log statt Klartext

```js
logRow(…, 'Zusatzfeld geschrieben', `Netzstatus -> ${fieldConfig.zusaetzlichesFeldBeimAnhaken.wert}`);
```
Im Sheet steht dann `Netzstatus -> 186`. Das kann niemand lesen, ohne in `Config.gs`
nachzuschlagen. Umkehr-Map bauen (wie `MONTAGEPARTNER_ID_TO_NAME`) und das Label mitloggen.
Der Text ist außerdem hart auf "Netzstatus" verdrahtet, obwohl das Konstrukt generisch ist.

---

## ⚪ B8 — Kein Aufräumen im Log-Sheet

Vier Trigger, davon zwei alle 15 Minuten. Mit B1 (nur Änderungen puffern) bleibt es lange
beherrschbar, aber eine Regel fehlt: ab ~20.000 Zeilen die ältesten in einen Monats-Tab
verschieben. Ein `deleteRows`-Aufruf am Lauf-Anfang.

---

# C. Bugs, die mir beim Lesen aufgefallen sind

## 🔴 C1 — `setValues()` über den Gesamtbereich kann Partner-Eingaben überschreiben

```js
const dataRange = sheet.getRange(2, 1, anzahlZeilen, lastCol);   // ALLE Spalten
const werte = dataRange.getValues();
…
if (geaendert) dataRange.setValues(werte);
```

Zwischen `getValues()` und `setValues()` liegen bei 440 Zeilen und einem Pipedrive-Durchlauf
mehrere Sekunden. Tippt der Partner in dieser Zeitspanne irgendwo im Blatt etwas ein — auch in
**seine eigenen** Spalten wie ZPN oder eine Checkbox — wird es beim Zurückschreiben mit dem
alten Stand überschrieben. Kommentarlos, alle 15 Minuten, den ganzen Tag.

Der Spaltenschutz hilft nicht: der schützt die RP-Spalten vor dem Partner, nicht die
Partner-Spalten vor uns.

**Fix:** nur zurückschreiben, was sich tatsächlich geändert hat, statt des ganzen Blocks —
entweder pro geänderter Zelle einzeln (bei wenigen Änderungen pro Lauf das Übliche), oder den
Schreibbereich auf die betroffenen Spalten einschränken. Die Leseoptimierung bleibt davon
unberührt.

---

## 🔴 C2 — Haken entfernen bei "IB erledigt" **löscht** das Fortschritt-Feld

```js
neuerWert = rohWert === true ? fieldConfig.checkedOptionValue : null;
```

Für `checkbox_to_date` ist `null` richtig (Datum wieder weg). Für `checkbox_to_option` ist es
etwas anderes: `Fortschritt` ist ein Feld, das **RP auch manuell pflegt** und das eine ganze
Stufenkette abbildet (Erstgespräch … Fertigmeldung). Entfernt der Partner den Haken
versehentlich, wird `Fortschritt` nicht auf den vorherigen Wert zurückgesetzt, sondern
**komplett geleert** — der gesamte Stand ist weg, und niemand weiß, was vorher drinstand.

Der Kommentar in `Config.gs` spricht bewusst von "kein Zurücksetzen" — das gilt aber nur für
`zusaetzlichesFeldBeimAnhaken`, nicht für das Hauptfeld.

**Vorschlag:** bei `checkbox_to_option` das Abhaken **nicht** nach Pipedrive schreiben, sondern
nur loggen und eine Notiz setzen:
`↩ Haken entfernt — der Fortschritt in Pipedrive wurde nicht geändert. Bei Bedarf RP informieren.`
Ein Häkchen ist eine Meldung ("ist passiert"), keine Zustandsspiegelung — und eine Meldung
nimmt man nicht durch Wegklicken zurück.

---

## 🟡 C3 — "Fertigmeldung" und "Montage abgeschlossen" werden vermischt

`OrdnerAbschluss.gs` schreibt im Kopfkommentar:
> *"sobald 'Montage abgeschlossen' im Sheet angehakt wurde"*

Die Spalte heißt aber `Fertigmeldung` (`COL.fertigmeldung`), das Pipedrive-Feld heißt
"Fertigmeldung am", und beim Anhaken wird zusätzlich `Netzstatus = "Fertigmeldung raus"` gesetzt.

Fachlich sind das zwei verschiedene Dinge: **Montage abgeschlossen** = der Monteur ist fertig.
**Fertigmeldung** = die Meldung an den Netzbetreiber ist raus. Zwischen beiden liegen in der
Regel Tage.

Aktuell wandert der Kundenordner also 7 Tage nach der *Fertigmeldung* ins Archiv, nicht 7 Tage
nach der Montage. Das kann so gewollt sein — dann gehören die Kommentare und die Konstante
`MONTAGE_ABGESCHLOSSEN_AM_FIELD_KEY` umbenannt. Ist es nicht gewollt, fehlt eine eigene Spalte.
**Bitte einmal entscheiden**, bevor es scharf geht — widersprüchliche Kommentare sind genau die
Fehlerklasse aus M1 im Montagepartner-Script.

---

## 🟡 C4 — Beide täglichen Trigger laufen um 06:00

```js
ScriptApp.newTrigger('verschiebeAbgeschlosseneOrdner').timeBased().everyDays(1).atHour(6).create();
ScriptApp.newTrigger('ueberwacheNetzanmeldungUndKundentermin').timeBased().everyDays(1).atHour(6).create();
```

Beide iterieren über alle gewonnenen Deals, beide loggen ins selbe Sheet, beide patchen
Pipedrive. Einen auf 7 Uhr legen — dann sind auch die Log-Blöcke sauber getrennt (bis B3 da ist,
ist das die einzige Trennung, die es gibt).

---

## 🟡 C5 — Cursor in `syncNeueZeilen()` nicht enkodiert

```js
const path = `deals?status=won&limit=100${cursor ? `&cursor=${cursor}` : ''}`;
```
`syncPipedriveToSheetFields`, `OrdnerAbschluss` und `NetzanmeldungEskalation` verwenden alle
`encodeURIComponent(cursor)`. Nur hier nicht. Enthält der Cursor je ein Sonderzeichen, bricht
die Pagination — und zwar so, dass einfach ein Teil der Deals fehlt, ohne Fehlermeldung.

---

## 🟡 C6 — Fortschritt und Netzstatus können auseinanderlaufen

`NetzanmeldungEskalation.gs` startet die Frist, wenn **eines von beiden** Feldern "übergeben"
sagt:
```js
if (!netzstatusUebergeben && !fortschrittNetzUebergeben && !hatStempel) return;
```
Beendet wird sie aber nur über **Netzstatus**:
```js
const netzanmeldungNochOffen = ![…eingereicht, …zaehlpunktDa, …fertigmeldungRaus].includes(cf[NETZSTATUS_FIELD_KEY]);
```
Setzt RP also den Fortschritt manuell auf "Zählpunkt da", ohne den Netzstatus mitzuziehen,
eskaliert das Script trotzdem — Valentin bekommt eine Aktivität für etwas längst Erledigtes.
Der Einstieg ist symmetrisch, der Ausstieg nicht. Entweder beide Felder überall prüfen, oder
festlegen, dass Netzstatus allein führend ist (dann auch beim Fristbeginn).

---

# Reihenfolge

1. **B1** (Log-Puffer) — verhindert, dass der erste scharfe Trigger-Tag ins Zeitlimit läuft
2. **C1** (Gesamtbereich-`setValues`) — der einzige Punkt, der stillschweigend Partnerdaten frisst
3. **C2** (Abhaken löscht Fortschritt) — Datenverlust in einem Feld, das RP manuell pflegt
4. **A1** (Notiz bei RP-Änderung) — der eigentliche Anlass dieses Reviews
5. **A2/A3** (Notiztexte) — zehn Minuten, direkt sichtbar für den Partner
6. **B3/B4/B6** (Lauf-ID, Abschlusszeile, Deal-ID im Fehler) — macht das Log auswertbar
7. **C3** entscheiden, **C4/C5** nebenbei
8. Rest (A4–A6, B2, B5, B7, B8)
