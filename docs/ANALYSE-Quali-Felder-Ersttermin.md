# Analyse: Qualifizierungs-Notizen → Pipedrive Custom Fields

**Stand:** 2026-09-10 · **Read-only**, nichts in Pipedrive geschrieben.
**Ziel:** Setter tippen die Quali nicht mehr als Notizblock, sondern in passende Felder.

## Datenbasis & Gewichtung
- **1.500 Aktivitäten** durchbrowst (20.07.–09.09.2026) → **188 Ersttermin-Aktivitäten** über **177 Deals**
- **644 Notizen** auf 175 dieser Deals
- Zwei Kohorten, **neuere höher gewichtet**:
  - **NEU = letzte 100 ET-Deals** (Ersttermin 19.08.–09.09.2026)
  - **ALT = 77 ET-Deals** davor (bis 19.08.)

## Stolperfalle: Ersttermine haben ZWEI Aktivitätstypen
| Zeitraum | `type` | Betreff |
|---|---|---|
| ab ~18.08.2026 | `erstterminbesichtigung` (102) | „Ersttermin" / „Ersttermin/Besichtigung" |
| vor ~18.08.2026 | `meeting` (69) | „Ersttermin" |
| Randfälle | `call` (10), `email` (7) | „Besichtigung" / „Ersttermin" |

→ **Filter nie nur auf `type`** — sonst fehlen alle Deals vor dem 18.08.

## Befüllung nach Kohorte — die Setter schmeißen die Soft-Fragen raus
| Feld | NEU (100) | ALT (77) | Trend |
|---|---|---|---|
| Stromverbrauch | 77 % | 68 % | ~ |
| Monatliche Kosten | 76 % | 79 % | ~ |
| Selbstmontage/Schlüsselfertig | 69 % | 86 % | ↓ |
| Wann möchte er umsetzen | 60 % | 82 % | ↓ |
| Zusätzliche Infos | 55 % | 53 % | ~ |
| Was ist ihm sonst noch wichtig | 51 % | 83 % | **↓↓** |
| **Dach** | **42 %** | **10 %** | **↑↑** |
| **E-Auto** | **35 %** | **14 %** | **↑↑** |
| Warum noch nicht umgesetzt | 34 % | 64 % | **↓↓** |
| Wie lange überlegt er schon | 31 % | 69 % | **↓↓** |

**Lesart:** Die weichen Motivfragen werden faktisch aufgegeben, die harten technischen (Dach, E-Auto) kommen dazu. Felddesign soll dem **neuen** Verhalten folgen, nicht dem alten.

## Monatliche Kosten — Ranges (der Knackpunkt)
User-Präferenz: **monatliche Kosten** als Leitgröße (statt Stromverbrauch). Datenseitig bestätigt, siehe unten.

**Ranges sind selten und uneinheitlich: nur 10 von 142 Antworten (7 %).**

| Kohorte | Punktwert | Range | leer | keine Zahl |
|---|---|---|---|---|
| NEU (letzte 100) | 65 | **4** | 5 | 5 |
| ALT | 45 | **5** | 6 | 7 |

Die tatsächlich genannten Ranges — **keine gemeinsame Skala**:
`50–80` (2×) · `80–90` · `80–100` · `100–150` · `150–200` (2×) · `200–250` · `250–400` · `300–350` · `1600–1700`

→ **Entscheidung datenbasiert: `double` (Zahl in €/Monat), KEIN Range-Dropdown.**
Ein Dropdown bräuchte 8 Buckets, würde 93 % der Antworten künstlich vergröbern — und die real genannten Ranges passen nicht mal auf die Bucket-Grenzen.

Verteilung (n=119 Mittelwerte): min 11 · p25 105 · **Median 160** · p75 270 · p90 500 · max 2.800
Bucket-Belegung nur zur Info: 0–100: 18 · 100–150: **34** · 150–200: 20 · 200–250: 15 · 250–300: 6 · 300–400: 10 · 400–600: 9 · >600: 7

