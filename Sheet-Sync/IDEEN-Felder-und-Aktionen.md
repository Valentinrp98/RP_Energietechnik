# Partner-Sheets — Feld- und Aktions-Ideen

Stand 2026-08-13. Sammlung, nichts davon gebaut. Ergänzung zu
`ARCHITEKTUR-2026-08-13.md` (Abschnitt 5) und `FIXES-2026-08-13.md` (S3/S4).

Heutiger Spaltenstand laut `Config.gs`:
`Kunden | Zählpunkt | DC Termin | AC Termin | Materiallieferung | IB Termin | Link zum Kundenordner | Deal-ID`

---

## 1. Das Grundmuster: geplant ≠ erledigt

Der wichtigste Gedanke zuerst, weil er die halbe Liste unten erzeugt.

Heute ist "IB Termin" **eine** Spalte, Richtung `pipedrive_to_sheet`. Damit lässt sich genau
eine Frage beantworten: *wann ist es geplant?* Nicht beantwortbar: *ist es passiert?*
Genau deshalb kommt der Anruf.

**Regel: jeder Meilenstein bekommt zwei Spalten.**

| geplant (RP → Sheet, gesperrt) | erledigt (Sheet → Pipedrive, Partner hakt ab) |
|---|---|
| DC Termin | DC erledigt ☑ |
| AC Termin | AC erledigt ☑ |
| Materiallieferung | Material erhalten ☑ |
| IB Termin | IB erledigt ☑ |

Das löst gleichzeitig S3 (Partner darf nicht in die geplanten Termine schreiben) und gibt ihm
trotzdem einen Kanal. Und es macht die Frage "wo hängt ein Auftrag" ohne Nachfrage beantwortbar:
geplanter Termin liegt in der Vergangenheit, Häkchen fehlt → das ist der Auftrag, um den man
sich kümmern muss.

### Häkchen ja — aber in Pipedrive ein **Datum** speichern, kein true/false

Deine Frage war "in Sheets ein true/false → Pipedrive". Im Sheet ja, Checkbox ist für den
Partner das Einfachste. Auf der Pipedrive-Seite würde ich **nicht** ein Ja/Nein-Feld anlegen,
sondern ein Datumsfeld `IB erledigt am`:

```js
// beim Haken setzen:
custom_fields: { [IB_ERLEDIGT_AM]: new Date().toISOString().slice(0,10) }
// beim Haken entfernen:
custom_fields: { [IB_ERLEDIGT_AM]: null }
```

Gründe:
- Ein `true` beantwortet nur *ob*. Ein Datum beantwortet *ob* **und** *wann* — und *wann* ist
  das, was man später für Abrechnung, Gewährleistungsfristen und Durchlaufzeit-Auswertungen
  braucht.
- Aus einem Datum lässt sich das Häkchen jederzeit wieder herstellen, umgekehrt nicht.
- Pipedrive hat ohnehin keinen echten Boolean-Typ — man müsste ein Einfachauswahl-Feld mit
  "Ja"/"Nein" bauen und wäre wieder bei hartcodierten Option-IDs, also bei der Fehlerklasse,
  die uns bisher am meisten gekostet hat.

Im Sheet bleibt die Checkbox. Optional daneben eine schmale, gesperrte Spalte "erledigt am",
die das zurückgespielte Datum zeigt — dann sieht der Partner, dass es angekommen ist, ohne
über die Zell-Notiz zu hovern.

**Technisch:** Checkbox über *Daten → Datenvalidierung → Checkbox* anlegen.
`cell.getValue()` liefert dann echtes `true`/`false`, und der installierbare `onEdit`-Trigger
feuert beim Klick. Kein Sonderfall im bestehenden `handleSingleCellEdit()` nötig, nur ein
Typ-Zweig in der Feld-Config (`valueType: 'checkbox_to_date'`).

---

## 2. Was heute fehlt und sofort weh tut

Vor allen Ausbaustufen: **der Partner bekommt aktuell nur den Kundennamen.**
Keine Adresse, keine Telefonnummer. Er kann mit dem Sheet allein nirgends hinfahren und
niemanden erreichen — das läuft heute zwangsläufig über Anrufe und WhatsApp, und genau die
wollen wir loswerden.

