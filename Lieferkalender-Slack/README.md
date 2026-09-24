# Lieferkalender-Slack ("Ernst")

Meldet Termin-Aenderungen aus Pipedrive-Pipeline 2 (Fulfillment) nach Slack.
Ueberwacht werden vier Datumsfelder am Deal: **Liefertermin, DC-Termin,
AC-Termin, IB-Termin**.

Das Script ist **rein lesend gegenueber Pipedrive**. Geschrieben wird nur ins
eigene Google Sheet und nach Slack.

**LIVE seit 11.09.2026, 13:44.** `DRY_RUN = false`, zwei Zeit-Trigger aktiv.
Erste echte Meldung 13:45 ("HEUTE Lieferung", Deal 6952).

- Editor: https://script.google.com/home/projects/1N1Q1XRvCtR6uUIIxZMM-NmaiP0xsGrXuR03cu3GQyWeRXrwjc28VTb4P/edit
- scriptId: `1N1Q1XRvCtR6uUIIxZMM-NmaiP0xsGrXuR03cu3GQyWeRXrwjc28VTb4P`
- Sheet: `11lekovl_J-701s9xmbFHOxYodNta-9rVXa-MFCxjF8U`
- Channel: **#ernst-knows** (`C0C0Q6JML23`)

---

## Wie es funktioniert — zwei verschiedene Mechanismen

Die Meldungen entstehen auf zwei voellig unterschiedliche Arten. Das ist der
wichtigste Punkt zum Verstehen des Projekts.

### 1. Aenderungs-Meldungen (gesetzt / verschoben / geloescht)

Pipedrive sagt nicht "dieses Feld wurde gerade geaendert". Der Listen-Endpoint
liefert nur den **aktuellen** Stand. Um "gerade gesetzt" von "steht schon seit
drei Wochen drin" zu unterscheiden, braucht das Script ein **Gedaechtnis**.

Das ist der Tab **Snapshot**: eine Zeile pro Deal mit dem Stand des letzten
Laufs. Jeder Lauf vergleicht Snapshot gegen Pipedrive:

| Snapshot (alt) | Pipedrive (neu) | Ereignis |
|---|---|---|
| leer | `2026-09-18` | **gesetzt** |
| `2026-09-11` | `2026-09-18` | **verschoben** (beide Daten in der Meldung) |
| `2026-09-11` | leer | **geloescht** |
| `2026-09-18` | `2026-09-18` | nichts |

Am Ende des Laufs wird der Snapshot neu geschrieben und ist damit der "alte"
Stand fuer den naechsten Lauf.

**Der Snapshot-Tab ist gleichzeitig die Liefer-Uebersicht**, die urspruenglich
das Ziel war: Deal-ID, Kunde, PLZ, Montagepartner, Stage und alle vier Termine
in einer Tabelle. Eine Datenstruktur, zwei Zwecke.

### 2. Datums-Meldungen (vorher / am Tag)

Die loest niemand in Pipedrive aus — der Ausloeser ist der Kalender. Hier wird
nicht verglichen, sondern gerechnet: `Termin minus N Tage == heute?`

Diese Regeln feuern bei jedem Lauf erneut, auch wenn sich nichts geaendert hat.
Bei einem 15-Minuten-Trigger waeren das 96 Posts pro Deal und Tag. Deshalb ist
der **Doppelpost-Schutz hier zwingend**, nicht optional — siehe unten.

---

## Steuerung: der Tab "Regeln"

Alles, was gemeldet wird, steht in diesem Tab. Eine Regel aendern heisst **eine
Zelle im Sheet aendern** — kein `clasp push`, kein Deployment, geht auch vom
Handy.

| Spalte | Bedeutung |
|---|---|
| `Aktiv` | `ja` / `nein` — Regel abschalten ohne sie zu loeschen |
| `Feld` | `Liefertermin` · `DC-Termin` · `AC-Termin` · `IB-Termin` |
| `Ereignis` | `gesetzt` · `verschoben` · `geloescht` · `vorher` · `am Tag` |
| `Tage davor` | nur bei `vorher` — Zahl, z.B. `2` |
| `Channel-ID` | Slack-ID, beginnt mit `C` (oder `G` bei privaten Channels). **Nicht der Name** — beim Umbenennen bricht sonst alles. |
| `Vorlage` | der Nachrichtentext mit Platzhaltern |

Gelesen wird nach **Header-Namen**, nicht nach Spaltenposition — die Spalten
duerfen also verschoben werden. (Lehre aus den Partner-Sheets, wo 5 von 6 eine
andere Reihenfolge hatten.)

Mehrere Zeilen pro Feld sind der Normalfall. Eine Kadenz 14/7/2/0 Tage vorher
waeren vier Zeilen mit Ereignis `vorher`.

### Platzhalter

| Platzhalter | Inhalt |
|---|---|
| `{dealId}` | 5829 |
| `{kunde}` | Deal-Titel |
| `{plz}` | PLZ der Person — **siehe Warnung unten** |
| `{partner}` | Montagepartner (ALE, Berger, …) |
| `{deallink}` | `https://rp-energietechnik.pipedrive.com/deal/5829` |
| `{datum}` | das relevante Datum der Meldung, z.B. `Fr, 18.09.2026` |
| `{altdatum}` / `{neudatum}` | nur sinnvoll bei `verschoben` |
| `{liefertermin}` `{dc}` `{ac}` `{ib}` | alle vier Termine des Deals |
| `{stage}` | Stage-ID |
| `{tage}` | die Zahl aus "Tage davor" |
| `{feld}` | Feldname der Regel |
| `{ordnerlink}` | Kundenordner in Drive |