### Einheiten-Chaos im selben Feld (n=142) — muss abgefangen werden
| Fälle | Problem | Beispiel |
|---|---|---|
| 22 | unsicher/geschätzt | `nicht auswendig ca. 200€`, `ned soviel - weiß nicht genau!` |
| 10 | Range | `100-150` |
| 6 | **Jahres**wert statt Monat | `1900 euro im jahr - 158 im monat`, `800 Jahr!`, `3340€` |
| 5 | **cent/kWh** statt €/Monat | `30cent zahlt er`, `0,19cent angeblich - ohne netzgebühren`, `11cent pro kw` |
| 3 | pro Wohnung / Mehrparteien | `20 euro pro wohnung`, `Privathaus + Billa + 4 Ferienwohnungen` |
| 2 | Fremdenergie inkludiert | `115 Euro, der Rest Gas (340 Euro)`, `320 (inklusive Gas)` |
| 2 | Akonto/Anbieterwechsel | `240€ anbieter gewechselt kein neue Rechnung!` |

→ Ein reines Zahlenfeld allein reicht nicht: braucht **Einheit im Feldnamen** + **Flag „Wert geschätzt"**.

## Stromverbrauch — warum er die schlechtere Leitgröße ist
| Fälle | Form |
|---|---|
| 66 | `8k`-Kurzform (mehrdeutig: 8.000 kWh) |
| 23 | **Text ohne Zahl** — `4 Pax Familienhaus` |
| 13 | kWh explizit |
| 12 | nur Zahl, keine Einheit |
| 11 | leer |
| 8 | falsche Einheit `kw` statt kWh |

→ Nur 13 von 133 Antworten sind sauber. **Bestätigt die Präferenz für monatliche Kosten.**

## Montageart — „Hybrid" ist neu und echt
| Wert | NEU | ALT |
|---|---|---|
| Selbstmontage / `SM` | 26 | 35 |
| Schlüsselfertig | 23 | 24 |
| beides / egal | **12** | 4 |
| **HYBRID** | **6** | **0** |
| weiß nicht | 3 | 2 |

Dazu wörtlich: `50/50 Dach selber und Stromzähler Monteur`, `will beide Angebote`, `das besprechen wir vor ORT!`
→ Der Braindump (`3 angebote, hybrid auch dabei!`) ist **kein Ausreißer, sondern der neue Normalfall**. „Hybrid" muss eine Option sein.

## Themen in den Freitexten — Kohorten-Trend
| Thema | NEU | ALT | Trend |
|---|---|---|---|
| Speicher | 37 | 59 | ↓ |
| Förderung | 30 | 26 | ~ |
| Finanzierung | 10 | 18 | ↓ |
| Wallbox/E-Auto (Freitext) | 9 | 16 | ↓ |
| Unabhängigkeit/Autarkie/Notstrom | 9 | 18 | ↓ |
| **Verschattung/Winter/Tal** | **6** | 2 | **↑** |
| **Nebengebäude (Carport/Garage/Stadl)** | **5** | 2 | **↑** |
| Wärmepumpe | 4 | 9 | ↓ |
| **Denkmalschutz/Behörde/Widmung** | **3** | **0** | **↑** |
| **Dachsanierung nötig** | **3** | **0** | **↑** |
| Modular/Etappen/erweitern | 3 | 6 | ↓ |
| Pool/Pooldach | 3 | 2 | ~ |
| Fassade | 2 | 1 | ~ |

**Der Molln-Braindump trifft genau die vier Aufsteiger** (Denkmal, Carport/Pooldach/Fassade, kein Sonne im Tal, Dach nicht nutzbar). Das ist das Argument, die Felder jetzt zu bauen.

## Einspeisung — brandneues Thema
Nur **6 Notizen**, aber **alle 6 in der neuen Kohorte, 0 in der alten**. Beide Richtungen vertreten:
- `nicht einspeisen` (Deal 7498)
- `50k PV + Speicher + einspeisen!` (Deal 7419)
- `26,5 darf er einspeisen, 30kw am Tag` (7439) · `Genehmigung 30kw zum einspeisung` (7449) · `Einspeisung 11ct bei seiner Energiegemeinschaft` (7392)

→ Rechtfertigt ein Feld. Deckt auch `Will nicht unbedingt einspeißen! Will unabhängig sein!` aus dem Braindump ab.

## Neuer Fund: Setter-Zuordnung + Provision steht in den Notizen
Ausgelöst durch `Sven 5%` im Braindump — das ist systematisch:
| Setter | Nennungen | Deals | Sätze |
|---|---|---|---|
| Sven | 48 | 25 | 5 % |
| Ramon | 31 | 28 | 5 % |
| Sergen | 21 | 21 | 5 %, 20 % |
| Manuel | 13 | 13 | 5 %, 20 % |

