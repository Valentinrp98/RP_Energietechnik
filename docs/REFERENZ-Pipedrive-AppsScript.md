# Referenz — Pipedrive, sevdesk & Apps Script

**Zweck:** Alle technischen Konstanten und alle hart erarbeiteten API-Fallen an einem Ort. Vor jedem neuen Script hier nachschlagen, nicht raten und nicht aus dem Gedächtnis zitieren.

**Stand:** 2026-09-01 · **Alle `field_code`-Werte in diesem Dokument wurden gegen den Code im Repo verifiziert.** Werte, die nur aus einer Memory-Datei stammen und im Code nicht vorkommen, sind ausdrücklich als *unverifiziert* markiert.

> **Vorrangregel bei Widerspruch: Code > dieses Dokument > Memory.**
> Wer hier einen Fehler findet, korrigiert ihn hier — und setzt an der alten Stelle einen Zeiger hierher, statt nur die neue Stelle zu schreiben.

---

## 1. Pipedrive — Zugang

| | |
|---|---|
| Domain | `rp-energietechnik.pipedrive.com` |
| API v2 Base | `https://rp-energietechnik.pipedrive.com/api/v2` |
| Auth v2 | Header `x-api-token` |
| Token | Script Property `PIPEDRIVE_API_TOKEN` |

`Montageplanung-Namensabgleich` nutzt als einziges Projekt den generischen Host `https://api.pipedrive.com/api/v2` — funktioniert genauso, ist nur uneinheitlich.

### v1 vs. v2 — die Regel, die immer wieder falsch zitiert wird

v1 ist **nicht** abgeschaltet. Drei Dinge laufen weiterhin nur über v1:

| Ressource | Version | Auth |
|---|---|---|
| Deals, Persons, Organizations, dealFields, Activities, itemSearch | **v2** | Header `x-api-token` |
| **Webhook-Registrierung** (`/v1/webhooks`) | **v1** | Query-Param `?api_token=` |
| **Files API** (`/v1/files`) | **v1** | Query-Param `?api_token=` |

**Die Formulierung „Webhooks gibt es nur in v1" ist irreführend und hat schon Fehler verursacht.** Korrekt ist:

- Die **Registrierung** läuft über den v1-Endpunkt.
- Das **Payload-Format** ist v2 — bei der Registrierung `version: "2.0"` und `event_action: "change"` mitgeben (nicht `"updated"`, das ist v1).
- Der v2-Payload hat `data`/`previous` (v1 hätte `current`/`previous`) und `meta.entity` + `meta.action`.
- **`meta.entity` ist richtig, nicht `meta.object`.** Das wurde einmal „gefixt" und hat den funktionierenden Filter kaputtgemacht; der Fix wurde zurückgebaut. Nicht nochmal ändern.
- Mischt man v1- und v2-Konventionen, wird der Webhook **stillschweigend ignoriert** und alles sieht gesund aus.
- Bei `GET /v1/webhooks` heißt das Aktiv-Feld **`is_active`**, nicht das naheliegende `active_flag` (live verifiziert, nicht dokumentiert).

### v2-Fallen, die real zugeschlagen haben