Dazu die Platzhalter aus dem Personen-Sweep und vom CT-Termin:

| Platzhalter | Inhalt |
|---|---|
| `{vorname}` / `{nachname}` | Name der Person am Deal |
| `{telefon}` | Telefonnummer der Person (primaere aus `phones[]`) |
| `{uhrzeit}` | `10:30` — nur bei `CT-Termin` gefuellt |
| `{um}` | `um 10:30 Uhr`, **leer wenn der Termin keine Uhrzeit hat** |
| `{cc}` / `{cc_voll}` | Vorname / voller Name des Activity-Owners (= Cash Collector) |
| `{watext}` | der fertige Kundentext aus Spalte `WA-Text` |
| `{walink}` | `https://wa.me/43…?text=…` mit genau diesem Text |

**Bewusst NICHT dabei:** kWp/Speicher — stehen in "Anlagendetails",
Fuellstand ungemessen. Dafuer ist `{deallink}` da.

> **Korrektur 21.09.2026:** hier stand vorher, die Telefonnummer sei bewusst
> nicht dabei, weil sie einen Extra-Call braucht. Stimmt nicht mehr: sie kommt
> aus demselben `/persons`-Sweep wie die PLZ, kostet also keinen zusaetzlichen
> Call. Gebraucht fuer den `wa.me`-Link.

Ein Platzhalter, den es nicht gibt (Tippfehler `{kwpp}`), wird **nicht still
stehen gelassen**, sondern erzeugt eine Warnung im Log.

### Syntax in der Spalte "Vorlage"

Slack versteht **mrkdwn**, nicht Markdown — das ist nicht dasselbe:

| gewollt | schreiben |
|---|---|
| **fett** | `*fett*` — EIN Stern, nicht zwei |
| _kursiv_ | `_kursiv_` |
| `code` | Backticks |
| Link mit Text | `<{deallink}|Deal {dealId} oeffnen>` |
| Zeilenumbruch | `
` als **zwei Zeichen** in der Zelle |

Zum Umbruch: Alt+Enter in der Zelle funktioniert auch, ist aber beim
Copy-Paste einer ganzen Regel-Tabelle nicht durchzuhalten — mehrzeilige Zellen
zerreissen dabei. Deshalb `
`.

Leere Platzhalter raeumen sich selbst auf: aus `{kunde} · {plz} · {partner}`
wird bei fehlender PLZ nicht `Muster ·  · ALE`, sondern `Muster · ALE`.
Das gilt fuer `·`, `( )` und `[ ]`.

### Ein Symbol pro Ereignisklasse, nicht pro Terminart

Vorgabe Valentin: ✅ gesetzt · ↪️ verschoben · 🗑️ geloescht · ➡️ Erinnerung.

Beim Ueberfliegen des Channels zaehlt **"muss ich reagieren?"**, und das haengt
am Ereignis, nicht daran, ob es DC oder AC ist. Ein Symbol pro Terminart waere
die Sortierung, die man beim Lesen gerade nicht braucht.

`setzeVorlagenNeu()` schreibt nur die Spalte `Vorlage` neu (nach
Feld|Ereignis|Tage|Channel gematcht) und loggt ALT/NEU pro Zeile. Channel-ID und
`Aktiv` bleiben unangetastet. Damit sind Text-Updates aus dem Code moeglich,
ohne den Tab zu loeschen — aber Achtung: **eigene Texte werden dabei
ueberschrieben.**

### Die 15 Startregeln

`befuelleRegelnMitStartwerten()` legt genau das an, was am 10.09. festgelegt
wurde:

| Feld | Ereignisse |
|---|---|
| Liefertermin | gesetzt · verschoben · geloescht · 1 Tag vorher · am Tag |
| DC-Termin | gesetzt · 2 Tage vorher · am Tag |
| AC-Termin | gesetzt · 2 Tage vorher · am Tag |
| IB-Termin | gesetzt · 2 Tage vorher · am Tag |

Dazu die **Bonus-DM** (16.09.2026): `Liefertermin / am Tag` ein zweites Mal,
Ziel ist aber nicht `#ernst-knows`, sondern Valentins User-ID.

Die Texte sind Platzhalter-Formulierungen. **Valentin schreibt sie um** — dafuer
ist der Tab da. Die Funktion ueberschreibt nichts, wenn der Tab schon Zeilen hat.
Fuer das Nachruesten einzelner Regeln in einen bereits gefuellten Tab gibt es
`ergaenzeFehlendeRegeln()` — haengt nur an, was fehlt, ist idempotent.

---

## Die Bonus-DM (seit 16.09.2026)

Valentin bekommt pro erfolgter Lieferung eine Praemie. Dafuer laeuft eine
zweite `Liefertermin / am Tag`-Regel, die als **Direktnachricht** zugestellt
wird — nicht in `#ernst-knows`. Was er pro Lieferung verdient, ist keine
Team-Information.

**Empfaenger als DM:** in der Spalte `Channel-ID` steht eine **User-ID**
(`U0BM9J0KPQT`). Slack oeffnet die DM bei `chat.postMessage` von selbst, sobald
`channel` eine User-ID ist — ein `conversations.open` braucht es nicht, und
`chat:write` reicht als Scope. Die Validierung in `Regeln.gs` akzeptiert
deshalb `C`, `G`, `D` **und** `U`.

**Neue Platzhalter:** `{bonus_brutto}` und `{bonus_netto}`, gespeist aus
`Config.gs`:

| Konstante | Bedeutung |
|---|---|
| `BONUS_PRO_LIEFERUNG_BRUTTO` | `100` |
| `BONUS_NETTO_FAKTOR` | `null` = unbekannt. Dann bleibt `{bonus_netto}` **leer** und faellt samt `·` aus der Zeile. |

