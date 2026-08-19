# TimeTree → Google Calendar Export

Workaround für einen fehlenden offiziellen Export bei TimeTree (App/Web haben
keine Export-Funktion, die öffentliche API wurde Dezember 2023 abgeschaltet).
Erstellt für den Umzug von Kunden-Terminen (Kalender pro Kunde/Standort) nach
Google Calendar.

## Ablauf

1. **Kalender-IDs herausfinden.** Auf timetreeapp.com einloggen, DevTools
   (F12) → Network-Tab → Aufnahme starten (roter Punkt) → "Disable cache"
   aktivieren. Danach in den Ziel-Kalender klicken und ein bisschen
   navigieren, bis ein Request zu `GET /api/v1/calendars` in der Liste
   auftaucht. Response enthält pro Kalender `id` (die Kalender-ID) und
   `name`.

2. **Alle Termine eines Kalenders laden.** TimeTree liefert Termine über
   einen Delta-Sync-Endpunkt (`GET /api/v1/calendar/{id}/events?since=<ms>`),
   der bei einem bereits eingeloggten Tab nur "was hat sich geändert"
   zurückgibt (leer), nicht die volle Historie. Mit `since=0` erzwingt man
   einen vollen Sync, der aber in Batches von 300 kommt (`chunk: true`
   solange es weitergeht).

   `fetchAllEvents.js` in diesem Ordner übernimmt das Paginieren
   automatisch: in die Browser-Konsole einfügen (definiert nur die
   Funktion), dann `fetchAllEvents(<calendarId>, '<name>-events-full.json')`
   aufrufen. Lädt am Ende automatisch eine JSON-Datei mit allen Rohterminen
   herunter.

   Der `x-csrf-token` im Script muss aus einem echten Request kopiert werden
   (Network-Tab → Request zu `.../events?since=...` → Rechtsklick → Copy →
   Copy as fetch → Token rüberkopieren). Der Token läuft ab, dann kommt ein
   401/403 und man braucht einen frischen.

3. **JSON zu .ics konvertieren.**
   ```
   node convert-flat-to-ics.js <input.json> <output.ics> ["Kalendername"] [cutoffDateISO]
   ```
   - `deactivated_at` (soft-gelöschte TimeTree-Termine) wird automatisch
     rausgefiltert.
   - Exakte ID-Duplikate (kommen an Pagination-Grenzen vor) werden dedupliziert.
   - `cutoffDateISO` (optional, z.B. `2026-07-01T00:00:00+02:00`) schneidet
     alles vor diesem Datum ab — wiederkehrende Termine (mit `recurrences`/
     RRULE) bleiben trotzdem drin, weil ihre künftigen Vorkommen sonst
     verschwinden würden.
   - Wiederholungsregeln (`RRULE`/`EXDATE`) aus TimeTree werden 1:1 als
     iCal-RRULE übernommen.
   - Checklisten-Items (TimeTree "Todos" mit Unterpunkten) landen im
     `DESCRIPTION`-Feld.

4. **Import beim Kunden.** Google Calendar → Einstellungen → Importieren &
   Exportieren → `.ics`-Datei auswählen → Zielkalender wählen.

## Bekannte Grenzen

- **Termin-Farben (TimeTree-Labels) gehen beim Import verloren.** Google
  Calendar übernimmt beim manuellen .ics-Import keine Per-Termin-Farbe,
  alle importierten Termine bekommen die Farbe des Zielkalenders. Für echte
  Farbübernahme bräuchte es entweder (a) pro Label eine eigene .ics-Datei,
  die der Kunde in einen jeweils eigenen, manuell eingefärbten Google-Kalender
  importiert, oder (b) ein Apps-Script mit Calendar-API-Zugriff, das Termine
  direkt mit passender `colorId` anlegt (braucht einmalige OAuth-Freigabe
  durch den Kunden). Aktuell nicht umgesetzt.
- Sehr alte Einzeltermine (z.B. jährlich wiederkehrende Geburtstage aus den
  1990ern) tauchen in den Rohdaten mit ihrem ursprünglichen Erstelldatum auf
  — das ist bei `RRULE:FREQ=YEARLY`-Terminen normal und kein Datenfehler.
