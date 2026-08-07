// ===== KONFIGURATION =====

const PIPEDRIVE_DOMAIN = 'rp-energietechnik';
const FORM_ID = '1_wS1BRz8dEqebtDoZZy4LB_uHrUunXEkXxTrZ_-Ecc8';
const TEST_EMAIL = 'valentin@rp-energietechnik.at'; // Solange gesetzt: keine Mail an echte Kunden

// Formular Item-IDs (via logFormItems ermittelt)
const ITEM_ID_NAME = 945011154;
const ITEM_ID_ADRESSE = 1036346225;
const ITEM_ID_TELEFON = 532771525;
const ITEM_ID_EMAIL = 1407288636;
const ITEM_ID_DACHFORM = 145420530;
const ITEM_ID_EINDECKUNG = 433704362;
const ITEM_ID_AUSRICHTUNG = 973516005;
const ITEM_ID_DACHNEIGUNG = 1052802777;
const ITEM_ID_GEBAEUDEHOEHE = 487607498;
const ITEM_ID_UNTERKONSTRUKTION = 1909718982;
const ITEM_ID_HOEHE_SPARREN = 649435743;
const ITEM_ID_BREITE_SPARREN = 1938099137;
const ITEM_ID_BLITZSCHUTZ = 1837289680;
const ITEM_ID_STOERFLAECHEN = 1269897483;
const ITEM_ID_KABEL_DC = 2100233501;
const ITEM_ID_KABEL_AC = 1511472008;

// Pipedrive field_codes (via listAllDealFields ermittelt)
const ADRESSE_FIELD_KEY = '432e4e165de7e9f474643c3d3a5552e2ec976f55'; // liegt an der PERSON
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
const AUSRICHTUNG_FIELD_KEY = '7ba65cad11182422467e4923292422b601f6da80';


// Options-Mapping: Pipedrive-Options-ID → Formular-Text (nur für enum-Felder)
const DACHFORM_OPTIONS = { 88: 'Satteldach', 89: 'Walmdach', 90: 'Pultdach', 91: 'Flachdach' };
const EINDECKUNG_OPTIONS = { 92: 'Ziegeldach', 93: 'Blechdach Trapez', 94: 'Blechdach Falz', 95: 'Welleternit', 96: 'Flachdach (Kies)', 97: 'Flachdach (Beton)', 98: 'Flachdach (begrünt)' };
const UNTERKONSTRUKTION_OPTIONS = { 99: 'Sparren', 100: 'Pfetten' };
const STOERFLAECHEN_OPTIONS = { 103: 'Ja', 104: 'Nein' };
const BLITZSCHUTZ_OPTIONS = { 101: 'Ja', 102: 'Nein' };
const AUSRICHTUNG_OPTIONS = { 142: 'Nord', 143: 'Ost', 144: 'Süd', 145: 'West' };

// ===== HILFSFUNKTIONEN =====

/** Holt den API-Token aus Script Properties, wirft klaren Fehler wenn er fehlt. */
function getApiToken() {
  const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN fehlt in den Script Properties (Projekteinstellungen prüfen).');
  return token;
}