- **Feld-Metadaten:** Klartext-Label steht in `field_name`, Identifier in `field_code`. **`name` ist bei allen Feldern `undefined`** — wer danach greift, bekommt lautlos nichts. (`key` ist der v1-Name und nur in v1-Antworten korrekt.)
- **`GET /deals` mit `status=all_not_deleted`** → HTTP 400 `ERR_SCHEMA_VALIDATION_FAILED`. Das ist v1. v2 kennt nur `open | won | lost | deleted`. **Lösung: `status` weglassen** — ohne Parameter liefert v2 laut Doku „all not deleted deals".
- **Listen-Endpunkte liefern `custom_fields` gleich mit.** Niemals über eine Liste iterieren und pro Eintrag nochmal einzeln abrufen.
- **Stille Nicht-Schreibung:** Ein `undefined` in `custom_fields` wird von `JSON.stringify` entfernt. Der PATCH geht mit leerem Objekt raus, Pipedrive antwortet **200**, das Log meldet Erfolg — geschrieben wurde nichts. Immer prüfen, dass die Option-ID existiert, **bevor** gepatcht wird. Die stärkste Umsetzung im Repo ist `Fortschritt-Script/Code.gs:407` (`pruefePatchNutzlast`) — sie prüft den serialisierten Round-Trip.
- **enum/set-Felder** werden über numerische Option-IDs gelesen und geschrieben, nie über Labels. Option-IDs sind hartcodiert fragil → vor jedem Massenlauf gegen `dealFields` abgleichen.
- **Der Options-Label-Abgleich muss case-insensitiv und als Substring laufen.** Pipedrive-Labels tragen teils Präfixe (`☐ Satteldach`), und `SUNOVA` vs. `Sunova` ist für die numerische Option-ID folgenlos. Ein exakter String-Vergleich in `pruefeKonfiguration()` erzeugt sonst Scheinfehler.
- **Address-Custom-Fields** liefern ein Objekt mit Subfeldern (`postal_code`, `locality`, `formatted_address`, `value`). Die Subfelder sind **nur befüllt, wenn die Adresse per Google-Maps-Autocomplete angelegt wurde**; bei freier Texteingabe steht alles in `value`, der Rest ist `null`. Beide Fälle abdecken.
- **Im Webhook-Payload sind Custom Fields Objekte, keine nackten Werte.** Gilt für alle vier Webhook-Projekte. Wer den Wert direkt vergleicht, vergleicht gegen `[object Object]`.
- **Pagination:** Cursor über `additional_data.next_cursor`, `limit=100` ist sicher. **Cursor immer `encodeURIComponent`** — ein `+` im Cursor wird sonst als Leerzeichen dekodiert und Seiten werden übersprungen oder doppelt geholt.
- **`dealFields` immer mit `?limit=500` abrufen.** RP hat deutlich über 100 Deal-Felder; ohne `limit` truncatet die erste Seite und ein Feld gilt fälschlich als „existiert nicht".
- **Exakte Feldsuche:** `/api/v2/itemSearch/field?entity_type=deal&field={code}&match=exact&return_item_ids=true`. **`/deals/search` hat einen Indexierungs-Delay** und ist für frisch geschriebene Daten unbrauchbar — wer ein Feld schreibt und sofort darauf sucht, bekommt „nicht gefunden". Für frisch Geschriebenes direkt `GET /deals/{id}` nutzen.
- **Es gibt kein „silent update".** API-Schreibvorgänge lösen Automations genauso aus wie Klicks in der Oberfläche. Vor Massenläufen prüfen, ob Automations auf den betroffenen Feldern hängen — sonst gehen hunderte Mails raus.
- **Das PLZ-Feld ist unzuverlässig** und widerspricht teils dem Adressfeld. Es kippt die Bundesland- und damit die Montagepartner-Zuordnung. Bei Zweifel gegen `https://openplzapi.org/at/Localities?postalCode=XXXX&pageSize=50` prüfen.
- **Checkbox-Workaround:** ein enum-Feld mit genau einer Option rendert in der UI als Checkbox.

---

## 2. Deal-Felder — `field_code`

**Legende:** ✅ = im Repo-Code verwendet und dort verifiziert · ⚠️ = nur aus Memory übernommen, kommt im Code nicht vor (nicht falsch, nur ungeprüft).

### Prozess & Routing

| Feld | field_code | Typ | |
|---|---|---|---|
| Ausführungsart | `cc80ad5daf0788dba60b3da3931681edd3dd2c87` | enum | ✅ |
| Montagepartner | `0190fd945adc86148657d2db36261ae9545e7bda` | enum | ✅ |
| Bundesland | `43a5e2fa23f0659ac07ca499a629d5c391cfc440` | enum | ✅ |
| Wartet auf | `b7342c374d4e7d76f9ec3772d95efd5944c97e29` | enum | ✅ |
| Elektromaterial **gezahlt von** | `1a352d7b69ffb99c05960d51b225c8bfaa422d82` | enum | ✅ |
| Elektromaterial **organisiert von** | `767eb0f43cd9f52d8a06c113294adb2cc521e234` | enum | ✅ |

> ⚠️ **Namensfalle:** Die Memory führt `1a352d7b…` als „Elektromaterial durch". Im Code heißt die Konstante `ELEKTROMATERIAL_GEZAHLT_FIELD_KEY`. Es gibt seit 25.08. ein **zweites** Feld für „organisiert von" (`767eb0f4…`). Wer nur „Elektromaterial durch" sucht, erwischt das falsche.

### Status-Ampeln

| Feld | field_code | Typ | |
|---|---|---|---|
| Netzstatus | `df60049565c7aecc52febb2ef5ecb911a761c2c6` | enum | ✅ |
| Förderstatus | `fe61797bd9d9e4990a2f5735b8c4de1919c7fa11` | enum | ✅ |
| Voraussichtlicher Fördercall | `04f44d4e94f7781771b6b9190f58865b7d5b090f` | enum | ⚠️ |
| Finanzierungsstatus | `ec8aa2fee84efabc5770fae60e13397c3247a146` | enum | ⚠️ |

### Termine