Der Faktor wird **bewusst nicht geraten** — Grenzsteuersatz und SV sind
individuell, und eine erfundene Netto-Zahl in einer Bonus-Meldung ist schlimmer
als gar keine. Sobald Valentin den Satz nennt: eintragen (z.B. `0.52`) und
`clasp push`.

### Warum der Ausloeser der Liefertermin ist und nicht "Geliefert"

Naheliegender waere der Meilenstein `Geliefert` (Option 228 im Erledigt-Feld).
Messung am 16.09.2026 ueber alle 485 gewonnenen Deals: **0 gesetzt.** Das Feld
wird nicht gepflegt und ist als Ausloeser wertlos.

Folge, die man wissen muss: gemeldet wird der **geplante** Liefertag, nicht die
bestaetigte Lieferung. Wird ein Termin nach der Meldung verschoben, ist die
Bonus-DM trotzdem schon raus. Ausserdem hatten zum selben Zeitpunkt nur
**9 von 485** gewonnenen Deals ueberhaupt einen Liefertermin — die DM ist also
nur so vollstaendig wie die Feldpflege in Pipedrive.

### Zwei Regeln, ein Ereignis — der Doppelpost-Schutz musste mit

Der Schluessel im Log-Tab war `dealId|Feld|Ereignis|Tage|Bezugsdatum` — **ohne
Channel**. Zwei Regeln auf dasselbe Ereignis in verschiedene Channels haetten
sich damit gegenseitig blockiert: die erste setzt den Schluessel, die zweite
haelt sich fuer ein Duplikat und postet **nie**, ohne Warnung.

Seit 16.09.2026 gehoert der Channel in den Schluessel. Fuer die Log-Eintraege
aus der Zeit davor gibt es in `schonGesendet()` eine Bruecke: fehlt der neue
Schluessel, wird zusaetzlich die alte Form geprueft — aber nur fuer
`C0C0Q6JML23`, den damals einzigen Channel. Ohne diese Bruecke waere jede heute
schon gemeldete Erinnerung ein zweites Mal gekommen.

---

## CT-Kundenerinnerung per WhatsApp (21.09.2026)

**CT** = Cash-Collection-Termin. Der Kunde soll am Vortag eine WhatsApp-
Erinnerung bekommen — ohne dass jemand eine Liste durchgeht.

### Warum kein Pipedrive-Sequence und keine echte Automatik

- **Sequences** zaehlen ab der *Einschreibung*, nicht ab dem Termindatum. Eine
  Erinnerung "einen Tag vor dem Termin" ist damit nicht baubar, und eine
  Terminverschiebung merkt die Sequence gar nicht.
- **WhatsApp Desktop/Web fernsteuern** (Klick-Automat, Browser-Bot) verstoesst
  gegen die WhatsApp-ToS und riskiert die Sperre der Firmennummer. Nicht gebaut.
- **WhatsApp Cloud API** (eigene Nummer, von Meta freigegebene Templates,
  Preis pro Nachricht) ist der saubere Weg fuer echten Auto-Versand — aber eine
  Registrierung, die Wochen dauert. Laeuft als "Weg B" separat.

### Was stattdessen passiert ("Weg A")

Ernst schickt **Valentin eine DM** mit einem fertigen `wa.me`-Link. Ein Klick
oeffnet WhatsApp Desktop mit dem vorformulierten Text im Eingabefeld —
abgeschickt wird erst per Enter. Also:

- **kein manuelles Suchen**: Termin, Kunde, Nummer und Text stehen schon drin
- **keine ToS-Verletzung**: der Versand ist ein menschlicher Klick
- **nichts geht ungeprueft nach draussen**

Der Umstieg auf Weg B tauscht nur den Sendeschritt — Erkennung, Texte,
Doppelpost-Schutz und Log bleiben wie sie sind.

### Woher der CT-Termin kommt

Nicht aus einem Deal-Feld, sondern aus **Pipedrive-Activities**. Dabei drei
Dinge, die man beim Bauen erst merkt:

1. **Die CT-Activity haengt an der PERSON, nicht am Deal** (`deal_id: null`,
   `person_id` gesetzt — nachgesehen an Deal 7500 und 7468). Ein
   `getActivities(deal_id=…)` findet sie also nicht. `ctFuerDeal()` nimmt
   `deal_id` zuerst und faellt auf `person_id` zurueck.
2. **Der Activity-`type` ist nicht verlaesslich** — meist `fzweitgesprach`,
   manchmal `meeting`. Verlaesslich ist nur der Betreff nach
   Kalenderkonvention `PLZ Name (CT)`. Erkannt wird deshalb am Marker `(CT)`.
   Activities vom Typ `fzweitgesprach` *ohne* Marker landen als
   Verdachtsfall im Log, statt still zu verschwinden.
3. **`/activities` hat keinen Datumsfilter.** Nachgesehen, nicht angenommen:
   filterbar sind nur `deal_id`, `person_id`, `org_id`, `owner_id`, `done`,
   `filter_id`, `ids`, `lead_id`, `updated_since/until`. Also werden alle
   **offenen** Activities geholt (`done=false`, `limit=500`, Cursor) und lokal
   nach Datum verglichen. Deckel bei `CT_MAX_SEITEN = 40` (= 20 000
   Activities); wird er erreicht, steht das als Warnung im Laeufe-Tab.

**Der Cash Collector ist der Activity-Owner, nicht der Deal-Owner.** Die
Fulfillment-Uebernahme setzt `owner_id` bei praktisch allen Deals auf Valentin
— als Personenkennung damit wertlos. Die Activity behaelt ihren Owner.

