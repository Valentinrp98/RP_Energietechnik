/** HAUPTTEST: baut Link aus echtem Deal, schickt IMMER an TEST_EMAIL (nie an result.email!). */
function testRealDealPrefill() {
  const result = buildPrefilledLinkFromDeal(7253); // ← DEAL-ID HIER ANPASSEN

  MailApp.sendEmail(
    TEST_EMAIL, // Sicherheits-Empfänger – NICHT result.email!
    'TEST: Echte Deal-Daten – Projektdokumentation',
    `Deal: ${result.name}\nWürde eigentlich an: ${result.email}\n\nLink:\n${result.link}`
  );
  Logger.log('Fertig: ' + result.link);
}

/** LIEST NUR: Alle Form-Fragen mit Item-IDs. Nach Formular-Änderungen ausführen. */
function logFormItems() {
  const form = FormApp.openById(FORM_ID);
  form.getItems().forEach(item => {
    Logger.log(item.getTitle() + ' → ID: ' + item.getId() + ' | Typ: ' + item.getType());
  });
}

/**
 * LIEST NUR: Kopfzeile der verknüpften Antworten-Tabelle, in exakter Spalten-Reihenfolge --
 * damit sich eine roh eingefügte Zeile (Copy-Paste aus dem Antworten-Sheet) sicher den Feldern
 * zuordnen lässt, statt anhand der ITEM_ID-Reihenfolge in Code.js zu raten (die muss nicht mit
 * der tatsächlichen Formular-/Sheet-Reihenfolge übereinstimmen).
 */
function zeigeFormAntwortSpalten() {
  const form = FormApp.openById(FORM_ID);
  const destId = form.getDestinationId();
  if (!destId) {
    Logger.log('Formular hat keine verknüpfte Antworten-Tabelle (getDestinationId ist leer).');
    return;
  }
  const sheet = SpreadsheetApp.openById(destId).getSheets()[0];
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  header.forEach((h, i) => Logger.log(`Spalte ${i + 1}: ${h}`));
}

/**
 * EINMALIG: Umfrage-Antwort von Tobias Knittelfelder (Deal 7093, 24.08.2026) einspielen.
 * Deckt NUR das Hauptdach ab (Formular-Antwort) -- die separaten Zubau-Details aus der
 * Kunden-Mail (Sandwichpaneele, 3,5°, ...) gehören zu einem ANDEREN Dach (Nebengebäude, siehe
 * Foto+Skizze vom 25.08.) und landen deshalb NICHT in Dachform/Eindeckung/Neigung, sondern
 * unten separat als Text in den internen Notizen -- sonst würden sie die echten Hauptdach-Werte
 * überschreiben.
 * Die 4 Formular-Restantworten (keine eigenen Pipedrive-Felder vorhanden, siehe Chat 25.08.)
 * kommen in "Sonstige Mitteilung Kunde".
 */
function schreibeUmfrageKnittelfelder7093() {
  const dealId = 7093;

  const internNotiz = [
    'ZUBAU-DACH (separates Nebengebäude, NICHT das Hauptdach -- Angaben lt. Mail + Skizze 25.08.2026):',
    'Ausrichtung (Gefällerichtung): Nord-Nordwest (N NW)',
    'Deckung: Sandwichpaneele',
    'Größe: ca. 90m² (Skizze: 13,8x4,9m + 6,5x3,5m, L-Form)',
    'Neigung: 3,5°',
    'Belastung (Verkehrs-/Schneelast/PV lt. Paneele): 2,25 kN/m²',
    'Beschattung: Mauer Nachbargebäude Süd-Südost (S SO), ca. 60cm über Dachniveau',
    'Kabelweg: West-Südwest (W SW) seitig vom Dach ins Gebäude, innen Platz für Speicher/WR',
    'Zuleitung ins Gebäude vorhanden: 5x6mm² vom Hauptzählerkasten'
  ].join('\n');

  const kundeNotiz = [
    'Spezielle Wünsche bei der Belegung: Infos lt. Mail',
    'Dachpläne vorhanden: Ja',
    'Beschreibung Kabelweg (Hauptdach, lt. Formular): West Südwest (W SW) seitig vom Dach ins Gebäude',
    'Sonstiges: Infos lt. Mail'
  ].join('\n');

  const result = patchPipedrive(`deals/${dealId}`, {
    custom_fields: {
      [DACHFORM_FIELD_KEY]: 91, // Flachdach (Hauptdach)
      [EINDECKUNG_FIELD_KEY]: 93, // Blechdach Trapez (Hauptdach)
      [DACHNEIGUNG_FIELD_KEY]: 3,
      [GEBAEUDEHOEHE_FIELD_KEY]: 3,
      [UNTERKONSTRUKTION_FIELD_KEY]: 100, // Pfetten
      [HOEHE_SPARREN_FIELD_KEY]: 2.46,
      [BREITE_SPARREN_FIELD_KEY]: 0.14,
      [BLITZSCHUTZ_FIELD_KEY]: 102, // Nein
      [STOERFLAECHEN_FIELD_KEY]: 103, // Ja
      [NOTIZEN_KUNDE_FIELD_KEY]: kundeNotiz,
      [NOTIZEN_INTERN_FIELD_KEY]: internNotiz
    }
  });
  Logger.log(`Deal ${dealId} aktualisiert. Custom Fields jetzt: ${JSON.stringify(result.custom_fields, null, 2)}`);
}

/** LIEST NUR: Auswahl-Optionen aller Multiple-Choice-Felder im Formular. */
function logFormChoices() {
  const form = FormApp.openById(FORM_ID);
  form.getItems().forEach(item => {
    if (item.getType() === FormApp.ItemType.MULTIPLE_CHOICE) {
      const labels = item.asMultipleChoiceItem().getChoices().map(c => c.getValue());
      Logger.log(item.getTitle() + ' → Optionen: ' + labels.join(', '));
    }
  });
}

/** LIEST NUR: Alle Deal-Custom-Fields mit field_code + Options-IDs. Nach Pipedrive-Änderungen ausführen. */
function listAllDealFields() {
  const fields = fetchPipedrive('dealFields');
  fields.forEach(field => {
    if (field.is_custom_field) {
      const opts = field.options ? ' | Optionen: ' + field.options.map(o => o.id + '=' + o.label).join(', ') : '';
      Logger.log(field.field_name + ' → field_code: ' + field.field_code + opts);
    }
  });
}

/** LIEST NUR: Rohes JSON von Deal + Person + Organisation, zur Struktur-Erkundung. */
function testPipedriveConnection() {
  const dealId = 7253; // ← DEAL-ID HIER ANPASSEN

  const deal = fetchPipedrive(`deals/${dealId}`);
  Logger.log('=== DEAL ===');
  Logger.log(JSON.stringify(deal, null, 2));

  if (deal.person_id) {
    Logger.log('=== PERSON ===');
    Logger.log(JSON.stringify(fetchPipedrive(`persons/${deal.person_id}`), null, 2));
  }
  if (deal.org_id) {
    Logger.log('=== ORGANISATION ===');
    Logger.log(JSON.stringify(fetchPipedrive(`organizations/${deal.org_id}`), null, 2));
  }
}

/** Prüft ob PIPEDRIVE_API_TOKEN in den Script Properties gesetzt ist. */
function debugToken() {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  Logger.log('Token vorhanden: ' + (token ? 'JA, Länge: ' + token.length : 'NEIN - ist null/leer'));
}