| Feld | field_code | Typ | |
|---|---|---|---|
| Liefertermin | `c0a676d8db66f0cb6300e8160e1401355a226990` | date | ✅ |
| DC-Termin | `6e4dc4e9017957ddadebddac3dd622ca3afe8676` | date | ✅ |
| AC-Termin | `0277ea7463b980044e0062e46467979ccc292127` | date | ✅ |
| IB-Termin | `ba820255728739b29c451287808fbe18f1c94b8e` | date | ✅ |
| IB erledigt am | `6625e4db471a6601a70766facc04d2d421f89810` | date | ✅ |
| Fertigmeldung am / Montage abgeschlossen am | `69dd6586f2a762a912b9131dee404acf711fc1a5` | date | ✅ |
| Wunschliefertermin | `644d0324c4f7f3f59365ea0b7f70bbcf78a9d632` | date | ⚠️ |
| AR versendet | `d54cfede7b837b9f1f135a24f14e6c1c5fe7d85a` | enum (Checkbox) | ✅ |
| Zahlungseingang erhalten | `ddbfed2a1cdc25c2be460b9a825e056cca2d0284` | enum (Checkbox) | ✅ |
| Förderzusage erhalten | `574d9469760b0e993af058654a7c827a81150cb4` | enum (Checkbox) | ✅ |
| Überweisung Großhändler erhalten | `ee17de5e4a9072f1d855e3d2f5faf29a2b6e5dac` | enum (Checkbox) | ⚠️ |

> **Achtung:** `69dd6586…` trägt im Repo **zwei** Konstantennamen — `FERTIGMELDUNG_AM_FIELD_KEY` (Fortschritt-Script) und `MONTAGE_ABGESCHLOSSEN_AM_FIELD_KEY` (Sheet-Sync). Dasselbe Feld, zwei Bedeutungen im Kopf. Beim Ändern beide Stellen prüfen.

### Technik & Kunde

| Feld | field_code | Typ | |
|---|---|---|---|
| Dachform | `71ee37fc98c338877d435f4d77f409367c013451` | enum | ✅ |
| Eindeckung des Daches | `2e8cc4c7d0592a418a58394a470e3386d125654a` | enum | ✅ |
| Dachneigung | `142c229d8dba549de13e5e2675d6addb1bc6def0` | — | ✅ |
| Unterkonstruktion | `35ea9050672a922a5fc919db66ae3c3e879e59e7` | enum | ✅ |
| Ausrichtung | `7ba65cad11182422467e4923292422b601f6da80` | set (Mehrfach) | ✅ |
| Gebäudehöhe | `8596f23d6a54366a6fb550b67abc4dcdaa9b2f22` | — | ✅ |
| Höhe Sparren | `72c895d8faa59e34f2c37beffcee12d43cea9fb0` | — | ✅ |
| Breite Sparren | `ac37e6c16947904e5675453e3d72fa57a34889b0` | — | ✅ |
| Störflächen | `5f419ab6f29e7373cb3edf8bd74fc821ab54d028` | — | ✅ |
| Blitzschutz | `d6a498297c4b89d3728e63f38fcde42fe20498e2` | — | ✅ |
| Kabelweg DC | `b5d425d088a42afdaa8ba6817acffa28b4156ae1` | — | ✅ |
| Kabelweg AC | `d429d11f249a664a3fa6c270620c0f4c2c4bbc49` | — | ✅ |
| Verteilerkasten Standort | `9002ca97ad5f8d88ee8e3aa55d9d3b73a42d7791` | varchar | ✅ |
| Einspeisezählpunkt (ZPN) | `86f6ce58bb7129c5c4e312038342f601713c7742` | varchar | ✅ |
| Netzansuchen eigenständig gestellt | `a05dd4431ed0963d2f286db8ee2de46612024a3e` | enum | ✅ |
| Notizen intern | `2565f8005e57f0b6bad0a36560f9f3213beffe98` | varchar | ✅ |
| Sonstige Mitteilung Kunde / Notizen Kunde | `0aff5c6f5bd4d7990c171cbe62a670bfabd5c0fd` | varchar | ✅ |
| Kabelmeter DC (Ist) | `be98059ddca6b84190ea8c3a9f15d981954e821d` | double | ⚠️ |
| Kabelmeter AC (Ist) | `ff5b767ad22507088b160ced40c56a322b77bf25` | double | ⚠️ |
| Spezielle Wünsche Belegung | `8a18a677d5cd7ea67333eb8e9bcb3294bd5dfc10` | varchar | ⚠️ |

> **Nicht verwechseln:** „Kabelweg DC/AC" (`b5d425d0…` / `d429d11f…`, im Code aktiv) und „Kabelmeter DC/AC (Ist)" (`be98059d…` / `ff5b767a…`, nur in Memory) sind **verschiedene Felder**.

