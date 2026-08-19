# Namensabgleich + Übernahme in Fulfillment

Einmal-Projekt: 55 Kunden aus der Sales-Pipeline auf gewonnenen Pipedrive-Deal
abgleichen, dann bestätigte Fälle nach Pipeline **Fulfillment**, Stage
**1_Übernommen** verschieben.

## Setup (im Apps-Script-Editor)

1. Neues Apps-Script-Projekt anlegen (z. B. "Namensabgleich Fulfillment-Übernahme").
2. `Config.gs`, `Abgleich.gs`, `Verschieben.gs` reinkopieren.
3. Projekteinstellungen → Script-Properties → `PIPEDRIVE_API_TOKEN` eintragen.

## Ablauf

1. **`pruefeKonfiguration()`** ausführen — bestätigt, dass Pipeline "Fulfillment"
   und Stage "1_Übernommen" wirklich existieren. Bricht mit Klartext-Fehler ab,
   falls nicht (zeigt vorhandene Namen zum Abgleichen).
2. **`testEinzelnerName()`** ausführen — prüft an einem festen Testnamen
   (`TEST_NAME` in Abgleich.gs), ob die Pipedrive-Suche das erwartete Format
   liefert. Log ansehen, bevor der Vollauf startet.
3. **`starteNamensabgleich()`** ausführen — **schreibt nichts in Pipedrive**,
   nur ins neue Log-Sheet "LOG_Namensabgleich Fulfillment-Übernahme"
   (Link erscheint im Ausführungsprotokoll). Spalte "Kategorie":
   - `WON` — genau ein Deal gefunden, Status "won" → Kandidat für Phase 2
   - `FEHLER_STATUS` — Deal gefunden, aber Status ist nicht "won" → prüfen
   - `MEHRDEUTIG` — mehrere mögliche Deals → manuell auswählen
   - `NICHT_GEFUNDEN` — kein Deal-Titel enthält den Namen → manuell suchen
   - `DUPLIKAT_IN_LISTE` — Name stand mehrfach in der Rohliste
   - `HARD_ERROR` — technischer Fehler (API, Config) → Fehlertext lesen
4. Log-Sheet durchsehen. Für jeden `WON`-Fall die Deal-ID in
   `DEAL_IDS_ZUM_VERSCHIEBEN` (Verschieben.gs) eintragen.
5. **`verschiebeBestaetigteDeals()`** mit `DRY_RUN = true` (Default) laufen
   lassen — Log zeigt "WÜRDE VERSCHOBEN WERDEN" pro Deal, nichts wird
   geschrieben. Kontrollieren.
6. `DRY_RUN = false` setzen, nochmal ausführen — verschiebt wirklich.

## Wichtig

- **Vor Schritt 6 prüfen, ob in Pipedrive Automations auf Stage-Wechsel nach
  "1_Übernommen" hängen** (Mails, Aktivitäten) — ein API-Write löst dieselben
  Automations aus wie ein Klick in der UI.
- Matching läuft über `deals/search` (Volltextsuche auf Deal-Titel) — falls
  der Deal-Titel in Pipedrive nicht den Kundennamen enthält, landet der Fall
  automatisch bei `NICHT_GEFUNDEN`, nicht bei einer falschen Zuordnung.
- Nichts wird automatisch verschoben ohne deine Bestätigung der Deal-ID in
  Schritt 4 — bewusst kein Automatismus bei Mehrdeutigkeit.

## Aus der Ursprungsliste entfernt (bereits erledigt laut Valentin, 2026-08-18)

Christian Lehner, Benjamin Bauer WP, David Peter, Arnold Baumann, Christian Potocnik
