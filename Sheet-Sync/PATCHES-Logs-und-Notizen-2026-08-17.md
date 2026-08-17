# Sheet-Sync — Patches: Logs & Notizen

Stand 2026-08-17. Umsetzung von `REVIEW-Logs-und-Notizen-2026-08-17.md`.
Teil 0 = was **du** machen musst. Teil 1–6 = Code, pro Datei und Fundstelle, zum Einsetzen
im Editor.

---

# Teil 0 — Was du selbst machen musst

## 0.1 In Pipedrive: vier Felder anlegen (Typ **Datum**)

Vorher einmal `listDealFieldsHelper()` laufen lassen — unter den 33 Fulfillment-Feldern vom
10.08. ist vielleicht schon etwas dabei. Nur anlegen, was fehlt. Danach die field_codes in
`Config.gs` eintragen.

| Konstante in `Config.gs` | Vorschlag Feldname | Wofür |
|---|---|---|
| `NETZSTATUS_UEBERGEBEN_AM_FIELD_KEY` | „Netz übergeben am" | Fristbeginn für beide Eskalationen |
| `NETZANMELDUNG_ESKALATION_GEMELDET_AM_FIELD_KEY` | „Eskalation Netzanmeldung am" | verhindert tägliche Wiederholung |
| `KUNDENTERMIN_ESKALATION_GEMELDET_AM_FIELD_KEY` | „Eskalation Kundentermin am" | dito |
| `TODO_WUNSCHTERMIN_FIELD_KEY` | „Wunschtermin Partner" | R6, Rückkanal Termin |

Ohne die ersten drei tut `NetzanmeldungEskalation.gs` gar nichts (steigt oben sauber aus).

## 0.2 In beiden Test-Sheets: Spalten anlegen

`COL` in `Config.gs` erwartet inzwischen deutlich mehr Spalten als die Dummy-Sheets haben.
Überschriften **exakt** so in Zeile 1 (ALE- und KOLLSTAR-Testsheet):

| Überschrift | Format | wer schreibt |
|---|---|---|
| `Adresse` | Text | Script (gesperrt) |
| `PLZ` | Text | Script (gesperrt) |
| `Telefon Kunde` | Text | Script (gesperrt) |
| `Anlagengröße (Module)` | Zahl | Script (gesperrt) |
| `Speicher (kWh)` | Zahl | Script (gesperrt) |
| `Fertigmeldung` | **Checkbox** | Partner |
| `Netzanmeldung eingereicht` | **Checkbox** | Partner |
| `IB erledigt` | **Checkbox** | Partner |
| `Wunschtermin Partner` | Datum | Partner |

Checkbox = *Daten → Datenvalidierung → Checkbox*. Nur so liefert `getValue()` echtes
`true`/`false`; eine getippte Zelle „x" läuft in den falschen Zweig.

## 0.3 Danach: `protectDealIdColumn()` erneut ausführen

Die Funktion schützt alles, was das Script schreibt (Deal-ID, Stufe-1-Felder, alle
`pipedrive_to_sheet`-Spalten). Sie überspringt Spalten, die es noch nicht gibt — also erst
0.2, dann das.

## 0.4 Eine Entscheidung: „Fertigmeldung" vs. „Montage abgeschlossen"

Siehe C3 im Review. Die Spalte heißt `Fertigmeldung`, der Kommentar in `OrdnerAbschluss.gs`
spricht von „Montage abgeschlossen", die Konstante heißt `MONTAGE_ABGESCHLOSSEN_AM_FIELD_KEY`,
das Pipedrive-Feld „Fertigmeldung am". Aktuell wandert der Ordner 7 Tage nach der
**Fertigmeldung** ins Archiv.

- **Ist das so gewollt?** → nur Konstante und Kommentare umbenennen.
- **Soll der Ordner nach der Montage wandern?** → zweite Checkbox-Spalte + zweites Datumsfeld.

Bitte einmal festlegen, bevor die Trigger scharf gehen.