### CT-Termin ist ein Pseudo-Feld

`CT-Termin` sieht fuer die Regel-Engine aus wie `Liefertermin` & Co., hat aber
**keine Snapshot-Spalte**. Absicht: mit Snapshot-Spalte wuerde beim ersten Lauf
jeder bestehende CT als "gerade gesetzt" gemeldet werden.

Folge: erlaubt sind nur die datumsbasierten Ereignisse **`vorher`** und
**`am Tag`**. Eine CT-Regel mit `gesetzt`/`verschoben`/`geloescht` wird beim
Lesen des Tabs **laut abgelehnt** (Log-Warnung), nicht still ignoriert.
Verschiebungen sind trotzdem gedeckt: das Bezugsdatum steckt im
Doppelpost-Schluessel, ein verschobener Termin erinnert also am neuen Vortag
noch einmal.

### Entscheidungen vom 21.09.2026

- **Die DM geht immer an Valentin**, nicht an den jeweiligen Cash Collector.
  Damit laeuft der Versand aus einer Nummer — die, die der Kunde ohnehin kennt.
- **Signatur im Kundentext ist die Firma**, nicht `{cc}`. Folgt direkt aus dem
  ersten Punkt: abgeschickt wird aus Valentins WhatsApp, eine Unterschrift mit
  fremdem Namen passt nicht zum Absender. Gemessene Verteilung war Marco 7 /
  Sean 3 / Valentin 1 — es waere also der Regelfall, nicht der Ausnahmefall.
  `{cc}` bleibt in der **Slack**-Vorlage, dort ist "wer ist zustaendig" genau
  die richtige Information.
- **Der Text bestaetigt, er fragt nicht zurueck**: "unser Termin morgen … steht.
  Wir freuen uns auf Sie!" Kein "falls es nicht passt" — eine Erinnerung, die
  zum Absagen einlaedt, produziert Absagen.

### Zwei Texte pro Regel

| Spalte | Empfaenger | Inhalt |
|---|---|---|
| `Vorlage` | Slack (Valentins DM) | Uebersicht + `{walink}` |
| `WA-Text` | der **Kunde** | wird in den `wa.me`-Link einkodiert |

Die Spalte `WA-Text` ist **optional** — fehlt sie, laeuft alles Uebrige
unveraendert weiter. `{walink}` innerhalb des Kundentexts bleibt leer (das waere
eine Schleife).

### Wenn keine Nummer da ist

`waNummer()` normalisiert oesterreichisch: `+` bleibt, `00` wird abgeschnitten,
fuehrende `0` wird zu `43`, sonst muss die Nummer schon mit `43` beginnen;
Ergebnis 10–15 Stellen, sonst `null`. Ohne Nummer gibt es keinen Link — und die
Slack-Meldung sagt dann **"⚠️ keine WhatsApp-Nummer"** statt einfach nichts.
Eine fehlende Nummer ist genau die Information, die man braucht.

### Befunde aus dem ersten Probelauf (21.09.2026)

1213 offene Activities auf 3 Seiten, **11 mit `(CT)`-Marker**, 6 Verdachtsfaelle
ohne Marker, 112 Pipeline-2-Deals davon 11 mit offenem CT. Kein verwaister CT,
kein Doppel-CT, kein Doppel-Deal. Uhrzeit, Cash Collector (via Activity-Owner)
und Nummern-Normalisierung stimmen.

Zwei Sachen, die der Lauf aufgedeckt hat:

- **Activity 17306 hat als Betreff nur `"CT"`** — ohne Klammern, also vom Marker
  `(CT)` nicht erfasst. Steht als Verdachtsfall im Log. Der Regex wird
  **nicht** stillschweigend gelockert: ob ein nackter Betreff "CT" zaehlt, ist
  eine Entscheidung ueber die Kalenderkonvention, keine Code-Frage. Die anderen
  fuenf Verdachtsfaelle sind erkennbar Closing-/Kundentermine.
- **`encodeURIComponent()` laesst `(` und `)` durch.** In Slacks `<url|label>`
  harmlos, aber der Link wird auch aus dem Log kopiert, und Terminals wie
  Markdown-Parser schneiden an einer `)` gern ab. `kodiereWaText()` kodiert
  `( ) ' ! *` jetzt mit.

### Gegenprobe im Google Kalender (21.09.2026)

Die CT-Termine entstehen im Kalender und werden nach Pipedrive uebertragen.
Driften die zwei auseinander, merkt es niemand — bis eine Erinnerung mit der
falschen Uhrzeit beim Kunden landet. Genau der Fall tut weh, weil er nach
draussen geht.

**Anschalten:** `listeKalender()` laufen lassen, die passende ID in
`CT_KALENDER_ID` (in `CtKalender.gs`) eintragen, `clasp push`. Leer = Abgleich
aus; die ID wird **nicht** geraten.

Der Abgleich prueft drei Richtungen:

| Richtung | Befund | Folge |
|---|---|---|
| Pipedrive → Kalender | Uhrzeiten widersprechen sich | **keine Erinnerung**, Fall ins Log |
| Pipedrive → Kalender | am Tag kein passender Termin | nur Hinweis, Erinnerung geht raus |
| Kalender → Pipedrive | `(CT)`-Termin ohne offene Activity | Warnung im Laeufe-Tab |
| Verdachtsfall → Kalender | steht am Tag ein `(CT)`-Termin? | Entscheidungsgrundlage im Log |

