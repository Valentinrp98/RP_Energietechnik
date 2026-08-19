// ============================================================
// Zusatz: Detail-Abfrage für FEHLER_STATUS + Suche für NICHT_GEFUNDEN
// ============================================================
// NUR LESEN, keine Schreibvorgänge. Ziel: genug Kontext liefern,
// damit Valentin jeden Fall in Sekunden selbst entscheiden kann,
// statt dass das Script rät.

// ---------- Teil 1: die 9 FEHLER_STATUS-Fälle genauer ansehen ----------
// (Deal existiert bereits, Status ist nur nicht "won" — hier reicht die Deal-ID)
const FEHLER_STATUS_FAELLE = [
  { name: 'Ralph Hemetinger', dealId: 7072 },
  { name: 'Ali Alsofi', dealId: 4945 },
  { name: 'Johannes Moser', dealId: 6454 },
  { name: 'Mehmet Ünsal', dealId: 5142 },
  { name: 'Koptische Kirche', dealId: 7107 },
  { name: 'Kenan Kavlak', dealId: 5307 },
  { name: 'Julia Linsmayr', dealId: 7177 },
  { name: 'Hans Greml', dealId: 6908 },
  { name: 'Martina Suppan', dealId: 6018 }
];

function zeigeFehlerStatusDeals() {
  FEHLER_STATUS_FAELLE.forEach(fall => {
    try {
      const dealResp = fetchPipedrive('/deals/' + fall.dealId);
      const deal = dealResp.data;
      if (!deal) {
        Logger.log('%s (Deal %s): NICHT GEFUNDEN', fall.name, fall.dealId);
        return;
      }
      let adresse = '', telefon = '';
      if (deal.person_id) {
        const personId = deal.person_id.value || deal.person_id;
        try {
          const personResp = fetchPipedrive('/persons/' + personId);
          const person = personResp.data;
          adresse = holeCustomFieldWert(person.custom_fields, PERSON_ADRESSE_FIELD_CODE);
          telefon = (person.phones && person.phones[0] && person.phones[0].value) || '';
        } catch (e) { /* ignore */ }
      }
      Logger.log('%s | Deal %s | Status: %s | Stage: %s | Wert: %s %s | Angelegt: %s | Zuletzt geändert: %s | Adresse: %s | Tel: %s',
        fall.name, fall.dealId, deal.status, (deal.stage && deal.stage.name) || deal.stage_id,
        deal.value, deal.currency, deal.add_time, deal.update_time, adresse || '(leer)', telefon || '(leer)');
    } catch (e) {
      Logger.log('%s (Deal %s): HARD_ERROR %s', fall.name, fall.dealId, e.message);
    }
  });
}

// ---------- Teil 2: die 13 NICHT_GEFUNDEN-Namen breiter suchen ----------
// Deal-Titelsuche hatte nichts gefunden — hier zusätzlich Personen- und
// Organisationssuche versuchen, dann alle Deals der gefundenen Person/Org auflisten.
const NICHT_GEFUNDEN_NAMEN = [
  'Leonardo Batista', 'Opencarbox GmbH', 'Edin Hamzic', 'Christian van Dyk',
  'George Pozderie', 'Sasa Usic', 'Verein HW', 'Verena Pizzini',
  'Kamal El Nour', 'Zoltan Bobal', 'Waldhaus GmbH', 'Johanna Seitz', 'Kalman KG'
];

// Test an einem festen Namen — vor dem Vollauf einmal ausführen, um das Response-Format zu prüfen
const TEST_NAME_PERSON = 'Leonardo Batista';
function testPersonenUndOrgSuche() {
  Logger.log('--- persons/search ---');
  Logger.log(JSON.stringify(fetchPipedrive('/persons/search?term=' + encodeURIComponent(TEST_NAME_PERSON) + '&fields=name&limit=5'), null, 2));
  Logger.log('--- organizations/search ---');
  Logger.log(JSON.stringify(fetchPipedrive('/organizations/search?term=' + encodeURIComponent(TEST_NAME_PERSON) + '&fields=name&limit=5'), null, 2));
}

function ermittleNichtGefundeneNamenDetails() {
  NICHT_GEFUNDEN_NAMEN.forEach(name => {
    Logger.log('=== ' + name + ' ===');
    try {
      const personResult = fetchPipedrive('/persons/search?term=' + encodeURIComponent(name) + '&fields=name&limit=5');
      const personen = ((personResult.data && personResult.data.items) || []).map(it => it.item);
      if (personen.length === 0) {
        Logger.log('  Keine Person gefunden.');
      }
      personen.forEach(person => {
        Logger.log('  Person %s: "%s"', person.id, person.name);
        try {
          const dealsResp = fetchPipedrive('/deals?person_id=' + person.id + '&limit=10');
          const deals = dealsResp.data || [];
          if (deals.length === 0) {
            Logger.log('    -> keine Deals an dieser Person.');
          }
          deals.forEach(d => Logger.log('    -> Deal %s | "%s" | Status: %s', d.id, d.title, d.status));
        } catch (e) {
          Logger.log('    Fehler beim Deal-Abruf für Person %s: %s', person.id, e.message);
        }
      });
    } catch (e) {
      Logger.log('  Fehler bei Personensuche: ' + e.message);
    }

    try {
      const orgResult = fetchPipedrive('/organizations/search?term=' + encodeURIComponent(name) + '&fields=name&limit=5');
      const orgs = ((orgResult.data && orgResult.data.items) || []).map(it => it.item);
      if (orgs.length === 0) {
        Logger.log('  Keine Organisation gefunden.');
      }
      orgs.forEach(org => {
        Logger.log('  Organisation %s: "%s"', org.id, org.name);
        try {
          const dealsResp = fetchPipedrive('/deals?org_id=' + org.id + '&limit=10');
          const deals = dealsResp.data || [];
          if (deals.length === 0) {
            Logger.log('    -> keine Deals an dieser Organisation.');
          }
          deals.forEach(d => Logger.log('    -> Deal %s | "%s" | Status: %s', d.id, d.title, d.status));
        } catch (e) {
          Logger.log('    Fehler beim Deal-Abruf für Organisation %s: %s', org.id, e.message);
        }
      });
    } catch (e) {
      Logger.log('  Fehler bei Organisationssuche: ' + e.message);
    }
  });
}
