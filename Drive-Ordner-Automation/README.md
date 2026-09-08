# Drive-Ordner-Automation — ⚠️ [ALT] Prototyp, nicht mehr verwenden

**Abgelöst.** Die Kundenordner legt heute `Ordnererstellung-bei-Gewonnen` an — webhook-getrieben, mit Existenzprüfung, `DRY_RUN`-Schalter, Lock und Logging.

Dieses Projekt ist der Vorläufer aus der Anfangsphase. Es liegt noch im Repo, weil die Ordnerstruktur-Liste und die REST-Testskripte historisch nützlich waren.

[Editor öffnen](https://script.google.com/home/projects/1waYEvH1R3jIsJemC8xDx8WZtg27yc7_2QDOHwzHxvmy4Xo7M3eHqg9kP/edit)

---

## 🔴 Warum es gefährlich ist

| | |
|---|---|
| **Kein `DRY_RUN`** | Als einziges Schreib-Projekt im Repo hat es überhaupt keinen Trockenlauf-Schalter. Jeder Start schreibt. |
| **Keine Existenzprüfung** | `ordnerErstellen()` (`Ordner Erstellen.js:1`) ruft `createFolder` bedingungslos auf. **Zweimal ausführen = doppelte Ordner.** Google Drive erlaubt gleichnamige Ordner nebeneinander, es gibt also keine Fehlermeldung. |
| **Es ist deployed** | Das Projekt existiert im Apps-Script-Editor. Ein versehentlicher ▷-Klick genügt. |

Steht seit dem 13.08. als `D1`/`D2` in [`../FIXES-INDEX-2026-08-13.md`](../FIXES-INDEX-2026-08-13.md). `D2` verlangte README und `[ALT]`-Kennzeichnung — die README ist hiermit nachgeholt, die Umbenennung des Projekts im Editor noch nicht.

---

## Was drin ist

| Datei | |
|---|---|
| `Ordner Erstellen.js` | `ordnerErstellen()` — der gefährliche Einstiegspunkt |
| `OrdnerfürKundenerstellen_hardcoded_names.js` | `ordnerFuerKundenErstellen()` mit fester Namensliste („Max Mustermann", „Thomas Gruber"). **Die Unterordner-Struktur hieraus wurde in `Ordnererstellung-bei-Gewonnen/Config.gs` übernommen** (`KUNDEN_UNTERORDNER_NAMEN`) — das ist der bleibende Wert dieses Ordners. |
| `test-rest-api-standard.js`, `test-rest-api-custom_fields.js` | Frühe Pipedrive-REST-Experimente (`testPipedriveVerbindung()`, `testDealMitCustomFields()`, `testDealFields()`). Historisch, gegen Testdeal 30. |
| `Script ID.txt` | **0 Bytes**, tot |
| `FIXES-2026-08-13.md` | Der damalige Review |

Hardcodierte IDs: `parentOrdnerId = '1wP9ChpzdI1__8gbe3yvQuuf5o0vQ6CtS'`, `partnerOrdnerId = '10BaT1-qjhlhBK0h9QYUki6wGQNUdGGcE'` (auskommentiert daneben: `1DbZvsuIMEuUQLn4sGOt0p4EMPUFZ2XEM`, der heute gültige Partner-Fulfillment-Ordner).

---

## Wenn hier doch etwas gebraucht wird

Nicht dieses Projekt reanimieren, sondern in `Ordnererstellung-bei-Gewonnen` nachsehen — dort ist alles davon in sicherer Form vorhanden:

- Ordnerstruktur → `Config.gs`, `KUNDEN_UNTERORDNER_NAMEN`
- Partner-Ordner-IDs → `Config.gs:52` (7 Partner, nicht 5)
- Anlage mit Existenzprüfung + Lock → `FolderCreation.gs`
- Drive-**Shortcut**-Behandlung → ebenfalls `FolderCreation.gs`. Wichtig: Shortcuts sind für `DriveApp.getFoldersByName()` unsichtbar, das kannte der Prototyp noch nicht. Siehe [`../docs/REFERENZ-Pipedrive-AppsScript.md`](../docs/REFERENZ-Pipedrive-AppsScript.md).

**Empfehlung:** löschen oder im Editor auf `[ALT] Drive-Ordner-Automation` umbenennen, damit der Name im Projektwähler warnt.
