## Was ist was?

Am Deal gibt es zwei Felder, die den Projektfortschritt zeigen. **Beide werden automatisch gefüllt** — niemand muss sie anklicken.

| Feld | Was drinsteht |
|---|---|
| **Erledigt** | Häkchen für jeden erreichten Meilenstein |
| **Fortschritt** | eine Zeile zum Überfliegen: `▰▰▰▰▰▰▱▱▱▱▱ 6/11 · ✓ Fertigmeldung · wa:Kunde` |

Ein Script prüft alle 15 Minuten alle gewonnenen Deals und rechnet beides neu aus.

---

## Die Fortschritt-Zeile lesen

```
▰▰▰▰▰▰▱▱▱▱▱ 6/11 · ✓ Fertigmeldung · wa:Kunde
```

| Teil | Bedeutung |
|---|---|
| `▰▰▰▰▰▰▱▱▱▱▱` | Balken über alle 11 Meilensteine |
| `6/11` | sechs davon erreicht |
| `✓ Fertigmeldung` | der **zuletzt erreichte** Schritt |
| `wa:Kunde` | **wa**rtet **a**uf — hier: den Kunden. Fehlt, wenn das Feld „Wartet auf" leer ist |

Weil der Balken vorne steht, kannst du die Deal-Liste einfach nach der Spalte **Fortschritt** sortieren und hast sie nach Projektfortschritt geordnet.

**Sonderfälle** — die ersetzen die ganze Zeile:

| Anzeige | Bedeutung |
|---|---|
| `▰▰▰▰▰▰▰▰▰▰▰ 11/11 ✓` | alles erledigt |
| `✖ Storniert` | Deal in „Verschoben/storniert" mit Stornogrund |
| `⏸ Verschoben` | Deal in „Verschoben/storniert" mit Verschiebegrund oder Datum „Verschoben auf" |
| `⏸✖ Verschoben/storniert` | in der Stage, aber kein Grund eingetragen — **bitte Grund nachtragen** |

---

## Wodurch entsteht welches Häkchen?

Die Häkchen sind **nur ein Spiegel** dieser Felder und Aktivitäten. Willst du ein Häkchen setzen, pflegst du die Quelle in der linken Spalte.

| # | Häkchen | Entsteht aus |
|---|---|---|
| 1 | Erstgespräch | Aktivität mit „Erstgespräch" im Betreff, **auf erledigt gesetzt** |
| 2 | Netz übergeben | Netzstatus = übergeben, eingereicht, Zählpunkt da oder Fertigmeldung raus |
| 3 | Zählpunkt da | Netzstatus = Zählpunkt da / Fertigmeldung raus — **oder** Einspeisezählpunkt (ZPN) ausgefüllt |
| 4 | AR raus | AR versendet = Versendet |
| 5 | Anzahlung da | Zahlungseingang erhalten = Erhalten |
| 6 | Geliefert | Material-Liefertermin eingetragen und erreicht |
| 7 | Zweitgespräch | Aktivität mit „Zweitgespräch" im Betreff, **auf erledigt gesetzt** |
| 8 | Montiert | AC-Termin eingetragen und erreicht |
| 9 | IB erfolgt | IB erledigt am — oder IB-Termin — eingetragen und erreicht |
| 10 | Förderzusage | Förderzusage erhalten = Erhalten — **oder** Förderstatus = zugesagt / abgerechnet |
| 11 | Fertigmeldung | Fertigmeldung am eingetragen und erreicht |

### Zwei Dinge, die oft für Verwirrung sorgen

**Termine in der Zukunft zählen nicht.** Ein AC-Termin nächste Woche heißt noch nicht „Montiert". Das Häkchen kommt von selbst, sobald der Tag erreicht ist — nichts nachtragen.

**Aktivitäten müssen auf „erledigt" stehen.** Eine angelegte, aber offene Aktivität zählt nicht. Das Wort „Erstgespräch" bzw. „Zweitgespräch" muss im Betreff vorkommen; Zusätze sind erlaubt, z. B. `Erstgespräch Familie Huber`.

---

## Die wichtigste Regel

> **Häkchen nicht von Hand setzen.** Sie werden binnen 15 Minuten wieder entfernt, wenn kein Feld sie belegt.

Das ist kein Fehler, sondern Absicht: die Anzeige soll immer dem echten Datenstand entsprechen und nicht dem, was jemand mal angeklickt hat. Umgekehrt heißt das aber auch — **wenn ein Häkchen fehlt, fehlt der Eintrag im Quellfeld.** Genau dort ansetzen, nicht am Häkchen.

Gleiches gilt für die Fortschritt-Zeile: reinschreiben ist zwecklos, sie wird überschrieben.

---

## Wenn etwas nicht stimmt

1. In der Tabelle oben nachsehen, welches Feld den fehlenden Meilenstein auslöst
2. Prüfen, ob dort wirklich ein Wert steht — und ob ein Datum nicht in der Zukunft liegt
3. Bei Aktivitäten: steht sie auf **erledigt**, und steht das Stichwort im Betreff?
4. Nach maximal 15 Minuten nochmal schauen
5. Passt es dann noch nicht: bei Valentin melden — es gibt ein Protokoll, in dem für jeden Deal steht, welche Regel gegriffen hat und warum

---

## Was aktuell noch nicht angezeigt wird

**Geliefert, Montiert und IB erfolgt** bleiben derzeit bei praktisch allen Deals leer. Grund: Liefer-, AC- und IB-Termine werden bis heute in den Montagepartner-Sheets geführt, nicht in Pipedrive. Sobald diese Termine im Deal stehen, füllen sich die drei Häkchen automatisch und rückwirkend.

**Deals von vor Juli 2026** werden bewusst nicht angefasst und bleiben ohne Fortschritt-Anzeige — dort wurden die Felder nie gepflegt, ein Balken wäre irreführend.
