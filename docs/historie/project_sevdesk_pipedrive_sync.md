---
name: project-sevdesk-pipedrive-sync
description: "Google Apps Script Projekt \"Sevdesk Articles to PipeDrive\" — syncet PV-Komponenten aus sevdesk-Aufträgen in Pipedrive Deal-Felder"
metadata: 
  node_type: memory
  type: project
  originSessionId: 23286a28-3863-428f-b783-72acdeb7dddc
  modified: 2026-09-02T06:45:18.866Z
---

## Verkaufte_Artikel_Summary: 255-Zeichen-Limit gerissen + Kundennummer-Fallback ergänzt (2026-09-01)
**Bug (live aufgetreten, Order 30092157):** `Verkaufte_Artikel_Summary` ist ein Pipedrive-autocomplete-Feld mit hartem 255-Zeichen-Limit. `summaryParts.join(' | ')` in `aggregatePositions()` (fieldkeysandmapping.js) hatte keine Kappung -- bei einem Auftrag mit vielen/langen Positionen (Gewerbe-ähnlich) hat der String das Limit gesprengt, Pipedrive hat den GESAMTEN PATCH abgelehnt (`ERR_SCHEMA_VALIDATION_FAILED`), nicht nur das eine Feld -- alle anderen Felder blieben dadurch auch leer. Fix in `writeArticleFieldsToDeal()` (syncengine.js): Summary wird auf 255 Zeichen gekappt (`substring(0,252)+'...'`) bevor sie geschrieben wird.
**Zusätzlich verkürzt** (User wollte weniger abgeschnitten sehen, nicht nur hart kappen): Module zeigen jetzt `${qty}x ${Marke} ${Wp}` statt vollem Rohnamen (exakter Name steht eh in `Module_Bezeichnung`, dafür neue `extractValue` für die Kategorie `module` in `ARTICLE_PATTERNS`, Regex `(\d+)\s*WP`); Speicher-Zeile zeigt die redundante "(=X kWh)"-Summe nur noch bei Menge>1; Pauschalen abgekürzt (`Elektroinstallation:`→`E-Install`, `Elektromaterial:`→`E-Material`, `Techn. Projektierung:`→`Projekt.`, kein Doppelpunkt/Leerzeichen vor €).
**Wichtig:** Die volle, ungekürzte Version (`formatiereErkannteFelder()` + kompletter `aggregated.summary`) landet weiterhin unverkürzt im Sync-Log-Sheet -- die Kürzung betrifft NUR das Pipedrive-Anzeigefeld, kein Informationsverlust beim Debuggen.

**Kundennummer-Fallback ergänzt** in `syncEinzelDealOhneStatusFilter(dealId)`: bisher NUR über Angebotsnummer nutzbar. Jetzt: fehlt die Angebotsnummer am Deal, aber Kundennummer ist gesetzt → neue Funktion `syncEinzelDealUeberKundennummer_()` sucht `/Contact?customerNumber=X` → Contact-ID → `/Order?contact[id]=X&contact[objectName]=Contact`. Bei >1 Auftrag für den Kunden: gleiches Muster wie bei Angebotsnummer-Mehrfachtreffern -- gewinnt der eine mit Status "Angenommen" (500), falls es GENAU einen gibt, sonst nichts schreiben (WARNUNG geloggt).
**UNGETESTET:** `/Contact?customerNumber=` und `/Order?contact[id]=...&contact[objectName]=Contact` sind vom bestehenden Bracket-Notation-Muster (`/OrderPos?order[id]=X&order[objectName]=Order`) abgeleitet, aber noch nie live gegen sevdesk verifiziert -- vor dem ersten Einsatz mit einem bekannten Kundennummer-only-Deal gegenchecken.
**Warum kam das jetzt hoch:** Valentin wollte 1 Deal manuell nachsynct, der beim ersten Versuch fehlgeschlagen war (s.o., 255-Zeichen-Bug) und dabei nur die Kundennummer hatte, keine Angebotsnummer.

## Neues Feld "Module_Bezeichnung" (2026-08-26, live getestet + bestätigt)
Ziel: exakte Modulbezeichnung (voller sevdesk-Artikelname, nicht nur die `Module_Marke`-Enum) automatisch bei jedem Sync ins Deal schreiben, damit Valentin sie in Pipedrive-Mailvorlagen per Platzhalter (`{{deal.Module_Bezeichnung}}`) nutzen kann. Bewusst NICHT die volle Produktdatenbank-Anreicherung (Garantie/Herkunft/Made-in-Europe-Bonus) — die wurde in einem Plan entworfen, aber vom User explizit auf "nur die genaue Modulbezeichnung, den Rest noch nicht" eingeschränkt.

**Umsetzung (3 Dateien, Pattern wie bestehende Felder):**
- `fieldsetup.js`: neue einmalige Funktion `createModulBezeichnungField()` (Feldtyp `varchar_auto`, wie `sevdesk_angebotsnummer`).
- `fieldkeysandmapping.js`: `FIELD_KEYS.Module_Bezeichnung = 'ba5c7c11d7a26d06d7de9973c25c4042dc21ae2d'` (live von Valentin erstellt + verifiziert). `classifyPosition()` gibt jetzt bei JEDER Kategorie `rawName: name` zurück (vorher nur beim `unknown`-Fallback) — harmlose, additive Änderung. `aggregatePositions()` setzt `result.Module_Bezeichnung = c.rawName` im `module`-Case, gleiche "letzter gewinnt"-Logik wie `Module_Marke`.
- `syncengine.js`: `writeArticleFieldsToDeal()` schreibt `customFields[FIELD_KEYS.Module_Bezeichnung] = aggregated.fields.Module_Bezeichnung || null`.

**Deploy-Ablauf, der funktioniert hat:** lokale Änderung → `clasp push` (durch Claude direkt im Bash-Tool ausgeführt, kein Browser-Copy-Paste nötig) → Valentin führt `createModulBezeichnungField()` einmal im Online-Editor aus → field_code zurückgemeldet → lokal eingetragen → erneut `clasp push`.