## 0.5 Nach dem Einspielen der Patches

1. `DRY_RUN = true` lassen
2. `testZpnSchreiben()` / `testFertigmeldungSchreiben()` / `testNetzanmeldungSchreiben()` /
   `testIbErledigtSchreiben()` — an der Zelle muss jetzt eine 🧪-Notiz stehen
3. `syncPipedriveToSheetFields()` einmal manuell — im Log-Sheet muss **eine** Zeile mit
   `Aktion = lauf` stehen, mit Lauf-ID, Modus DRY und Zusammenfassung
4. Erst dann `DRY_RUN = false`, dann `installTriggers()`

⚠️ Beim ersten `getLogSheet()`-Aufruf nach dem Patch wird ein **neues** Log-Sheet
`LOG_Sheet-Sync (V2)` angelegt (neue Property, neue Spalten). Das alte bleibt unangetastet
erhalten — die URL des neuen steht im Ausführungsprotokoll.

---

# Teil 1 — `Config.gs`

## 1.1 Umkehr-Map für Netzstatus (B7)

Direkt **nach** `NETZSTATUS_OPTION_IDS` einfügen:

```js
// Für lesbare Logs: Options-ID -> Klartext. Ohne das steht im Log "Netzstatus -> 186".
const NETZSTATUS_ID_TO_LABEL = Object.fromEntries(
  Object.entries(NETZSTATUS_OPTION_IDS).map(([name, id]) => [id, name])
);
```

## 1.2 Aufräum-Frist für Notizen (A4)

Zu den anderen Wartefristen dazu (bei `ORDNER_VERSCHIEBEN_WARTETAGE`):

```js
// Nach so vielen Tagen werden Erfolgs-/Änderungs-Notizen im Partner-Sheet wieder entfernt,
// damit nicht jede Zelle dauerhaft ein Notiz-Eck trägt. Fehler-Notizen (⚠) bleiben IMMER
// stehen -- die sind ja das offene Problem. Siehe raeumeAlteNotizen() in SetupHelpers.gs.
const NOTIZ_AUFRAEUM_TAGE = 30;
```

## 1.3 Den kompletten `===== LOGGING =====`-Block ersetzen

Alles ab `// ===== LOGGING =====` bis zum Dateiende raus, dafür:

```js
// ===== LOGGING =====
// Gepuffert statt appendRow pro Zeile: ein appendRow ist ein einzelner Sheets-Schreibvorgang,
// und syncPipedriveToSheetFields() kann pro Lauf vierstellig viele Zeilen erzeugen (im DRY-Lauf
// jedes Mal aufs Neue, weil ja nichts geschrieben wird). Gepuffert ist es EIN setValues().

const LOG_HEADER = [
  'Zeitstempel', 'Lauf-ID', 'Funktion', 'Modus', 'Aktion',
  'Deal-ID', 'Partner/Sheet', 'Feld', 'Ergebnis', 'Detail'
];

// Neue Property (V2), weil das bestehende Log-Sheet die alte 7-Spalten-Kopfzeile hat.
// Das alte Sheet bleibt erhalten, es wird nur nicht mehr beschrieben.
const PROP_LOG_SHEET_ID = 'SHEETSYNC_LOG_SHEET_ID_V2';

let _logSheetCache = null;
let _logBuffer = [];
let _laufId = '-';
let _laufFunktion = '-';
let _laufStart = 0;

/**
 * Am Anfang JEDER Einstiegsfunktion aufrufen. Vergibt eine kurze Lauf-ID, die in jeder Zeile
 * dieses Laufs steht -- damit lässt sich aus einer FEHLER-Zeile heraus per Filter der komplette
 * Lauf ansehen. Nötig, weil fünf verschiedene Funktionen (zwei davon zeitgleich) in dasselbe
 * Log-Sheet schreiben.
 */
function starteLauf(funktionsName) {
  _laufId = Utilities.getUuid().slice(0, 8);
  _laufFunktion = funktionsName;
  _laufStart = Date.now();
  Logger.log(`[${_laufId}] ${funktionsName} gestartet (${DRY_RUN ? 'DRY' : 'LIVE'})`);
  return _laufId;
}

function getLogSheet() {
  if (_logSheetCache) return _logSheetCache;
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty(PROP_LOG_SHEET_ID);
  let ss = null;
  if (sheetId) {
    try { ss = SpreadsheetApp.openById(sheetId); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('LOG_Sheet-Sync (V2)');
    props.setProperty(PROP_LOG_SHEET_ID, ss.getId());
    ss.getActiveSheet().appendRow(LOG_HEADER);
    Logger.log(`Neues Log-Sheet angelegt: ${ss.getUrl()}`);
  }
  _logSheetCache = ss.getActiveSheet();
  return _logSheetCache;
}

/**
 * aktion: 'sheet→pipedrive' | 'pipedrive→sheet' | 'zeile anlegen' | 'drive' | 'aktivität' | 'lauf'
 * Bewusst NICHT mehr "Richtung": OrdnerAbschluss und NetzanmeldungEskalation schreiben gar nichts
 * ins Sheet, standen aber trotzdem auf 'pipedrive_to_sheet'.
 */
function logRow(aktion, dealId, partnerOderSheet, feld, ergebnis, detail) {
  _logBuffer.push([
    new Date(), _laufId, _laufFunktion, DRY_RUN ? 'DRY' : 'LIVE', aktion,
    dealId || '', partnerOderSheet || '', feld || '', ergebnis, detail || ''
  ]);
}

/**
 * Eine Zeile pro Lauf -- die einzige, die man täglich anschauen muss, und die spätere
 * Dashboard-Zeile. status: 'OK' | 'KETTE_BLOCKIERT' | 'FEHLER'
 */
function logLaufEnde(status, summary) {
  const dauer = Math.round((Date.now() - _laufStart) / 1000);
  logRow('lauf', null, null, null, status, `${JSON.stringify(summary)} -- ${dauer}s`);
  Logger.log(`[${_laufId}] ${_laufFunktion} ${status}: ${JSON.stringify(summary)} (${dauer}s)`);
}

function flushLog() {
  if (_logBuffer.length === 0) return;
  const sheet = getLogSheet();
  sheet.getRange(sheet.getLastRow() + 1, 1, _logBuffer.length, LOG_HEADER.length).setValues(_logBuffer);
  _logBuffer = [];
}

/** Werte für Notizen/Logs lesbar machen -- niemals "null" oder "undefined" an eine Zelle. */
function zeigeWert(w) {
  return (w === null || w === undefined || w === '') ? '(leer)' : String(w);
}

/** Einheitlicher Zeitstempel für alle Zell-Notizen. */
function notizZeitstempel() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm');
}
```

> Die Parameterzahl von `logRow()` bleibt gleich — alle bestehenden Aufrufe funktionieren
> weiter. Nur der erste Wert sollte in den Dateien angepasst werden (Teil 3–5).

---

# Teil 2 — `FieldSync.gs`, `handleSingleCellEdit()`

## 2.1 `dealId` außerhalb von `try` (B6)

`function handleSingleCellEdit(...) {` — die zwei ersten Zeilen ersetzen:

```js
function handleSingleCellEdit(sheet, row, col, dealIdCol, fieldConfig, dealCache) {
  const cell = sheet.getRange(row, col);
  let dealId = null;              // NEU: auch im catch verfügbar
  try {
    if (!dealIdCol) {
      throw new Error(`Spalte "${COL.dealId}" fehlt im Sheet "${sheet.getName()}" -- Sync nicht möglich.`);
    }
    dealId = sheet.getRange(row, dealIdCol).getValue();     // NEU: ohne const
```

## 2.2 Abhaken bei `checkbox_to_option` nicht schreiben (C2)

Den `else if (fieldConfig.valueType === 'checkbox_to_option')`-Block komplett ersetzen:

```js
    } else if (fieldConfig.valueType === 'checkbox_to_option') {
      // Haken ENTFERNT: bewusst NICHT nach Pipedrive schreiben. Das Zielfeld ("Fortschritt")
      // bildet eine ganze Stufenkette ab und wird auch manuell von RP gepflegt -- ein null
      // würde nicht diese eine Meldung zurücknehmen, sondern den kompletten Stand löschen.
      // Ein Häkchen ist eine Meldung ("ist passiert"), keine Zustandsspiegelung: man nimmt
      // sie nicht durch Wegklicken zurück.
      if (rohWert !== true) {
        cell.setNote(`↩ Haken entfernt am ${notizZeitstempel()}\n`
                   + `In Pipedrive wurde NICHTS geändert. Falls das ein Versehen war, bitte RP informieren.`);
        logRow('sheet→pipedrive', dealId, sheet.getName(), fieldConfig.label, 'Haken entfernt',
               'bewusst nicht nach Pipedrive geschrieben -- Zielfeld wird auch manuell gepflegt');
        return;
      }
      // checkedOptionValue ist ein TEXT-Label, keine Options-ID (field_type "autocomplete").
      neuerWert = fieldConfig.checkedOptionValue;
    } else {
```

## 2.3 DRY-RUN: Notiz setzen statt löschen (A4)

```js
    if (DRY_RUN) {
      logRow('sheet→pipedrive', dealId, sheet.getName(), fieldConfig.label, 'DRY-RUN', `würde "${zeigeWert(neuerWert)}" nach Pipedrive schreiben`);
      // Notiz SETZEN statt clearNote(): so sieht man beim Testen an der Zelle, dass der Trigger
      // überhaupt gefeuert hat -- und ein versehentlich eingeschalteter DRY_RUN löscht nicht
      // reihenweise echte Bestätigungs-Notizen.
      cell.setNote(`🧪 DRY-RUN (${notizZeitstempel()})\nwürde "${zeigeWert(neuerWert)}" an RP übermitteln -- noch NICHT geschrieben.`);
      return;
    }
```

## 2.4 Erfolgs-Notiz: kein „null" mehr (A2)

Den Block ab `// Erfolgs-Notiz mit Zeitstempel...` bis `cell.setNote(...)` ersetzen:

```js
    // Zwei Fälle unterscheiden: ein zurückgenommener Eintrag ist kein "✓".
    const zeitstempel = notizZeitstempel();
    cell.setNote(neuerWert === null
      ? `↩ Eintrag zurückgenommen am ${zeitstempel}\nvorher: ${zeigeWert(alterWert)} -> jetzt: (leer)`
      : `✓ An RP übermittelt am ${zeitstempel}\nvorher: ${zeigeWert(alterWert)} -> neu: ${zeigeWert(neuerWert)}`);
    cell.setBackground(null);   // eine frühere Fehler-Markierung wieder aufheben
```

## 2.5 Fehlerfall: Zeitstempel, Farbe, Deal-ID (A3 + A5 + B6)

Den kompletten `catch`-Block ersetzen:

```js
  } catch (err) {
    // An der Zelle nur eine Handlungsanweisung für den Montagepartner -- die technische Meldung
    // geht ausschließlich ins Log. Zeitstempel ist wichtig: sonst weiß er nicht, ob die Notiz
    // von heute ist oder seit drei Wochen dranhängt.
    cell.setNote(`⚠ NICHT übernommen (${notizZeitstempel()})\n`
               + `Dein Eintrag ist bei RP nicht angekommen. Bitte RP informieren.`);
    cell.setBackground('#f4c7c3');   // rot -- Notizen sieht man nur beim Hovern, Farbe beim Scrollen
    logRow('sheet→pipedrive', dealId, sheet.getName(), fieldConfig.label, 'FEHLER',
           `Zeile ${row}, Spalte ${col}: ${err.message}`);
    Logger.log(`FEHLER in handleSingleCellEdit (${sheet.getName()} Zeile ${row}): ${err.message}`);
  }
```

