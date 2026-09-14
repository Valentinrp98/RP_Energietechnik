# Spec: Pipedrive-Quali-Felder für Setter

**Stand:** 2026-09-11 · **Status:** ✅ **alle 11 Felder LIVE in Pipedrive** seit 11.09.2026 (Stufe 1 um 14:58, Stufe 2 um 15:07) — angelegt per `Sevdesk-Pipdrive_sync/QualiFelderSetup.js`, 0 Fehler. field_codes + Options-IDs (332–406) stehen in `REFERENZ-Pipedrive-AppsScript.md`.
**Datenbasis:** `ANALYSE-Quali-Felder-Ersttermin.md` (177 ET-Deals, Kohorten NEU 100 / ALT 77, recency-gewichtet).

## Priorisierung auf einen Blick

**Must-have (5)** — Stromkosten €/Monat · Stromverbrauch kWh/Jahr · Montageart-Präferenz · Umsetzungszeitpunkt · Interesse an
**Maybe (3)** — Geplanter Montageort · E-Auto · Einschränkung am Standort
**Provision (3)** — Setter · Provision Setter % · Provision Closer % ← **fix, vom User bestätigt 11.09.**
**Notiz reicht** — warum noch nicht umgesetzt · wie lange überlegt · Speichergröße-Wunsch · „IDEE:"-Empfehlung · Originalwortlaut der Kosten (ca/Jahr/ct) · Verbrauch- und Montageart-Beitexte · Mehrparteien/Gewerbe

**Grundsatz für alle `set`-Felder:** Optionslisten bewusst **über** die belegten Fälle hinaus. Lieber 18 Optionen, von denen 6 selten sind, als wöchentlich eine nachpflegen. Optionen nachträglich hinzufügen geht in Pipedrive, **umbenennen/löschen** ist der Ärger — deshalb gleich breit und neutral formuliert.

---

## Must-have (5)

| # | Feld | Typ | Optionen / Einheit |
|---|---|---|---|
| 1 | Stromkosten €/Monat | `double` | Pflicht. Einheit im Feldnamen, Jahreswert /12, ct/kWh **nicht** hier rein |
| 2 | Stromverbrauch kWh/Jahr | `double` | nur die Zahl, `8k` = 8000 |
| 3 | Montageart-Präferenz | `enum` | Pflicht. Selbstmontage · **Hybrid (Teilmontage)** · Schlüsselfertig · Beides anbieten · Entscheidet vor Ort · Noch offen |
| 4 | Umsetzungszeitpunkt | `enum` | sofort · < 3 Monate · heuer noch · nach dem Winter/Frühjahr · nächstes Jahr o. später · hängt vom Angebot ab |
| 5 | Interesse an | `set` | siehe unten (20 Optionen) |

### #5 „Interesse an" — 20 Optionen
Speicher · Notstrom/Ersatzstrom · Inselbetrieb/Autarkie · **Will nicht einspeisen** · Einspeisung/Überschuss · Energiegemeinschaft · Dynamischer Stromtarif · Wallbox · Wärmepumpe · Klimaanlage · Heizstab/Warmwasser · Pool/Poolheizung · Förderung · Finanzierung/Leasing · Erweiterung Altanlage · Modularer/etappenweiser Ausbau · Energiemanagement/Smart Home · Monitoring-App · Optik/unauffällige Module · Herkunft der Komponenten (Made in Europe)

> „Will nicht einspeisen" und „Einspeisung/Überschuss" bewusst **beide** drin — die 6 Einspeise-Notizen der neuen Kohorte gehen in beide Richtungen.

---

## Maybe (3)

| # | Feld | Typ | Beleg |
|---|---|---|---|
| 6 | Geplanter Montageort | `set` | Hausdach ist Default (107) — zahlt sich für die ~12 % Carport/Fassade/Pooldach aus |
| 7 | E-Auto | `enum` | ja vorhanden · geplant/demnächst · überlegt · nein · nein, definitiv nie — Befüllung **14 % → 35 %** |
| 8 | Einschränkung am Standort | `set` | Denkmal 3/0 · Dachsanierung 3/0 · Verschattung 6/2 — alle nur neue Kohorte |