Warum ein **Widerspruch** stoppt, ein **fehlender Eintrag** aber nicht: bei
widersprechenden Uhrzeiten ist eine der beiden falsch, und der Kunde richtet
sich nach der, die er bekommt — lieber keine Nachricht. Fehlt der Eintrag
dagegen ganz, ist wahrscheinlich der konfigurierte Kalender der falsche, und
dann duerfen nicht alle Erinnerungen ausfallen. Umschaltbar ueber
`CT_KALENDER_KONFLIKT_STOPPT`.

Zugeordnet wird ueber den Titel: Kleinschreibung, Umlaute aufgeloest,
Namensbestandteile ab 4 Zeichen. Kuerzere treffen zu leicht auf fremde Termine.
Fenster: 7 Tage zurueck bis 90 Tage vor.

> **Achtung beim ersten Lauf:** `CalendarApp` braucht einen neuen
> OAuth-Scope. Nach dem Push **einmal von Hand im Editor** eine Funktion
> ausfuehren und zustimmen — sonst laufen die Trigger in
> "Authorization is required".

### Zwei offene CTs zum selben Kunden

Dann wird **nicht geraten**: keine Erinnerung, und alle Kandidaten (Activity-ID,
Datum, Uhrzeit, Betreff) landen im Log und im Laeufe-Tab. Aufgeraeumt wird in
Pipedrive, nicht im Code.

### Eine Person, zwei Deals in Pipeline 2

Der Join laeuft ueber `person_id`. Hat dieselbe Person zwei Deals in Pipeline 2
und der CT hat keine `deal_id`, haengt er an **beiden** Deals — und weil die
Deal-ID im Doppelpost-Schluessel steckt, kommt die DM zweimal. Der
Doppelpost-Schutz kann das nicht sehen, fuer ihn sind es zwei Deals.
`pruefeDoppelDeals()` meldet genau diesen Fall in den Laeufe-Tab, statt ihn
auszusitzen. Aufgeraeumt wird in Pipedrive (Doppel-Deal schliessen, oder die
Activity an einen Deal haengen).

### Was der Selbst-Review am 21.09.2026 gefunden hat

Vier Sachen, alle gefixt — aufgeschrieben, weil es dieselben Muster sind, die
in diesem Projekt schon zweimal zugeschlagen haben:

1. **`setzeCtMap()` hat die Warnliste geleert**, nachdem `holeCtMap()` sie
   gefuellt hatte. Die Seitenlimit-Warnung ("es koennen CT-Termine fehlen")
   erreichte den Laeufe-Tab damit nie — genau der stille Ausfall, gegen den
   die Warnung gebaut war (vgl. das Cloudflare-Relay, das immer 200 meldete).
   Zurueckgesetzt wird jetzt am Anfang von `holeCtMap()`.
2. **Ein Fehler im CT-Abruf riss den ganzen Sweep mit** — also auch die seit
   11.09. live laufenden Liefertermin-Meldungen. Der CT-Abruf ist jetzt
   eingekapselt: faellt er aus, entfallen nur die CT-Erinnerungen, der Grund
   steht im Laeufe-Tab.
3. **Warnungen wurden mehrfach gezaehlt.** `ctFuerDeal()` laeuft pro Deal x
   Regel und zusaetzlich in `baueKontext()` — ein Doppel-CT haette "6
   Zweifelsfaelle" gemeldet, wo es zwei sind. `ctWarnung()` dedupliziert.
4. **`pruefeKonfiguration()` sagte nichts ueber die CT-Kette.** Prueft jetzt:
   CT-Regel aktiv? Spalte `WA-Text` da? Kundentext gefuellt? `{walink}` in der
   Vorlage?

### Inbetriebnahme

1. `ergaenzeWaSpalte()` — legt die Spalte `WA-Text` an
2. `ergaenzeFehlendeRegeln()` — haengt die zwei CT-Zeilen an
3. `testeCtLauf()` — Log lesen. Zuerst kommt die Liste **aller** gefundenen
   CT-Termine (Datum, Uhrzeit, Deal, Kunde, CC, Telefon ok/FEHLT, Activity-ID),
   nach Datum sortiert — die laesst sich gegen den Kalender gegenlesen. Danach
   nur die Termine, die *heute* eine Meldung ausloesen wuerden, samt Slack-Text,
   Kundentext und `wa.me`-Link. Der Link aus dem Log laesst sich im Browser
   oeffnen; WhatsApp geht mit dem Text auf, abgeschickt wird nichts.
4. Texte in den Spalten `Vorlage` / `WA-Text` umschreiben — ohne `clasp push`
5. Fertig. Der bestehende Tages-Trigger um ~07:15 uebernimmt.

> **Korrektur 21.09.2026:** hier stand, die Zeile `CT-Termin / am Tag` sei auf
> `nein` gesetzt, weil zwei Erinnerungen zum selben Termin schnell eine zu viel
> seien. Gilt nicht mehr — **beide Zeilen sind scharf**, siehe unten.

**Beide Erinnerungen laufen**: am Vortag und am Tag des Termins. Der Kunde
bekommt also zwei Nachrichten. Die zwei Regeln blockieren sich nicht — das
Ereignis steckt im Doppelpost-Schluessel, `vorher` und `am Tag` sind
verschiedene Schluessel.

Der Tages-Trigger laeuft gegen **07:15**. Bei einem CT um 07:30 kommt die
"heute"-Erinnerung also rund 15 Minuten vorher — knapp, aber im Datenbestand
der Ausnahmefall (frueheste gemessene Uhrzeit: 07:30).

Ziel ist bewusst die **DM**, nicht `#ernst-knows`: im `wa.me`-Link steht die
Telefonnummer des Kunden im Klartext.