**200 Notizen** enthalten überhaupt eine Prozentangabe. Distinct Sätze: 3 %, 5 %, 19 %, 20 %.
→ Provisionsrelevante Daten liegen heute **unstrukturiert im Freitext**. Eigene Felder wären der größte Struktur-Hebel — aber provisionsnah, deshalb explizite Entscheidung nötig (siehe offene Punkte).

## Gewünschte Speichergröße
34 Notizen nennen eine Zahl direkt beim Speicher: `Speicher 10`, `speicher 15`, `speicher20`, `speicher 40kw`, `Speicher - 15`, `Speicher 5`
→ eigenes `double`-Feld „Gewünschte Speichergröße kWh". Deckt `Speicher 10` aus dem Braindump ab.

## Geplanter Montageort (Nennungen in Notizen)
| Ort | alle | neu |
|---|---|---|
| Hausdach | 107 | 48 |
| Garage | 14 | 5 |
| Freifläche/Wiese | 13 | 5 |
| Terrasse/Pergola | 13 | 8 |
| Carport | 10 | 7 |
| Stadl/Scheune | 10 | 2 |
| Zaun | 9 | 2 |
| Fassade | 4 | 2 |
| Pooldach | 2 | 2 |

→ **`set` (Mehrfachauswahl)** — Molln braucht z.B. gleichzeitig Carport + Pooldach + Fassade.

---

# FELDVORSCHLAG

> 🔴 **Eingekocht auf 11 Felder** (Stand 11.09.) — User: "viel zu viele Felder" (10.09.),
> danach "setter und provision muss rein".
> 5 Must-have + 3 Maybe + 3 Provisionsfelder. Die `set`-Felder bekommen bewusst lange Optionslisten
> (18–20 Optionen), damit nicht wöchentlich eine Option nachgepflegt werden muss.
> Maßgeblich ist ab jetzt **`SPEC-Quali-Felder-Setter.md`**. Die Blöcke A–D unten bleiben als Herleitung
> (welches Feld welche Datenlage hat), sind aber **nicht** die Bauliste.

## A — Kern, hoch befüllt, sofort bauen (7 Felder)
| Feld | Typ | Optionen / Einheit | Begründung |
|---|---|---|---|
| Stromkosten €/Monat | `double` | Einheit im Namen | 76–79 % befüllt, Leitgröße, Ranges nur 7 % |
| Stromkosten geschätzt | `enum` | Ja / Nein | 22 Fälle „ca / weiß nicht genau" |
| Stromverbrauch kWh/Jahr | `double` | kWh/Jahr | 77 % befüllt, aber Einheiten-Chaos → Einheit erzwingen |
| Montageart-Präferenz | `enum` | Selbstmontage · Schlüsselfertig · **Hybrid** · Beides anbieten · Weiß noch nicht · Entscheidet vor Ort | Hybrid 6× neu / 0× alt |
| Umsetzungszeitpunkt | `enum` | sofort · < 3 Monate · heuer noch · nach dem Winter/Frühjahr · offen (bei Angebotslegung) | 60 % befüllt |
| Geplanter Montageort | `set` | Hausdach · Carport · Garage · Stadl/Scheune · Terrasse/Pergola · Freifläche/Wiese · Fassade · Pooldach · Zaun | Mehrfach nötig, Carport steigt |
| Interesse an | `set` | Speicher · Wallbox/E-Auto · Förderung · Finanzierung · Wärmepumpe · Autarkie/Notstrom · Klimaanlage · Pool · Heizstab/Warmwasser · Erweiterung Altanlage | ersetzt „Was ist ihm sonst noch wichtig" strukturiert |

## B — Neue Themen der neuen Kohorte (5 Felder)
| Feld | Typ | Optionen | Begründung |
|---|---|---|---|
| Einspeisung gewünscht | `enum` | ja · nein (will autark) · nur Überschuss · unklar | 6 Treffer, alle neu |
| Gewünschte Speichergröße kWh | `double` | kWh | 34 Nennungen |
| Dachnutzung eingeschränkt | `enum` | nein · Denkmalschutz/Ortsbild · Dachsanierung nötig · Statik · Verschattung · sonstiges | Denkmal 3/0, Dachsanierung 3/0 |
| Verschattung/Standort-Risiko | `varchar` | Freitext | 6× neu — „kein Sonne im Tal, Schnee/Frost im Winter" |
| E-Auto | `enum` | ja vorhanden · geplant/demnächst · überlegt · nein | 35 % neu vs. 14 % alt, steigend |

