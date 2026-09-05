# Telefon-Qualifizierung

Prüft Pipedrive-Personen-Telefonnummern **bevor** Setter anrufen. Ergebnis landet immer im eigenen Sheet und — seit der Freigabe am 05.09.2026 (`WRITE_TO_PIPEDRIVE = true` in `Config.gs`) — zusätzlich auf der Person selbst.

**Geschrieben wird das Prüfergebnis, nie die Nummer.** Das Telefonfeld der Person bleibt unangetastet; die Option "ja +(+43) ergänzt" heißt "wir mussten für die Prüfung korrigieren", nicht "die Nummer in Pipedrive ist jetzt korrigiert".

Editor: https://script.google.com/home/projects/1rrTD2ziFw8pbd7Ergp4wEI-35VFIAgNMoAYvcYIW5PtKl_iG1SPQrzi-/edit

## Zwei Ebenen

1. **Format-Check** (`PhoneFormat.gs`) — kostenlos, offline, sofort. Erkennt/korrigiert AT-Formatfehler (fehlendes `+43`, falsche führende Null, unplausible Länge). Deterministisch korrigierbar.
2. **Existenz-Check** (`ExistenceCheck.gs`) — [AbstractAPI](https://www.abstractapi.com/api/phone-validation-api), Freiplan **100/Monat, kein Tages-Deckel**. Prüft ob die Nummer wirklich aktiv im Netz ist (`valid`), plus Line-Type (Mobil/Festnetz/VOIP) und Carrier. (Ursprünglich IPQualityScore, umgestiegen 05.09.2026 wegen eines Credit-Bugs auf deren Seite — siehe „Verrechnung" unten.)

**Grenze:** Formatfehler sind automatisch korrigierbar. Echte Zifferndreher/Tippfehler nicht — die landen nur als "Verdacht" im Ergebnis-Sheet zur manuellen Prüfung, keine stille Autokorrektur.

## Ablauf: "new"-Label zuerst, Monatskontingent geschont

`taeglicherTelefonCheck()` sortiert bei jedem Lauf alle noch nicht erledigten Personen (Person-ID steht noch nicht im Ergebnis-Sheet) in zwei Warteschlangen: zuerst alle mit dem Pipedrive-Person-**Label "new"** (so kommen bei RP tatsächlich neue Leads rein — per Screenshot verifiziert, nicht per `add_time` geraten), danach der übrige Bestand. Innerhalb jeder Warteschlange neueste zuerst.

Zwei Kontingent-Grenzen (Config.gs): **`MAX_EXISTENZ_CHECKS_PRO_LAUF`** (steht aktuell auf **50** für den einmaligen Erst-Batch, danach zurück auf ~5 stellen) begrenzt einen einzelnen Trigger-Lauf, damit nicht gleich am 1. des Monats das ganze Kontingent für einen Tag draufgeht — AbstractAPI hat anders als IPQS keinen Tages-Deckel, nur einen Monats-Deckel. **`MAX_EXISTENZ_CHECKS_PRO_MONAT`** (Default 90) ist die harte Obergrenze, wird über den Kalendermonat verfolgt (nicht pro Skript-Ausführung) — mehrere manuelle Starts am selben Tag summieren sich.

Die Label-ID wird zur Laufzeit über den Text `"new"` aufgelöst (`resolveNeuLabelId()`), nicht hartcodiert — falls RP das Label je umbenennt, `NEU_LABEL_TEXT` in `DryRun.gs` anpassen.

## Setup

1. Script-Properties setzen (Projekteinstellungen → Script-Properties):
   - `PIPEDRIVE_API_TOKEN`
   - `ABSTRACT_API_KEY` — kostenlosen Key holen: https://www.abstractapi.com/api/phone-validation-api (kein Kreditkarten-Zwang, 100/Monat)
2. `pruefeKonfiguration()` — legt beim ersten Mal automatisch ein Ergebnis-Sheet an und loggt dessen ID. Diese ID danach in `Config.gs` bei `ERGEBNIS_SHEET_ID` eintragen.
3. `testEinzelneNummer()` — `TEST_NUMMER` oben in `ExistenceCheck.gs` mit einer echten Nummer befüllen (▷-Button-Falle: der Editor ruft ohne Parameter auf), dann ausführen. 1 echter API-Call, Rohantwort komplett ins Log. Prüft ob der Key funktioniert und die angenommenen Antwortfelder wirklich stimmen.
4. `richteTaeglichenTriggerEin()` — einmalig ausführen, richtet den Zeit-Trigger ein (~6 Uhr Europe/Vienna). Danach läuft `taeglicherTelefonCheck()` von selbst, kein manuelles Starten mehr nötig.
   - Manuell testen/vorziehen: `taeglicherTelefonCheck()` direkt im Editor ausführen.
   - `setzeMonatskontingentZurueck()` — nur zum Testen, erzwingt einen frischen Scan von oben ohne auf den nächsten Kalendermonat zu warten (löscht keine Sheet-Zeilen).

## Verrechnung AbstractAPI (Stand 05.09.2026, verifiziert gegen die offizielle Doku)

- **Freiplan:** $0/Monat, **100 Lookups/Monat, kein separater Tages-Deckel** (nur eine Rate-Limit-Bremse von **1 Anfrage/Sekunde** lt. offizieller Doku — deshalb `Utilities.sleep(1100)` nach jedem Call), kein Kreditkarten-Zwang beim Signup.
- **Jede Anfrage kostet 1 Credit**, auch bei einer erkennbar ungültigen Nummer. Deshalb läuft der Existenz-Check nur bei `format.formatOk`.
- **Bezahlte Pläne:** ab $17/Monat (jährlich abgerechnet) für 60.000+/Jahr.
- **Warum nicht mehr IPQualityScore:** deren $0-Plan zeigte trotz aktivem Free-Plan „0 Remaining Credits" und lieferte bei jeder Anfrage „insufficient credits" — ein bestätigter Bug auf IPQS-Seite (auch andere Free-Plan-Nutzer betroffen, z.B. GitHub-Issue firecrawl/firecrawl#651), kein Setup-Fehler unsererseits. Support-Ticket wäre der saubere Weg gewesen, aber nicht abgewartet — 100/Monat bei AbstractAPI reicht für den aktuellen Bedarf (siehe "new"-Label-Priorisierung oben) und ist sofort nutzbar.
- **Kleinerer Umfang als ursprünglich mit IPQS geplant:** 100/Monat statt der ursprünglich gedachten ~1.000/Monat. Für einen echten Vollauf über den kompletten Altbestand reicht das nicht annähernd — die "new"-Label-Priorisierung ist hier also nicht mehr nur "nice to have", sondern trägt den Hauptteil des Nutzens (neue Leads werden geprüft, der Altbestand bleibt größtenteils ungeprüft, außer Kontingent bleibt über).

## Phase 2 — Rückschreiben auf die Person (`PipedriveWriteBack.gs`)

Drei Pipedrive-Person-Felder, Feldgruppe "Automatisierung_felder_Valentin" (von Valentin am 05.09.2026 angelegt):

| Feld | Typ | Zweck |
|---|---|---|
| `Telefonnummer existiert?` | Mehrfachoption ("set"): `ja` / `ja +(+43) oder ähnliches ergänzt)` / `nein` | Ergebnis des Existenz-Checks |
| `Origininalnummer_vor_check` | Text (varchar) | unveränderter Rohwert, damit man dem Script bei einem Fehler nicht ausgeliefert ist |
| `Zuletzt_geprüft` | Datum | wie alt die Prüfung ist — Nummern werden über Monate wieder inaktiv |

**Feldname mit Tippfehler:** `Origininalnummer_vor_check` (doppeltes "in") ist der echte Name in Pipedrive und steht 1:1 so im Code. Wird er dort umbenannt, muss `FIELD_LABEL_ORIGINAL` in `Config.gs` nachgezogen werden. Der Feldtyp ist inzwischen korrekt **Text** — ein numerisches Feld hätte führende Null und `+` verschluckt, also genau das zerstört, was das Feld beweisen soll.

**Fehlt eines der Felder**, schreibt das Script trotzdem, was es schreiben kann, und vermerkt das fehlende Feld in der Sheet-Spalte "Pipedrive-Status" — statt an einem 400er zu scheitern. `pruefeKonfiguration()` sagt in 5 Sekunden, ob alle drei auflösen.

Alle Feld-Keys und die drei Options-IDs werden zur Laufzeit über den Klartext-Namen aufgelöst (`getPersonFieldKeyByLabel()`, `getPersonFieldOptionId()`), nicht hartcodiert. `pruefeKonfiguration()` prüft das mit und loggt die aufgelösten IDs.

**Fall "unklar"** (Existenz-Check fehlgeschlagen, z.B. Monatskontingent aufgebraucht): keine der drei Optionen passt wirklich. Aktuell wird in diesem Fall **nichts geschrieben** (Feld bleibt wie es war) statt zu raten — steht so in `ermittleStatusOptionText()` in `PipedriveWriteBack.gs`. Falls stattdessen z.B. eine vierte Option "nicht prüfbar" gewünscht ist, dort anpassen.

**`WRITE_TO_PIPEDRIVE`** (Config.gs) steht seit 05.09.2026 auf `true` (von Valentin explizit freigegeben). Zum Zurückschalten auf reine Simulation: auf `false` setzen — dann zeigt die Sheet-Spalte "Pipedrive-Status" nur noch, was geschrieben WÜRDE (`DRY-RUN -- würde schreiben: "..."`).

## Bekannte Grenzen (Stand 05.09.2026)

- **"Erledigt" heißt: steht im Ergebnis-Sheet.** Löscht man dort Zeilen, wird die betroffene Person beim nächsten Lauf einfach nochmal geprüft (verbraucht dann erneut Monatskontingent) — kein separates Tracking daneben.
- **Skalierung beim Überspringen nicht optimiert.** Je mehr Personen schon erledigt sind, desto mehr Pipedrive-Seiten muss ein Lauf überspringen, bevor er auf frische trifft. Bei sehr großem Bestand (mehrere Zehntausend) könnte das irgendwann an die 4,5-Min-Laufzeitgrenze stoßen — für die aktuelle RP-Datenmenge kein Thema, "erst messen dann optimieren".
- **Nur der primäre (oder erste) Telefonwert pro Person wird geprüft**, nicht alle hinterlegten Nummern.
- **Auto-Korrektur nur nach AT-Regeln.** Auslandsnummern in sauberer `+XX`/`00XX`-Schreibweise (RP hat vereinzelt DE-Leads) gelten als formal in Ordnung und bekommen einen Existenz-Check, werden aber nicht umgeschrieben. Nur eine Nummer ohne jedes erkennbare Präfix (`+`, `0`, `0043`) ist ein echter Formatfehler.
- **Personen ohne Telefonnummer bekommen trotzdem eine Zeile** ("übersprungen (keine Nummer)") und gelten damit als erledigt. Trägt jemand später eine Nummer nach, wird sie erst geprüft, wenn die Zeile im Sheet gelöscht wird.