**Live-Test (2026-08-26):** `testEinzelDealOhneStatusFilter()` mit Deal 7356 schlug fehl — **kein Bug**, sondern die bestehende Sicherheitslogik griff korrekt (2 sevdesk-Aufträge mit identischer Angebotsnummer "2026-633-A", Script bricht bewusst ab statt zu raten, siehe bekanntes ~154-von-4080-Duplikate-Problem oben). Danach mit Deal 7253 (bekannt guter Testdeal) erfolgreich verifiziert.

**Why:** Pipedrive kann bei eigenen Custom Fields kein "Feld zieht automatisch weitere Felder nach"-Verhalten wie bei Person-Verknüpfungen (Name+Telefon) — der nächstbeste Weg ist, das Feld bei jedem automatischen Sync-Lauf direkt mitzuschreiben, ganz ohne manuelle Auswahl.
**How to apply:** Falls Valentin später doch noch die Garantie/Herkunft/Bonus-Anreicherung will (siehe verworfener Plan, PRODUKT_SPECS-Lookup nach Kategorie+Marke aus `eag-automation/produktdatenbank.csv`), auf dasselbe Muster zurückgreifen — Insertion Point ist derselbe `module`/`wechselrichter`/`speicher`-Case in `aggregatePositions()`.

## Zweck
Automatisches Befüllen von Pipedrive Deal-Custom-Fields mit PV-Komponenten (Module, WR, Speicher, Wallbox, Notstrom, Heizstab), sobald ein sevdesk-Auftrag Status "Angenommen" (Code 500) erreicht.

**Why:** Verkäufer/Fulfillment sollen nicht händisch Artikeldaten in Pipedrive nachpflegen.
**How to apply:** Teil von [[project_rp_energietechnik]] (RP Energietechnik). Relevant wenn User über sevdesk, Pipedrive Custom Fields, Apps Script oder PV-Artikel-Matching spricht.

## Architektur — 3 Dateien (Google Apps Script)
1. **FieldSetup.gs** — Setup-/Wartungsfunktionen für Pipedrive Custom Fields (u.a. `showFieldOptions()`)
2. **FieldKeysAndMapping.gs** — FIELD_KEYS, ENUM_OPTION_IDS, Artikel-Erkennungslogik
3. **SyncEngine.gs** — sevdesk abfragen, Deal matchen, schreiben, loggen, Live-Trigger `syncPendingOrders`

PROD-Versionen sind fertig (Duplikat-Schutz, Pagination, robustes JSON-Parsing, zweistufiges Matching) — noch nicht live.

## Matching-Logik (löst Problem "2 Angebote pro Kunde")
1. Primär: Angebotsnummer (z.B. "2026-154-A") — exakte Feldsuche
2. Fallback: Kundennummer — nur bei genau 1 Treffer
3. Gegenprobe bei Match über Angebotsnummer: falls Deal auch Kundennummer hat, muss sie passen, sonst Warnung
4. Mehrdeutigkeit → nichts schreiben, Warnung ins Sync-Log
sevdesk-Kundennummer ≠ interne Kontakt-ID — eigener `/Contact/{id}`-Call nötig (`customerNumber`-Feld).

## API-Learnings
**sevdesk:** Basis-URL `https://my.sevdesk.de/api/v1/` (nicht api.sevdesk.de); Auth-Header `Authorization` mit rohem Token, kein "Bearer"; Order-Positionen eigener Call `/OrderPos?order[id]=X&order[objectName]=Order`; Order-Status "Angenommen"=500; Pagination max 100/Call via limit/offset.
**Pipedrive API v2:** Auth-Header `x-api-token` (nicht Query-Param); dealFields Property `field_name`, Identifier `field_code`; Deal-Suche über `/api/v2/itemSearch/field?entity_type=deal&field={code}&match=exact&return_item_ids=true` (nicht `/deals/search` wegen Indexierungs-Delay).
**Pipedrive Deal.person_id trägt KEINEN Namen mit** (Stand 2026-08-20, live gegen echte API verifiziert): `deal.person_id` ist nur eine Referenz (`{value, ...}`), kein `{value, name}`-Kompaktobjekt wie zunächst angenommen. Name IMMER über einen separaten `/persons/{id}`-Call holen, wie es Ordnererstellung-bei-Gewonnen/Projektdoku-Generator schon immer gemacht haben — die Annahme, der Name stünde eingebettet mit dabei, hat beim Vormatching-per-Name-Feature (siehe unten) zu 30/30 Fehlschlägen "Kein Personenname ermittelbar" geführt, bis der Bug gefunden wurde.
**sevdesk `/Contact`-Feldstruktur ist inkonsistent** (Stand 2026-08-20, live verifiziert via Debug-Dump): Der volle Name eines Kunden steht MAL in `name` (auch bei echten Privatpersonen, nicht nur Firmen -- z.B. "Marijana Kovacevic" oder "Kenan Kavlak" standen direkt in `name`, `surename`/`familyname` waren `null`), MAL aufgeteilt in `surename`+`familyname` (z.B. "Elpie Morales": `surename="Elpie"`, `familyname="Morales"`, `name=null`). `category.id` (immer "3" in den Stichproben) ist KEIN zuverlässiger Firma/Person-Unterscheider. Fallback-Reihenfolge `contact.name || (surename+familyname)` deckt beide Fälle ab und war in den Tests korrekt.
**sevdesk `/Order` liefert mehrere Objekte pro echtem Kunden** (Stand 2026-08-20): Ein einzelner realer Kunde kann mehrere `Order`-Objekte haben (unterschiedliche `orderType`, z.B. "AN" = Angebot, vermutlich plus spätere Auftragsbestätigung/Revisionen), alle mit demselben `contact.id`. Ein Namensmatching, das rohe Order-Treffer zählt (statt nach `contact.id` zu dedupen), erzeugt dadurch falsche "mehrdeutig"-Meldungen bei Kunden, die in Wahrheit eindeutig sind (Beispiel: Kenan Kavlak zeigte 3 Order-Treffer, aber nur 1 echten Kontakt). Fix: nach distinct `contact.id` gruppieren, bei genau 1 Kontakt den zuletzt aktualisierten Auftrag nehmen, erst bei >1 KONTAKT (nicht Order) als echt mehrdeutig behandeln.
**GELÖST -- `addressName` am Auftrag ist die richtige Matching-Quelle, nicht der verknüpfte Contact** (Stand 2026-08-20): Der ursprüngliche 24/30-"kein Treffer"-Verdacht war ein echter Bug, kein Datenproblem -- Valentin hat live in der sevdesk-Angebote-Suche bestätigt, dass z.B. "Metehan Hilal Arac" dort sofort gefunden wird, obwohl das Vormatching-per-Name "kein Treffer" meldete. Root Cause: Order-Objekte tragen den Kundennamen direkt im Feld `addressName` (z.B. `"addressName": "Elpie Morales"`), UNABHÄNGIG davon, was im verknüpften `contact.id`-Datensatz an `name`/`surename`/`familyname` steht -- die sevdesk-UI durchsucht offenbar `addressName`, nicht den Contact. Fix: `holeAlleAuftraegeMitKundenname()` matched jetzt direkt über `addressName`, der komplette `/Contact`-Preload (`holeAlleKontaktnamen()`) ist dadurch überflüssig geworden und wurde entfernt -- einfacherer Code UND kein Bug mehr.
**Lehre für zukünftige sevdesk-Matching-Logik:** Wenn ein Objekt sowohl eine direkte Relation (`contact.id`) als auch redundante Klartextfelder (`addressName`, `address`) trägt, sind die Klartextfelder oft die verlässlichere Matching-Quelle für "wie im UI gesucht wird" -- nicht blind über die Relation auflösen, sondern beides im Rohdaten-Dump prüfen, bevor man sich für eine Quelle entscheidet.