**Dach 2 / Dach 3:** Für Mehrfach-Dächer existieren seit 27.08. duplizierte Feldsätze mit `2_`/`3_`-Präfix (je 11 Felder, Option-IDs im Block 260–313). Die vollständige Zuordnung steht in `Projektdoku-Generator/Config.js` unter `DACH2_FIELD_KEYS` / `DACH3_FIELD_KEYS` — dort nachschlagen, nicht hier duplizieren.

### Fortschritt

| Feld | field_code | Typ | |
|---|---|---|---|
| Erledigt | `8f3f8e44c657ad9fdd2e171f2d5ed6ac8c565ac7` | set | ✅ |
| **Fortschritt** | **`dfa17befc9285d9641c2c92f3c001fe36a77a448`** | varchar (Text) | ✅ |

> 🔴 **Korrektur gegenüber der Memory.** `rp_global_reference.md` führt `Fortschritt` als `fa77cb3c2a12790f5de5879ccb7b076b5c98ab44`. Das ist das **abgelöste** Autocomplete-Feld (`varchar_auto`). Pipedrive lässt Feldtypen nicht nachträglich ändern, deshalb wurde ein neues Textfeld angelegt. Gültig ist `dfa17bef…` (`Fortschritt-Script/Config.gs:113-115`).

### Abschluss & Lernen

| Feld | field_code | Typ | |
|---|---|---|---|
| Stornogrund | `78f141d32919d24cc9e45f070f260bd421b984e3` | enum | ✅ |
| Verschoben auf | `a6dc892da6e8a16eeef6e57e3530b903e0cf2f42` | date | ✅ |
| Verschiebegrund | `ef68d654014dd173df185b4bb1fbf08bbc4d6c0d` | enum | ✅ |
| Empfehlungsquelle | `4d18df056a52fe09c9362b386c6fcd096c51ad6d` | varchar | ⚠️ |

### Anlage & sevdesk-Sync

| Feld | field_code | |
|---|---|---|
| Anlagendetails / Verkaufte Artikel Summary | `a38455087829e67f22cb5217a44c3cf31f39bcbc` | ✅ |
| Module Anzahl | `46e74c317774c91ac843a431780ad24d2e59da03` | ✅ |
| Module Bezeichnung | `ba5c7c11d7a26d06d7de9973c25c4042dc21ae2d` | ✅ |
| Module Marke | `717c4708845a942034c80f4687862714d65c0311` | ✅ |
| Speicher Kapazität kWh | `d8e9435192bb719365e9bc3186dcba540dff26bd` | ✅ |
| WR Leistung kW | `75fd8ffb7ba5ae4b3a8a5de1969e0d0f0a9050a0` | ✅ |
| System Marke | `6e42bb6bd1d9314fc4be52fe58789924b9ba51da` | ✅ |
| Wallbox Typ | `9c9bf4b5bf02b8ba924bbad2b086bad830b2af12` | ✅ |
| Notstrom Typ | `936f581faded886d47e9a3d3c004e0dc37e51bab` | ✅ |
| Heizstab | `9f7b89cfd2364447f5ee4d9bda4cba0a984af10d` | ✅ |
| Montage Pauschale EUR | `126ce0b31fc718cfb05a8356f891684a8f7196c1` | ✅ |
| Elektroinstallation Pauschale EUR | `13892f466a82621f0c3ee7020b61f208724dcd6b` | ✅ |
| Elektromaterial Pauschale EUR | `83713577892e7c77de66f55690c4299d14b47097` | ✅ |
| Technische Projektierung Pauschale EUR | `61f65b794a6bac1d9160374f7ff1c4d78f3533f5` | ✅ |
| sevdesk Angebotsnummer | `9935f33d1f8c5575da1aa3bdf1c2329bed92398b` | ✅ |
| sevdesk Kunden-ID | `8926e917db5b38f34fccc43fe74f05a9730e247e` | ✅ |

> **Angebotsnummer-Duplikat, geklärt:** Es gab zwei Felder. **Gültig und im Code verwendet ist `9935f33d…`.** Das zweite (`e442e2f3803eedfe77a2e4d7c5e180d33093e067`) ist das abzuräumende Duplikat. Die Memory beschreibt es widersprüchlich (einmal „neu", einmal „alt, sollte gelöscht werden") — maßgeblich ist der Code.

### Kundenordner & Snapshot (Ordnererstellung)

| Feld | field_code | |
|---|---|---|
| Kundenordner-Link | `5c442fe317da26ed4f60504e2b912df7e3116c5b` | ✅ |
| Kunde Name | `d1dcf344277f58ffdb7c2076f24c15fe2daf9b5f` | ✅ |
| Kunde Telefon | `8e11ac25aeffa4a367006f5633374488e342b746` | ✅ |
| Kunde Adresse | `2323c82b4ef433c914a1c241576e6b238a471a45` | ✅ |

