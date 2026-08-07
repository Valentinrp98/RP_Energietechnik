/** Haupttest: baut Link aus echtem Deal, schickt IMMER an TEST_EMAIL (nie an result.email!). Deal-ID unten anpassen. */
function testRealDealPrefill() {
  const result = buildPrefilledLinkFromDeal(7253); //DEAL ID HERE <-----------------------------------------------------------------------------

  MailApp.sendEmail(
    TEST_EMAIL, // Sicherheits-Empfänger – NICHT result.email!
    'TEST: Echte Deal-Daten – Projektdokumentation',
    `Deal: ${result.name}\nWürde eigentlich an: ${result.email}\n\nLink:\n${result.link}`
  );
  Logger.log('Fertig: ' + result.link);
}

/** Listet alle Form-Fragen mit Item-IDs im Log (einmalig für Setup gebraucht). */
function logFormItems() {
  const form = FormApp.openById(FORM_ID);
  form.getItems().forEach(item => {
    Logger.log(item.getTitle() + ' → ID: ' + item.getId() + ' | Typ: ' + item.getType());
  });
}

/** LIEST NUR: Zeigt die Auswahl-Optionen der Multiple-Choice-Felder im Formular. */
function logFormChoices() {
  const form = FormApp.openById(FORM_ID);
  form.getItems().forEach(item => {
    if (item.getType() === FormApp.ItemType.MULTIPLE_CHOICE) {
      const choices = item.asMultipleChoiceItem().getChoices();
      const labels = choices.map(c => c.getValue());
      Logger.log(item.getTitle() + ' → Optionen: ' + labels.join(', '));
    }
  });
}


/** Prüft ob PIPEDRIVE_API_TOKEN in Script Properties gesetzt ist. */
function debugToken() {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  Logger.log('Token vorhanden: ' + (token ? 'JA, Länge: ' + token.length : 'NEIN - ist null/leer'));
}

/** Liest Deal 3715 + Person + Organisation roh aus der API (nur zur Struktur-Erkundung). */
function testPipedriveConnection() {
  const apiToken = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  const dealId = 7253;

  const dealUrl = `https://rp-energietechnik.pipedrive.com/api/v2/deals/${dealId}?api_token=${apiToken}`;
  const deal = JSON.parse(UrlFetchApp.fetch(dealUrl).getContentText()).data;
  Logger.log('=== DEAL ===');
  Logger.log(JSON.stringify(deal, null, 2));

  if (deal.person_id) {
    const personUrl = `https://rp-energietechnik.pipedrive.com/api/v2/persons/${deal.person_id}?api_token=${apiToken}`;
    const person = JSON.parse(UrlFetchApp.fetch(personUrl).getContentText()).data;
    Logger.log('=== PERSON ===');
    Logger.log(JSON.stringify(person, null, 2));
  }

  if (deal.org_id) {
    const orgUrl = `https://rp-energietechnik.pipedrive.com/api/v2/organizations/${deal.org_id}?api_token=${apiToken}`;
    const org = JSON.parse(UrlFetchApp.fetch(orgUrl).getContentText()).data;
    Logger.log('=== ORGANISATION ===');
    Logger.log(JSON.stringify(org, null, 2));
  }
}



/** Erster Proof-of-Concept mit Dummy-Daten (Max Mustermann) – historisch, nicht mehr nötig. */
function testPrefillAndSend() {
  const form = FormApp.openById(FORM_ID);
  const items = form.getItems();
  const formResponse = form.createResponse();

  formResponse.withItemResponse(items.find(i => i.getId() === ITEM_ID_NAME).asTextItem().createResponse('Max Mustermann (TEST)'));
  formResponse.withItemResponse(items.find(i => i.getId() === ITEM_ID_ADRESSE).asTextItem().createResponse('Teststraße 1, 4600 Wels'));
  formResponse.withItemResponse(items.find(i => i.getId() === ITEM_ID_TELEFON).asTextItem().createResponse('+43 660 1234567'));
  formResponse.withItemResponse(items.find(i => i.getId() === ITEM_ID_EMAIL).asTextItem().createResponse('max.mustermann@test.at'));

  const link = formResponse.toPrefilledUrl();
  MailApp.sendEmail(TEST_EMAIL, 'TEST: Projektdokumentation PV-Anlage', `Test-Link (Dummy-Daten):\n\n${link}`);
  Logger.log('Gesendet an ' + TEST_EMAIL + ': ' + link);
}

/** SCHREIBT: Erstellt 1 einzelnes Test-Feld in Pipedrive, zum gefahrlosen Ausprobieren. */
function testCreateOneField() {
  const apiToken = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  const url = `https://rp-energietechnik.pipedrive.com/api/v2/dealFields?api_token=${apiToken}`;

  const feld = { 
    field_name: 'TEST Dachform',
    field_type: 'enum',
    options: [{ label: 'Satteldach' }, { label: 'Walmdach' }, { label: 'Pultdach' }, { label: 'Flachdach' }]
  };

  Logger.log('Sende: ' + JSON.stringify(feld)); // Debug-Zeile: zeigt was wirklich rausgeht

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(feld),
    muteHttpExceptions: true
  });

  Logger.log('Status: ' + response.getResponseCode());
  Logger.log('Antwort: ' + response.getContentText());
}

/** LIEST NUR: Zeigt alle Deal-Custom-Fields mit Namen, field_code und Options-IDs. */
function listAllDealFields() {
  const apiToken = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  const url = `https://rp-energietechnik.pipedrive.com/api/v2/dealFields?api_token=${apiToken}`;

  const response = UrlFetchApp.fetch(url);
  const fields = JSON.parse(response.getContentText()).data;

  fields.forEach(field => {
    if (field.is_custom_field) { // nur eure eigenen Felder, keine Pipedrive-Standardfelder
      let optionsInfo = '';
      if (field.options) {
        optionsInfo = ' | Optionen: ' + field.options.map(o => o.id + '=' + o.label).join(', ');
      }
      Logger.log(field.field_name + ' → field_code: ' + field.field_code + optionsInfo);
    }
  });
}