## Vormatching-per-Name-Ergebnis für die 30 Fulfillment-Altdeals (2026-08-20, DRY_RUN)
Nach dem addressName-Fix: **26 von 30 eindeutig gematcht** (6 davon mit mehreren Order-Revisionen desselben Kontakts, neueste automatisch gewählt -- vor Go-Live einzeln gegenchecken: Deals 6922, 6406, 6219, 7059, 5307, 6908). Die restlichen 4 "kein Treffer" sind **kein Bug**, sondern von Valentin live in sevdesk verifiziert:
- **Metehan Hilal Arac (Deal 7065):** Kontakt existiert in sevdesk, aber 0 Aufträge -- nie ein Angebot erstellt.
- **Christian Seitz (Deal 5663):** sevdesk-Auftrag läuft auf "Frau Johanna Seitz" (vermutlich Ehefrau).
- **Canan Kalman (Deal 6493):** sevdesk-Auftrag läuft auf die Firma "Brot & Gebäck KALMAN KG" (Gewerbekunde).
- **Rudy Waldhaus (Deal 6771):** sevdesk-Auftrag läuft auf "Waldhaus GmbH".

**Why:** Zeigt ein wiederkehrendes Muster -- der Pipedrive-Personenname und der sevdesk-Kundenname (Ehepartner oder Firma statt Privatperson) können systematisch auseinanderlaufen. Kein Matching-Algorithmus sollte hier weiter raten (Ehename/Firmenname-Heuristik wäre zu unsicher).
**How to apply:** Bei diesen 3 (Seitz/Kalman/Waldhaus) die Angebotsnummer manuell ins Pipedrive-Deal-Feld eintragen, dann läuft die normale Angebotsnummer-Matching-Logik (syncEinzelDealOhneStatusFilter) glatt durch. Bei Metehan Hilal Arac: nichts zu tun, bis ein sevdesk-Auftrag existiert. Falls künftig wieder viele "kein Treffer" auftreten: zuerst einzeln in der sevdesk-UI nachschauen (wie hier), bevor man erneut Matching-Code verdächtigt.

## Zwei weitere echte Bugs gefunden und gefixt (2026-08-21)
**Bug 1 -- `getDealCustomFieldValue()` gab bei leerem Feld den STRING `"null"` zurück statt echtem `null`:** `cf[fieldKey] !== undefined` reicht nicht, ein leeres Pipedrive-Feld liefert `null` (nicht `undefined`), `String(null)` = `"null"`. Die Angebotsnummer-Gegenprobe in `findTargetDeal()` (`if (kundeCheck && kundeCheck !== String(order.customerId))`) hielt diesen String für einen echten Wert (truthy!) und hat bei JEDEM Deal ohne gesetzte Kundennummer fälschlich "vermutlich falscher Deal" gemeldet -- sichtbar geworden, als `setzeBekannteAngebotsnummernUndSync()` bei allen 5 frisch beschriebenen Deals (Bobál, van Dyck, Kavlak, Kalman, Waldhaus) diese Warnung auslöste, obwohl die Angebotsnummer korrekt gesetzt war. Betraf die GESAMTE Angebotsnummer-Matching-Logik (auch den Live-Poller `syncPendingOrders`), nicht nur diese 5. Fix: explizit auf `!== null` prüfen.

**Bug 2 (architektonisch, wichtiger) -- `syncPerNameVormatching()` rief `syncOrderToPipedrive(orderId)` auf, die den Ziel-Deal selbst NEU sucht** (über Angebotsnummer/Kundennummer), statt den über den Namensabgleich bereits sicher bekannten `dealId` zu verwenden. Da diese Fulfillment-Altdeals nie eine Angebotsnummer/Kundennummer in Pipedrive hatten, hätte diese Rediscovery bei JEDEM der 24 "erfolgreichen" Namens-Treffer vom 2026-08-20/21 vermutlich "Kein Pipedrive Deal gefunden" ergeben -- der ganze Batch hat also wahrscheinlich NIE tatsächlich geschrieben (auch nicht im DRY_RUN-Preview bis zum Ende), nur die Vorab-Log-Zeile in `syncPerNameVormatching` selbst hat Erfolg vorgetäuscht. Nie durch fehlende Folgezeilen im vom User gepasteten Log aufgefallen, weil die echten Erfolgs-/Fehlerzeilen von `syncOrderToPipedrive` schlicht nicht mitkopiert wurden.
Fix: neue Funktion `syncDirektAufBekannterDeal(dealId, orderId)` -- schreibt direkt auf den bekannten Deal (inkl. Angebotsnummer als Nebeneffekt, für Nachvollziehbarkeit), keine Rediscovery mehr. `syncPerNameVormatching` ruft jetzt diese statt `syncOrderToPipedrive` auf.