## C — Freitext behalten, NICHT in Dropdowns pressen (3 Felder)
| Feld | Typ | Begründung |
|---|---|---|
| Warum noch nicht umgesetzt | `varchar` | nur 34 % neu, aber inhaltlich nicht enumerierbar → optional |
| Zusätzliche Infos (Setter) | `varchar` (lang) | 55 % befüllt, echter Catch-all |
| Interne Empfehlung Setter | `varchar` | `IDEE: wir gehen mit 5 kWp raus` — bisher 2–5 Treffer, aber hoher Wert für den Closer |

## D — Bewusst NICHT bauen
- **„Wie lange überlegt er schon"** — von 69 % auf 31 % eingebrochen, Antworten vage (`länger` 22×). Wird faktisch nicht mehr gefragt.
- **Adresse** (93 Nennungen) — gehört ins Person/Deal-Adressfeld, nicht in ein neues Custom Field. ⚠️ PLZ-Feld ist laut Referenz unzuverlässig.
- **Dach-Details** — `Dachform`, `Eindeckung`, `Dachneigung`, `Gebäudehöhe` etc. existieren schon, inkl. `2_`/`3_`-Varianten für Mehrfach-Dach. Die „Dach:"-Zeilen (42 % neu!) gehören dorthin.
- **Erweiterung Altanlage** — `Neuanlage oder Erweiterung` `8bc19dfdb1f3135f1babe069f2f9bfba1b347c40` deckt das ab.

## Nicht duplizieren (bestehende Felder)
- `Sonstige Mitteilung Kunde / Notizen Kunde` — `0aff5c6f5bd4d7990c171cbe62a670bfabd5c0fd`
- `Notizen intern` — `2565f8005e57f0b6bad0a36560f9f3213beffe98`
- `Förderstatus` — `fe61797bd9d9e4990a2f5735b8c4de1919c7fa11`
- `Finanzierungsstatus` — `ec8aa2fee84efabc5770fae60e13397c3247a146`
- Dach-Basisfelder + `2_`/`3_`-Varianten (siehe `REFERENZ-Pipedrive-AppsScript.md`)

---

# OFFENE ENTSCHEIDUNGEN
1. **Setter + Provisionssatz als Felder?** 200 Notizen enthalten `<Name> <x>%`, 4 Setter identifiziert. Größter Struktur-Hebel, aber provisionsnahe Daten → braucht OK und ggf. Sichtbarkeitsbeschränkung.
2. **Jahreswerte & cent/kWh:** eigene Felder `Stromkosten €/Jahr` und `Strompreis ct/kWh` dazu, oder Setter auf €/Monat umrechnen lassen? (11 Fälle betroffen)
3. **Mehrparteien-Objekte** (3 Fälle, z.B. `Privathaus + Billa + 4 Ferienwohnungen`): eigenes Flag „Mehrparteien/Gewerbe" oder im Freitext lassen?
4. **„Wie lange überlegt" wirklich streichen?** Empfehlung ja — Bestätigung fehlt.
5. **Altdaten:** 169 bestehende Quali-Notizen nachträglich in die Felder parsen, oder Stichtag „ab jetzt neu"?
6. **Anlegen:** per Script (`FieldSetup`-Pattern mit DRY_RUN, wie `FieldSetup2_3.js`) oder manuell in Pipedrive geklickt?
7. **Pflichtfelder:** Kern-Felder (A) in Pipedrive als required markieren, damit die Setter sie nicht überspringen?

---

## Mehrdeutig im Braindump — nicht geraten, bitte klären
- `10big installation ist genehmigt` — 10 kWp genehmigt? Von Baubehörde oder Netzbetreiber?
- `wenn der rest öffentlich zu zahlen ist kann sein kein problem` — Satz unklar, keine Feldableitung möglich.
- `Fasade tene weiß aber nicht wieviel passt` — Fassadenfläche unbekannt → Vorplanung braucht Aufmaß.