### Projektdoku-Generator

| Feld | field_code | |
|---|---|---|
| Dokumentation-Status | `d33a358f840e5e1ccade4e1f88cd9109ae3e63f4` | ✅ |
| Dokumentation-Link | `e08d635f1391e5735802dc066e61fac836c5a0d0` | ✅ |

Option-IDs: `234` = Erstellt · `235` = Doku erstellen (Trigger) · `245` = Neu erstellen.
Das Statusfeld ist **gleichzeitig Trigger und Idempotenz-Marker** — kein Script-Property-State nötig.

### Person-Felder

| Feld | field_code | |
|---|---|---|
| Adresse (Person) | `432e4e165de7e9f474643c3d3a5552e2ec976f55` | ✅ |
| Postleitzahl (Person) | `5fef394025c936df4b58763b2b58c340fbb0d251` | ✅ |

Die PLZ ist bei RP ein **eigenes varchar-Feld** an der Person, kein Subfeld von „Adresse" (per Debug-Lauf 12.08. bestätigt).

---

## 3. Enum-/Set-Option-IDs

```javascript
const ENUM_OPTION_IDS = {
  'Ausführungsart': { 'Full Service': 154, 'Selbstmontage': 155, 'Hybrid': 156 },

  // ✅ verifiziert gegen Montagepartner-aus-Bundesland/Code.js:45
  // ACHTUNG: Memory kennt nur 5 Partner. Tirol/Vorarlberg kamen am 20.08. dazu.
  'Montagepartner': {
    'ALE-Engineering (NÖ, Wien, BGL)': 157, 'Berger Elektrotechnik (KTN)': 158,
    'Greensky (OÖ, SBG)': 159, 'KOLLSTAR (OÖ)': 160, 'Kreuzeder (OÖ, SBG)': 161,
    'Tiroler Partner (T)': 243, 'Vorarlberg Partner (V)': 244
  },

  // ✅ verifiziert gegen Bundesland-aus-PLZ/Code.js:50
  'Bundesland': {
    'Wien': 162, 'Niederösterreich': 163, 'Oberösterreich': 164, 'Salzburg': 165,
    'Kärnten': 166, 'Steiermark': 167, 'Tirol': 168, 'Vorarlberg': 169, 'Burgenland': 170
  },

  'Wartet auf': {
    'RP': 171, 'Kunde': 172, 'Montagepartner': 173, 'Lieferant': 174,
    'Netzbetreiber': 175, 'Förderstelle': 176, 'Easy Leasing': 177
  },
  'Elektromaterial durch': { 'RP': 178, 'Montagepartner': 179, 'Kunde': 180, 'noch offen': 181 },

  // ✅ verifiziert gegen Sheet-Sync/Config.gs
  'Netzstatus': {
    'offen': 182, 'übergeben': 183, 'eingereicht': 184,
    'Zählpunkt da': 185, 'Fertigmeldung raus': 186
  },
  'Förderstatus': {
    'nicht relevant': 187, 'wartet auf Fördercall': 188, 'Ticket gezogen': 189,
    'eingereicht': 190, 'zugesagt': 191, 'abgelehnt': 192, 'abgerechnet': 193
  },
  'Voraussichtlicher Fördercall': {
    '2026 Q4': 194, '2027 Q1': 195, '2027 Q2': 196, '2027 Q3': 197, '2027 Q4': 198
  },
  'Finanzierungsstatus': {
    'nicht relevant': 199, 'Angebot angefragt': 200, 'Angebot erhalten': 201,
    'Kundenunterlagen angefragt': 202, 'bei Easy Leasing eingereicht': 203,
    'zugesagt': 204, 'abgelehnt': 205
  },

  // Checkbox-Felder: enum mit genau einer Option
  'AR versendet': { 'Versendet': 206 },
  'Zahlungseingang erhalten': { 'Erhalten': 207 },
  'Überweisung Großhändler erhalten': { 'Erhalten': 208 },
  'Förderzusage erhalten': { 'Erhalten': 209 },

  'Netzansuchen eigenständig gestellt': { 'Ja': 210, 'Nein': 211 },
  'Stornogrund': {
    'Preis': 212, 'Kunde abgesprungen': 213, 'Technisch nicht machbar': 214,
    'Finanzierung abgelehnt': 215, 'Förderung abgelehnt': 216, 'Sonstiges': 217
  },
  'Verschiebegrund': {
    'Geld': 218, 'Jahreswechsel': 219, 'Kunde unsicher': 220,
    'technische Klärung': 221, 'Sonstiges': 222
  },

  // set-Feld, 11 Meilensteine — Fortschritt-Script/Config.gs
  'Erledigt': {
    'Erstgespräch': 223, 'Netz übergeben': 224, 'Zählpunkt da': 225, 'AR raus': 226,
    'Anzahlung da': 227, 'Geliefert': 228, 'Zweitgespräch': 229, 'Montiert': 230,
    'IB erfolgt': 231, 'Förderzusage': 232, 'Fertigmeldung': 233
  },

  'Dokumentation-Status': { 'Erstellt': 234, 'Doku erstellen': 235, 'Neu erstellen': 245 }
};
```