## 2.6 Zusatzfeld-Log mit Klartext (B7)

```js
    if (fieldConfig.zusaetzlichesFeldBeimAnhaken && neuerWert !== null) {
      const zusatz = fieldConfig.zusaetzlichesFeldBeimAnhaken;
      const lesbar = NETZSTATUS_ID_TO_LABEL[zusatz.wert] || zusatz.wert;
      logRow('sheet→pipedrive', dealId, sheet.getName(), fieldConfig.label, 'Zusatzfeld geschrieben',
             `${zusatz.fieldKey} -> ${lesbar}`);
    }
```

## 2.7 `handleSheetEdit()`: Lauf-ID + Flush

```js
function handleSheetEdit(e) {
  starteLauf('handleSheetEdit');
  try {
    const sheet = e.range.getSheet();
    // ... unveränderter Rumpf ...
  } finally {
    flushLog();
  }
}
```

---

# Teil 3 — `FieldSync.gs`, `syncPipedriveToSheetFields()`

Hier stecken **A1** (Notiz bei RP-Änderung) und **C1** (Gesamtbereich-Überschreiben) — beide
werden von derselben Änderung gelöst: nicht mehr den ganzen Block zurückschreiben, sondern nur
die Zellen, die sich wirklich geändert haben. Lesen bleibt gebündelt.

**Funktion ab `const anzahlZeilen = ...` bis zum `});`-Ende ersetzen:**

```js
    const anzahlZeilen = Math.max(sheet.getLastRow() - 1, 0);
    if (anzahlZeilen === 0) return;
    partnerVerarbeitet++;

    // LESEN bleibt gebündelt (ein getValues für alles).
    const werte = sheet.getRange(2, 1, anzahlZeilen, sheet.getLastColumn()).getValues();

    for (let i = 0; i < werte.length; i++) {
      const dealId = werte[i][dealIdCol - 1];
      if (!dealId) continue;
      const deal = dealMap[dealId];
      if (!deal) continue;
      const row = i + 2;
      const cf = deal.custom_fields || {};

      feldSpalten.forEach(({ fieldConfig, col }) => {
        const pipedriveWert = cf[fieldConfig.pipedriveFieldKey];
        if (pipedriveWert === undefined) return;
        const aktuellerWert = werte[i][col - 1];
        // String-Vergleich: Sheets liefert Number/Date, Pipedrive meist String.
        if (String(pipedriveWert) === String(aktuellerWert)) return;

        if (DRY_RUN) {
          logRow('pipedrive→sheet', dealId, partner, fieldConfig.label, 'DRY-RUN', `würde "${pipedriveWert}" ins Sheet schreiben`);
          summary.dryRun++;
          return;
        }

        // SCHREIBEN gezielt pro Zelle -- NICHT den ganzen Bereich mit setValues() zurück.
        // Zwischen getValues() und setValues() liegen bei ~440 Zeilen mehrere Sekunden; ein
        // Blockschreiben würde alles überschreiben, was der Partner in dieser Zeit eingetippt
        // hat, auch in seinen eigenen Spalten. Änderungen sind pro Lauf ohnehin selten.
        const zelle = sheet.getRange(row, col);
        zelle.setValue(pipedriveWert);
        // Notiz: sonst ändert sich z.B. der DC-Termin still, und der Monteur, der schon
        // disponiert hat, merkt es bestenfalls zufällig.
        zelle.setNote(`↻ Von RP geändert am ${notizZeitstempel()}\n`
                    + `vorher: ${zeigeWert(aktuellerWert)}\n`
                    + `neu:    ${zeigeWert(pipedriveWert)}`);
        zelle.setBackground('#fff2cc');   // gelb, wird von raeumeAlteNotizen() wieder entfernt
        summary.geschrieben++;
        logRow('pipedrive→sheet', dealId, partner, fieldConfig.label, 'geschrieben',
               `${zeigeWert(aktuellerWert)} -> ${pipedriveWert}`);
      });
    }
  });

  // Abschlusszeile -- bisher hatte diese Funktion als einzige gar keine. Ein Lauf, der nichts
  // getan hat, war von einem Lauf, der nicht stattfand, nicht unterscheidbar.
  const partnerGesamt = Object.keys(PARTNER_SHEET_CONFIG).length;
  const status = partnerVerarbeitet === 0 ? 'KETTE_BLOCKIERT' : 'OK';
  logLaufEnde(status, Object.assign({ partnerVerarbeitet, partnerGesamt }, summary));
}
```

