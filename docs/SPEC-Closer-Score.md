# SPEC — Closer-Score (Feedback-Loop für Presale/Closer)

**Stand:** 2026-09-16 · **Status:** gebaut, DRY_RUN · **Projekt:** `Closer-Score/`

Feldnamen und Options-IDs stammen aus `DUMP-dealFields-2026-09-15.md`. Bei Widerspruch gilt der Dump.

---

## 1. Zweck

Wer einen Deal ins Fulfillment übergibt, bekommt eine **Slack-DM mit Ampel und Punktzahl**, plus
einer Liste der Felder, die gefehlt haben. Rein informativ — es hängt nichts daran, keine
Eskalation, kein Reporting nach oben. Der Effekt ist Erziehung: man sieht schwarz auf weiß, was
man vergessen hat, in dem Moment, in dem man sich noch erinnert.

**Bewertet wird der Presale/Closer.** Das separate Feld „Setter" (`75df8ada…`) wird **nicht**
bewertet — der Setter füllt die Quali-Felder am Ersttermin, das ist ein anderer Score.

> ⚠️ **Korrektur 17.09.2026.** Hier stand „Bewertet wird der Deal-Besitzer (`owner_id`)".
> Das ist **widerlegt**: `diagnoseCloserFelder()` hat über alle 86 qualifizierten Deals nur zwei
> Felder gefunden, die überhaupt Menschen enthalten — und nur eines unterscheidet sie.
>
> | Feld | verschiedene Menschen | Verteilung |
> |---|---|---|
> | `owner_id` | 2 | Valentin 85×, Marco 1× |
> | `creator_user_id` | 5 | Marco 74×, André 8×, Manuel 2×, Sean 1×, Sergen 1× |
>
> Die Fulfillment-Übernahme hängt `owner_id` auf Valentin um. Das Script liest den Empfänger
> deshalb aus **`CLOSER_FELD`** in `Config.gs`, aktuell `creator_user_id`.

### Was daran noch offen ist

`creator_user_id` heißt in Pipedrive **„wer den Deal angelegt hat"**, nicht „wer verkauft hat".
Dass ein einzelner Mensch auf 74 von 86 Deals kommt, sieht nach einem Anlage-Account aus, nicht
nach einer Verkaufsverteilung — und die seit 08.09. neuen Closer tauchen gar nicht auf.
Das Feld ist damit die **beste verfügbare Näherung, nicht die Wahrheit**. Bevor scharf
geschaltet wird, gehört an zwei, drei bekannten Deals geprüft, ob der dort genannte Mensch
wirklich der Verkäufer war. Wenn nicht, steht der Closer nicht am Deal und braucht ein eigenes
Feld.

---

## 2. Torwächter: wann wird überhaupt bewertet?

Drei Bedingungen, alle drei müssen erfüllt sein:

| # | Bedingung | Technisch | Warum |
|---|---|---|---|
| 1 | Deal ist im Fulfillment | `pipeline_id === 2` | Die Automatisierung verschiebt den Deal **nur dann**, wenn er korrekt eingetragen ist. Das Ankommen in Pipeline 2 ist damit selbst schon der Beweis. |
| 2 | sevdesk-Kunde stimmt | `Verkaufte_Artikel_Summary` (`a38455087829e67f22cb5217a44c3cf31f39bcbc`) ist befüllt | Dieses Feld schreibt **ausschließlich** der sevdesk→Pipedrive-Sync, und nur, wenn er über Angebots- oder Kundennummer einen Auftrag gefunden hat. Befüllt heißt: Angebot auf sevdesk angenommen **und** Kunden-ID im Deal passt. |
| 3 | Reifezeit vorbei | ≥ 48 h seit Erst-Sichtung durch dieses Script | Fotos und Notizen werden oft am Tag danach nachgereicht. Sofort messen erzeugt ungerechte Rotmeldungen. |

> **Warum nicht `status: "won"`?** Weil der bei RP schon **bei der Anlage** gesetzt wird
> (Origin Marketplace/Zapier, Befund D20 in `REFERENZ-Pipedrive-AppsScript.md`). `won` und
> `won_time` tragen deshalb kein Signal und dürfen nicht filtern. Ebenso wenig die
> Files-API — `files_count` sagt nur „irgendeine Datei hängt dran", nicht welche.