**Why:** Zeigt, wie wichtig es ist, die tatsächliche LETZTE Log-Zeile eines Laufs zu sehen, nicht nur die Zwischenmeldung "syncing..." -- die täuscht Erfolg vor, auch wenn der eigentliche Schreibversuch danach scheitert.
**How to apply:** Vor dem nächsten `DRY_RUN=false`-Lauf: `syncPerNameVormatchingMassentransfer` nochmal mit dem gefixten Code laufen lassen und diesmal das KOMPLETTE Log bis zum letzten Eintrag pro Deal prüfen (Sync-Log-Sheet ist zuverlässiger als kopierter Editor-Log-Ausschnitt, da dort nichts fehlen kann).

## Live-Schreibung erfolgreich (2026-08-21, ~09:24) -- DRY_RUN jetzt false
Nach den 2 Bugfixes DRY_RUN auf `false` gestellt und live geschrieben: **21 von 22 aus `syncPerNameVormatchingMassentransfer`** SUCCESS (Metehan Hilal Arac weiterhin ohne Treffer, erwartet) PLUS **alle 5 aus `setzeBekannteAngebotsnummernUndSync`** (Bobál/van Dyck/Kavlak/Kalman/Waldhaus) live bestätigt (10:06 Uhr, beide Läufe ohne Fehler). **26 von 30 Fulfillment-Deals fertig mit echten Artikel-Daten aus sevdesk befüllt.**

**Bekannte offene Nacharbeit (Stand 2026-08-21, kein Bug, nur Datenlücken):**
- **Deal 6804 (Adolf Matschek):** Artikel-Erkennung komplett gescheitert (0 Module, WR "Sigen Hybrid Inverter HYA 60.0 kW M1" nicht erkannt, Speicher-Marke unbekannt) -- große Gewerbe-Anlage mit Produktbezeichnungen außerhalb der bekannten Muster. Bewusst NICHT die globale Artikel-Regex erweitert (Risiko: wirkt auf alle ~4000+ Aufträge, "HYA" als 3-Buchstaben-Substring hätte Kollisionsgefahr, und unklar ob es überhaupt eine separate Modul-Position gibt). Modul_Anzahl/-Marke, WR_Leistung_kW, Speicher-Marke händisch aus Angebot 2026-463-A nachtragen.
- **Deal 6771 (Rudy Waldhaus):** "FRONIUS VERTO 30.0 Plus" nicht als Wechselrichter erkannt (Regex kennt "VERTO" nicht) -- nur WR_Leistung_kW manuell nachtragen, Rest (Module, Speicher) korrekt.
- **Deals 5728/5867/6738:** Modul-Marke "JASOLAR" über Generic-Fallback erkannt (nicht in `ENUM_OPTION_IDS.Module_Marke`), Dropdown-Option existiert noch nicht in Pipedrive -- Modul_Marke bleibt leer bis die Option angelegt wird. Anzahl/Rest korrekt.
- **Deal 6922 (Hidir Özdek):** 3 gleichzeitig aktive/unterschriebene Verträge -- unklar welcher zu diesem Deal gehört, braucht menschliche Zuordnung (Summe/Datum abgleichen).
- **Deal 6406 (Karl Heindl), 6908 (Hans Greml):** On Hold, Marco klärt noch grundsätzlich wie weiter.
- **Deals 6591/7107 (Mario Messiha):** hat mehrere sevdesk-Aufträge, 2 Pipedrive-Deals mit identischem Name+Adresse -- Zuordnung noch offen, braucht Angebotsnummer pro Deal.
- **Deal 7065 (Metehan Hilal Arac):** 0 Aufträge in sevdesk, nichts zu tun bis einer existiert.

**Why:** Damit ein künftiger Blick auf diese Deals nicht wieder als "Bug" untersucht wird -- alles hier ist bekannte, bewusst offen gelassene Nacharbeit.
**How to apply:** Bei Fragen zu einem dieser 7 Deals: das ist der aktuelle Stand, kein neues Problem. Sobald Özdek/Heindl/Greml/Messiha eine Angebotsnummer bekommen, über `setzeBekannteAngebotsnummernUndSync` nachziehen (Pattern etabliert, einfach Eintrag hinzufügen).

## Artikel-Erkennung Kernlogik
Reihenfolge: Zubehör ZUERST (sonst false-positives durch Wort-Überschneidung), dann WR → Speicher → Module → Wallbox → Notstrom → Heizstab. Deutsche Kommazahlen vor Regex normalisieren. Wert-Extraktion: kW/kWh direkt, sonst erste (nicht letzte) Dezimalzahl im Namen. Marken-Fallback: erstes großgeschriebenes Wort. Enum-Lookup case-insensitive. Gegen kompletten Katalog simuliert: 139/140 Artikel korrekt.

## Offener Punkt
Zwei Angebotsnummer-Felder in Pipedrive (Duplikat): `Angebotsnummer(202X-XXX-X)` (field_code `9935f33d1f8c5575da1aa3bdf1c2329bed92398b`, aktiv genutzt) vs. altes `sevdesk_angebotsnummer` (field_code `e442e2f3803eedfe77a2e4d7c5e180d33093e067`, sollte gelöscht werden). FIELD_KEYS in Datei 2 muss auf ersteres zeigen.

## ~~Go-Live-Checkliste (Stand 2026-08-11: noch nicht live)~~ — ✅ ABGEARBEITET, historisch