**Dazu am Funktionsanfang** (direkt nach `function syncPipedriveToSheetFields() {`):

```js
  starteLauf('syncPipedriveToSheetFields');
  const summary = { geschrieben: 0, dryRun: 0 };
  let partnerVerarbeitet = 0;
```

und das `Object.keys(PARTNER_SHEET_CONFIG).forEach(...)` in ein
`try { ... } finally { flushLog(); }` einfassen.

Der frühe Ausstieg bei nicht konfigurierten Partnern bleibt still — aber `partnerVerarbeitet`
zeigt jetzt in der Abschlusszeile `2 von 5`, und bei `0` steht `KETTE_BLOCKIERT`.

---

# Teil 4 — `RowCreation.gs`

## 4.1 Cursor enkodieren (C5)

```js
    const path = `deals?status=won&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
```

## 4.2 Lauf-ID + Abschlusszeile

```js
function syncNeueZeilen() {
  starteLauf('syncNeueZeilen');
  let cursor = null;
  let processed = 0;
  const summary = { angelegt: 0, uebersprungen: 0, dryRun: 0 };

  try {
    do {
      // ... unverändert ...
    } while (cursor);
  } finally {
    logLaufEnde(summary.angelegt === 0 && summary.dryRun === 0 && processed > 0 ? 'KETTE_BLOCKIERT' : 'OK',
                Object.assign({ geprueft: processed }, summary));
    flushLog();
  }
}
```

`KETTE_BLOCKIERT` trifft hier genau den bekannten Fall „0 von 437 Zeilen, weil noch kein
Ordner-Link gesetzt ist" — der sah bisher aus wie ein sauberer Lauf.

## 4.3 Notiz an der neuen Zeile (A6.1)

Direkt vor `logRow(... 'angelegt' ...)` am Ende von `createSheetRowForDeal()`:

```js
  // Beantwortet ein für alle Mal "woher kommt diese Zeile" -- und macht sichtbar, dass sie
  // nicht von Hand eingetragen wurde (also auch nicht von Hand gelöscht werden sollte).
  if (nameCol) {
    sheet.getRange(newRow, nameCol).setNote(
      `Automatisch angelegt am ${notizZeitstempel()}\naus Pipedrive-Deal ${dealId}`);
  }