/** LIEST: Pipedrive-GET mit Token im Header + Statusprüfung vor dem Parsen. */
function fetchPipedrive(path) {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/${path}`;
  const response = UrlFetchApp.fetch(url, {
    headers: { 'x-api-token': getApiToken() },
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code !== 200) {
    throw new Error(`Pipedrive API-Fehler ${code} bei "${path}": ${response.getContentText()}`);
  }
  return JSON.parse(response.getContentText()).data;
}

/** Sucht ein Formular-Item, wirft verständlichen Fehler mit Feldnamen wenn nicht gefunden. */
function findItem(items, id, label) {
  const item = items.find(i => i.getId() === id);
  if (!item) throw new Error(`Formularfeld "${label}" (ID ${id}) nicht gefunden – logFormItems() ausführen und ID prüfen.`);
  return item;
}

/** Wandelt Pipedrive-Options-ID in Formular-Text um, warnt im Log bei unbekannter ID. */
function mapOption(rawId, mapping, feldname) {
  if (rawId === null || rawId === undefined) return '';
  const text = mapping[rawId];
  if (!text) Logger.log(`WARNUNG: Unbekannte Options-ID ${rawId} bei "${feldname}" – Mapping in Code.gs veraltet?`);
  return text || '';
}


// ===== KERNFUNKTION =====

/** Baut Prefill-Link aus Pipedrive-Deal. Kein Mailversand, keine Pipedrive-Änderung. */
function buildPrefilledLinkFromDeal(dealId) {
  const deal = fetchPipedrive(`deals/${dealId}`);

  if (!deal.person_id) {
    throw new Error(`Deal ${dealId} hat keine verknüpfte Person – Prefill nicht möglich.`);
  }
  const person = fetchPipedrive(`persons/${deal.person_id}`);

  // Kontaktdaten (Person)
  const name = person.name || '';
  const telefon = person.phones?.[0]?.value || '';
  const email = person.emails?.[0]?.value || '';
  const adrObj = person.custom_fields?.[ADRESSE_FIELD_KEY];
  const adresse = adrObj?.formatted_address || adrObj?.value || ''; // Fallback wenn Google Maps nicht aufgelöst hat

  // Dachdaten (Deal)
  const cf = deal.custom_fields || {};
  const dachform = mapOption(cf[DACHFORM_FIELD_KEY], DACHFORM_OPTIONS, 'Dachform');
  const eindeckung = mapOption(cf[EINDECKUNG_FIELD_KEY], EINDECKUNG_OPTIONS, 'Eindeckung');
  const unterkonstruktion = mapOption(cf[UNTERKONSTRUKTION_FIELD_KEY], UNTERKONSTRUKTION_OPTIONS, 'Unterkonstruktion');
  const blitzschutz = mapOption(cf[BLITZSCHUTZ_FIELD_KEY], BLITZSCHUTZ_OPTIONS, 'Blitzschutz');
  const stoerflaechen = mapOption(cf[STOERFLAECHEN_FIELD_KEY], STOERFLAECHEN_OPTIONS, 'Störflächen');

  // Neue Zeile bei den anderen Auswahlfeldern:
  const ausrichtungIds = cf[AUSRICHTUNG_FIELD_KEY] || [];
  const ausrichtungen = (Array.isArray(ausrichtungIds) ? ausrichtungIds : [ausrichtungIds])
    .map(id => AUSRICHTUNG_OPTIONS[id])
    .filter(Boolean); // entfernt undefined, falls eine ID nicht im Mapping ist
  const dachneigung = cf[DACHNEIGUNG_FIELD_KEY] ?? '';
  const gebaeudehoehe = cf[GEBAEUDEHOEHE_FIELD_KEY] ?? '';
  const hoeheSparren = cf[HOEHE_SPARREN_FIELD_KEY] ?? '';
  const breiteSparren = cf[BREITE_SPARREN_FIELD_KEY] ?? '';
  const kabelDc = cf[KABEL_DC_FIELD_KEY] ?? '';
  const kabelAc = cf[KABEL_AC_FIELD_KEY] ?? '';

  const form = FormApp.openById(FORM_ID);
  const items = form.getItems();
  const r = form.createResponse();

  // Kontaktdaten – immer setzen
  r.withItemResponse(findItem(items, ITEM_ID_NAME, 'Name').asTextItem().createResponse(name));
  r.withItemResponse(findItem(items, ITEM_ID_ADRESSE, 'Adresse').asTextItem().createResponse(adresse));
  r.withItemResponse(findItem(items, ITEM_ID_TELEFON, 'Telefonnummer').asTextItem().createResponse(telefon));
  r.withItemResponse(findItem(items, ITEM_ID_EMAIL, 'Email').asTextItem().createResponse(email));
  

  // Auswahlfelder – nur wenn Wert vorhanden
  if (dachform) r.withItemResponse(findItem(items, ITEM_ID_DACHFORM, 'Dachform').asMultipleChoiceItem().createResponse(dachform));
  if (eindeckung) r.withItemResponse(findItem(items, ITEM_ID_EINDECKUNG, 'Eindeckung').asMultipleChoiceItem().createResponse(eindeckung));
  if (unterkonstruktion) r.withItemResponse(findItem(items, ITEM_ID_UNTERKONSTRUKTION, 'Unterkonstruktion').asMultipleChoiceItem().createResponse(unterkonstruktion));
  if (blitzschutz) r.withItemResponse(findItem(items, ITEM_ID_BLITZSCHUTZ, 'Blitzschutz').asMultipleChoiceItem().createResponse(blitzschutz));
  if (stoerflaechen) r.withItemResponse(findItem(items, ITEM_ID_STOERFLAECHEN, 'Störflächen').asMultipleChoiceItem().createResponse(stoerflaechen));
  if (ausrichtungen.length > 0) r.withItemResponse(findItem(items, ITEM_ID_AUSRICHTUNG, 'Ausrichtung').asCheckboxItem().createResponse(ausrichtungen));

  // Zahlenfelder – nur wenn Wert vorhanden (!== '' damit auch 0 durchkommt)
  if (dachneigung !== '') r.withItemResponse(findItem(items, ITEM_ID_DACHNEIGUNG, 'Dachneigung').asTextItem().createResponse(String(dachneigung)));
  if (gebaeudehoehe !== '') r.withItemResponse(findItem(items, ITEM_ID_GEBAEUDEHOEHE, 'Gebäudehöhe').asTextItem().createResponse(String(gebaeudehoehe)));
  if (hoeheSparren !== '') r.withItemResponse(findItem(items, ITEM_ID_HOEHE_SPARREN, 'Höhe Sparren').asTextItem().createResponse(String(hoeheSparren)));
  if (breiteSparren !== '') r.withItemResponse(findItem(items, ITEM_ID_BREITE_SPARREN, 'Breite Sparren').asTextItem().createResponse(String(breiteSparren)));
  if (kabelDc !== '') r.withItemResponse(findItem(items, ITEM_ID_KABEL_DC, 'Kabelweg DC').asTextItem().createResponse(String(kabelDc)));
  if (kabelAc !== '') r.withItemResponse(findItem(items, ITEM_ID_KABEL_AC, 'Kabelweg AC').asTextItem().createResponse(String(kabelAc)));

  return { link: r.toPrefilledUrl(), email: email, name: name };
}