> 🔴 **Korrektur 2026-09-01.** Dieser Abschnitt stand drei Wochen lang so da, als wären die Punkte noch
> offen. Sie sind erledigt: **der Sync ist seit 2026-08-21 live**, Trigger seit 26.08. auf **5 Min**
> (nicht 15). Punkte 1–3 sind abgehakt.
>
> **Was wirklich offen ist**, ist weiter unten der Abschnitt „Status 500 wird in der Praxis kaum
> gesetzt" — der Poller filtert hart auf `status=500`, aber von 26 geprüften gewonnenen Deals hatten 22
> den Status 200. Für die Mehrheit real gewonnener Aufträge löst er also nie aus. Das ist der einzige
> echte Blocker.

1. ~~Angebotsnummer-Duplikat klären/löschen~~ — gültig ist `9935f33d…`, das Duplikat `e442e2f3…` ist abzuräumen
2. ~~Bestehende offene Deals: Angebotsnummer/Kundennummer nachtragen~~
3. ~~Testdeal 7253 bereinigen~~
4. ~~Trigger `syncPendingOrders` neu anlegen~~ — läuft, seit 26.08. alle 5 Min
5. Prozess für neue Deals: Angebotsnummer/Kundennummer wird MANUELL eingetragen, kein Automatismus *(gilt weiterhin)*

## Neues Teilprojekt: Fulfillment-Pipeline in Pipedrive (Stand 2026-08-12, noch Konzeptphase)
Separates Script `FieldSetup_Fulfillment.gs` (Drive-Ordner "Erstellung Felder in Pipedrive Auto", erstellt 10.08.2026) legt ~35 Deal-Custom-Fields für Fulfillment-Tracking an (Prozess & Routing, Status-Ampeln, Termine, Kaufmännisch, Technik-Ergänzung, Abschluss & Lernen, Fortschritt). Läuft gegen Pipedrive API **v2** (v1 seit 1.8.2026 abgeschaltet). Aktuell `DRY_RUN = true`, noch nichts live geschrieben. Erkennt bestehende Felder per normalisiertem Namensabgleich (mehrfach ausführbar ohne Duplikate). Persistentes Log-Sheet "LOG_Fulfillment Field Setup" legt sich selbst an.

### Geplant: Automatische Erkennung "Zahlungseingang" (noch nicht gebaut, Konzept steht)
sevdesk hat **keine Webhooks** — nur Polling möglich (wie beim bestehenden Order-Sync alle 15 Min).
1. Poll `GET /Invoice?status=1000&invoiceType=AR` — kombinierter Filter funktioniert (Invoice-Objekt hat unabhängige `status`- und `invoiceType`-Felder, AR/SR sind komplett getrennte Invoice-Objekte, keine Verwechslungsgefahr)
2. **AR (Anzahlungsrechnung) ist ausschlaggebend, nicht SR (Schlussrechnung)** — bewusste Entscheidung des Users
3. Angebotsnummer aus Betreff/Header der AR extrahieren (gleiche Regex-Logik wie beim Order-Matching) → Deal finden
4. Zusatzbedingung: Deal muss Stage "Gewonnen" sein, bevor geschrieben wird (Fall "Zahlung vor Gewonnen" laut User sehr unwahrscheinlich, wird nur geloggt falls es doch vorkommt)
5. Aktion bei Treffer: Checkbox-Feld "Zahlungseingang erhalten" setzen UND eine Pipedrive-**Aktivität** "Zahlungseingang da!" anlegen — dient als Übergabepunkt/Trigger für den nächsten Fulfillment-Schritt
6. Duplikatschutz nötig (gleiches Muster wie Order-Sync: Script Property mit verarbeiteten Invoice-IDs)

**Offen — Aktivitäten-Zuständigkeit:** Aktivität wird aktuell fix dem User (Valentin) zugewiesen, weil er im Fulfillment-Prozess bei RP Energietechnik aktuell die einzige Person ist.
**Why:** Kein Team-Aufteilungsbedarf, solange nur eine Person fulfillt.
**How to apply:** Sobald RP Energietechnik mehr Personen ins Fulfillment holt, MUSS die Zuweisungslogik überdacht werden (z.B. `owner_id` = aktueller Deal-Owner statt fix Valentin, oder Rollen-Zuordnung nach Bundesland/Region). Bei Erwähnung von neuen Fulfillment-Mitarbeitern proaktiv daran erinnern.

Noch nicht umgesetzt — User will erst internes Team-Feedback einholen, bevor gebaut wird. Artikel-Art/Menge-Erkennung ist bereits vorhanden (siehe oben, Artikel-Erkennung Kernlogik) und wird wiederverwendet.

## Zahlungseingang-Feature — gebaut, live getestet (DRY_RUN), Stand 2026-08-26
4. Datei `zahlungseingang.js` im selben Projekt (Sevdesk Articles to PipeDrive, Script-ID `1pfqKbOFNUQYaZZg-k2odn2RSZ3CmbOZSZBtFqnvKldxpvHw8EUGbBoIP`), gepusht + lokal committed. **Noch `ZAHLUNGSEINGANG_DRY_RUN = true`, noch nicht scharf, kein Trigger eingerichtet.**

**Feld:** "Zahlungseingang erhalten", field_code `ddbfed2a1cdc25c2be460b9a825e056cca2d0284`, Typ enum. Options-Label ist **"Erhalten"**, nicht "Ja" (Options-ID 207) — Namensmuster wie bei "AR versendet". `pruefeZahlungseingangKonfiguration()` gleicht das live gegen Pipedrive ab, ist grün.

**sevdesk-Learning: Auftrag→Rechnung ist NICHT automatisch.** Jemand muss im Angebot/Auftrag manuell auf "Mehr" → "Rechnung erstellen" klicken und AR (Prozentsatz/Fixbetrag) oder SR wählen. Das erklärt, warum viele Aufträge gar keine AR-Rechnung haben, und warum AR-Existenz und Pipedrive-Angebotsnummer-Pflege zwei komplett entkoppelte manuelle Schritte sind (siehe unten, Match-Lücke).

**AR und SR sind KEINE Vorstufe/Endstufe desselben Dokuments**, sondern zwei unabhängige `Invoice`-Objekte mit je eigenem `status`: AR deckt einen Teilbetrag (Anzahlung), SR den Restbetrag. SR ist laut sevdesk-Doku sogar zwingend (auch als 0€-Beleg), wenn die AR schon alles abdeckt.