| Spalte | Richtung | Quelle in Pipedrive | Warum |
|---|---|---|---|
| **Adresse** | RP → Sheet (gesperrt) | Person, `ADRESSE_FIELD_KEY` | ohne die ist das Sheet nicht arbeitsfähig |
| **PLZ / Ort** | RP → Sheet (gesperrt) | Person, `PLZ_FIELD_KEY` | Routenplanung, Tagesbündelung |
| **Telefon Kunde** | RP → Sheet (gesperrt) | Person, `phones[0]` | Terminabstimmung vor Ort |
| **Anlagengröße (kWp / Module)** | RP → Sheet (gesperrt) | Deal (aus sevdesk-Sync) | bestimmt Aufwand und Teamgröße |
| **Speicher (kWh)** | RP → Sheet (gesperrt) | Deal (aus sevdesk-Sync) | ob ein Speicher mitkommt, ändert den Termin |

Die letzten beiden befüllt der sevdesk-Sync bereits in Pipedrive — die Feldcodes stehen in
`Sevdesk-Pipdrive_sync/fieldkeysandmapping.js`, es wäre also nur ein Eintrag in
`SYNC_FIELD_CONFIG`.

⚠️ Grenze: **kein Deal-Wert, keine Handelsspanne, keine anderen Kunden.** Ein Sheet pro Partner,
nie ein gemeinsames mit Filter — ein Filter ist kein Zugriffsschutz.

---

## 3. Rückkanal Partner → Pipedrive

Nach Nutzen sortiert.

| # | Spalte | Typ | Pipedrive | Was es auslöst |
|---|---|---|---|---|
| R1 | **Montage abgeschlossen** ☑ | Checkbox → Datum | `Montage abgeschlossen am` | Drive-Ordner von "Montage offen" nach "Montage abgeschlossen" verschieben; optional Stage-Wechsel |
| R2 | **IB erledigt** ☑ | Checkbox → Datum | `IB erledigt am` | löst die Fertigmeldung beim Netzbetreiber aus (heute manuell nachgefragt) |
| R3 | **DC erledigt / AC erledigt** ☑ | Checkbox → Datum | je ein Datumsfeld | Fortschritt sichtbar ohne Anruf |
| R4 | **Material erhalten** ☑ | Checkbox → Datum | `Material erhalten am` | Abweichung zum Liefertermin wird sichtbar → Lieferantenproblem erkennbar |
| R5 | **Zählernummer** | Text | Deal-Textfeld | wird für die Fertigmeldung gebraucht, kennt nur der Monteur vor Ort |
| R6 | **Wunschtermin** | Datum | `Terminvorschlag Partner` | RP bestätigt → bestätigter Termin kommt in die gesperrte Spalte zurück |
| R7 | **Nacharbeit nötig** ☑ + **Anmerkung** | Checkbox + Text | Aktivität in Pipedrive | ersetzt den "da fehlt noch was"-Anruf |
| R8 | **Termin nicht möglich** + Grund | Text | Aktivität, zuständig RP | heute der häufigste Anrufgrund |
| R9 | **Seriennummer WR / Speicher** | Text | Deal-Textfelder | Garantie, Monitoring-Anbindung, Rückrufaktionen |
| R10 | **Anzahl Module tatsächlich verbaut** | Zahl | Deal-Zahlenfeld | Abweichung zur Planung = Nachkalkulation |
| R11 | **Monteur / Team** | Text | Deal-Textfeld | Rückfragen gehen an die richtige Person |

**R1 und R2 sind die zwei, die den größten Teil der Telefonate ersetzen.** Wenn nur zwei
Sachen gebaut werden, dann diese.

⚠️ Zu R6: das ist der FS-Ablauf aus dem Retool-Projekt "Terminfindung" (Partner schlägt vor →
Kunde bestätigt). **Nicht zweimal bauen** — vorher entscheiden, welcher Kanal es wird.

⚠️ Zu R1, falls ein Stage-Wechsel drankommt: ein Stage-Wechsel per API löst Pipedrive-Automations
genauso aus wie ein Klick in der Oberfläche. Vorher prüfen, was daran hängt. Ein Datumsfeld zu
setzen ist der harmlosere erste Schritt; der Stage-Wechsel kann später nachkommen.

---

## 4. Was das Script von selbst erkennen kann (ohne Partner-Aufwand)

Die beste Spalte ist die, die niemand ausfüllen muss. Die Kundenordner haben eine feste
Unterordner-Struktur (`1_AB`, `2_Projektdokumentation`, `3_Stromrechnung`, `4_Fotos`,
`5_Abschlussdoks.-Zaehlern._Fertigm._Prüfprot.`) — der 15-Minuten-Trigger kann dort einfach
nachsehen:

| Spalte (gesperrt, automatisch) | Ermittelt aus | Warum wertvoll |
|---|---|---|
| **Fotos vorhanden** ☑ | Dateien in `4_Fotos` | Fotos sind Abnahmevoraussetzung, werden ständig nachgefordert |
| **Abschlussdoku vollständig** ☑ | Dateien in `5_Abschlussdoks…` | löst die Schlussrechnung aus |
| **Stromrechnung da** ☑ | Dateien in `3_Stromrechnung` | blockiert sonst die Auslegung |

`DriveApp.getFolderById(...).getFiles().hasNext()` — ein Aufruf pro Ordner. Kostet nichts,
und die Information ist heute nur durch Reinklicken zu bekommen.

Ausbaustufe: statt nur ☑ die **Anzahl** Dateien plus Datum der letzten Änderung. Dann sieht man
"3 Fotos, zuletzt vor 10 Tagen" und weiß, ob es vollständig ist.

Zusätzlich rein rechnerisch, ganz ohne Partner:

| Spalte | Formel/Logik |
|---|---|
| **Status** | abgeleitet: kein DC-Termin → "in Planung"; DC-Termin < heute ohne Häkchen → "überfällig"; alle Häkchen → "fertig" |
| **Tage seit letztem Fortschritt** | heute − letztes gesetztes Erledigt-Datum → die Liste, die man montags durchgeht |

---

## 5. Menü-Aktionen (kein Feld, sondern ein Klick)

Über einen installierbaren `onOpen`-Trigger pro Partner-Sheet — läuft unter deinem Konto,
der Partner braucht keinen Pipedrive-Zugang.

| Aktion | Nutzen | Aufwand |
|---|---|---|
| **Jetzt synchronisieren** | Partner will nicht 15 Min warten; spart "das Sheet geht nicht"-Anrufe | klein |
| **Problem melden** (Dialog mit Freitext) | legt Aktivität in Pipedrive an, zuständig RP — Anruf wird nachvollziehbar | klein |
| **Fotos hochladen** | öffnet direkt den `4_Fotos`-Unterordner des Kunden | klein |
| **Meine offenen Aufträge** | filtert auf Zeilen ohne Fertigmeldung | klein |
| "Kundenordner öffnen" | überflüssig, der Link steht in der Spalte | — |

---

## 6. Was bewusst NICHT ins Sheet gehört

- Deal-Wert, Handelsspanne, Marge, Anzahlungs-/Schlussrechnungsstatus
- andere Kunden desselben Bundeslands (ein Sheet pro Partner)
- Deal-IDs anderer Partner
- interne Notizen, Fehlermeldungen im Rohformat (siehe S5)
- alles, was niemand auswertet — **jede Spalte ist eine, die falsch befüllt werden kann und
  gepflegt werden muss.** Lieber vier Spalten, die stimmen, als zwölf, die halb leer sind.

---

## 7. Aufwand und Reihenfolge

**Stufe 1 — arbeitsfähig machen** (kein neues Pipedrive-Feld nötig, nur `SYNC_FIELD_CONFIG`)
Adresse, PLZ/Ort, Telefon → Sheet. Ohne das ist alles andere Kosmetik.

**Stufe 2 — die zwei Anruf-Killer** (zwei neue Pipedrive-Datumsfelder + ein Typ-Zweig im Code)
`Montage abgeschlossen ☑` und `IB erledigt ☑`, beide Checkbox → Datum.
Dazu die Ordner-Verschiebung bei R1.

**Stufe 3 — Vollständigkeit**
DC/AC/Material-Häkchen, Zählernummer, Nacharbeit + Anmerkung, Status-Spalte.

**Stufe 4 — Komfort**
Menü-Aktionen, automatische Ordner-Erkennung, Seriennummern, Nachkalkulations-Felder.

**Nicht vorher:** Stufe 1 und 2 setzen voraus, dass S1/S2 aus `FIXES-2026-08-13.md` behoben
sind — jede zusätzliche Spalte multipliziert das API-Kontingentproblem, solange
`syncPipedriveToSheetFields()` pro Zeile einen Call macht.

---

## Offene Entscheidungen

1. **Wunschtermin: Sheet oder Retool?** (R6) — blockiert Stufe 3
2. **Soll R1 einen Stage-Wechsel auslösen oder nur ein Datum setzen?** — Automations-Risiko
3. **Welche Pipedrive-Datumsfelder existieren schon?** `listDealFieldsHelper()` in
   `SetupHelpers.gs` einmal laufen lassen und die Liste durchgehen, bevor neue angelegt werden —
   es gibt bereits 33 Fulfillment-Felder aus dem Setup vom 10.08., da ist vermutlich schon
   etwas dabei.
