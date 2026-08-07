// ===== KONFIGURATION =====

const FORM_ID = '1_wS1BRz8dEqebtDoZZy4LB_uHrUunXEkXxTrZ_-Ecc8'; // Google Form "Projektdokumentation"
const TEST_EMAIL = 'valentin@rp-energietechnik.at'; // Solange hier gesetzt: keine Mail an echte Kunden

// Kontaktdaten (Person) – Item-IDs + Pipedrive-Feld
const ITEM_ID_NAME = 945011154;
const ITEM_ID_ADRESSE = 1036346225;
const ITEM_ID_TELEFON = 532771525;
const ITEM_ID_EMAIL = 1407288636;
const ADRESSE_FIELD_KEY = '432e4e165de7e9f474643c3d3a5552e2ec976f55'; // Custom Field "Adresse" (Person)

// Dachdaten (Deal) – Item-IDs aus dem Formular
const ITEM_ID_DACHFORM = 145420530;
const ITEM_ID_EINDECKUNG = 433704362;
const ITEM_ID_DACHNEIGUNG = 1052802777;
const ITEM_ID_GEBAEUDEHOEHE = 487607498;
const ITEM_ID_UNTERKONSTRUKTION = 1909718982;
const ITEM_ID_HOEHE_SPARREN = 649435743;
const ITEM_ID_BREITE_SPARREN = 1938099137;
const ITEM_ID_BLITZSCHUTZ = 1837289680;
const ITEM_ID_STOERFLAECHEN = 1269897483;
const ITEM_ID_KABEL_DC = 2100233501;
const ITEM_ID_KABEL_AC = 1511472008;

// Dachdaten (Deal) – Pipedrive field_codes
const DACHFORM_FIELD_KEY = '71ee37fc98c338877d435f4d77f409367c013451';
const EINDECKUNG_FIELD_KEY = '2e8cc4c7d0592a418a58394a470e3386d125654a';
const DACHNEIGUNG_FIELD_KEY = '142c229d8dba549de13e5e2675d6addb1bc6def0';
const GEBAEUDEHOEHE_FIELD_KEY = '8596f23d6a54366a6fb550b67abc4dcdaa9b2f22';
const UNTERKONSTRUKTION_FIELD_KEY = '35ea9050672a922a5fc919db66ae3c3e879e59e7';
const HOEHE_SPARREN_FIELD_KEY = '72c895d8faa59e34f2c37beffcee12d43cea9fb0';
const BREITE_SPARREN_FIELD_KEY = 'ac37e6c16947904e5675453e3d72fa57a34889b0';
const KABEL_DC_FIELD_KEY = 'b5d425d088a42afdaa8ba6817acffa28b4156ae1';
const KABEL_AC_FIELD_KEY = 'd429d11f249a664a3fa6c270620c0f4c2c4bbc49';
const STOERFLAECHEN_FIELD_KEY = '5f419ab6f29e7373cb3edf8bd74fc821ab54d028';
const BLITZSCHUTZ_FIELD_KEY = 'd6a498297c4b89d3728e63f38fcde42fe20498e2';

// Options-Mapping: Pipedrive-ID → Formular-Text (nur für enum-Felder nötig)
const DACHFORM_OPTIONS = { 88: 'Satteldach', 89: 'Walmdach', 90: 'Pultdach', 91: 'Flachdach' };
const EINDECKUNG_OPTIONS = { 92: 'Ziegeldach', 93: 'Blechdach Trapez', 94: 'Blechdach Falz', 95: 'Welleternit', 96: 'Flachdach (Kies)', 97: 'Flachdach (Beton)', 98: 'Flachdach (begrünt)' };
const UNTERKONSTRUKTION_OPTIONS = { 99: 'Sparren', 100: 'Pfetten' };
const STOERFLAECHEN_OPTIONS = { 103: 'Ja', 104: 'Nein' };
const BLITZSCHUTZ_OPTIONS = { 101: 'Ja', 102: 'Nein' };


