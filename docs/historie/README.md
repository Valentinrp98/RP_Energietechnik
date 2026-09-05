# Archivierte Projekt-Journale

Vier Claude-Memory-Dateien waren zu chronologischen Session-Journalen angewachsen (52 / 37 / 30 / 23 KB) statt je einen Sachverhalt festzuhalten. Sie wurden am **2026-09-01** auf kurze Fassungen eingedampft; die Vollversionen liegen hier.

| Datei | Was drin steht |
|---|---|
| `project_rp_energietechnik.md` (52 KB) | Chronologisches Arbeitsjournal 11.–18.08.2026, **ohne eine einzige Überschrift**. PV-Auslegung, Meeting-Setup, Build-Logs von Bundesland-aus-PLZ und Montagepartner-aus-Bundesland, ein 16-Bug-Code-Review, Drive-Datei-Forensik, Team-Notizen, Telefonie-Evaluierung, der Sheet-Sync-Ausbau vom 17.08. |
| `project_sevdesk_pipedrive_sync.md` (37 KB) | Rückwärts-Changelog plus Einzelfall-Incidents (Deal 7138 Schwaiger, 7356 Radmacher, 6804 Matschek). Enthält echtes API-Wissen: Instabilität der sevdesk-Nummernkreise, Bracket-Notation-Endpunkte, das 154/4080-Duplikatnummern-Phänomen. |
| `project_deepcore_automatisierung.md` (30 KB) | Sieben aufeinanderfolgende „Review-Durchgang"-Abschnitte mit je nummerierten Fund-/Fix-Listen. Faktisch ein Code-Review-Transkript. |
| `project_pv_doku_generator.md` (23 KB) | Debugging-Narrativ mit **zwei Selbst-Widerrufen**. Wer nur den Anfang liest, bekommt die falsche Antwort. |

## Wie diese Dateien zu lesen sind

**Als Historie, nicht als Statusbericht.** Der Widerruf gewinnt: Wo ein späterer Abschnitt eine frühere Diagnose zurücknimmt (z.B. `meta.entity` → `meta.object` → wieder `meta.entity`), gilt die spätere Fassung.

**Für den aktuellen Stand nicht hierher greifen**, sondern:

| Was | Wo |
|---|---|
| Technische Konstanten und API-Regeln | [`../REFERENZ-Pipedrive-AppsScript.md`](../REFERENZ-Pipedrive-AppsScript.md) |
| Script-Status, Trigger, Deploy | [`../../CLAUDE.md`](../../CLAUDE.md) |
| Offene Code-Befunde | [`../BEFUNDE-2026-09-01.md`](../BEFUNDE-2026-09-01.md) |
| Projekt-Details | die `README.md` im jeweiligen Projektordner |

Der Wert dieser Dateien liegt im **Warum**: welche Sackgasse schon durchlaufen wurde, welche Diagnose sich als falsch erwiesen hat, welcher Fix welchen Vorfall ausgelöst hat. Bevor ein alter Fehler nochmal gemacht wird, lohnt hier ein `grep`.