### Reifezeit und Zustand

Das Script hält in einer ScriptProperty einen kleinen Zustand pro Deal:

```
{ "7253": { "f": 1758000000000, "s": 1758172800000 } }
   Deal-ID     f = erstmals qualifiziert gesehen (ms)
               s = DM gesendet (ms), fehlt solange nicht gesendet
```

- Ein Deal, der Torwächter 1+2 erfüllt und noch nicht im Zustand steht, wird mit `f = jetzt`
  eingetragen — **ohne** DM.
- Beim nächsten Lauf, bei dem `jetzt - f ≥ 48 h`, wird gescored und die DM geht raus, `s` gesetzt.
- Deals, die nicht mehr in Pipeline 2 liegen, fallen aus dem Zustand. Damit bleibt er auf
  Pipeline-Größe begrenzt (~60 Einträge, weit unter dem 9-KB-Limit einer ScriptProperty).

### Erstinbetriebnahme

**Der erste Lauf mit leerem Zustand seedet sich selbst.** Alles, was dann schon in der Pipeline
liegt, wird stumm als „bereits gemeldet" eingetragen — ohne DM. Das ist Bestand: Deals, bei denen
48 h später niemand mehr etwas nachträgt. Ohne diese Regel fiele zwei Tage nach dem
Scharfschalten eine Welle von ~86 DMs auf einmal an.

`seedeBestandOhneDM()` macht dasselbe von Hand und bleibt als Werkzeug drin, ist aber für den
normalen Start nicht mehr nötig.

> Nebenwirkung, bewusst in Kauf genommen: geht die ScriptProperty verloren, gilt der laufende
> Bestand wieder als erledigt und bekommt keine DM mehr. Der sichere Fehlerfall — lieber eine
> DM zu wenig als 86 zu viel.

## 3. Die Bewertung

### 3.1 Punkte

| Item | Gruppe | field_code | Typ | Punkte |
|---|---|---|---|---|
| Neuanlage oder Erweiterung | Dach & Anlage | `8bc19dfdb1f3135f1babe069f2f9bfba1b347c40` | enum | 3 |
| Ausführungsart | Dach & Anlage | `cc80ad5daf0788dba60b3da3931681edd3dd2c87` | enum | 3 |
| Ausrichtung | Dach & Anlage | `7ba65cad11182422467e4923292422b601f6da80` | set | 3 |
| Dachform | Dach & Anlage | `71ee37fc98c338877d435f4d77f409367c013451` | enum | 3 |
| Eindeckung des Daches | Dach & Anlage | `2e8cc4c7d0592a418a58394a470e3386d125654a` | enum | 3 |
| Förderstatus | Förderung & Finanzierung | `fe61797bd9d9e4990a2f5735b8c4de1919c7fa11` | enum | 3 |
| Finanzierung gewünscht? | Förderung & Finanzierung | `8be8531405aa97034d8774d994903acca30f62af` | enum | 3 |
| **→ nur wenn "Ja" (305):** F-Rate / F-Laufzeit / F-Anzahlung | Förderung & Finanzierung | `ee906b75…` / `f3f7304a…` / `58772eeb…` | double/varchar/double | 0–3 (je 1) |
| Besondere Wünsche / Must knows | Unterlagen & Notizen | `896c816c7fa5ee755c279a9d4f8617e6ee48861a` | text | 2 |
| Projektdoku-Notizen | Unterlagen & Notizen | `2565f8005e57f0b6bad0a36560f9f3213beffe98` | text | 2 |
| Kunden-Dokumente/Fotos Checkliste | Unterlagen & Notizen | `36e7b14b2dff4ad584f875a4a5892ea0821e5f0d` | set | 0–3 (je 1) |

Die Gruppe steht als `gruppe:` an jedem Eintrag in `SCORE_FELDER` (`Config.gs`) und steuert nur
die Gliederung der Slack-DM, nicht die Punkte. Summen je Gruppe: **Dach & Anlage 15** ·
**Förderung & Finanzierung 6** (9 mit Details) · **Unterlagen & Notizen 7**.

**Maximum: 31 Punkte mit Finanzierung, 28 ohne.**