### #6 „Geplanter Montageort" — 18 Optionen
Hausdach · Flachdach/Anbau · Garagendach · Carport · Pooldach · Terrassen-/Pergolaüberdachung · Vordach/Überdachung · Balkon · Wintergarten/Glasdach · Fassade · Nebengebäude/Schuppen · Gartenhaus · Stadl/Scheune · Stall · Halle/Betriebsgebäude · Freifläche/Wiese · Zaun · Standort noch offen

### #8 „Einschränkung am Standort" — 20 Optionen
Keine bekannt · Denkmalschutz/Ortsbildschutz · Bebauungsplan/Widmung · Genehmigung offen · Dachsanierung nötig · Eternit/Asbest · Statik unklar · Dachfläche zu klein · Verschattung durch Bäume · Verschattung durch Nachbargebäude · Tallage/wenig Wintersonne · Schnee-/Frostlage · Blitzschutz vorhanden · Netzanschluss/Trafo begrenzt · Einspeiselimit Netzbetreiber · Zählerkasten/Verteiler zu klein · Kabelweg schwierig · Zufahrt/Kran nötig · Mietobjekt — Zustimmung Eigentümer · Miteigentum/WEG-Beschluss nötig

---

## Provision (3) — bestätigt, aber Sichtbarkeit noch offen

| # | Feld | Typ | Warum so |
|---|---|---|---|
| 9 | Setter | **Benutzerfeld** | kein `enum` — Benutzerliste pflegt sich selbst, kein Nachpflegen bei Personalwechsel |
| 10 | Provision Setter % | `double` | Werte real 3 / 5 / 19 / 20 → Zahl, kein Dropdown, Standard 5 |
| 11 | Provision Closer % | `double` | optional, Standard 20 |

**Kein eigenes „Closer"-Feld** — das ist der **Deal-Besitzer**. Ausnahme belegt (`sergen 20%, falls ich nicht hinfahr`), dafür reicht die Notiz.
Belegt in **200 Notizen**: Sven 48 Nennungen/25 Deals · Ramon 31/28 · Sergen 21/21 · Manuel 13/13. Semantik explizit in `sergen macht der Termin — andre bekommt die 20% beim Abschluss`.

⚠️ **Offen: Sichtbarkeit.** Provisionsdaten für alle Setter sichtbar, oder Pipedrive-Sichtbarkeitsgruppe? Das ist die einzige verbleibende Entscheidung zu diesem Block.

---

## Zwei Regeln fürs Setter-Briefing (statt eigener Felder)
- **Auf €/Monat umrechnen.** 6 Fälle nennen Jahreswerte (`800 Jahr!`), 5 nennen ct/kWh (`30cent zahlt er`). Originalwortlaut in die Notiz.
- **Bei #4 gewinnt die Bedingung.** Sagt der Kunde beides („so schnell wie möglich **wenn alles passt**") → `hängt vom Angebot ab`, nicht `sofort`. Sonst ist die Priorisierung wertlos.

**Kalibrierung #1:** Median 160 € · p25 105 · p75 270 · p90 500 · dichteste Zone 100–150 € (34 Fälle). Ranges nur 10 von 142 (7 %) und ohne gemeinsame Skala (`50–80` … `1600–1700`) → **kein Range-Dropdown**.

## Was gestrichen bleibt

| Gestrichen | Grund |
|---|---|
| **Wie lange überlegt er schon** | **69 % → 31 %**, 22× nur „länger" |
| **Warum noch nicht umgesetzt** | **64 % → 34 %**, nicht enumerierbar |
| Was ist ihm sonst noch wichtig | 83 % → 51 %, geht in #5 auf |
| Stromkosten geschätzt (Ja/Nein) | 22 Fälle, ändert keine Entscheidung |
| Stromkosten €/Jahr · Strompreis ct/kWh | 11 von 142 Fällen → Briefing-Regel |
| Einspeisung als eigenes `enum` | als 2 Optionen in #5 gelöst |
| Gewünschte Speichergröße kWh | 34 Nennungen, Zahl kommt in der Auslegung eh neu |
| Interne Empfehlung Setter, Objekttyp, Beitexte | Notiz |

