# Geburtstagskalender-Sync

Liest Geburtstage aus einem Slack Custom Profile Field und schreibt sie als jährlich
wiederkehrende Ganztags-Events in einen einzigen gemeinsamen Google-Kalender
("RP Geburtstage"), den alle RP-Mitarbeiter abonnieren bzw. auf den sie eingeladen
sind. Kein Schreiben in individuelle Mitarbeiter-Kalender.

Hintergrund/Entscheidungshistorie: Bauplan — liegt **nur lokal** auf Valentins Rechner, nicht
im Repo; alles zum Weiterbauen Nötige steht in dieser README:
`C:\Users\valen\.claude\plans\passt-mach-bitte-den-resilient-clarke.md`.

## Noch offene manuelle Voraussetzungen

Diese vier Schritte kann nur Valentin (bzw. der Slack-Workspace-Admin) erledigen —
ohne sie kann das Skript zwar geschrieben, aber nicht live getestet werden:

1. **Apps-Script-Projekt anlegen**: neues Standalone-Projekt unter
   [script.google.com/create](https://script.google.com/create), Script-ID an Claude
   geben (für `.clasp.json`, siehe `RP-Google-Scripts/.claude/skills/gs-deploy/SKILL.md`
   → "Neues Projekt binden"). Danach unter
   `https://script.google.com/home/usersettings` einmalig die Apps Script API für
   dieses Google-Konto aktivieren, falls noch nicht geschehen.
2. **Slack Custom Profile Field "Geburtstag"** anlegen: Slack → Einstellungen &
   Verwaltung → Workspace-Einstellungen → Profil → Feld hinzufügen. Typ **Datum**,
   falls verfügbar (sonst Freitext, Format TT.MM. oder TT.MM.JJJJ — dann
   `parseGeburtsdatum()` in `SlackClient.gs` ggf. anpassen).
3. **Slack App + Bot Token**: neue App unter [api.slack.com/apps](https://api.slack.com/apps),
   im RP-Workspace installieren. Scopes: `users:read`, `users.profile:read`. Bot User
   OAuth Token danach in den Script Properties als `SLACK_BOT_TOKEN` hinterlegen
   (Projekteinstellungen im Apps-Script-Editor → Script-Properties) — **nicht** im Code.
4. Alle Mitarbeiter tragen ihr Geburtsdatum im neuen Slack-Profilfeld ein.

## Setup-Reihenfolge nach den 4 Schritten oben

1. `ermittleGeburtstagsFeldId()` einmal ausführen → Log zeigt alle Custom-Field-IDs
   mit Label → die zu "Geburtstag" gehörende ID in `SLACK_BIRTHDAY_FIELD_ID`
   (`Config.gs`) eintragen.
2. `legeKalenderAnUndZeigeId()` (`Setup.gs`) **einmalig** ausführen → legt den Kalender
   "RP Geburtstage" an (domainweite Freigabe für `rp-energietechnik.at`) und loggt die
   `CALENDAR_ID` → in `Config.gs` eintragen. Danach `pruefeKonfiguration()` zur Kontrolle:
   die legt bewusst **nichts** mehr selbst an, sonst hätte der Tages-Trigger jeden Tag einen
   weiteren Kalender angelegt, solange die ID nicht eingetragen ist.
3. `syncGeburtstage()` mit `DRY_RUN = true` (Default) manuell ausführen → Log zeigt,
   was angelegt/aktualisiert/gelöscht **würde**, ohne etwas zu schreiben.
4. Nach Sichtprüfung `DRY_RUN = false` setzen, `clasp push --force`, erneut manuell
   ausführen → echte Events im Kalender prüfen.
5. `richteTaeglichenTriggerEin()` einmalig ausführen → ab dann läuft der Sync täglich
   um 04:00 von selbst (siehe `gs-deploy` SKILL.md für belegte Uhrzeiten anderer
   Projekte).
6. Kalender-Abo-Link einmalig im Team-Slack-Channel teilen (Google Calendar →
   Einstellungen des Kalenders → "Kalender-ID" bzw. "Öffentliche URL", falls
   zusätzlich zur domainweiten Freigabe gewünscht).

## Wie Updates/Löschungen erkannt werden

Jedes Event trägt `extendedProperties.private.slackUserId` (die Slack-User-ID). Beim
nächsten Lauf wird darüber exakt das richtige Event wiedergefunden — ein geändertes
Geburtsdatum führt zu einem `Calendar.Events.patch`, kein Duplikat. Wird das
Slack-Feld geleert oder der Mitarbeiter deaktiviert, wird das Event gelöscht.

## Not-Aus gegen Massenlöschung

Liefert Slack für **keinen einzigen** Mitarbeiter einen Geburtstag, bricht der Lauf ab, statt
alle bestehenden Events zu löschen — eine falsche `SLACK_BIRTHDAY_FIELD_ID` oder eine geänderte
Slack-Antwort ist die viel wahrscheinlichere Erklärung als ein Workspace, in dem alle
gleichzeitig ihr Feld leeren.

## Bekannte Unsicherheit

Das Rohformat, in dem Slack den Wert eines Date-Typ-Custom-Fields zurückgibt, ist
nicht öffentlich dokumentiert — `parseGeburtsdatum()` in `SlackClient.gs` geht von
`YYYY-MM-DD` aus, mit Fallback auf `TT.MM.(JJJJ)` für ein Freitextfeld. Beim ersten
echten Testlauf (Schritt 1 oben) im Log gegenchecken, ob das Format passt.

## Weitere bekannte Grenzen

- **29. Februar:** `RRULE:FREQ=YEARLY` auf einem 29.02. zeigt das Event nur in Schaltjahren.
  Betrifft aktuell vermutlich niemanden — falls doch, das Event von Hand auf den 28.02. ziehen.
- **Ein Zeitlimit-Abbruch fängt beim nächsten Lauf wieder von vorne an.** Es gibt keinen
  gespeicherten Cursor: bei einer Belegschaft, die nicht in 4,5 Minuten durchläuft, kämen die
  hinteren Namen nie dran. Bei RP-Größe (ein Slack-Call pro Mitarbeiter) kein Thema — falls
  doch, Cursor in Script Properties nachrüsten (Muster: `Telefon-Qualifizierung`).
- **Löschungen greifen nur bei tatsächlich gelesenen Mitgliedern.** Wer wegen des Zeitlimits
  nicht gelesen wurde, behält sein Event — bewusst die sichere Richtung.