> ⚠️ **Korrektur 16.09.2026.** Hier stand vorher „28 mit Finanzierung, 25 ohne“ — das war
> falsch, die Checkliste war in der Summe vergessen. Der DRY-Vollauf hat es aufgedeckt
> („16 von 31“ im Log). Der **Code hat immer richtig gerechnet**, nur dieser Text war falsch.
> Rechenweg: 7 Felder à 3 = 21, + Must-knows 2 + Projektnotizen 2 = 25, + Checkliste max 3
> = **28 ohne Finanzierung**, + F-Details 3 = **31 mit**.

### 3.2 Die bedingte Finanzierung

Steht in „Finanzierung gewünscht?" **Nein (304)** oder **nur als Vergleich (306)**, entfallen die
drei Detailfelder komplett — sie zählen weder als erreicht noch als möglich. Das Maximum sinkt
von 31 auf 28. Nur bei **Ja (305)** werden sie verlangt.

> `F-Laufzeit` ist `varchar`, nicht `double`. Laut Closing-Cheatsheet gehört dort **„0"** hinein,
> wenn nichts besprochen wurde. Leer ≠ „0" — das Script unterscheidet die beiden, „0" zählt als
> ausgefüllt.

### 3.3 Die Checkliste

Gezählt werden nur drei der vier Optionen:

| Option | ID | zählt? |
|---|---|---|
| Stromrechnung(Zählpunkt) | 307 | ✅ |
| Dachfotos | 308 | ✅ |
| Zählerkasten | 309 | ✅ |
| Sonstiges | 310 | ❌ |

3 von 3 = 3 Punkte, 2 = 2, 1 = 1, 0 = 0.

Bewertet wird **der Haken, nicht die Datei**. Ob wirklich ein Dachfoto hochgeladen wurde, prüft
das Script nicht — das wäre Bildklassifikation und ein eigenes Projekt. Der Haken ist die
Selbstauskunft, und genau die soll erzogen werden.

### 3.4 Nur Dach 1

Bewertet werden ausschließlich die Dach-1-Felder. Die `2_`- und `3_`-Felder (Mehrfach-Dach, live
seit 27.08.) bleiben außen vor: es gibt kein Feld „Anzahl Dächer", also wäre bei jedem
Ein-Dach-Deal — also fast allen — Dach 2 und 3 leer und der Score dauerhaft rot.

### 3.5 Ampel

Die Schwellen sind **prozentual**, damit ein Deal ohne Finanzierung (Max 28) nicht härter
bewertet wird als einer mit (Max 31):

| Ampel | Anteil vom jeweiligen Maximum | bei Max 28 (ohne Finanzierung) | bei Max 31 (mit) |
|---|---|---|---|
| 🟢 | ≥ 89,3 % (25/28) | ≥ 25 | ≥ 28 |
| 🟡 | ≥ 67,9 % (19/28) | 19–24 | 22–27 |
| 🔴 | darunter | < 19 | < 22 |

Die Anteile sind so gewählt, dass sie beim Standardfall „ohne Finanzierung“ (Max 28) genau die
besprochenen Grenzen **25 (grün)** und **19 (gelb)** treffen.

> ⚠️ **Korrektur 16.09.2026.** Die Tabelle stand vorher auf den falschen Maxima 28/25.
> Die **Anteile im Code sind unverändert** (`AMPEL_GRUEN_ANTEIL = 25/28`,
> `AMPEL_GELB_ANTEIL = 19/28`) — nur ihre Wirkung auf die Finanzierungs-Deals war hier nie
> ausgerechnet. Praktische Folge: ein Deal **mit** Finanzierung braucht 28 von 31 für Grün.
> Ob das so bleiben soll, ist eine offene Entscheidung.

---

## 4. Die Slack-DM

Eine DM an den Closer, Text auf Deutsch, gegliedert in **drei Themen**. Gezeigt werden nur die
Themen mit Lücken, jeweils mit eigenem Punktestand; vollständige Themen kosten eine Zeile:

```
🟡 Projektübergabe Musterfrau Anna — 21 von 28 Punkten

Danke fürs Übergeben! Das fehlt noch:

*Dach & Anlage*  ·  12 von 15 Punkten
• Dachform

*Unterlagen & Notizen*  ·  4 von 7 Punkten
• Projektdoku-Notizen
• Kunden-Dokumente/Fotos Checkliste — Zählerkasten fehlt

✅ Komplett: Förderung & Finanzierung

Deal: https://rpenergietechnik.pipedrive.com/deal/7253
Rein informativ — es hängt nichts daran. Beim nächsten gleich mitnehmen.
```

