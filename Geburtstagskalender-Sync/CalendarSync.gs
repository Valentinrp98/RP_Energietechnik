// ============================================================
// CALENDAR-SYNC — Kernlogik
// ============================================================
// Jeder Slack-Mitarbeiter-Geburtstag wird über ein extendedProperties.private.
// slackUserId-Tag am Event exakt wiedergefunden (nicht über Titel/Datum-Abgleich) —
// so bleibt ein Update bei geändertem Geburtsdatum ein Patch statt eines Duplikats.

function syncGeburtstage() {
  if (!pruefeKonfiguration()) {
    Logger.log('Abbruch: Konfiguration unvollständig (siehe Log oben). Es wurde nichts angelegt und nichts gelöscht.');
    return;
  }

  const mitarbeiter = holeMitarbeiterGeburtstage();

  // Not-Aus gegen Massenlöschung: kommt für NIEMANDEN ein Geburtstag zurück, ist eine falsche
  // Feld-ID oder eine geänderte Slack-Antwort viel wahrscheinlicher als ein Workspace, in dem
  // alle gleichzeitig ihr Feld geleert haben. Ohne den Riegel würde der Lauf jedes bestehende
  // Event löschen. CLAUDE.md: bei mehrdeutigen Daten nicht raten, entscheidbar machen.
  const mitGeburtstag = mitarbeiter.filter(function (p) { return !!p.geburtstag; }).length;
  if (mitarbeiter.length > 0 && mitGeburtstag === 0) {
    Logger.log('ABBRUCH: %s Mitglieder gelesen, aber KEIN einziger Geburtstag gefunden. SLACK_BIRTHDAY_FIELD_ID prüfen (ermittleGeburtstagsFeldId()). Es wurde nichts gelöscht.', mitarbeiter.length);
    return;
  }

  let angelegt = 0, aktualisiert = 0, geloescht = 0, uebersprungen = 0;

  mitarbeiter.forEach(function (person) {
    if (person.geburtstag) {
      const ergebnis = upsertGeburtstagsEvent(person);
      if (ergebnis === 'angelegt') angelegt++;
      else if (ergebnis === 'aktualisiert') aktualisiert++;
      else uebersprungen++;
    } else {
      if (loescheEventFallsVorhanden(person)) geloescht++;
    }
  });

  // String() um die Zähler, sonst loggt Apps Script Ganzzahlen als "1.0".
  Logger.log('Sync fertig (DRY_RUN=%s): %s angelegt, %s aktualisiert, %s gelöscht, %s unverändert.',
    DRY_RUN, String(angelegt), String(aktualisiert), String(geloescht), String(uebersprungen));
}

function findeExistierendesEvent(userId) {
  const antwort = Calendar.Events.list(CALENDAR_ID, {
    privateExtendedProperty: 'slackUserId=' + userId,
    showDeleted: false
  });
  return (antwort.items && antwort.items[0]) || null;
}

function upsertGeburtstagsEvent(person) {
  const jahr = new Date().getFullYear();
  const startDatum = formatDatum(jahr, person.geburtstag.monat, person.geburtstag.tag);
  const endDatum = formatDatum(jahr, person.geburtstag.monat, person.geburtstag.tag + 1);
  const titel = EVENT_TITEL_PRAEFIX + person.name;

  const bestehendesEvent = findeExistierendesEvent(person.userId);

  if (!bestehendesEvent) {
    if (DRY_RUN) {
      Logger.log('[DRY_RUN] Würde anlegen: %s am %s (jährlich)', titel, startDatum);
      return 'angelegt';
    }
    Calendar.Events.insert({
      summary: titel,
      start: { date: startDatum },
      end: { date: endDatum },
      recurrence: ['RRULE:FREQ=YEARLY'],
      extendedProperties: { private: { slackUserId: person.userId } }
    }, CALENDAR_ID);
    Logger.log('Angelegt: %s am %s', titel, startDatum);
    return 'angelegt';
  }

  // start.date gibt es nur bei Ganztags-Events. Hat jemand das Event in Google Calendar von
  // Hand auf eine Uhrzeit umgestellt, steht dort start.dateTime -- dann lieber in Ruhe lassen
  // und melden, statt an .slice() eines undefined zu sterben.
  const bestehendesDatum = bestehendesEvent.start && bestehendesEvent.start.date;
  if (!bestehendesDatum) {
    Logger.log('Event "%s" (%s) ist kein Ganztags-Event mehr — übersprungen, bitte im Kalender ansehen.', bestehendesEvent.summary, bestehendesEvent.id);
    return 'unveraendert';
  }
  const neuesMonatTag = startDatum.slice(5);
  if (bestehendesDatum.slice(5) === neuesMonatTag && bestehendesEvent.summary === titel) {
    return 'unveraendert';
  }

  if (DRY_RUN) {
    Logger.log('[DRY_RUN] Würde aktualisieren: %s -> %s am %s', bestehendesEvent.summary, titel, startDatum);
    return 'aktualisiert';
  }
  Calendar.Events.patch({
    summary: titel,
    start: { date: startDatum },
    end: { date: endDatum }
  }, CALENDAR_ID, bestehendesEvent.id);
  Logger.log('Aktualisiert: %s am %s', titel, startDatum);
  return 'aktualisiert';
}

// Feld leer oder Mitarbeiter nicht mehr aktiv -> zugehöriges Event entfernen, falls vorhanden.
function loescheEventFallsVorhanden(person) {
  const bestehendesEvent = findeExistierendesEvent(person.userId);
  if (!bestehendesEvent) return false;

  if (DRY_RUN) {
    Logger.log('[DRY_RUN] Würde löschen: %s', bestehendesEvent.summary);
    return true;
  }
  Calendar.Events.remove(CALENDAR_ID, bestehendesEvent.id);
  Logger.log('Gelöscht: %s', bestehendesEvent.summary);
  return true;
}

function formatDatum(jahr, monat, tag) {
  // Date-Objekt normalisiert Überläufe selbst (z.B. Tag 32 im Jänner -> 1. Februar),
  // relevant für den End-Datum-Fall bei Monatsletzten.
  const datum = new Date(jahr, monat - 1, tag);
  const pad = function (n) { return String(n).padStart(2, '0'); };
  return datum.getFullYear() + '-' + pad(datum.getMonth() + 1) + '-' + pad(datum.getDate());
}