## Nicht duplizieren (existiert schon)
Dach-Basisfelder inkl. `2_`/`3_`-Varianten (die „Dach:"-Zeilen — 10 % → 42 %! — gehören dorthin) · `Neuanlage oder Erweiterung` `8bc19dfdb1f3135f1babe069f2f9bfba1b347c40` · `Förderstatus` `fe61797bd9d9e4990a2f5735b8c4de1919c7fa11` · `Finanzierungsstatus` `ec8aa2fee84efabc5770fae60e13397c3247a146` · Adressfeld Person/Deal (93 Nennungen; PLZ-Feld unzuverlässig) · sevdesk-Sync-Felder (= **verkaufte** Anlage, nicht Interesse) · Deal-Besitzer (= Closer).

⚠️ #5 „Interesse an" ist Kaufinteresse im Ersttermin. Label so wählen, dass es nicht mit `Speicher Kapazität kWh` & Co. verwechselt wird.

## Offen
1. ~~Maybe-Block (#6–8)~~ ✅ erledigt 11.09., 15:07 — alle 11 Felder stehen.
2. **Sichtbarkeit der Provisionsfelder** — aktuell für alle sichtbar, ggf. Pipedrive-Sichtbarkeitsgruppe.
3. ~~Anlegen per Script~~ ✅ erledigt — `Sevdesk-Pipdrive_sync/QualiFelderSetup.js`, idempotent über den Feldnamen.
   Bleibt offen: **Pflichtfelder** (#1, #3) setzt die API nicht — das ist in der Pipedrive-UI pro Pipeline/Stage zu konfigurieren.
   Ebenfalls offen: **Setter-Briefing** — ohne die zwei Regeln (auf €/Monat umrechnen; bei #4 gewinnt die Bedingung) werden die Felder ungleich befüllt.

4. **Sichtbarkeit Fulfillment** (14.09.): Felder sollen nur in der Sales-Pipeline erscheinen.
   - Weg 1 (UI-Handarbeit, offen): pro Feld "pipeline-specific" nur Sales anhaken -- Premium-Feature, per API nicht setzbar.
   - Weg 2 (gebaut, Code scharf): `Ordnererstellung-bei-Gewonnen/SetterInfoNotiz.gs` schreibt die Quali-Infos beim Gewinnen als Notiz an den Deal. Felder werden NICHT geleert (sonst faellt die Auswertbarkeit weg). Provisionsfelder bewusst nicht in der Notiz. `SETTER_NOTIZ_AKTIV = true` seit 14.09.2026, Testlauf an Deal 7621 erfolgreich (Notiz 13061).
     ✅ **LIVE seit 14.09.2026** -- Deployment @10, Serverstand verifiziert. Jeder frisch gewonnene Deal bekommt die Notiz automatisch; bereits gewonnene Deals bekommen sie bei der naechsten Aenderung (Webhook feuert auf jede Aenderung). Duplikate verhindert der Marker-Check `hatSetterInfoNotiz()`.
     API-Fund dabei: `POST /v1/notes` antwortet mit **201**, nicht 200 (offizielle Doku ist falsch) -> `callPipedriveWithRetry` in `Config.gs` akzeptiert jetzt beides. Ohne den Fix gilt ein erfolgreiches Anlegen als Fehler und erzeugt beim naechsten Event ein Duplikat.
5. Altdaten: 169 bestehende Quali-Notizen nachparsen oder Stichtag „ab jetzt neu"?
6. Ungeklärt aus dem Braindump: `10big installation ist genehmigt` — 10 kWp? von Baubehörde oder Netzbetreiber?