```

---

# Teil 5 — `OrdnerAbschluss.gs` & `NetzanmeldungEskalation.gs`

## 5.1 Aktion-Werte korrigieren (B2)

Beide Dateien loggen durchgehend mit `'pipedrive_to_sheet'`, schreiben aber nichts ins Sheet.

- `OrdnerAbschluss.gs`: alle `logRow('pipedrive_to_sheet', …)` → `logRow('drive', …)`
- `NetzanmeldungEskalation.gs`: → `logRow('aktivität', …)`

## 5.2 Partner mitloggen statt `null` (B2)

In beiden Dateien steht im Partner-Feld immer `null`, obwohl der Partner am Deal hängt:

```js
const partner = MONTAGEPARTNER_ID_TO_NAME[cf[MONTAGEPARTNER_FIELD_KEY]] || null;
// ... und dann statt null im logRow-Aufruf: partner
```

## 5.3 Lauf-ID, Abschlusszeile, Flush

Beide Hauptfunktionen (`verschiebeAbgeschlosseneOrdner`,
`ueberwacheNetzanmeldungUndKundentermin`) nach demselben Muster:

```js
function verschiebeAbgeschlosseneOrdner() {
  starteLauf('verschiebeAbgeschlosseneOrdner');
  // ... bestehender TODO-Ausstieg ...
  try {
    // ... bestehender Rumpf ...
  } finally {
    logLaufEnde(summary.fehler > 0 ? 'FEHLER' : 'OK', Object.assign({ geprueft }, summary));
    flushLog();
  }
}
```

## 5.4 Ordner-Archivierung im Sheet sichtbar machen (A6.2)

Nach erfolgreicher Verschiebung, im `else`-Zweig von `verschiebeAbgeschlosseneOrdner()`:

```js
        } else {
          logRow('drive', deal.id, partner, 'Ordner-Verschiebung', 'verschoben', `nach "${detail}"`);
          summary.verschoben++;
          setzeNotizAmDeal(deal, partner, COL.ordnerLink,
            `📁 Auftrag archiviert am ${notizZeitstempel()}\nOrdner liegt jetzt unter "${MONTAGE_ABGESCHLOSSEN_ORDNERNAME}". Der Link funktioniert weiter.`);
        }
```

## 5.5 Eskalation im Sheet sichtbar machen (A6.3) — der wertvollste Punkt

Heute erzeugt die Eskalation eine Aktivität für **RP**, aber kein Signal an den, der etwas tun
soll. Der Monteur erfährt es per Anruf — also genau das, was die Eskalation ersetzen sollte.

In `meldeEskalation()`, nach dem `patchPipedrive(...)`:

```js
  const partner = MONTAGEPARTNER_ID_TO_NAME[(deal.custom_fields || {})[MONTAGEPARTNER_FIELD_KEY]] || null;
  setzeNotizAmDeal(deal, partner, spalte,
    `⏳ ${logDetail}\nRP hat am ${notizZeitstempel()} nachgehakt.`);
  // spalte = COL.netzanmeldung bei der Netzanmeldung-Eskalation,
  //          COL.wunschtermin bei der Kundentermin-Eskalation
```

`meldeEskalation()` bekommt dafür einen zusätzlichen Parameter `spalte`, die beiden Aufrufer
geben `COL.netzanmeldung` bzw. `COL.wunschtermin` mit.

## 5.6 Gemeinsamer Helfer (in `Config.gs` ans Ende)

Beide Dateien arbeiten dealweise und haben kein Sheet zur Hand:

```js
/**
 * Setzt eine Notiz an einer bestimmten Spalte in der Sheet-Zeile eines Deals. Für Vorgänge, die
 * NICHT vom Sheet ausgehen (Ordner-Archivierung, Eskalation) -- der Partner soll trotzdem im
 * Sheet sehen, dass etwas passiert ist, statt es per Anruf zu erfahren. Schluckt Fehler bewusst:
 * eine fehlende Notiz darf den eigentlichen Vorgang nie scheitern lassen.
 */
function setzeNotizAmDeal(deal, partner, spaltenHeader, text) {
  if (DRY_RUN || !partner) return;
  try {
    const sheet = openPartnerSheet(partner);
    const dealIdCol = findColumnIndexByHeader(sheet, COL.dealId);
    const col = findColumnIndexByHeader(sheet, spaltenHeader);
    if (!dealIdCol || !col) return;
    const row = findRowByDealId(sheet, dealIdCol, deal.id);
    if (!row) return;
    sheet.getRange(row, col).setNote(text);
  } catch (e) {
    Logger.log(`Notiz für Deal ${deal.id} konnte nicht gesetzt werden: ${e.message}`);
  }
}
```

---

# Teil 6 — `SetupHelpers.gs`

## 6.1 Trigger entzerren (C4) + Notiz-Aufräumer

```js
  ScriptApp.newTrigger('verschiebeAbgeschlosseneOrdner').timeBased().everyDays(1).atHour(6).create();
  // 7 statt 6 Uhr: beide täglichen Läufe iterieren über alle gewonnenen Deals und loggen ins
  // selbe Sheet -- entzerrt sind auch die Log-Blöcke sauber getrennt.
  ScriptApp.newTrigger('ueberwacheNetzanmeldungUndKundentermin').timeBased().everyDays(1).atHour(7).create();
  ScriptApp.newTrigger('raeumeAlteNotizen').timeBased().everyDays(1).atHour(4).create();