**Bundesland → Montagepartner** (Entscheidung 20.08., alle 9 Bundesländer eindeutig): Oberösterreich komplett zu Kreuzeder; Greensky und KOLLSTAR bleiben als Optionen bestehen, werden aber nicht mehr automatisch zugeordnet. Maßgeblich ist `Montagepartner-aus-Bundesland/Code.js:65`.

**`set`-Felder leeren:** undokumentiertes Verhalten, siehe `Fortschritt-Script` (`LEERWERT_FUER_SET = null`, `testLeerenSetWert()`).

---

## 4. Google-Ressourcen

| Was | ID |
|---|---|
| Partner-Fulfillment Drive-Ordner | `1DbZvsuIMEuUQLn4sGOt0p4EMPUFZ2XEM` |
| Google Form (Projektdokumentation SM) | `1_wS1BRz8dEqebtDoZZy4LB_uHrUunXEkXxTrZ_-Ecc8` |
| sevdesk Sync-Log Sheet | `1Icpc12eOBEmp2674cdKFVa1PCP7m-AHSRlSwNeiwmeo` |
| Fulfillment Field-Setup Log Sheet | `1W965Tesi0zgO80G7fJtNBnfErGLzj0g26FvTkIA_AX8` |

### Montagepartner „Montage offen"-Ordner (Ordnererstellung-bei-Gewonnen/Config.gs:52)

| Partner | Ordner-ID |
|---|---|
| ALE-Engineering | `1XIBb_UvDaNON3t38sR2PSxWzsyUnw75d` |
| Berger Elektrotechnik | `13oW_ltohWezbjiuFWUdZZXgM6NtndcD_` |
| Greensky | `14j-TzXjnCNVgx9SqCcTilX3gsGB0DnF5` |
| KOLLSTAR | `1ZeOW8gm0jhVDNG9920Yori7pde1G6bpw` |
| Kreuzeder | `1zAdnKf5VPEuUqQsdDWSb9D5btaf_7t1K` |
| Tiroler Partner | `1AAB7JjI5L5Zq3R-S7f_JpvbN-4g9y061` |
| Vorarlberg Partner | `1ICcSFoZ0EGnib1I3oi60eTjotx30Fqkl` |

Alle Ordner-IDs mit `_` am Ende in Backticks setzen, sonst bricht der Link beim Verlinken.

### Google Drive API — die Falle, die einen halben Tag gekostet hat

**Shortcuts sind für `DriveApp` als Ordner unsichtbar.** Eine Drive-Verknüpfung (mimeType `application/vnd.google-apps.shortcut`) taucht bei `Folder.getFoldersByName()` **nicht** auf — nur echte Ordner. Wer einen Partner-Ordner per Shortcut einbindet (weil er im Drive des Partners liegt), muss zusätzlich mit `getFilesByName()` suchen und per REST auflösen:

```
GET https://www.googleapis.com/drive/v3/files/{shortcutId}?fields=shortcutDetails
Authorization: Bearer ${ScriptApp.getOAuthToken()}
```

Kein Advanced Service im Manifest nötig — der OAuth-Token deckt das ab, wenn das Script ohnehin per `DriveApp` schreibt.
**Pro Partner einzeln prüfen, nicht von einem auf alle schließen:** Bei Kreuzeder war der Unterordner ein Shortcut, bei ALE-Engineering ein echter Ordner.

### Google-Datei-IDs

Echte Google Sheets haben **44 Zeichen**. Eine 33-Zeichen-ID ist meist eine hochgeladene `.xlsx` — die kann `SpreadsheetApp.openById()` nicht öffnen. Vor dem Bauen den mimeType prüfen, nicht dem Dateinamen glauben.

---

## 5. sevdesk

| | |
|---|---|
| Base-URL | `https://my.sevdesk.de/api/v1` |
| Auth | Header `Authorization`, **ohne** `Bearer`-Präfix, kein Query-Parameter |
| Status „Angenommen" | `500` |
| Test-Deal | 7253 · Test-Kunde: Stefan Schießtl, Kundennummer 4010 |

