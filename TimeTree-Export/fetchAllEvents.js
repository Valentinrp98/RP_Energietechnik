// In die Browser-Konsole einfügen, während man auf timetreeapp.com eingeloggt ist
// (DevTools > Network > einen Request zu .../events?since=... suchen > Rechtsklick
// > Copy > Copy as fetch, um den x-csrf-token unten aktuell zu halten, falls er
// abgelaufen ist).
//
// Aufruf danach z.B.:
//   fetchAllEvents(107804524, 'sean-events-full.json')
// Kalender-IDs findet man in der Antwort von GET /api/v1/calendars (Feld "id"
// pro Eintrag in "calendars", Name steht daneben in "name").

async function fetchAllEvents(calendarId, filename) {
  let since = 0;
  let all = [];
  while (true) {
    const res = await fetch(`https://timetreeapp.com/api/v1/calendar/${calendarId}/events?since=${since}`, {
      "headers": {
        "accept": "*/*",
        "content-type": "application/json",
        "x-csrf-token": "PASTE_FRISCHEN_TOKEN_HIER_REIN",
        "x-timetreea": "web/2.1.0/de"
      },
      "referrer": "https://timetreeapp.com/calendars/DEINE_CALENDAR_ALIAS_HIER",
      "body": null,
      "method": "GET",
      "mode": "cors",
      "credentials": "include"
    }).then(r => r.json());
    all.push(...res.events);
    console.log(filename, '- geladen:', all.length, 'chunk:', res.chunk);
    if (!res.chunk) break;
    since = res.since;
  }
  const blob = new Blob([JSON.stringify(all)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  console.log('FERTIG:', filename, '-', all.length, 'Termine');
}