**Angebotsnummer-Ermittlung, zwei echte Bugs live gefunden und gefixt:**
1. Der Rechnungs-Header enthält ZWEI Nummern ("Anzahlungssrechnung Nr. 2024-1001-A **aus Angebot** 2024-1266-A") — ein naiver "erste Zahl im Text"-Match hätte die eigene Rechnungsnummer statt der Angebotsnummer getroffen. Live an Rechnung 73888855 verifiziert.
2. **Bessere Quelle gefunden:** `invoice.origin` ist eine direkte sevdesk-Objektreferenz auf den erzeugenden Auftrag (`{id, objectName:"Order"}`). `ermittleDealFuerRechnung_()` nutzt das jetzt primär — lädt den vollen Auftrag per `fetchOrderFromSevdesk(invoice.origin.id)` (liefert orderNumber UND Kundennummer) und übergibt ihn an das **bestehende** `findTargetDeal()` aus SyncEngine.gs, statt eigene Matching-Logik zu duplizieren. Header-Text-Regex (jetzt auf "Angebot X" eingeschränkt) ist nur noch Fallback, falls origin fehlt.

**Bekannte, akzeptierte Datenlücke (kein Bug):** DRY-Testlauf über die ersten 25/219 bezahlten AR zeigte nur 3 Treffer, 22× "Kein Pipedrive Deal gefunden" — auch nach dem findTargetDeal()-Fix identisch. Ursache: bei diesen (überwiegend älteren) Aufträgen fehlt vermutlich sowohl Angebotsnummer als auch Kundennummer im Pipedrive-Deal (bekannter, nie abgeschlossener Rückstand seit 11.08., siehe Go-Live-Checkliste oben). Kein Code-Fehler — Fehlschläge landen sichtbar im Sync-Log statt stillschweigend zu verschwinden. Bewusst nicht weiter untersucht/gefixt, Valentin hat das akzeptiert.

**Offen, bewusst zurückgestellt (2026-08-26):** Nur AR wird getrackt, SR (Schlusszahlung/Restbetrag) bleibt unberücksichtigt — passt zur ursprünglichen Entscheidung "AR ist ausschlaggebend". Frage kam aber auf: braucht es ein ZWEITES Feld "Schlusszahlung erhalten" + einen parallelen SR-Zweig, falls ein späterer Fulfillment-Schritt "vollständig bezahlt" (nicht nur Anzahlung) als eigenes Signal braucht? Architektur würde das leicht hergeben (`invoiceType=SR` statt `AR`, gleiches Muster dupliziert). **Nicht gebaut, nur gemerkt** — bei Bedarf wieder aufgreifen, wenn ein konkreter Prozessschritt das braucht.

**Nächste Schritte vor Go-Live:** DRY_RUN=false setzen, 15-Min-Trigger für `syncZahlungseingaenge()` einrichten (analog `syncPendingOrders`).

## Git/clasp-Setup
Hauptordner: `C:\Users\valen\OneDrive\Documents\RP\Claude_Work_RP\RP-Google-Scripts`, 3 clasp-Unterprojekte (Drive-Ordner-Automation, Pipedrive-form-prefill-mail-trigger, Sevdesk-Pipdrive_sync).
**Überholt seit 2026-08-21, siehe [[project_gs_deploy_workflow]]:** früher war Browser-Editor Source of Truth mit `clasp pull` danach, jetzt ist lokaler Code Source of Truth mit `clasp push` (kein Copy-Paste mehr in den Editor). Workflow jetzt: `clasp push` → bei Erfolg `git add`/`git commit`, `git push` nur auf Ansage. Passt weiter zu [[feedback_user_skill_level]] falls vorhanden — User ist A1-A2 Programmier-Level, braucht einfache PowerShell-Einzelbefehle, nicht verkettet.

## Zuordnungs-Audit der 26 Fulfillment-Deals (2026-08-21) — Ergebnis: keine Fehlzuordnung
Valentin hatte konkret Angst, dass das Namensmatching Artikel-Daten auf den falschen Kunden schreibt. Geprüft mit neuer Datei `zuordnungspruefung.js` (4. Datei im Projekt, `Zuordnungspruefung.gs` im Editor) — **rein lesend**, verifiziert die laut Sync-Log tatsächlich geschriebenen Deal/Auftrag-PAARE gegen vier unabhängige Merkmale (Adresse/PLZ, Deal-Wert vs. Auftragssumme, Anzahl gleichnamiger Kontakte + Aufträge pro Kontakt, Auftragsstatus) statt das Matching neu auszuführen.

**Wichtig am Aufbau:** Ein zweiter Matching-Lauf hätte denselben möglichen Fehler nur wiederholt und wieder „passt" gesagt. Deshalb die Paare aus dem Log hart eintragen und mit fremden Merkmalen gegenprüfen.

**Ergebnis über 4080 sevdesk-Aufträge / 2869 Kontakte:**
- 21 Deals live geschrieben (2026-08-21 09:23–09:24), alle über die Namens-Route
- **0 Namensdoppelgänger** in sevdesk, **0** Fälle „Kontakt hat mehrere Aufträge, neuester geraten" bei den 21, **0** Fälle „Person hat mehrere Deals" bei den 21
- PLZ-Gegenprobe bestanden bei 20/21; der einzige Ausreißer (7177 Linsmaier) war ein falsches PLZ-Feld in Pipedrive, Straße+Ort identisch → Zuordnung korrekt (siehe [[reference_pipedrive_plz_feld_unzuverlaessig]])
- Die 3 „neuester geraten"-Fälle (6219, 7059, 5307) liegen alle in der Angebotsnummer-Gruppe, dort war die Nummer manuell bestätigt

