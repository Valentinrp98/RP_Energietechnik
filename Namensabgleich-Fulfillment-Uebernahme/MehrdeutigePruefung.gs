// ============================================================
// Zusatz: Detail-Abfrage für die 3 MEHRDEUTIG-Fälle aus Phase 1
// ============================================================
// Holt pro Kandidat-Deal zusätzliche Infos (Anlegedatum, Wert,
// Angebotsnummer, Adresse der Person), damit Valentin in 30 Sekunden
// entscheiden kann, welcher Deal der richtige ist — kein Auto-Entscheid.
// NUR LESEN, keine Schreibvorgänge.

const ANGEBOTSNUMMER_FIELD_CODE = '9935f33d1f8c5575da1aa3bdf1c2329bed92398b';
const PERSON_ADRESSE_FIELD_CODE = '432e4e165de7e9f474643c3d3a5552e2ec976f55';

const MEHRDEUTIGE_GRUPPEN = [
  { name: 'Werner Kremser', dealIds: [5982, 6006, 3854] },
  { name: 'Karl Heindl', dealIds: [6406, 2859] },
  { name: 'Josef Kassmannhuber', dealIds: [7109, 2521, 7129] }
];

function holeCustomFieldWert(customFields, fieldCode) {
  if (!customFields) return '';
  // API v2: custom_fields ist ein Objekt {field_code: wert}, keine Liste.
  const wert = customFields[fieldCode];
  if (wert === undefined || wert === null) return '';
  // Zusammengesetzte Felder (z. B. Adresse) liefern ein Objekt mit .value/.formatted_address
  if (typeof wert === 'object') {
    return wert.formatted_address || wert.value || JSON.stringify(wert);
  }
  return wert;
}

function zeigeMehrdeutigeDeals() {
  MEHRDEUTIGE_GRUPPEN.forEach(gruppe => {
    Logger.log('=== ' + gruppe.name + ' ===');
    gruppe.dealIds.forEach(dealId => {
      try {
        const dealResp = fetchPipedrive('/deals/' + dealId);
        const deal = dealResp.data;
        if (!deal) {
          Logger.log('  Deal %s: NICHT GEFUNDEN', dealId);
          return;
        }

        let adresse = '';
        let telefon = '';
        if (deal.person_id) {
          const personId = deal.person_id.value || deal.person_id;
          try {
            const personResp = fetchPipedrive('/persons/' + personId);
            const person = personResp.data;
            adresse = holeCustomFieldWert(person.custom_fields, PERSON_ADRESSE_FIELD_CODE);
            telefon = (person.phones && person.phones[0] && person.phones[0].value) || '';
          } catch (e) {
            adresse = 'Fehler beim Person-Abruf: ' + e.message;
          }
        }

        const angebotsnummer = holeCustomFieldWert(deal.custom_fields, ANGEBOTSNUMMER_FIELD_CODE);

        Logger.log('  Deal %s | Status: %s | Stage: %s | Wert: %s %s | Angelegt: %s | Angebotsnr: %s | Adresse: %s | Tel: %s',
          dealId, deal.status, (deal.stage && deal.stage.name) || deal.stage_id,
          deal.value, deal.currency, deal.add_time, angebotsnummer || '(leer)', adresse || '(leer)', telefon || '(leer)');
      } catch (e) {
        Logger.log('  Deal %s: HARD_ERROR %s', dealId, e.message);
      }
    });
  });
}