// ===== KERNFUNKTION =====

/** Baut Prefill-Link aus Pipedrive-Deal (Kontaktdaten + Dachdaten). Kein Mailversand, keine Pipedrive-Änderung. */
function buildPrefilledLinkFromDeal(dealId) {
  const apiToken = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');

  const dealUrl = `https://rp-energietechnik.pipedrive.com/api/v2/deals/${dealId}?api_token=${apiToken}`;
  const deal = JSON.parse(UrlFetchApp.fetch(dealUrl).getContentText()).data;

  const personUrl = `https://rp-energietechnik.pipedrive.com/api/v2/persons/${deal.person_id}?api_token=${apiToken}`;
  const person = JSON.parse(UrlFetchApp.fetch(personUrl).getContentText()).data;

  const name = person.name || '';
  const telefon = person.phones?.[0]?.value || '';
  const email = person.emails?.[0]?.value || '';
  const adresse = person.custom_fields?.[ADRESSE_FIELD_KEY]?.formatted_address || '';

  const dachform = DACHFORM_OPTIONS[deal.custom_fields?.[DACHFORM_FIELD_KEY]] || '';
  const eindeckung = EINDECKUNG_OPTIONS[deal.custom_fields?.[EINDECKUNG_FIELD_KEY]] || '';
  const unterkonstruktion = UNTERKONSTRUKTION_OPTIONS[deal.custom_fields?.[UNTERKONSTRUKTION_FIELD_KEY]] || '';
  const blitzschutz = BLITZSCHUTZ_OPTIONS[deal.custom_fields?.[BLITZSCHUTZ_FIELD_KEY]] || '';
  const stoerflaechen = STOERFLAECHEN_OPTIONS[deal.custom_fields?.[STOERFLAECHEN_FIELD_KEY]] || '';

  const dachneigung = deal.custom_fields?.[DACHNEIGUNG_FIELD_KEY] ?? '';
  const gebaeudehoehe = deal.custom_fields?.[GEBAEUDEHOEHE_FIELD_KEY] ?? '';
  const hoeheSparren = deal.custom_fields?.[HOEHE_SPARREN_FIELD_KEY] ?? '';
  const breiteSparren = deal.custom_fields?.[BREITE_SPARREN_FIELD_KEY] ?? '';
  const kabelDc = deal.custom_fields?.[KABEL_DC_FIELD_KEY] ?? '';
  const kabelAc = deal.custom_fields?.[KABEL_AC_FIELD_KEY] ?? '';

  const form = FormApp.openById(FORM_ID);
  const items = form.getItems();
  const formResponse = form.createResponse();

  formResponse.withItemResponse(items.find(i => i.getId() === ITEM_ID_NAME).asTextItem().createResponse(name));
  formResponse.withItemResponse(items.find(i => i.getId() === ITEM_ID_ADRESSE).asTextItem().createResponse(adresse));
  formResponse.withItemResponse(items.find(i => i.getId() === ITEM_ID_TELEFON).asTextItem().createResponse(telefon));
  formResponse.withItemResponse(items.find(i => i.getId() === ITEM_ID_EMAIL).asTextItem().createResponse(email));

  if (dachform) formResponse.withItemResponse(items.find(i => i.getId() === ITEM_ID_DACHFORM).asMultipleChoiceItem().createResponse(dachform));
  if (eindeckung) formResponse.withItemResponse(items.find(i => i.getId() === ITEM_ID_EINDECKUNG).asMultipleChoiceItem().createResponse(eindeckung));
  if (unterkonstruktion) formResponse.withItemResponse(items.find(i => i.getId() === ITEM_ID_UNTERKONSTRUKTION).asMultipleChoiceItem().createResponse(unterkonstruktion));
  if (blitzschutz) formResponse.withItemResponse(items.find(i => i.getId() === ITEM_ID_BLITZSCHUTZ).asMultipleChoiceItem().createResponse(blitzschutz));
  if (stoerflaechen) formResponse.withItemResponse(items.find(i => i.getId() === ITEM_ID_STOERFLAECHEN).asMultipleChoiceItem().createResponse(stoerflaechen));

  if (dachneigung !== '') formResponse.withItemResponse(items.find(i => i.getId() === ITEM_ID_DACHNEIGUNG).asTextItem().createResponse(String(dachneigung)));
  if (gebaeudehoehe !== '') formResponse.withItemResponse(items.find(i => i.getId() === ITEM_ID_GEBAEUDEHOEHE).asTextItem().createResponse(String(gebaeudehoehe)));
  if (hoeheSparren !== '') formResponse.withItemResponse(items.find(i => i.getId() === ITEM_ID_HOEHE_SPARREN).asTextItem().createResponse(String(hoeheSparren)));
  if (breiteSparren !== '') formResponse.withItemResponse(items.find(i => i.getId() === ITEM_ID_BREITE_SPARREN).asTextItem().createResponse(String(breiteSparren)));
  if (kabelDc !== '') formResponse.withItemResponse(items.find(i => i.getId() === ITEM_ID_KABEL_DC).asTextItem().createResponse(String(kabelDc)));
  if (kabelAc !== '') formResponse.withItemResponse(items.find(i => i.getId() === ITEM_ID_KABEL_AC).asTextItem().createResponse(String(kabelAc)));

  return { link: formResponse.toPrefilledUrl(), email: email, name: name };
}