**Why:** Das Risiko „newest revision geraten", das die Namens-Route theoretisch hat, hat sich im echten Batch nicht materialisiert — die 21 hatten alle genau 1 Kontakt mit genau 1 Auftrag. Die Sorge war berechtigt, das Ergebnis ist trotzdem sauber.
**How to apply:** Bei künftigen Bulk-Schreibläufen dieses Muster wiederholen: Paare aus dem Log + fremde Merkmale gegenprüfen. Geld (Deal-Wert vs. Auftragssumme) war als Probe unbrauchbar, weil **die Deal-Werte in Pipedrive bei RP durchgängig 0/leer sind** — Adresse ist der belastbare Anker.

## Order-Feldstruktur live verifiziert (2026-08-21)
Vollständige Feldliste eines `/Order`-Objekts: `additionalInformation, address, addressCity, addressCountry, addressGender, addressName, addressName2, addressParentName, addressParentName2, addressStreet, addressZip, contact, contactPerson, create, createUser, currency, customerInternalNote, deliveryTerms, footText, headText, header, id, objectName, orderDate, orderNumber, orderType, paymentTerms, sendDate, sendType, sevClient, showNet, smallSettlement, status, sumDiscount*, sumGross, sumNet, sumTax, taxRate, taxText, taxType, update, version, weight`.
- `address` ist ein **mehrzeiliger String** mit Anrede: `"Frau Elisabeth Maderebner\nKoppbach 14\n4904 Atzbach"`. Es gibt zusätzlich die Einzelfelder `addressStreet`/`addressZip`/`addressCity` — die sind für Abgleiche sauberer als der Freitext.
- `orderDate`/`update` sind **ISO mit Offset** (`"2026-08-21T09:05:25+02:00"`) → lexikografischer String-Vergleich funktioniert, bricht aber beim DST-Wechsel (`+02:00` vs `+01:00`). Besser `new Date(x).getTime()`.
- `sumNet`/`sumGross` kommen als **String**, nicht als Zahl (`"22617"`, `"27140.39"`) → vor dem Rechnen `Number()`.
- Von 4080 Aufträgen haben nur 3926 eine eindeutige `orderNumber` → **die Annahme „Angebotsnummer ist immer eindeutig" (Kommentar in findTargetDeal) ist falsch**, ~154 Nummern kommen doppelt vor.

## Status 500 („Angenommen") wird in der Praxis kaum gesetzt — Go-Live-Blocker
Bei den 26 geprüften, in Pipedrive **gewonnenen** Deals hatten **22 den sevdesk-Status 200** (versendet), nur 4 den Status 500. RP pflegt den Angebotsstatus in sevdesk offenbar nicht nach.