> 🔴 **Bekannter Blocker:** Der Live-Poller filtert hart auf `status=500`. In der Praxis wird dieser Status kaum gesetzt — von 26 geprüften, in Pipedrive gewonnenen Deals hatten **22 den Status 200**. Der Sync löst für die Mehrheit der real gewonnenen Aufträge also nie aus. Siehe `Sevdesk-Pipdrive_sync/`.

---

## 6. Apps Script — Muster für Massenläufe

Jede Zeile hier hat mindestens einen echten Fehlschlag als Ursache.

- **Laufzeitlimit 6 bzw. 30 Min.** Jeder Lauf über einen größeren Bestand braucht: Cursor in `ScriptProperties`, freiwilligen Abbruch nach ~4,5 Min, Fortsetzung beim nächsten Start. Ohne das stirbt der Lauf mittendrin und beginnt beim Neustart wieder von vorn — er kommt nie durch.
  **Die Stoppuhr muss VOR dem teuren Teil starten.** Wenn eine Pagination oder ein Preload vor `startZeit` läuft, greift der Guard nie und der Lauf stirbt reproduzierbar an derselben Stelle.
- **Niemals `appendRow` pro Zeile**, und schon gar nicht `openById` pro Zeile. Sheet-Handle einmal cachen, Zeilen in einem Array puffern, am Ende **ein** `setValues()`.
- **N+1 killt alles.** Verknüpfte Entitäten einmal komplett vorladen und in eine Map legen. Reales Beispiel: 6568 Deals mit je einem Personen-Abruf ≈ 22 Min → 6726 Personen in 68 Seitenabrufen vorgeladen = 32 s. Gesamtlauf von 4,5 Min/1200 Deals auf 68 s/6568 Deals, also **~25× schneller**.
- **Funktionen mit Parametern kann man im Editor nicht starten.** Der ▷-Button ruft ohne Argumente auf → Parameter ist `undefined`. Werte gehören in Konstanten, nicht in Signaturen. (Bei einer Webhook-Registrierung führt das dazu, dass eine kaputte URL registriert wird.)
- **Installierbare `onEdit`-Trigger feuern NICHT bei Änderungen durch das Script selbst.** Gut: keine Endlosschleifen. Schlecht: man verlässt sich fälschlich darauf, dass etwas nachzieht.
- **`e.range.getValue()` liefert nur die obere linke Zelle.** Beim Einfügen mehrerer Zellen gehen alle anderen Werte lautlos verloren → `getValues()` + Schleife.
- **Trigger-Installation idempotent bauen** (vorher eigene Trigger löschen), sonst läuft nach dem zweiten Klick alles doppelt.
- **`.after()`-Einmal-Trigger löschen sich nicht selbst.** Apps Script entfernt gefeuerte One-Time-Clock-Trigger nicht. Wer sie in einer Schleife erzeugt, läuft in das 20-Trigger-Limit; `.create()` wirft dann, und wenn der Fehler nur geloggt wird, stirbt der ganze Mechanismus lautlos. Der Handler muss seinen eigenen Trigger am Anfang löschen.
- **`LockService.getScriptLock()`** bei allem, was per Webhook parallel laufen kann — und bei jedem Read-Modify-Write auf eine Script-Property. Ohne Lock überschreibt der zweite Schreiber die Änderung des ersten, ohne Fehler.
  **`tryLock(5000)`, nicht `waitLock(30000)`** auf dem Webhook-Pfad: Pipedrives Antwortfenster liegt bei ~10 s.
- **Retry:** bei 429/5xx mit exponentiellem Backoff wiederholen, bei 4xx sofort abbrechen. Ein 4xx wird durch Warten nicht besser.
  Die übliche Schleife im Repo (`for attempt 1..3`, `sleep(1000 * 2^attempt)`, kein Sleep beim letzten Versuch) wartet real **2 s und 4 s** — mehrere Kommentare im Repo behaupten fälschlich „2s, 4s, 8s".
- **Sheets-Limit 10 Mio. Zellen.** Ein täglicher Vollauf, der pro Datensatz eine Zeile schreibt, sprengt das in Monaten. Im Dauerbetrieb nur protokollieren, was sich tatsächlich geändert hat, plus eine Zusammenfassungszeile pro Lauf.
- **Script-Properties fassen ~9 KB pro Wert.** State-Listen brauchen eine Obergrenze und eine Aufräumregel, sonst kippt der Sync stillschweigend.
- **Standard-Schalter in jedem Schreib-Script:** `DRY_RUN` (Default **true**) und `FORCE_OVERWRITE` (Default false, überspringt bereits befüllte Felder). Macht Wiederholungsläufe gefahrlos.
- **Konstanten kollidieren projektweit.** Zwei Dateien im selben Apps-Script-Projekt mit demselben `const` starten nicht. Deshalb bekommt jedes Script sein eigenes Projekt — und ein `_backup_v1/`-Unterordner braucht zwingend `skipSubdirectories: true` in der `.clasp.json`.

