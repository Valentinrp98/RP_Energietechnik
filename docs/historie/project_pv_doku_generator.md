---
name: project-pv-doku-generator
description: "Google Doc Auto-Generator für PV-Projektdokumentation aus Pipedrive — LIVE seit 2026-08-17 (Webhook 1686556 + Tages-Trigger). Enthält zwei zurückgenommene Fehldiagnosen: meta.entity ist richtig, nicht meta.object."
metadata: 
  node_type: memory
  type: project
  originSessionId: dcf1e9fa-1559-4a81-9edf-07543ea49878
  modified: 2026-08-26T12:35:00.000Z
---

## Ziel
Automatisch erzeugtes, formatiertes Google Doc pro PV-Deal (Kunde, Adresse, Installation, Verkabelung, Anlagendetails) statt aktuell manueller Word-Doku.

**Why:** Doku wird bisher händisch in Word erstellt — Ziel ist Zeitersparnis + einheitliches Format.
**How to apply:** Teil von [[project_rp_energietechnik]], grenzt an [[project_sevdesk_pipedrive_sync]] (Anlagendetails-Tabelle existiert dort konzeptionell schon) und [[project_automations_dashboard]] (Logging-Schema).

## Entschiedenes Design (Stand 2026-08-17)
- **Trigger: hybrid, keine Webhooks nötig.** Täglicher Zeit-Trigger scannt Deals nach neuem Pipedrive-Enum-Feld "Dokumentation Status". User setzt den Wert manuell pro Deal auf "Doku erstellen" → Script erzeugt das Doc und schaltet den Status danach auf einen "Erstellt"-Wert (genauer Label-Text z.B. "Erstellt in Partner-Ordner" — mit User beim Bauen final festlegen). Das Feld ist gleichzeitig Trigger UND Idempotenz-Marker — kein Script-Property-State nötig (vermeidet die 9-KB/~285-Einträge-Falle aus [[reference_apps_script_limits]]).
- **Storage:** Doc landet im Partner-Ordner (Drive), Link wird in ein Pipedrive Custom Field zurückgeschrieben (dasselbe Feld belegt auch den Nachweis "Doku existiert bereits").
- **Anlagendetails (Phase 1):** manuell aus vorhandenem Pipedrive-Textfeld übernommen, bewusst NICHT an den sevdesk-Sync gekoppelt — entkoppelt das MVP von dessen noch offener Go-Live-Checkliste.
- **Logging:** eigenes Log-Sheet in Phase 1, aber mit dem für [[project_automations_dashboard]] bereits entschiedenen Schema (Timestamp | Script-Name | Lauf-Typ | Status | Verarbeitet | Übersprungen | Fehler | Detail; Status-Werte OK/SOFT_ERROR/HARD_ERROR/KETTE_BLOCKIERT). Späterer Umzug ins zentrale Dashboard wird damit nur ein ID-Wechsel, kein Rewrite.
- **Docs-Erzeugung:** `DocumentApp`-Service (Apps-Script-eingebaut) statt roher Google Docs API — kein zusätzliches OAuth-Scope/API-Freischalten nötig.

## Trigger-Feld: 3 Zustände (bestätigt 2026-08-17)
Single-Select-Enum (kein Multi-Select) "Dokumentation Status" am Deal: leer/Default = nichts tun, "Doku erstellen" = Auslöser für nächsten Tageslauf, "Erstellt" = fertig. Kein Script-Property-State nötig.