---

## Setup — Reihenfolge

1. **Slack-App "Ernst"** auf `https://api.slack.com/apps` anlegen
   (*From scratch*, RP-Workspace).
   Bot Token Scopes: `chat:write`, `chat:write.public`, `channels:read`.
   Installieren → Bot Token (`xoxb-…`) kopieren.
2. **Channel anlegen** und den Bot einladen: im Channel `/invite @Ernst`.
   Channel-ID holen: Rechtsklick auf den Channel → Link kopieren, die ID am
   Ende beginnt mit `C`.
3. **Apps-Script-Projekt anlegen** (`clasp create`) und pushen.
4. **Script Properties** setzen (Projekteinstellungen → Skripteigenschaften):
   - `PIPEDRIVE_API_TOKEN`
   - `SLACK_BOT_TOKEN` = `xoxb-…`

   Tokens gehoeren NICHT in den Code (Befund D4).
5. `legeSheetAnUndZeigeId()` ausfuehren → legt Sheet + Tabs an, loggt die ID.
   (Der Tab "Laeufe" entsteht beim ersten Lauf von selbst.)
6. **`SHEET_ID` in `Config.gs` eintragen** (steht noch auf `TODO_SHEET_ID`) und pushen.
7. `befuelleRegelnMitStartwerten()` → legt die 14 Zeilen an.
8. **Channel-ID in Spalte "Channel-ID"** eintragen (im Sheet, alle 14 Zeilen).
9. `pruefeKonfiguration()` → prueft alles, legt nichts an, sendet nichts.
   Muss `=== Konfiguration vollstaendig ===` loggen.
10. `testePost()` → eine Nachricht mit Testdaten in den Channel der ersten Regel.
    Zeigt, ob das Layout im Slack-Client lesbar ist. Ignoriert `DRY_RUN` bewusst.
11. `initialisiereSnapshotJetzt()` → fuellt das Gedaechtnis mit dem Ist-Stand,
    postet nichts. Ignoriert `DRY_RUN` bewusst.
    **Warum eine eigene Funktion:** ein DRY-Lauf schreibt den Snapshot nicht
    (das ist der Sinn von DRY), also misst ein DRY-Lauf ohne befuellten
    Snapshot gar nichts — jeder Deal gilt als "neu", und
    gesetzt/verschoben/geloescht bleiben stumm. Die Alternative waere, kurz
    `DRY_RUN = false` zu setzen und schnell wieder zurueck. Genau bei diesem
    Flag-Geschiebe bleibt man scharf, ohne es zu merken.
12. `sweep()` bei `DRY_RUN = true` → das Log zeigt, was gepostet WUERDE.
    **Muss 0 Meldungen ergeben** (Idempotenz-Beweis, siehe Verifikation).
13. Scharf schalten: `DRY_RUN = false`, dann `installiereTrigger()`.
    Der zaehlt danach nach, statt "installiert" zu behaupten — erwartet
    werden **2** CLOCK-Trigger. `zeigeTrigger()` zeigt den Stand jederzeit.

---

## Verifikation

| Check | Erwartung |
|---|---|
| `pruefeKonfiguration()` | `✅` bei Slack-Token, allen vier field_codes, Sheet, Tabs, Bot ist Channel-Mitglied |
| `testePost()` | Nachricht kommt an, Absendername ist **Ernst**, Umlaute korrekt, `{…}` nirgends sichtbar |
| `initialisiereSnapshotJetzt()` | `0 Meldungen`, Snapshot-Tab hat eine Zeile pro Deal (90 am 11.09.2026) |
| **Zweiter `sweep()` direkt danach** | **`0 Meldungen`** — das ist der Idempotenz-Beweis. Kommt hier etwas, ist der Diff kaputt (meist Date-vs-String, siehe unten). |
| Einen Testtermin in Pipedrive setzen, `sweep()` | genau **eine** Meldung "gesetzt" |
| Denselben Termin verschieben, `sweep()` | genau **eine** Meldung "verschoben" mit altem UND neuem Datum |
| `sweep()` nochmal | 0 Meldungen |
| Log-Tab | eine Zeile pro gesendeter Meldung, Spalte `Schluessel` gefuellt |

---

## Fallen, die hier schon geloest sind

- **Slack antwortet auch bei Fehlern mit HTTP 200.** Der Erfolg steht in
  `json.ok`. Nie dem Statuscode trauen. — geloest in `fetchSlackJson`
  (uebernommen aus dem Geburtstagskalender).
- **`status`-Parameter bei Pipedrive v2**: kennt nur `open|won|lost|deleted`,
  `all_not_deleted` wirft HTTP 400. Und `status:"won"` wird bei RP schon bei der
  Anlage gesetzt und traegt **kein** Liefersignal. → wird gar nicht erst
  uebergeben.
- **Sheets liefert ein Datumsfeld als `Date`-Objekt, nicht als String.** Ohne
  Normalisierung (`alsDatumsText`) sieht jeder Lauf eine Abweichung und meldet
  jedes Mal "verschoben" — bei 15-Minuten-Trigger 96 Falschmeldungen pro Deal
  und Tag.
- **`new Date("2026-09-18")` wird als UTC gelesen** und kippt in Wien auf den
  Vortag. Deshalb rechnet `tageVorher()` mit `new Date(Jahr, Monat-1, Tag)`.
- **Frisch uebernommene Deals**: ein Deal, der im letzten Snapshot nicht stand,
  meldet seine vorhandenen Termine NICHT als "gerade gesetzt" (`istNeuerDeal`).
  Datumsbasierte Regeln feuern trotzdem.