**Why:** Der Live-Poller `syncPendingOrders` filtert hart auf `status=500` — er würde für die große Mehrheit der real gewonnenen Aufträge **nie auslösen**. Das ist ein echter Blocker, unabhängig vom Matching. Nebeneffekt: der Status taugt auch nicht als Qualitätssignal beim Namensmatching, und die „neuester `update` gewinnt"-Heuristik ist dadurch riskanter (ein Angebot als abgelehnt zu markieren bumpt genau dieses `update`).
**How to apply:** Vor Go-Live entscheiden: entweder Prozess in sevdesk (Angebote bei Gewinn auf „Angenommen" setzen) oder den Filter im Poller ändern/erweitern. Nicht stillschweigend auf 500 warten.

## Trigger-Takt auf 5 Min + Kundennummer-Fallback nach Angebotsnummer-Konflikt (2026-08-26)
**Trigger:** 15-Min-Trigger auf 5 Min geändert (`everyMinutes(5)` in `SETUP_EINMALIG_createTrigger`, syncengine.js) -- auf Valentins expliziten Wunsch, behebt aber NICHT den eigentlichen Status-500-Blocker (s.o.), rein für schnellere Reaktion bei erfolgreich matchbaren Aufträgen.

**Bug gefunden -- Deal 7138 (Wolfgang Schwaiger, Kundennummer 4062) blieb leer:** `findTargetDeal()` fand über die Angebotsnummer "2026-630-A" nur Deal 7356 (Irene Radmacher), die Kundennummer-Gegenprobe schlug korrekt Alarm ("vermutlich falscher Deal") -- brach danach aber komplett ab, statt auf Stufe 2 (Kundennummer-Suche) auszuweichen, obwohl Schwaigers echte Kundennummer 4062 längst korrekt in Pipedrive stand.

**KORREKTUR der Erst-Diagnose (26.08., nach echtem PDF-Vergleich):** ursprünglich als "sevdesk vergibt Angebotsnummern doppelt" eingeordnet -- das war FALSCH. "2026-630-A" (Schwaiger) und "2026-633-A" (Radmacher) sind zwei echte, unterschiedliche sevdesk-Angebote (unterschiedliche PDFs, unterschiedliche Kunden, unterschiedliche Produktvorlage "PV SM" vs. "PV FS"). Der eigentliche Fehler: bei Deal 7356 stand von Anfang an ein **Tippfehler** im Angebotsnummer-Feld -- "2026-630-A" statt der korrekten "2026-633-A" (Zahlendreher, 630/633 leicht verwechselbar). Die schon geschriebenen Artikel-Daten bei Deal 7356 waren davon nicht betroffen (kamen korrekt über die Kundennummer-Route aus Order 2026-633-A). Fix: `korrigiereIreneRadmacher7356()` setzt nur das Angebotsnummer-Feld richtig, kein Artikel-Rewrite nötig.
**Lehre:** Bei einem Angebotsnummer-Konflikt zuerst die echten PDFs beider Kandidaten vergleichen, bevor man "sevdesk-Duplikat" als Ursache annimmt -- das bekannte 154-von-4080-Duplikat-Phänomen (s.u.) ist nicht die einzig mögliche Erklärung für so einen Konflikt, ein simpler Tippfehler bei der manuellen Eingabe ist mindestens genauso wahrscheinlich.

**Nachtrag (26.08., "Irene AB.pdf" gefunden):** die von Irene Radmacher unterschriebene AB trägt noch den Aufdruck "2026-630-A" -- das war die Nummer zum Zeitpunkt der Unterschrift. sevdesk hat den Auftrag danach intern umnummeriert (630 → 633), Inhalt (24 Module, 11,76 kWp, PV FS) blieb dabei unverändert; die freigewordene Nummer 630 wurde später an Wolfgang Schwaigers unabhängiges Angebot vergeben. **Wichtige Erkenntnis für dieses Projekt: sevdesk-Angebotsnummern sind nicht stabil über die Lebensdauer eines Auftrags** -- eine bereits unterschriebene/eingefrorene PDF kann eine andere Nummer zeigen als der aktuelle API-Stand. Matching muss deshalb immer gegen die LIVE-sevdesk-API erfolgen, nie gegen eine alte, unterschriebene PDF-Nummer als Referenz -- Pipedrive-Feld "2026-633-A" bei Deal 7356 ist trotzdem korrekt, weil es dem aktuellen sevdesk-Datensatz entspricht.

**Fix (`findTargetDeal()` in syncengine.js):** Bei Kundennummer-Gegenprobe-Konflikt in Stufe 1 wird nicht mehr sofort abgebrochen, sondern zu Stufe 2 (Kundennummer-Suche) weitergegangen. Findet die genau 1 Deal, wird dorthin geschrieben (`matchedBy: 'Kundennummer'`), der Angebotsnummer-Konflikt bleibt trotzdem als `konflikt`-Info am Ergebnis hängen (wird geloggt + gemailt, aber blockiert nicht mehr). Nur bei echtem Mehrfachtreffer (`byNumber.length > 1`, mehrere Deals TRAGEN dieselbe Nummer) bleibt der harte Abbruch bestehen -- das ist mit Kundennummer allein nicht mehr auflösbar.

**Warum das so blieb, bis es live auffiel:** sevdesk vergibt Angebotsnummern nicht global eindeutig -- schon dokumentiert (~154 von 4080 Nummern doppelt), aber erst hier wurde sichtbar, dass die Matching-Logik bei so einem Konflikt komplett aufgab statt den vorhandenen Fallback zu nutzen. Sofort-Fix für den Einzelfall: `syncDirektAufBekannterDeal(dealId, orderId)` mit der eindeutigen sevdesk-**Order-ID** (nicht Angebotsnummer) -- umgeht jede Text-Suche.

**Neu: Mail-Alarm bei Konflikten** (`alarmiereBeiKonflikt()`, syncengine.js) -- sendet einmalig (dedupe über Script Property `KONFLIKT_ALARM_GESENDET`, 90-Tage-Aufräumung wie beim Sync-State) eine Mail an valentin@rp-energietechnik.at, sobald ein Angebotsnummer-Konflikt auftritt -- egal ob der Sync danach über Kundennummer trotzdem erfolgreich war oder ganz scheiterte. Vorher verschwanden solche Fälle stumm im Sync-Log-Sheet, bis jemand zufällig nachschaute (wie bei Schwaiger, der tagelang unbemerkt leer blieb).

**Why:** Zeigt ein wiederkehrendes Architekturmuster in diesem Projekt: ein Sicherheitscheck (Gegenprobe) darf einen Fall zu Recht als verdächtig markieren, sollte aber nicht automatisch auch den bestehenden Fallback-Pfad blockieren, wenn der unabhängig davon zu einem eindeutigen, vertrauenswürdigen Ergebnis kommt.
**How to apply:** Bei künftigen "warum ist Feld X leer"-Fragen zu diesem Sync zuerst das Sync-Log-Sheet (Tab "Sync-Log", `SHEET_ID` `1Icpc12eOBEmp2674cdKFVa1PCP7m-AHSRlSwNeiwmeo`) nach WARNUNG/ERROR-Zeilen für den betroffenen Kunden durchsuchen, bevor man eine neue Ursache vermutet -- die Mail sollte das ab jetzt aber ohnehin proaktiv anstoßen.

## Geparkte Aufträge: 1x täglich Retry statt für immer gesperrt (26.08.2026)
Nach `MAX_VERSUCHE_VOR_PARKEN` (5) Fehlversuchen wurde ein sevdesk-Auftrag bisher für immer ignoriert, bis jemand von Hand `entparkeAuftraege()` ausführt -- dabei löst sich der häufigste Grund (Kundennummer/Angebotsnummer nachträglich in Pipedrive ergänzt, wie bei Mario Golger/Deal 29989956) meist von selbst, ohne dass das Script je davon erfährt.

**Fix (auf Valentins Wunsch):** geparkte Aufträge werden jetzt **1x/Tag automatisch erneut versucht** (`state[id].geparktSeit` + `gespeichert < heuteAlsIso()` im Filter von `syncPendingOrders()`). Bleibt es **14 Tage** (`PARK_DAUERHAFT_NACH_TAGEN`) erfolglos, wird endgültig aufgegeben -- nur noch per `entparkeAuftraege()` reaktivierbar. Kein Mail-Spam-Risiko dabei: "Kein Deal gefunden" (der häufigste Park-Grund) löst keine `alarmiereBeiKonflikt()`-Mail aus, nur der seltenere Angebotsnummer-Mehrfachtreffer-Fall tut das.
**Diagnose-Tool:** `zeigeGeparkteAuftraege()` zeigt pro geparktem Auftrag jetzt auch `geparkt seit X (noch N Tage täglicher Retry / DAUERHAFT)`.

## Datenfehler in Deal 6804 (Adolf Matschek) — live geschrieben, muss nachgetragen werden
Artikel-Erkennung ist bei diesem 86.664-€-Auftrag (2026-463-A) gescheitert: `Sigen Hybrid Inverter HYA 60.0 kW M1` nicht als Wechselrichter erkannt, `19x ? Speicher 12.06 kWh` zu **230.1 kWh** aufsummiert, `Module_Anzahl` leer geschrieben. Zuordnung ist korrekt, nur die Werte sind Müll. Fehlende Patterns: `Sigen Hybrid Inverter`/`HYA` (WR), `ENERGIEGEMEINDSCHAFT EINRICHTUNG` + `FÖRDERANSUCHEN & ABWICKLUNG` + `TECHNISCHE PROJEKTIERUNG` (Zubehör/Dienstleistung).