## Bau-Stand (2026-08-17): Scaffolding fertig, noch nicht testbar
Lokal angelegt unter `C:\Users\valen\OneDrive\Documents\RP\Claude_Work_RP\RP-Google-Scripts\Projektdoku-Generator\` (Config.gs, DocGeneration.gs, SetupHelpers.gs, README.md, appsscript.json) — Pattern 1:1 aus [[project_sevdesk_pipedrive_sync]]/Ordnererstellung-bei-Gewonnen übernommen (fetchPipedrive/patchPipedrive mit Retry, gepuffertes Logging mit Lauf-ID, DRY_RUN-Schalter, `checkConfiguration()` gegen echte dealFields).

**Architektur-Entscheidung:** nutzt den von `Ordnererstellung-bei-Gewonnen` bereits geschriebenen Kundenordner-Link-Feld-Wert wieder und legt das Doc in dessen Unterordner `2_Projektdokumentation` ab — keine eigene Partner-Ordner-Zuordnung nötig. Voraussetzung: dieses Script muss für den Deal zuerst gelaufen sein (sonst SOFT_ERROR, kein Bug).

**Noch KEIN `.clasp.json`** — Apps-Script-Projekt existiert nur lokal, noch nicht im Browser/Editor angelegt (wie bei Sheet-Sync/Ordnererstellung-bei-Gewonnen ursprünglich).

## Bau-Stand (2026-08-17, Update): Apps-Script-Projekt live im Editor, Feldmapping größtenteils fertig
Script-ID `1F5wPoZ-11wzSXo7Td6S5KTuCFRb4BIyLzLFwdD6C0z6tWnsm6SFcAffs`, `.clasp.json` verknüpft. Dateien im Editor heißen `Config.js`/`DocGeneration.js`/`SetupHelper.js` (nicht `.gs` — clasp hat beim Pull umbenannt, alte `.gs`-Duplikate lokal gelöscht).

**Trigger-Feld final geklärt:** bestehendes Feld "Projektdokumentation-Partner" (field_code `d33a358f840e5e1ccade4e1f88cd9109ae3e63f4`) wird zweckentfremdet statt neu angelegt. Die alten Optionen ("Projektdoku erstellt"=235, "Projektdoku vollständig"=234) werden durch zwei neue ersetzt: "Projektdoku rdy for creation" (Trigger) und "Projektdoku erstellt und abgelegt" (fertig) — Valentin hat das live im Pipedrive-UI umbenannt, neue Options-IDs stehen nach dem Speichern noch aus.

**Fast alle Inhaltsfelder aus echtem `listDealFieldsHelper()`-Dump übernommen** (Dachform, Eindeckung, Ausrichtung [Mehrfachauswahl/set!], Netzansuchen, DC/AC-Kabelweg, Verteiler-Ort, Anlagendetails via "Verkaufte_Artikel_Summary", Material-Liefertermin, "Sonstige Mitteilung Kunde"). Dabei zwei Bugs aus der ersten Fassung gefixt: Netzansuchen war fälschlich als Boolean codiert (ist tatsächlich enum Ja=210/Nein=211), Enum-/Set-Felder wurden vorher gar nicht über Options-IDs aufgelöst (hätten rohe Zahlen im Doc gezeigt statt Labels) — jetzt über `resolveEnumLabel()`/`resolveSetLabels()` in Config.js gelöst.

**Montagetermin umgebaut:** kein einzelnes "Gewünschter Montagetermin"-Feld gefunden — stattdessen 3 separate Datumsfelder (DC-Termin, AC-Termin, IB-Termin/Inbetriebnahme) als eigene Zeilen in Sektion 4.

**Notizen-Sektion zeigt jetzt 2 getrennte Felder:** "Sonstige Mitteilung Kunde" (was der Kunde gesagt hat) UND ein neues, noch anzulegendes internes "Notizen"-Feld (`NOTIZEN_INTERN_FIELD_KEY`, für Fulfillment-Hinweise wie im Mockup "Heizstab mit Kunde abklären") — bewusst getrennt, unterschiedlicher Zweck.

## Alle Feld-TODOs aufgelöst (Stand 2026-08-17, 13:30)
- `DOKU_STATUS_OPTION_TRIGGER` = `235` ("Projektdoku rdy for creation"), `DOKU_STATUS_OPTION_DONE` = `234` ("Projektdoku erstellt und abgelegt")
- `DOKU_LINK_FIELD_KEY` = `e08d635f1391e5735802dc066e61fac836c5a0d0` (Feld "Projektdokumentation Link", Typ Text)
- `NOTIZEN_INTERN_FIELD_KEY` = `2565f8005e57f0b6bad0a36560f9f3213beffe98` (Feld heißt in Pipedrive tatsächlich "Projektdoku-Notizen", nicht "Notizen")
- `checkConfiguration()` mit diesen Werten noch nicht gegengetestet (lokale Datei aktualisiert, aber noch nicht wieder in den Browser-Editor eingefügt)

## Erfolgreich live getestet + committed (Stand 2026-08-17, ~14:30)
Erster echter LIVE-Lauf gegen Deal 7253 erfolgreich: Doc korrekt erzeugt (Enum-Labels, Mehrfachauswahl, Termine, Montagepartner alle richtig aufgelöst — per Google-Drive-Zugriff inhaltlich verifiziert), Link+Status verifiziert nach Pipedrive zurückgeschrieben (`patchCustomFieldsVerified`). Danach kompletten Code-Review (`FIXES-2026-08-17.md`, P0/P1/P2) abgearbeitet: Self-Healing bei fehlgeschlagenem Patch, Duplikat-Schutz inkl. Papierkorb-Filter, Zeit-Guard fürs 6-Min-Limit, `checkConfiguration()` prüft jetzt alle 18 Werte + alle Options-IDs + Feldtyp, `moveTo()` statt `addFile`/`removeFile` (Shared-Drive-tauglich), PLZ-Fix in der Adresse, Anlagendetails als Bullet-Liste. `checkConfiguration()` zuletzt bestätigt: "alles passt".

Committed in `RP-Google-Scripts` main-Branch (nur der neue `Projektdoku-Generator`-Ordner, nichts von den anderen zeitgleich offenen Änderungen im Repo — Fortschritt-Script, Ordnererstellung-bei-Gewonnen, restliches Sheet-Sync — die gehören nicht zu dieser Session und wurden bewusst nicht mit committed).

## Offen / noch zu tun
- `SETUP_EINMALIG_createDailyTrigger()` noch nicht ausgeführt — kein täglicher Trigger aktiv, bisher nur manuelle Testläufe
- Nicht committed/nicht gepusht zum Remote (`git push` noch nicht gemacht, nur lokaler Commit)
- Sheet-Sync-Duplikat-Aktivitäten-Fix (siehe [[project_pv_doku_generator]] F9 im Bau-Log bzw. eigener Kontext) ist nur lokal, nie live getestet/bestätigt — separates offenes Thema, nicht Teil dieses Commits

## Kein Inhaltsfeld ist Pflicht — nur Kundenordner+Unterordner (Stand 2026-08-20)
`processDeal()` verlangt zwingend nur: Kundenordner-Link am Deal gesetzt + Unterordner "2_Projektdokumentation" existiert im Kundenordner. Alle 12 Inhaltsfelder (Dachform, Kabelwege, Termine, Anlagendetails/Module, ...) sind optional — fehlt eins, steht im Doc `(leer)`, blockiert nichts. Deshalb reicht z.B. nur Module+Name (für eine "SM"-Doku) schon für eine erste Doc-Erzeugung, der Rest kann später für "FS" nachgetragen werden.

**Why:** Valentin wollte wissen, ob er die Projektdoku schon mit Teildaten (nur Module+Name) auslösen kann, bevor alle FS-relevanten Felder (Dachform, Verkabelung, Termine) vorliegen.
**How to apply:** Bei Fragen "reicht das schon zum Auslösen" — ja, außer Kundenordner-Link/Unterordner ist alles optional.

## Re-Trigger-Mechanismus "Projektdoku neu erstellen" (gebaut 2026-08-20, TODO in Pipedrive anlegen)
Der bestehende Duplikat-Schutz (verhindert zweites Doc bei erneutem Trigger) blockierte bisher auch das gewollte Neu-Bauen, wenn nach der ersten (Teil-)Doku weitere Felder nachgetragen wurden — ein erneuter Trigger auf denselben Options-Wert hätte nur SOFT_ERROR "Doc existiert bereits" oder höchstens Link/Status nachgezogen, nie den Inhalt aktualisiert.

Lösung: dritter Options-Wert am selben Enum-Feld "Projektdokumentation-Partner", eigene Konstante `DOKU_STATUS_OPTION_NEU_ERSTELLEN` (Config.js) — bewusst NICHT der bestehende Trigger-Wert wiederverwendet, damit ein versehentliches Zurücksetzen auf "rdy for creation" nicht automatisch das bestehende Doc löscht. `findDealsForDokuErstellung()` liefert jetzt `{deal, forceRegenerate}`-Paare; `processDeal(deal, forceRegenerate)` verwirft bei `forceRegenerate=true` ein vorhandenes Doc (Papierkorb) und baut komplett neu, statt SOFT_ERROR zurückzugeben.

**Offener TODO:** neue Pipedrive-Option "Projektdoku neu erstellen" am Feld noch anlegen (wie bei den ersten beiden Options-Umbenennungen vom 17.08.), dann deren ID in `DOKU_STATUS_OPTION_NEU_ERSTELLEN` (aktuell `TODO_NEUE_OPTION_ID_EINTRAGEN`) eintragen, danach `checkConfiguration()` laufen lassen (prüft die neue ID jetzt mit).

**Why:** Ermöglicht den Workflow "früh mit Teildaten erstellen (SM reicht), später mit Vollständigkeit neu erzeugen (für FS)" ohne manuelles Doc-Löschen.
**How to apply:** Sobald die Pipedrive-Option existiert und die ID eingetragen ist: Deal-Status auf "Projektdoku neu erstellen" setzen → nächster Lauf (Tages-Trigger oder `testEinzelDeal()` mit `FORCE_REGENERATE=true`) verwirft das alte Doc und baut mit aktuellem Feldstand neu.

## Zweiter Vollreview + Fixes (2026-08-21)
Kompletter Re-Review nach dem Re-Trigger-Umbau; alle Fixes lokal eingearbeitet in Config.js/DocGeneration.js/SetupHelper.js, Details in `REVIEW-2026-08-21.md` im Projektordner. Noch NICHT in den Browser-Editor übertragen und nicht committed.

Die vier Funde, die wirklich weh getan hätten:
- **Datenverlust bei forceRegenerate:** altes Doc wurde VOR dem Bau des neuen getrasht → ein Fehler in buildProjectDoc/moveTo hieß: Kundendoku weg, keine neue da. Jetzt bauen → verschieben → dann altes verwerfen.
- **Deal unreparierbar:** Link+Status gingen in einem PATCH raus. Status kam an, Link wurde still verworfen → Deal auf DONE ohne Link, und weil nur auf Trigger-Werte gefiltert wird, fand ihn kein Folgelauf mehr. Jetzt zwei getrennte verifizierte PATCHes, Link zuerst.
- **checkConfiguration() war stumm:** der ganze API-Block hing an `if (probleme.length === 0)` — der offene TODO-Platzhalter DOKU_STATUS_OPTION_NEU_ERSTELLEN hat damit JEDE Prüfung abgeschaltet. Jetzt laufen die API-Prüfungen immer. Zusätzlich: checkConfiguration() läuft am Anfang jedes Tageslaufs und blockiert mit KETTE_BLOCKIERT — solange die Pipedrive-Option fehlt, macht der Trigger bewusst nichts.
- **Kundenordner ist NICHT pro Deal:** Ordnererstellung-bei-Gewonnen benennt ihn `{Name} - {Adresse}` und verwendet vorhandene wieder. Zwei Deals derselben Person an derselben Adresse teilten sich den Ordner → der zweite bekam den Doc-Link des ersten und nie eine eigene Doku. Dateiname trägt jetzt die Deal-ID: `Projektdokumentation - {Name} (Deal {id})`, Überschrift im Doc bleibt ohne. findExistingDoc() prüft jetzt zuerst den gespeicherten Pipedrive-Link, dann den Namen (überlebt Personen-Umbenennungen und die Namensänderung des bestehenden Docs von Deal 7253).

Weiter gefixt: encodeURIComponent auf den v2-Cursor (unencodiertes `+` konnte Seiten verschlucken), LockService, lost/deleted-Deals bekommen keine Doku, formatPipedriveDate ohne `new Date()` (UTC-Off-by-one-Falle), file.getUrl() statt doc.getUrl() nach saveAndClose, Log-Sheet legt bei transientem openById-Fehler kein zweites Sheet mehr an, Status-Feldtyp-Check nur noch 'enum', personFields-Prüfung für Adresse/PLZ, dealFields-500er-Abschneiden wird erkannt.

**PLZ-Fix (verknüpft mit [[reference_pipedrive_plz_feld_unzuverlaessig]]):** formatAdresse() hängt das PLZ-Feld nicht mehr blind an. 4-Ziffern-Plausibilitätsprüfung (im Feld stand real schon eine Telefonnummer), Adresse gewinnt wenn sie selbst eine PLZ hat, Widerspruch landet als Warnung in der Log-Detail-Spalte statt im Doc. Rückgabe ist jetzt `{text, warnung}`, buildProjectDoc() nimmt die Adresse als Parameter.

Bewusst offen gelassen: Vollscan aller Deals pro Lauf (itemSearch auf Enum ungeprüft), kein Dead-Letter für dauerhaft fehlerhafte Deals (tägliche Wiederholung + Log-Wachstum), Shortcut-Fall beim Unterordner.

## 🔴 Zweimal falsch diagnostiziert (2026-08-26): meta.entity ist RICHTIG, nicht meta.object
**Die frühere Fassung dieses Abschnitts war falsch und ist ersetzt.** Behauptet wurde, `meta.entity` existiere im Pipedrive-Payload nicht und müsse `meta.object` heißen — genau umgekehrt:
- **Webhooks v2** (registriert ist v2): `meta.entity` + `meta.action: "change"` — https://pipedrive.readme.io/docs/guide-for-webhooks-v2#webhook-format
- **Webhooks v1**: `meta.object` + `meta.action: "updated"` — https://pipedrive.readme.io/docs/guide-for-webhooks

Der "Fix" `96c14f7` (entity → object) hat den bis dahin korrekten Filter kaputtgemacht: ab Deployment-Version 3 war `meta.object` undefined, die Abbruchbedingung immer wahr, jedes Event wurde verworfen. Rückgebaut in `5381f4c`, Filter akzeptiert jetzt beide Schreibweisen. Deployment `AKfycbz0…` steht auf @4.

**Nachweislich funktionierend seit 26.08. 14:28:** Test-POST mit `create.deal` durch den Cloudflare-Relay erzeugt die erwartete SOFT_ERROR-Zeile im Log-Sheet (`[Webhook] Event verworfen -- erwartet change.deal, bekommen create.deal`). Damit sind Relay, Secret, Deployment und meta-Auswertung als Kette bewiesen — nicht mehr nur vermutet.

**Der eigentliche Grund, warum nie eine Doku automatisch entstand** (aus dem Log-Sheet, 253 Zeilen): es gibt **keine einzige `[Webhook]`-Zeile** seit Go-Live, und **keine einzige Zusammenfassungszeile des Tageslaufs** — `generateDailyProjectDocumentation()` schreibt so eine Zeile unbedingt bei JEDEM Lauf, es kann also nie einer gelaufen sein. Alle 253 Zeilen stammen aus manuellen `testEinzelDeal()`-Läufen (Arbeitszeiten, nie 2:00 Uhr). Beide Automatik-Wege lagen also gleichzeitig still, und weil manuelle Läufe Dokumente erzeugten, sah es von außen funktionierend aus.

**Why:** Zwei Diagnose-Fehler in Folge am selben Feld. Der erste kam daher, dass eine v1-Doku-Seite als Quelle für ein v2-Payload gelesen wurde; der zweite (die Fehlerursache überhaupt für "beweisbar" zu halten) daher, dass Pipedrives Zustellungs-Statistik (`is_active`/`last_http_status=200`) mit tatsächlicher Verarbeitung verwechselt wurde — `doPost()` antwortet bewusst immer 200.
**How to apply:** Bei "Webhook liefert 200, aber nichts passiert" ist der einzige belastbare Test ein **Testpayload, der eine Zeile ins Log-Sheet schreiben MUSS** (z.B. `create.deal` → Ablehnungszeile). Zustellungs-Statistik beweist nichts. Und bei v1-vs-v2-Feldnamen immer die passende Doku-Seite öffnen — `guide-for-webhooks` ist v1, `guide-for-webhooks-v2` ist v2. Siehe [[project_webhook_migration_2026_08_21]] und [[project_gs_deploy_workflow]].

## Log-Sheet ist jetzt aussagekräftig für Fehlschläge (2026-08-26)
Vorher landete jeder verworfene Webhook-Event nur in Stackdriver — deshalb war der Bug oben unsichtbar. Jetzt schreiben unerwartetes `meta`, fehlendes `data.id` und ein fehlender `custom_fields`-Block eine SOFT_ERROR-Zeile **ins Log-Sheet** (mit Roh-`meta`). Still bleibt nur der Normalfall "diese Deal-Änderung betrifft das Statusfeld nicht". Zusätzlich prüft `verarbeiteTreffer()` den frisch nachgeladenen Status jetzt auch wirklich, statt ihn nur zu lesen — vorher hätte der neue custom_fields-Fallback bei jeder beliebigen Deal-Änderung ein Doc gebaut. Neu: `DIAGNOSE_pruefeGesundheit()` prüft Tages-Trigger und Webhook-Registrierung in einem Aufruf.

## 🔴 ECHTE Ursache gefunden (2026-08-26): Custom Fields sind im Webhook-Payload OBJEKTE
Das Webhook-v2-Payload ist **nicht** das REST-v2-Format. Genau diese Verwechslung ist der Grund, warum dieser Webhook von Go-Live bis 26.08.2026 **nie** etwas getan hat:

```
REST v2 (GET /deals):  "custom_fields": { "<hash>": 235 }                      -> nackter Wert
Webhook v2:            "custom_fields": { "<hash>": {"id": 235, "type":"enum"} } -> Objekt
```

Der Vorab-Filter machte `String(cf[key])` auf das Objekt → `"[object Object]"`, matcht nie gegen `"235"` → stiller `return` bei JEDEM Event. Kein Fehler, keine Log-Zeile, Pipedrive bekam 200. Deshalb sah die Zustellstatistik bis zuletzt gesund aus (`is_active=1`, `last_http_status=200`, tägliche Deliveries) — und deshalb gab es null `[Webhook]`-Zeilen im Log-Sheet.

**Alle Custom-Field-Typen im Webhook-Payload** (Quelle: https://pipedrive.readme.io/docs/webhooks-v2-migration-guide#custom-fields-format-in-webhooks-v2):
- `enum` (Einfachauswahl), `people`, `org`, `user` → `{id, type}` — **nur die ID, kein Label**
- `set` (Mehrfachauswahl) → `{values: [{id}, {id}], type}`
- `varchar`/`text`/`varchar_auto`/`double`/`date`/`phone` → `{type, value}`
- `monetary` → `{type, value, currency}`; `time` → `{type, value, timezone_id}`
- `daterange`/`timerange` → `{type, from, until}` (kein `value`!)
- `address` → `{type, value, postal_code, locality, formatted_address, ...}`

Weiter belegt: `data.custom_fields` enthält die befüllten Felder des Deals; `previous.custom_fields` **nur die geänderten**. Ein leeres Feld fehlt im Block ganz (`custom_fields: {}` im Create-Beispiel).

Fix: `leseWebhookOptionId()` in `Webhook.js` deutet beide Formen; unbekannte Form → `undefined` → laute SOFT_ERROR-Zeile + Deal wird trotzdem frisch nachgeladen, statt still zu verschwinden. Commit `bc4613a`, Deployment `AKfycbz0…` @5.

**Verifiziert, nicht angenommen:** 11 Offline-Fälle gegen die Filterlogik (echtes v2-Format, alte REST-Form, v1-`meta.object`, unbekannte Form, fehlender `custom_fields`-Block, leeres Feld, falsches Secret) alle PASS. Dann live durch den Relay: Payload mit `{id:235,type:"enum"}` auf eine nicht existierende Deal-ID → Filter lässt durch, Nachladen scheitert mit dem erwarteten 404, HARD_ERROR-Zeile im Log-Sheet. Vorher wäre derselbe Payload lautlos verworfen worden.

**Why:** Drei Diagnose-Anläufe an einem Tag am selben Feld. Anlauf 1+2 haben am `meta`-Feldnamen gedreht (v1- gegen v2-Doku verwechselt), obwohl der eigentliche Fehler eine Ebene tiefer im Payload lag. Gefunden wurde er erst, als die Payload-Struktur vollständig gegen die Doku geprüft wurde statt nur die eine verdächtige Zeile.
**How to apply:** Bei JEDEM Pipedrive-Webhook-Handler gilt: das Payload-Format ist ein eigenes Format, nicht die API-Antwort. Nie einen Filter auf `custom_fields` schreiben, ohne die Migration-Guide-Sektion oben offen zu haben. Und ein Filter, der bei unerwarteter Form still aussteigt, ist der Fehler — er muss laut ins Log und im Zweifel den Datensatz frisch nachladen.

### Alle 4 Webhook-Empfänger im Repo geprüft (26.08.2026)
Nur der Projektdoku-Generator war betroffen — weil nur er einen Custom-Field-Wert gegen eine Options-ID **vergleicht**:

| Projekt | Payload-Zugriff | betroffen |
|---|---|---|
| Projektdoku-Generator | `String(cf[KEY]) === '235'` | **ja**, gefixt |
| Montagepartner-aus-Bundesland | nur `!cf[KEY]` / `cf[KEY] &&` (truthy) | nein |
| Bundesland-aus-PLZ | nur `!cf[KEY]` (truthy) | nein |
| Ordnererstellung-bei-Gewonnen | `data.status` (Standardfeld, nackter String) | nein |

**Truthiness rettet die anderen zufällig**, nicht aus Absicht: `{id:4,type:'enum'}` ist genauso truthy wie `4`. Sobald dort jemand einen Wert-Vergleich einbaut, tritt derselbe Bug auf. Montagepartner + Bundesland-aus-PLZ stehen außerdem korrekt auf `meta.entity` — der falsche Fix von heute Morgen wurde nur im Projektdoku-Generator angewendet, das war Glück.

**Suchfalle:** `Ordnererstellung-bei-Gewonnen` heißt seine Webhook-Datei `WebhookHandler.gs` — ein `grep --include=*.js` nach `function doPost` findet sie NICHT. Bei repo-weiten Suchen in diesem Repo immer `--include=*.js --include=*.gs`, das Repo mischt beide Endungen.

## Zustand nach dem 26.08.
- Webhook 1686556: aktiv, `version=2.0`, `change.deal`, HTTP 200, keine Duplikate — war nie das Problem.
- Deployment `AKfycbz0…` @5 — beweisbar bis ins Log-Sheet durchlaufend.
- **Tages-Trigger existiert nicht** (`DIAGNOSE_pruefeGesundheit()` bestätigt). `SETUP_EINMALIG_createDailyTrigger()` ist der einzige offene Klick; `clasp run-function` geht bei dem Projekt nicht (kein verknüpftes GCP-Projekt, `NOT_FOUND`).
- Achtung bei einem manuellen `generateDailyProjectDocumentation()`: `DRY_RUN=false`, verarbeitet ALLE wartenden Deals in einem Zug.

## Workflow-Muster "Light-Doku dann Voll-Doku" bestätigt live nutzbar (2026-08-25)
Valentins realer Ablauf: erst Anfangsdaten rein → Light-Projektdoku für die Netzanmeldung erzeugen → später Kundendetails komplett nachtragen → Doku nochmal mit vollen Daten neu bauen. Dafür ist der [[project_pv_doku_generator]]-Re-Trigger-Mechanismus (Status-Dropdown "Projekdoku NEU → Korrektur und überschreiben") exakt gebaut — braucht KEINEN Code/Editor-Zugriff, nur den Dropdown-Wert in der Pipedrive-UI umstellen.

Webhook-Health am 25.08. verifiziert (`checkWebhookRegistration()`): Webhook-ID 1686556, `is_active=1`, `last_http_status=200`, letzte Zustellung Sekunden vor der Prüfung — Status-Wechsel im Dropdown löst also SOFORT einen Doc-Neubau aus (nicht erst der 2-Uhr-Backup-Trigger).

**Why:** Valentin fand das Neu-Ausführen im Apps-Script-Editor "zach" (mühsam) für diesen wiederkehrenden Fall.
**How to apply:** Bei "wie bekomme ich die Doku aktualisiert, wenn neue Kundendaten reinkommen" — Antwort ist der Pipedrive-Dropdown, nicht `testEinzelDeal()`. `testEinzelDeal()` bleibt nur für Sonderfälle (z.B. Korrektur nach fehlerhaft eingepflegten Daten, wie bei Deal 7093/Knittelfelder).
