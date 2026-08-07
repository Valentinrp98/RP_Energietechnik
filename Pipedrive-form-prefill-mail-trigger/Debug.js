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