```

## 6.2 `raeumeAlteNotizen()` (A4) — neue Funktion

```js
/**
 * Entfernt Erfolgs-/Änderungs-Notizen, die älter als NOTIZ_AUFRAEUM_TAGE sind, samt gelber
 * Markierung. Fehler-Notizen (⚠) bleiben IMMER stehen -- die sind das offene Problem, nicht
 * eine alte Bestätigung. Ohne das trägt nach ein paar Monaten jede Zelle ein Notiz-Eck und die
 * Notiz sagt nichts mehr aus.
 */
function raeumeAlteNotizen() {
  starteLauf('raeumeAlteNotizen');
  const grenze = new Date();
  grenze.setDate(grenze.getDate() - NOTIZ_AUFRAEUM_TAGE);
  const summary = { entfernt: 0, sheets: 0 };

  try {
    Object.keys(PARTNER_SHEET_CONFIG).forEach(partner => {
      let sheet;
      try { sheet = openPartnerSheet(partner); } catch (e) { return; }

      const anzahlZeilen = Math.max(sheet.getLastRow() - 1, 0);
      if (anzahlZeilen === 0) return;
      summary.sheets++;

      const range = sheet.getRange(2, 1, anzahlZeilen, sheet.getLastColumn());
      const notizen = range.getNotes();
      const farben = range.getBackgrounds();
      let geaendert = 0;

      for (let r = 0; r < notizen.length; r++) {
        for (let c = 0; c < notizen[r].length; c++) {
          const notiz = notizen[r][c];
          if (!notiz) continue;
          if (notiz.indexOf('⚠') === 0) continue;              // Fehler bleiben stehen
          const m = notiz.match(/(\d{2})\.(\d{2})\.(\d{4})/);  // dd.MM.yyyy aus dem Notiztext
          if (!m) continue;
          if (new Date(`${m[3]}-${m[2]}-${m[1]}`) >= grenze) continue;
          notizen[r][c] = '';
          farben[r][c] = '#ffffff';
          geaendert++;
        }
      }

      if (geaendert > 0 && !DRY_RUN) {
        range.setNotes(notizen);
        range.setBackgrounds(farben);
      }
      summary.entfernt += geaendert;
      logRow('pipedrive→sheet', null, partner, 'Notizen aufräumen',
             DRY_RUN ? 'DRY-RUN' : 'aufgeräumt', `${geaendert} Notizen älter als ${NOTIZ_AUFRAEUM_TAGE} Tage`);
    });
  } finally {
    logLaufEnde('OK', summary);
    flushLog();
  }
}
```

## 6.3 Die vier Testfunktionen

Bleiben unverändert — sie rufen `handleSingleCellEdit(..., {})` auf, und der Cache-Parameter
funktioniert weiter. Ein `starteLauf('testXY')` + `flushLog()` am Anfang bzw. Ende schadet
nicht, sonst landen Testzeilen mit Lauf-ID `-` im Log.

---

# Reihenfolge beim Einspielen

1. **Teil 1** (`Config.gs`) — muss zuerst, alles andere benutzt `starteLauf`, `zeigeWert`,
   `notizZeitstempel`, `flushLog`
2. **Teil 6.2** (`raeumeAlteNotizen`) — braucht `NOTIZ_AUFRAEUM_TAGE` aus 1.2
3. **Teil 2 + 3** (`FieldSync.gs`) — hier sitzen C1, C2 und A1, die drei wichtigsten
4. **Teil 4 + 5**
5. **Teil 6.1** (Trigger) — ganz zum Schluss, nach dem Test aus 0.5
