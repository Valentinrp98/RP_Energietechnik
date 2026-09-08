// ============================================================
// SLACK-CLIENT — Mitglieder + Geburtstags-Custom-Field lesen
// ============================================================

// Einmalig ausführen, um die Feld-ID des Custom Profile Field "Geburtstag" zu
// finden (Slack liefert Custom-Field-Werte nur über ihre interne ID, z.B.
// "Xf0123456789", nicht über den Anzeigenamen). Ergebnis ins Log, dann
// SLACK_BIRTHDAY_FIELD_ID in Config.gs eintragen.
function ermittleGeburtstagsFeldId() {
  const antwort = fetchSlackJson('team.profile.get', {});
  const felder = (antwort.profile && antwort.profile.fields) || [];
  if (!felder.length) {
    Logger.log('Keine Custom Profile Fields gefunden — wurde "Geburtstag" schon in Slack Admin angelegt?');
    return;
  }
  felder.forEach(function (feld) {
    Logger.log('Feld-ID: %s | Label: %s | Typ: %s', feld.id, feld.label, feld.field_type);
  });
  Logger.log('>>> Die Zeile mit Label "Geburtstag" (o.ä.) suchen und deren Feld-ID in Config.gs eintragen.');
}

// Alle aktiven, menschlichen Workspace-Mitglieder (keine Bots, keine gelöschten
// Accounts) mit ihrem Geburtsdatum aus dem Custom Field, falls gesetzt.
// Rückgabe: [{ userId, name, geburtstag: { monat, tag } | null }, ...]
function holeMitarbeiterGeburtstage() {
  const start = Date.now();
  const mitglieder = holeAlleAktivenMitglieder();
  const ergebnis = [];

  for (let i = 0; i < mitglieder.length; i++) {
    if (Date.now() - start > MAX_LAUFZEIT_MS) {
      Logger.log('Zeitlimit erreicht nach %s von %s Mitgliedern — Rest folgt beim nächsten Trigger-Lauf.', i, mitglieder.length);
      break;
    }
    const mitglied = mitglieder[i];
    // Pro Mitglied abschirmen: ein einzelner Slack-Fehler (z.B. user_not_found, Gast ohne
    // Profilzugriff) darf nicht den ganzen Lauf und damit alle übrigen Kollegen mitreißen.
    // Ein übersprungenes Mitglied wird bewusst NICHT als "kein Geburtstag" behandelt --
    // sonst würde der Löschzweig sein Event entfernen.
    let geburtstag;
    try {
      geburtstag = holeGeburtstagFuerUser(mitglied.id);
    } catch (fehler) {
      Logger.log('Übersprungen: %s (%s) — Slack-Fehler: %s', mitglied.real_name || mitglied.name, mitglied.id, fehler.message);
      continue;
    }
    ergebnis.push({
      userId: mitglied.id,
      name: mitglied.real_name || mitglied.name,
      geburtstag: geburtstag
    });
  }
  return ergebnis;
}

function holeAlleAktivenMitglieder() {
  const mitglieder = [];
  let cursor;
  do {
    const antwort = fetchSlackJson('users.list', cursor ? { cursor: cursor, limit: 200 } : { limit: 200 });
    antwort.members
      .filter(function (m) { return !m.deleted && !m.is_bot && m.id !== 'USLACKBOT'; })
      .forEach(function (m) { mitglieder.push(m); });
    cursor = antwort.response_metadata && antwort.response_metadata.next_cursor;
  } while (cursor);
  return mitglieder;
}

function holeGeburtstagFuerUser(userId) {
  const antwort = fetchSlackJson('users.profile.get', { user: userId, include_labels: false });
  const feld = antwort.profile.fields && antwort.profile.fields[SLACK_BIRTHDAY_FIELD_ID];
  if (!feld || !feld.value) return null;
  return parseGeburtsdatum(feld.value);
}

// Slacks Date-Custom-Field liefert den Wert als "YYYY-MM-DD" (unverifiziert bis
// zum ersten echten Testlauf — Slack dokumentiert das Rohformat für Date-Felder
// nicht öffentlich; Fallback auf TT.MM.(JJJJ) falls stattdessen ein Freitextfeld
// benutzt wurde). Jahr wird ignoriert, nur Monat/Tag zählen fürs wiederkehrende Event.
function parseGeburtsdatum(rohwert) {
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rohwert);
  if (isoMatch) {
    return { monat: Number(isoMatch[2]), tag: Number(isoMatch[3]) };
  }
  const deMatch = /^(\d{1,2})\.(\d{1,2})\.?(\d{4})?$/.exec(rohwert);
  if (deMatch) {
    return { tag: Number(deMatch[1]), monat: Number(deMatch[2]) };
  }
  Logger.log('Geburtsdatum-Format nicht erkannt, wird übersprungen: "%s"', rohwert);
  return null;
}