/** SCHREIBT: Erstellt alle 11 finalen Deal-Custom-Fields in Pipedrive. */
function createDealFieldsFromFormList() {
  const apiToken = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  const url = `https://rp-energietechnik.pipedrive.com/api/v2/dealFields?api_token=${apiToken}`;

  const felder = [
    // ===== VOM SELLER (Pflichtfeld bei Signing) =====
    { 
      field_name: 'Dachform', 
      field_type: 'enum',
      options: [{ label: 'Satteldach' }, { label: 'Walmdach' }, { label: 'Pultdach' }, { label: 'Flachdach' }]
    },
    { 
      field_name: 'Eindeckung des Daches', 
      field_type: 'enum',
      options: [
        { label: 'Ziegeldach' }, { label: 'Blechdach Trapez' }, { label: 'Blechdach Falz' },
        { label: 'Welleternit' }, { label: 'Flachdach (Kies)' }, { label: 'Flachdach (Beton)' }, { label: 'Flachdach (begrünt)' }
      ]
    },

    // ===== VOM KUNDEN (via Formular, später zurückgeschrieben) =====
    { field_name: 'Dachneigung in Grad', field_type: 'double' },
    { field_name: 'Gebäudehöhe in m', field_type: 'double' },
    { 
      field_name: 'Unterkonstruktion des Daches', 
      field_type: 'enum',
      options: [{ label: 'Sparren' }, { label: 'Pfetten' }]
    },
    { field_name: 'Höhe Sparren/Pfetten in m', field_type: 'double' },
    { field_name: 'Breite Sparren/Pfetten in m', field_type: 'double' },
    { 
      field_name: 'Blitzschutz vorhanden', 
      field_type: 'enum',
      options: [{ label: 'Ja' }, { label: 'Nein' }]
    },
    { 
      field_name: 'Störflächen am Dach', 
      field_type: 'enum',
      options: [{ label: 'Ja' }, { label: 'Nein' }]
    },
    { field_name: 'Kabelweg DC (Dach zu Wechselrichter) in m', field_type: 'double' },
    { field_name: 'Kabelweg AC (Wechselrichter zu Verteiler) in m', field_type: 'double' },

    // ===== INTERN (Tracking) =====
    { 
      field_name: 'Doku Link verschickt', 
      field_type: 'enum',
      options: [{ label: 'Ja' }, { label: 'Nein' }]
    }
  ];

  felder.forEach(feld => {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(feld),
      muteHttpExceptions: true
    });
    Logger.log(feld.field_name + ' → Status ' + response.getResponseCode() + ': ' + response.getContentText());
  });
}