Warum gruppiert: bei einem schwachen Deal standen vorher bis zu zehn Stichpunkte flach
untereinander — der Closer sah eine Wand statt einer Aufgabe. Drei Blöcke mit je einem
Punktestand zeigen sofort, **wo** er nachlegen muss. Das Lob für vollständige Themen bleibt
drin, verstellt aber als einzelne Zeile nicht den Blick auf die Lücken.

Ist gar nichts offen, entfällt die ganze Gliederung und es steht nur ein Dank da.

> Früher (bis 21.09.2026) war das eine einzige flache Liste `- <Label> (n Punkte)`.
> Die Punktzahl je Einzelfeld ist bewusst entfallen: sie hat zum Rechnen eingeladen statt
> zum Nachtragen. Die Zahl steht jetzt nur noch pro Thema und in der Kopfzeile.

**DM-Technik:** die **User-ID (`U…`) direkt als `channel`** übergeben. Kein `conversations.open`,
kein Zusatz-Scope — `chat:write` reicht. Slack antwortet auch bei Fehlern mit HTTP 200, der Erfolg
steht in `json.ok`. (Muster aus `Lieferkalender-Slack/Config.gs`, Bot „Ernst".)

### Betriebsmodus und Freigabe

`BETRIEBSMODUS` in `Config.gs` — löst den früheren Schalter `TEST_ALLES_AN_MICH` ab (22.09.2026):

| Modus | Was passiert |
|---|---|
| `'test'` | Jede DM geht an Valentin, fertig. Erreicht nie einen Closer. |
| `'freigabe'` | **Der laufende Modus.** Valentin bekommt die Nachricht zuerst als Vorlage. ✅ schickt sie an den Closer, ❌ verwirft sie, keine Reaktion = nichts passiert. |
| `'direkt'` | Sofort an den Closer. |

**So läuft die Freigabe:**

1. Der Tageslauf scored einen fälligen Deal und schickt die fertige Nachricht als Vorlage an
   Valentin — mit Kopfzeile „so ginge das an \<Name\>" und der Fußzeile, was die Reaktionen tun.
2. Slack liefert dabei `channel` und `ts` zurück. **Beides wandert in den Zustand** — ohne sie
   findet man die Reaktion später nicht wieder. Wichtig: `reactions.get` will die
   **DM-Channel-ID (`D…`)** aus der Sende-Antwort, nicht die User-ID.
3. `pruefeFreigaben()` läuft alle 15 Minuten und entscheidet je Vorlage.

Zustandseintrag: `{ f: <erstSichtung>, v: <ts der Vorlage>, c: <channel>, p: <Punkte der Vorlage>, s: <gesendet> }`.
Sobald entschieden ist, schrumpft er wieder auf `{f, s}` — nur offene Vorlagen tragen die
zwei Zusatzfelder, damit die ScriptProperty nicht zuläuft.

**Reaktionen** (`FREIGABE_JA` / `FREIGABE_NEIN` in `Config.gs`): ✅ ✔️ ☑️ 👍 👌 heißen ja,
❌ 👎 ⛔ 🚫 🗑️ heißen nein. Liegt beides drauf, gewinnt das Nein — im Zweifel nicht verschicken.

> ⚠️ Geprüft wird **nur der Emoji-Name, nicht wer reagiert hat.** Laut Slack-Doku enthält das
> `users`-Array einer Reaktion immer den authentifizierten User (hier: den Bot) und nicht
> zwingend alle anderen — eine Absenderprüfung wäre also unzuverlässig. In einer 1:1-DM mit dem
> Bot kann ohnehin nur Valentin reagieren.

**Frist:** Ohne Reaktion verfällt eine Vorlage nach 7 Tagen (`FREIGABE_FRIST_MS`) still. Eine
Rückmeldung, die zwei Wochen später beim Closer aufschlägt, erzieht niemanden mehr.

**Kopie an Valentin** (`KOPIE_AN_VALENTIN = true`): Sobald eine Nachricht wirklich beim
Closer landet, kommt eine Bestätigung `✅ Raus an \<Name\> (Datum Uhrzeit)` — im Freigabe-Modus
als **Antwort im Thread der Vorlage**, damit sie direkt unter dem hängt, was freigegeben wurde.
Der Wortlaut wird dabei *nicht* wiederholt, er steht eine Nachricht weiter oben. Ausnahme: hat
sich der Score zwischen Vorlage und Freigabe geändert (der Closer hat nachgetragen), hängt die
tatsächlich verschickte Fassung mit dran — dafür steht die Punktzahl der Vorlage als `p` im
Zustandseintrag. Im Modus `'direkt'` gibt es keine Vorlage, dort kommt die Kopie als eigene DM
`📨 Ging raus an \<Name\>` samt vollem Text. Scheitert die Kopie, bleibt die Zustellung an den
Closer trotzdem gültig — sie ist ja schon draußen.

**Beim Freigeben wird neu gescored**, statt die alte Nachricht aufzuheben: was der Closer
zwischenzeitlich nachgetragen hat, soll ihm zugutekommen.

**Scope:** `reactions.get` braucht `reactions:read` am Bot-Token — zusätzlich zu `chat:write`.
Fehlt er, nennt der Fehlertext von `fetchSlackJson()` benötigten und vorhandenen Scope.

**Warum Abfrage statt Slack-Event:** `reaction_added` als Event bräuchte einen öffentlich
erreichbaren Endpunkt. Apps Script antwortet auf jeden Aufruf zuerst mit HTTP 302, was Slack als
Fehlschlag wertet — dasselbe Problem, das bei den Pipedrive-Webhooks einen Cloudflare-Worker als
Relay nötig machte. Für eine Freigabe, die auch eine Viertelstunde später noch richtig ist,
lohnt der Aufwand nicht.

### Closer → Slack-Mapping### Closer → Slack-Mapping

Hart hinterlegte Tabelle in `Config.gs` (`CLOSER_SLACK_IDS`: Pipedrive-User-ID → Slack-User-ID).
Bewusst keine Auflösung über `users:read.email` — das wäre ein zusätzlicher Scope für eine
Handvoll Leute.

**Noch leer.** Zum Befüllen:
1. `listePipedriveUser()` im Script laufen lassen → loggt ID, Name, E-Mail aller Pipedrive-User.
2. Slack-User-IDs dazu holen (Slack-Profil → „Mitglieds-ID kopieren").

Ein Closer ohne Eintrag bekommt keine DM ins Leere: die Nachricht geht mit einem Hinweis an
Valentin (`U0BM9J0KPQT`), damit nichts still verschwindet.

---

## 5. Betrieb

| | |
|---|---|
| Projekt | `RP-Google-Scripts/Closer-Score/` |
| Trigger | täglich, 1× (Vorschlag 09:00) — `installiereTrigger()` (legt beide Trigger an: Tageslauf 09:00 + Freigabe-Prüfung alle 15 Min) |
| Schreibt nach Pipedrive | **nie.** Ausschließlich GET. |
| Schreibt nach Slack | ja, das ist die einzige Schreiboperation überhaupt |
| ScriptProperties | `PIPEDRIVE_API_TOKEN`, `SLACK_BOT_TOKEN`, `CLOSER_SCORE_STATE` (vom Script selbst) |
| DRY_RUN | `true` bis zum ersten sauberen Vollauf |

**Inbetriebnahme in dieser Reihenfolge:**
1. Tokens in die ScriptProperties (`setupTokens()` hilft beim Prüfen).
2. `CLOSER_SLACK_IDS` in `Config.gs` befüllen.
3. `testeLauf()` bei `DRY_RUN = true` — zeigt für jeden qualifizierten Deal Score, Ampel,
   Mängelliste und die DM im Wortlaut, verschickt nichts.
4. `seedeBestandOhneDM()` einmalig.
5. `DRY_RUN = false`, `installiereTrigger()` (legt beide Trigger an: Tageslauf 09:00 + Freigabe-Prüfung alle 15 Min).

---

## 6. Bewusst nicht gebaut

- **Kein sevdesk-API-Call.** `Verkaufte_Artikel_Summary` beweist dasselbe und kostet nichts.
- **Keine Bildprüfung.** Siehe 3.3.
- **Kein Sammel-Report, keine Rangliste.** Valentins Vorgabe: rein informativ, an den Einzelnen.
- **Keine Bewertung der Setter-Quali-Felder.** Anderer Score, andere Person.
