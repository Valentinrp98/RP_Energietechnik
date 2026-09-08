# Geburtstagskalender-Sync

Liest Geburtstage aus einem Slack Custom Profile Field und schreibt sie als jährlich
wiederkehrende Ganztags-Events in einen einzigen gemeinsamen Google-Kalender
("RP Geburtstage"), den alle RP-Mitarbeiter abonnieren bzw. auf den sie eingeladen
sind. Kein Schreiben in individuelle Mitarbeiter-Kalender.

Hintergrund/Entscheidungshistorie: Bauplan — liegt **nur lokal** auf Valentins Rechner, nicht
im Repo; alles zum Weiterbauen Nötige steht in dieser README:
`C:\Users\valen\.claude\plans\passt-mach-bitte-den-resilient-clarke.md`.

## Manuelle Setup-Schritte

**Stand 08.09.2026 — 1 bis 3 sind erledigt:** Apps-Script-Projekt gebunden (per `clasp create`),
Slack-Feld "Geburtstag" (Typ Date) angelegt, Feld-ID `Xf0BV2CREFUP` live verifiziert, Slack App
"Geburtstagsapp RP" mit Bot Token installiert und in den Script Properties hinterlegt, Kalender
"Geburtstage RP intern" manuell unter `sales@rp-energietechnik.at` angelegt und
`valentin@rp-energietechnik.at` (der ausführende Account) darauf schreibberechtigt.
**Offen: Schritt 4** — bisher hat nur Valentin sein Geburtsdatum eingetragen.

Die Anleitung bleibt hier als Referenz stehen, falls das Setup nochmal aufgebaut werden muss:

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

## Gratulations-Post im Slack-Channel (`Geburtstagspost.gs`)

Zweiter, unabhängiger Teil: `postGeburtstagsGruesse()` prüft morgens, wer heute Geburtstag
hat, und postet `🎂 Heute hat @Name Geburtstag — alles Gute!` in alle Channels aus
`BIRTHDAY_CHANNEL_IDS` (`C0C063H2VT5` = eigener Geburtstags-Channel, `C070PAA2VDE` =
#allgemein). Eigener Trigger um 08:00 via `richteGeburtstagsPostTriggerEin()`, unabhängig
vom Kalender-Sync um 04:00. Ein Channel, in dem der Bot fehlt, wird geloggt und
übersprungen — die übrigen laufen durch.

Voraussetzungen dafür:
1. Bot-Scope **`chat:write`** in der App ergänzen → App neu installieren (Bot Token bleibt gleich)
2. Bot in den Channel einladen: `/invite @Geburtstagsapp RP`
3. `pruefeSlackRechte()` ausführen — loggt Workspace, Bot und alle erteilten Scopes und sagt
   explizit, ob `chat:write` angekommen ist. Braucht selbst keinen Scope, postet nichts.

**Doppelpost-Schutz:** die Script-Property `LETZTER_GRATULATIONS_POST` hält
`{tag, posted: ["<channelId>:<userId>", …]}` und wird nach jedem einzelnen erfolgreichen Post
gespeichert. Ein Fehler mitten im Lauf führt
also nicht dazu, dass beim nächsten Lauf schon Gratulierte erneut gepostet werden. `DRY_RUN`
gilt auch hier: bei `true` wird nur geloggt, was gepostet würde.

## Übersicht-Sheet (`Uebersicht.gs`)

Ein Blick auf alle Geburtstage statt Profil-für-Profil-Klicken. Spalten: Name, Slack-ID,
Geburtstag (TT.MM.), **Erstmals erfasst**, Zuletzt gesehen, Status (`✓ eingetragen` /
`— fehlt noch`). Sortiert nach Monat/Tag, wer nichts eingetragen hat rutscht nach unten —
damit ist die Liste direkt die Nachfass-Liste.

Einrichtung: `legeUebersichtSheetAn()` einmal ausführen, geloggte ID in
`UEBERSICHT_SHEET_ID` eintragen. Danach zieht `syncGeburtstage()` das Sheet bei jedem Lauf
automatisch mit; `aktualisiereUebersicht()` geht auch jederzeit von Hand.

**„Erstmals erfasst" kommt nicht von Slack.** Slack liefert keinen Zeitstempel, wann ein
Profilfeld gefüllt wurde. Der Wert ist der Tag, an dem dieses Skript das Datum zum ersten
Mal gesehen hat, und wird danach nie überschrieben — auch nicht, wenn jemand sein Datum
später korrigiert.

Das Sheet legt sich **nicht** selbst an, wenn die ID fehlt (es wird nur geloggt und
übersprungen). Grund: `aktualisiereUebersicht()` läuft täglich mit, Selbst-Anlage hätte
jeden Tag ein neues Sheet erzeugt — derselbe Fehler wie beim Kalender am 05.09.2026.

## Not-Aus gegen Massenlöschung

Liefert Slack für **keinen einzigen** Mitarbeiter einen Geburtstag, bricht der Lauf ab, statt
alle bestehenden Events zu löschen — eine falsche `SLACK_BIRTHDAY_FIELD_ID` oder eine geänderte
Slack-Antwort ist die viel wahrscheinlichere Erklärung als ein Workspace, in dem alle
gleichzeitig ihr Feld leeren.

## Datumsformat — geklärt (08.09.2026)

Slack liefert Date-Typ-Custom-Fields als `YYYY-MM-DD` (offiziell dokumentiert bei
`users.profile.set`, live im DRY_RUN-Lauf bestätigt). `parseGeburtsdatum()` in
`SlackClient.gs` behandelt genau das, mit Fallback auf `TT.MM.(JJJJ)` für den Fall,
dass das Feld irgendwann als Freitext neu angelegt wird. Das Geburts**jahr** wird
bewusst verworfen — nur Monat/Tag landen im Kalender, also steht dort kein Alter.

Nebenbefund: in der Slack-Admin-Oberfläche zeigt das Feld "Geburtstag" **kein**
"API"-Badge und keine Field-ID, anders als die Short-Text-Felder (City, Kostenstelle).
Das ist kein Hinweis auf fehlenden API-Zugriff — über `team.profile.get` ist das Feld
normal lesbar. Nicht davon irritieren lassen.

## Weitere bekannte Grenzen

- **29. Februar:** `RRULE:FREQ=YEARLY` auf einem 29.02. zeigt das Event nur in Schaltjahren.
  Betrifft aktuell vermutlich niemanden — falls doch, das Event von Hand auf den 28.02. ziehen.
- **Ein Zeitlimit-Abbruch fängt beim nächsten Lauf wieder von vorne an.** Es gibt keinen
  gespeicherten Cursor: bei einer Belegschaft, die nicht in 4,5 Minuten durchläuft, kämen die
  hinteren Namen nie dran. Bei RP-Größe (ein Slack-Call pro Mitarbeiter) kein Thema — falls
  doch, Cursor in Script Properties nachrüsten (Muster: `Telefon-Qualifizierung`).
- **Löschungen greifen nur bei tatsächlich gelesenen Mitgliedern.** Wer wegen des Zeitlimits
  nicht gelesen wurde, behält sein Event — bewusst die sichere Richtung.