- **Verschwundene Deals sind nicht geloescht.** `GET /deals` liefert nur
  nicht-archivierte Deals und hat keinen `include_archived`-Schalter. Solche
  Zeilen bleiben im Snapshot stehen und bekommen einen **Hinweis**, statt als
  "Termin geloescht" gemeldet zu werden. Ein Mensch entscheidet.
- **Doppelpost-Schutz**: Schluessel
  `<dealId>|<feld>|<ereignis>|<tage>|<termindatum>` im Log-Tab. Das
  **Termindatum steckt im Schluessel** — wird ein Termin verschoben, darf die
  Erinnerung fuer das NEUE Datum erneut feuern. Log wird nach 120 Tagen
  ausgeduennt.
- **Fehlgeschlagener Slack-Post** erzeugt KEINE Log-Zeile → wird beim naechsten
  Lauf erneut versucht. Ein kaputter Channel reisst den Lauf nicht mit.
- **Snapshot wird ZULETZT geschrieben** und nur bei vollstaendigem Lauf. Bricht
  der Lauf ab, sieht der naechste dieselbe Aenderung wieder — verpasste Meldung
  ist besser als verlorene.
- **`LockService.tryLock(5000)`**, nicht `waitLock(30000)`: laeuft der Vorgaenger
  noch, ist Ueberspringen richtig — der naechste Trigger kommt in 15 Minuten.
- **Konfigurationsfehler sind laut.** Unbekanntes Feld, unbekanntes Ereignis,
  fehlende oder unplausible Channel-ID → sichtbare `⚠️`-Warnung mit Zeilennummer.
  Eine Regel, die wegen eines Tippfehlers nie feuert, ist der schlimmere Fall.

---

## ⚠️ Zur PLZ

`{plz}` haengt an der **Person**, nicht am Deal — sie kommt also nicht im
Deal-Sweep mit. Dafuer laeuft ein zweiter Bulk-Sweep ueber `/persons`, und zwar
**nur dann, wenn ueberhaupt eine Vorlage `{plz}` benutzt**.

Es gibt zwei Quellen (PLZ-Feld und Adressfeld der Person). **Beide sind bei RP
nachweislich unzuverlaessig und widersprechen sich teils** (belegt an Deal 7177
und 6804, siehe `docs/CHECK-Kette-PLZ-Bundesland-Montagepartner-2026-09-10.md`,
K1). Im PLZ-Feld stand auch schon eine Telefonnummer.

Deshalb wird hier **nicht geraten**:
- alles, was keine 4-stellige AT-PLZ ist, wird verworfen
- weichen die beiden Quellen ab, zeigt die Meldung **beide**:
  `2340 ⚠️ (PLZ-Feld: 1230)`

Aus der PLZ wird in diesem Script **keine Folgeentscheidung** abgeleitet (kein
Bundesland, keine Partner-Zuordnung). Sie ist reine Anzeige.

---

## Was uebernommen wurde statt neu gebaut

| Baustein | Quelle |
|---|---|
| `fetchSlackJson` (Token, `json.ok`, 429-Retry) | `Geburtstagskalender-Sync/Config.gs:121` |
| `chat.postMessage`-Muster | `Geburtstagskalender-Sync/Geburtstagspost.gs:48` |
| Cursor-Pagination + weicher Ausstieg | `Fortschritt-Script/Code.gs:92-101` |
| Trigger-Installation (alte erst loeschen) | `Geburtstagskalender-Sync/Setup.gs:31-43` |
| field_codes, Option-IDs, Address-Subfelder | `docs/REFERENZ-Pipedrive-AppsScript.md` |

Neu ist praktisch nur die Diff-Logik.

---

## Dateien

| Datei | Inhalt |
|---|---|
| `Config.gs` | field_codes, Tokens, Betriebsschalter, Slack-HTTP |
| `PipedriveClient.gs` | Deal-Sweep, Personen-/PLZ-Sweep, Feld-Leser |
| `Regeln.gs` | liest und validiert den Regeln-Tab |
| `Snapshot.gs` | Gedaechtnis + Liefer-Uebersicht |
| `Meldungen.gs` | Text bauen, Doppelpost-Schutz, senden |
| `Lauf.gs` | `sweep()` — die Funktion am Trigger |
| `CtTermine.gs` | CT-Termine aus Pipedrive-Activities + `wa.me`-Link |
| `CtKalender.gs` | Gegenprobe der CT-Termine im Google Kalender |
| `Setup.gs` | Setup-, Pruef- und Trigger-Funktionen |

### Funktionen in `Setup.gs`, die man von Hand aufruft

| Funktion | Tut was | Postet? |
|---|---|---|
| `legeSheetAnUndZeigeId()` | Sheet + Tabs anlegen | nein |
| `befuelleRegelnMitStartwerten()` | alle Startzeilen anlegen — **nur wenn der Tab leer ist** | nein |
| `ergaenzeWaSpalte()` | Spalte `WA-Text` anhaengen, idempotent | nein |
| `ergaenzeFehlendeRegeln()` | nur die Startregeln nachziehen, die im Tab fehlen | nein |
| `aktualisiereCtRegeln()` | die CT-Zeilen auf die aktuellen Startwerte ziehen (Aktiv, Vorlage, `WA-Text`) — **ueberschreibt Handaenderungen**, protokolliert jede Zelle mit Vorher/Nachher | ja, aber nur Sheet |
| `testeCtLauf()` | zeigt alle CT-Treffer samt Slack-Text, Kundentext und `wa.me`-Link | nein, **liest nur** |
| `listeKalender()` | alle erreichbaren Kalender mit ID — zum Aussuchen fuer `CT_KALENDER_ID` | nein, **liest nur** |
| `vorschauCt(tage)` | welche Erinnerungen gehen in den naechsten Tagen raus, pro Versandtag mit Kundentext (Standard 7) | nein, **liest nur** |
| `setzeVorlagenNeu()` | nur die Spalte `Vorlage` ueberschreiben | nein |
| `pruefeKonfiguration()` | alle fuenf Checks, legt nichts an | nein |
| `testePost()` | eine Nachricht mit Testdaten, Praefix `_[TEST, keine echten Daten]_` | **ja**, ignoriert `DRY_RUN` |
| `initialisiereSnapshotJetzt()` | Snapshot auf den Ist-Stand setzen | nein, ignoriert `DRY_RUN` |
| `installiereTrigger()` | alte `sweep`-Trigger weg, zwei neue, danach nachzaehlen | nein |
| `zeigeTrigger()` | Ist-Stand der Trigger anzeigen | nein |

