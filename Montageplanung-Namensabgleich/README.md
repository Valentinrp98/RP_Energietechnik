# Montageplanung-Namensabgleich

> ## ⚠️ Zwei Setup-Angaben unten sind überholt — nachgeprüft 2026-09-01
>
> | Behauptung unten | Tatsächlich |
> |---|---|
> | Schritt 1: „sobald ein `.clasp.json` für dieses Projekt existiert — noch nicht angelegt" | **Existiert**, scriptId `15it5Xl0RvJz7gSfXTZ5dCtO3VdPNIGD3g_g8EFtUF31B414fF7T-n-hu` |
> | Schritt 4: „nur ALEs gid ist eingetragen" | **Alle 6 gids sind eingetragen**, `Config.gs:77-84` |
>
> Aktueller Partner: `AKTUELLER_PARTNER = 'GREENSKY'` (`Config.gs`, uncommitted geändert von `'TIROL'`).
>
> **Dieses Projekt macht eine Sache besser als alle anderen** — als Vorlage nutzen: Es löst die
> Person-Feldcodes **zur Laufzeit über das Label** auf (`Config.gs:121-127`, `PLZ_FIELD_LABEL`) statt
> sie hartzucodieren. Anlass war, dass die hartcodierten Codes hier nach 16 Tagen veraltet waren.
>
> ⚠️ **Konfigurationsrisiko:** `.clasp.json` erlaubt `scriptExtensions: [".js", ".gs"]`. Der
> `gs-deploy`-Skill verbietet das ausdrücklich („nie beide gleichzeitig") wegen der
> „Conflicting files"-Falle. Es knallt heute nicht, weil hier nur `.gs` liegt — aber die Schutzregel
> ist nicht scharf.
>
> Kleiner Befund: `Abgleich.gs:95` nutzt `&limit=5` bei der Won-Deal-Suche und meldet „5 won-Deals",
> als wäre das die Gesamtzahl (D19).

---

Sucht pro Kunde in einem "Montageplanung RP <Partner>"-Sheet (Spalte B) den passenden
Pipedrive-Deal (nur lesend) und trägt Deal-ID/Adresse/PLZ/Telefon zurück ins Sheet ein.
Schreibt NIE in Pipedrive selbst — nur ins Google Sheet, und auch das nur bei DRY_RUN=false.

## Setup (einmalig)
1. Neues Apps-Script-Projekt anlegen, `Config.gs` + `Abgleich.gs` reinkopieren (oder `clasp push`,
   sobald ein `.clasp.json` für dieses Projekt existiert — noch nicht angelegt).
2. Projekteinstellungen → Script-Properties → `PIPEDRIVE_API_TOKEN` eintragen.
3. `AKTUELLER_PARTNER` in Config.gs auf den Partner setzen, den du gerade abgleichen willst
   (KREUZEDER / ALE / GREENSKY / BERGER / TIROL / VORARLBERG).
4. `TARGET_TAB_GID` für den Partner nachtragen (aus der Sheet-URL nach `gid=`) — ohne gid fällt
   das Script auf `getSheets()[0]` zurück und loggt eine Warnung. Für ALE ist das schon
   eingetragen (`128496518`), die anderen fünf fehlen noch.

## Ablauf pro Partner
1. `pruefeKonfiguration()` — prüft Ziel-Sheet-Zugriff + PLZ-Feld gegen echtes Pipedrive.
2. `testEinzelnerName()` — prüft das Rohformat der itemSearch-Antwort (Logs ansehen; falls
   Pipedrive andere Feldnamen liefert als erwartet, `filterByType()` in Abgleich.gs anpassen).
3. `starteAbgleich()` mit `DRY_RUN = true` — schreibt nur den Tab "Log_Namensabgleich" im
   Ziel-Sheet selbst, rührt die Datenzeilen nicht an.
4. Log-Tab durchsehen:
   - `WON` = Deal eindeutig gefunden, wird bei DRY_RUN=false automatisch gesetzt
   - `MEHRDEUTIG` = mehrere Personen mit dem Namen. Bei mehreren Namens-Duplikaten prüft das
     Script zuerst, wer davon überhaupt einen won-Deal hat — hat nur einer, wird automatisch als
     `WON` aufgelöst (Hinweis-Spalte sagt dann "automatisch aufgelöst"), keine Ratearei, nur
     eine echte Zusatzinfo aus Pipedrive genutzt. Bleibt `MEHRDEUTIG` nur noch übrig, wenn
     mehrere Kandidaten je einen won-Deal haben (oder keiner) — dann wirklich manuell im Sheet
     eintragen.
   - `UNKLAR` = Person gefunden, aber kein eindeutiger won-Deal (offen/verloren/zu Lead
     konvertiert) — manuell prüfen
   - `NICHT_GEFUNDEN` = keine Person in Pipedrive — manuell suchen
5. `DRY_RUN = false`, `LIMIT_PRO_LAUF` klein lassen (Canary, Default 5) — `starteAbgleich()`,
   Ergebnis im Sheet stichprobenartig prüfen.
6. `LIMIT_PRO_LAUF` hochsetzen oder entfernen, `starteAbgleich()` für den Rest. Bereits gesetzte
   Deal-ID-Zeilen werden automatisch übersprungen (idempotent) — mehrfacher Start ist gefahrlos,
   solange `FORCE_OVERWRITE` auf `false` bleibt.
   - Gilt auch für **manuell** eingetragene Deal-IDs (z.B. nach einer im Chat aufgelösten
     MEHRDEUTIG/UNKLAR-Zeile): die Namenssuche wird übersprungen, aber Adresse/PLZ/Telefon/
     Erstellungsdatum/Gewonnen-Notiz werden trotzdem nachgezogen, wenn sie noch leer sind
     (Kategorie `ANGEREICHERT` im Log) — muss nicht von Hand nachgetragen werden.
7. `sortiereNachErstellungsdatum()` — EINMAL manuell aufrufen, nachdem die Deal-IDs (und damit
   Erstellungsdaten) für einen Partner durch sind. Sortiert die Datenzeilen fix nach Spalte Q
   (Erstellungsdatum, aus `deal.add_time`), Zeilen ohne Datum landen am Ende. Bewusst KEIN
   automatischer Re-Sort bei jedem Lauf — Valentins Vorgabe: die Reihenfolge soll stabil bleiben,
   nicht bei jeder Änderung neu springen.
8. `richteCheckboxenEin()` (SetupHelpers.gs) — EINMAL pro Partner-Sheet aufrufen, richtet
   Checkbox-Format ein für "Netzanmeldung eingereicht" (C), "IB erledigt" (O) und "Fertigmeldung"
   (P) — die drei Felder, die laut Sheet-Sync/Config.gs SYNC_FIELD_CONFIG tatsächlich als
   `checkbox_to_option`/`checkbox_to_date` definiert sind (DC-/AC-/IB-Termin sind KEINE
   Checkboxen, das sind normale bidirektionale Datumsfelder). Inkl. Puffer für künftige Zeilen.
   Reine Zellformatierung, kein Pipedrive-Zugriff.

## Falls `pruefeKonfiguration()` ein Feld nicht findet
PLZ und Adresse werden zur Laufzeit über den Feldnamen aufgelöst (nicht hartcodiert, siehe
2026-08-28: der alte hartcodierte PLZ-Feldcode war nach 16 Tagen bereits ungültig). Wenn ein
Feld nicht gefunden wird: `listePersonFields()` (Abgleich.gs) ausführen, loggt alle
Person-Custom-Felder mit aktuellem Namen — dann `PLZ_FIELD_LABEL` in Config.gs anpassen, falls
sich der Name geändert hat.

## Bekannte Grenzen
- Sucht nur nach Personen, nicht nach Deal-Titeln (robuster laut früheren Learnings, siehe
  [[project_namensabgleich_fulfillment_uebernahme]]) — Deal-Titel wie "Farmento" für Kundin
  "Verena Pizzini" werden dadurch trotzdem korrekt gefunden.
- "Anlagengröße (Module)" wird nicht befüllt — es gibt aktuell kein bekanntes Pipedrive-Feld
  dafür, das zuverlässig genug ist.
- Rät nie bei Mehrdeutigkeit — jeder Nicht-WON-Fall bleibt für eine manuelle Entscheidung im
  Log stehen, ganz bewusst (siehe CLAUDE.md "Bei mehrdeutigen Daten nicht raten").