### Self-Trigger-Ketten

Ein Webhook-Handler, der nach Pipedrive zurückschreibt, triggert sich selbst. **Der Guard muss „nichts geändert" heißen, nicht „alles gefüllt".** Ein „alles gefüllt"-Guard terminiert nicht, solange irgendein Feld leer bleiben darf. Referenz-Implementierung: `Ordnererstellung-bei-Gewonnen/KundendatenSnapshot.gs:71`.
Statt das Logging abzuschalten, um Log-Spam zu vermeiden: **drosseln**, nicht weglassen — sonst ist der Fehlerfall unsichtbar.

### Arbeitsweise, die sich bewährt hat

- **Bestehende Code-Kommentare sind keine Quelle.** Der `all_not_deleted`-Fehler entstand, weil ein vorhandener Kommentar übernommen statt gegen die v2-Doku geprüft wurde. Bei API-Details: nachschlagen, nicht erinnern.
- **Der DRY-Vollauf ist das beste Messinstrument.** Er beantwortet Fragen über die Grundgesamtheit, die zehn Stichproben nie beantworten — und kostet nichts. Erst messen, dann optimieren, dann scharf schalten.
- **Bei Validierungsfehlern immer den Rohwert mitloggen**, nicht nur „ungültig". So kam heraus, dass in einem PLZ-Feld eine Telefonnummer stand.
- **Vor jedem Massenlauf `pruefeKonfiguration()`**, das hartcodierte IDs gegen die echte API abgleicht. Fängt genau die Fehlerklasse ab, die sonst als hunderte unauffällige Log-Zeilen durchrutscht.
  Wichtig: Der Check muss **grün werden können**. Ein Check, der wegen Platzhaltern dauerhaft FEHLER meldet, wird nicht mehr gelesen.
- **field_codes zur Laufzeit per Label auflösen statt hartcodieren.** `Montageplanung-Namensabgleich/Config.gs:121` macht das als einziges Projekt — der Anlass: die hartcodierten Codes waren nach 16 Tagen veraltet.
- **Bei mehrdeutigen Daten nicht raten, sondern entscheidbar machen.** Statt eine 50:50-Zuordnung zu würfeln: nicht setzen, den Fall mit allen Entscheidungsgrundlagen ins Log schreiben, den Menschen in 30 Sekunden entscheiden lassen. Gilt besonders, wenn der Wert weitere Automatik auslöst.

---

## 7. Web-App als Webhook-Empfänger

- Apps-Script-Web-Apps liefern bei **jedem** Aufruf zuerst HTTP 302 (Weiterleitung auf `script.googleusercontent.com`). Folgt der Aufrufer der Weiterleitung nicht, wird `doPost` unter Umständen gar nicht ausgeführt.
  **Gelöst über einen Cloudflare-Worker als Relay** — seit 24.08.2026 auf allen drei Webhook-Projekten live und end-to-end verifiziert. Relay: `https://wispy-band-24d4.valentin-be0.workers.dev/`
- **`clasp deploy --deploymentId <id>` kann die Zugriffsberechtigung zurücksetzen.** Reales Symptom (24.08.): `/exec` antwortete plötzlich mit HTTP 401 („Datei kann derzeit nicht geöffnet werden" — Googles Zugriffsverweigert-Seite, **kein** Bot-Schutz, auch wenn sie so aussieht) statt der normalen 302. Ursache: „Zugriffsberechtigte" war von „Jeder" auf „Jeder mit einem Google-Konto" gerutscht; `appsscript.json`s `webapp.access: ANYONE` wird beim Versions-Redeploy nicht zuverlässig neu übernommen.
  **Nach jedem `clasp deploy` auf eine öffentlich erreichbare Web-App im UI gegenchecken** (Bereitstellen → Bereitstellungen verwalten → ✎), nicht erst wenn jemand 401 bekommt.
- **Web-App-Deployments sind versioniert, Zeit-Trigger nicht.** Ein Zeit-Trigger führt immer den aktuell gespeicherten Code aus; eine Web-App-URL bleibt nach einer Code-Änderung auf dem alten Stand. Details im Deploy-Abschnitt der `CLAUDE.md` im Repo-Root.

---

## 8. Windows / PowerShell 5.1

- UTF-8 **mit BOM** für Skripte mit Sonderzeichen/Emojis.
- `Unblock-File -Path .\datei.ps1` nach dem Download nötig.
- `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`
- Kein `&&`/`||`, kein Ternary, kein `??`. Statt `A && B`: `A; if ($?) { B }`.
- POSIX-Pfade wie `/tmp` funktionieren nicht — für Scratch-Dateien Windows-Pfade nutzen.