---

## Trigger

- `sweep()` alle **15 Minuten** → Aenderungs-Erkennung
- `sweep()` taeglich **~07:15** → die datumsbasierten Regeln

Belegt sind bei RP schon 02:00, 03:00, 04:00 und 08:00. Beide Trigger rufen
dieselbe Funktion; der Doppelpost-Schutz macht das unschaedlich.

`installiereTrigger()` loescht vorher alle alten `sweep`-Trigger und zaehlt
danach nach. `zeigeTrigger()` listet den Ist-Stand, ohne etwas zu aendern.

### Nachtsperre — `RUHEZEIT_BIS_STUNDE = 7`

Die datumsbasierten Regeln fragen "ist `heute` == Termindatum?". `heute` kippt
um Mitternacht — der 15-Minuten-Trigger laeuft also um **00:07** das erste Mal
mit dem neuen Datum. Und weil der Doppelpost-Schutz greift, waere dieser
Nachtlauf **zugleich der einzige Post des Tages**: "HEUTE Lieferung" kaeme jede
Nacht um viertel nach zwoelf und waere am Morgen weggescrollt.

Darum feuern `vorher` und `am Tag` erst ab 07:00. Die Diff-Regeln laufen rund
um die Uhr weiter — die haengen daran, dass ein Mensch etwas aendert, und
nachts aendert niemand etwas.

---

## Lauf-Protokoll — Tab "Laeufe"

Eine Zeile pro Lauf, **auch bei 0 Meldungen und auch bei Absturz**:
Zeitpunkt, Dauer, Deals, Meldungen, Modus (`DRY`/`live`), Hinweis.
500 Zeilen Historie, dann rollt der Tab.

Der Grund: ein stiller Channel heisst entweder "nichts zu melden" oder "das
Script laeuft seit Dienstag nicht mehr" — von aussen sehen die identisch aus.
Dieselbe Falle wie beim Cloudflare-Relay, das immer 200 meldete und damit tote
Webhooks maskiert hat.

Damit gibt es drei Protokolle mit drei Aufgaben:

| Wo | Was | Lebensdauer |
|---|---|---|
| Apps-Script-Ausfuehrungsprotokoll | jede Zeile des Laufs, zum Debuggen | 7 Tage |
| Tab **Log** | jede *gesendete* Meldung + Dedup-Schluessel | 120 Tage |
| Tab **Laeufe** | jeder Lauf, auch der leere | 500 Laeufe |

---

## Betriebskosten pro Lauf (gemessen)

| Call | Bringt | Kosten |
|---|---|---|
| `GET /deals?pipeline_id=2` | alle 90 Deals **inkl. custom_fields** | 1 Call, ~1 s |
| `GET /persons?limit=500` | nur die PLZ (haengt an der Person) | 14 Calls, ~4 s |

Der Personen-Sweep laeuft **nur, wenn eine Vorlage `{plz}` benutzt**. `limit`
steht bewusst auf 500 statt 100: bei ~7000 Personen sind das 14 Calls statt 70
— pro Lauf, und beim 15-Minuten-Trigger der Unterschied zwischen 1.344 und
6.720 Calls am Tag.

---

## Offen

- [ ] **Nachrichtentexte von Valentin** — was drinsteht, sind Platzhalter.
      Der Tab "Regeln", Spalte `Vorlage`, ist genau dafuer da: aenderbar ohne
      `clasp push`, auch vom Handy.
- [ ] **CT-Erinnerung: zaehlt ein nackter Betreff "CT" als CT-Termin?**
      (Activity 17306, 22.09.2026). Marker bewusst nicht gelockert — sonst
      faengt er auch "Contracting" oder "CT-Vorbereitung". Einfachster Weg:
      die Activity in Pipedrive auf `PLZ Name (CT)` umbenennen.
- [ ] **Pipedrive-Automation A1 pruefen** (`Fortschritt-Script/README.md:241`)
      — falls die schon nach Slack postet, gibt es zwei Absender fuer dieselbe
      Sache. Faellt auf, sobald der erste echte Termin eingetragen wird.

### Erledigt am 11.09.2026

- [x] `SHEET_ID`, Slack-App, Token, Channel-ID, `clasp create`, Go-Live
- [x] **Archivierte Deals sind ungefaehrlich** — im Code nachgesehen, nicht
      angenommen: `sweep()` laeuft nur ueber die Deals, die Pipedrive gerade
      liefert. Ein verschwundener Deal wird gar nicht geprueft und kann deshalb
      kein "geloescht" ausloesen. Seine Snapshot-Zeile bleibt mit dem Hinweis
      "nicht mehr in Pipeline 2 (archiviert, verschoben oder geloescht?)"
      stehen. Sichtbar, aber still.
