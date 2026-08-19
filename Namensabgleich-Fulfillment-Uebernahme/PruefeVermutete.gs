// ============================================================
// Zusatz: Notizen/Adresse der nächstliegenden Kandidaten prüfen
// ============================================================
// NUR LESEN. Idee: der Deal steht evtl. unter dem Ehepartner-/
// Firmeninhaber-Namen statt dem Namen aus der Liste
// (z. B. Johanna Seitz -> Ehemann "Christian Seitz",
//  Kalman KG -> Inhaber "Canan Kalman",
//  Verein HW -> Vorstand "Heinz Wehrle").
// Zeigt Notizen + Adresse, damit Valentin selbst entscheidet.

const VERMUTETE_KANDIDATEN = [
  { gesuchterName: 'Johanna Seitz', kandidatTyp: 'deal', kandidatId: 5663, kandidatBezeichnung: 'Christian Seitz' },
  { gesuchterName: 'Kalman KG', kandidatTyp: 'deal', kandidatId: 6493, kandidatBezeichnung: 'Canan Kalman' },
  { gesuchterName: 'Verein HW', kandidatTyp: 'person', kandidatId: 5685, kandidatBezeichnung: 'Heinz Wehrle (1)' },
  { gesuchterName: 'Verein HW', kandidatTyp: 'person', kandidatId: 6524, kandidatBezeichnung: 'Heinz Wehrle (2)' }
];

function zeigeVermuteteKandidaten() {
  VERMUTETE_KANDIDATEN.forEach(k => {
    Logger.log('=== %s -> Kandidat: %s (%s %s) ===', k.gesuchterName, k.kandidatBezeichnung, k.kandidatTyp, k.kandidatId);
    try {
      if (k.kandidatTyp === 'deal') {
        const dealResp = fetchPipedrive('/deals/' + k.kandidatId);
        const deal = dealResp.data;
        Logger.log('  Status: %s | Stage: %s | Wert: %s %s | Angelegt: %s', deal.status,
          (deal.stage && deal.stage.name) || deal.stage_id, deal.value, deal.currency, deal.add_time);
        Logger.log('  Notizen: %s', JSON.stringify(deal.notes || []));
        if (deal.person_id) {
          const personId = deal.person_id.value || deal.person_id;
          const person = fetchPipedrive('/persons/' + personId).data;
          const adresse = holeCustomFieldWert(person.custom_fields, PERSON_ADRESSE_FIELD_CODE);
          Logger.log('  Person: %s | Adresse: %s | Tel: %s | Email: %s', person.name, adresse || '(leer)',
            (person.phones && person.phones[0] && person.phones[0].value) || '(leer)',
            person.primary_email || '(leer)');
        }
      } else {
        const person = fetchPipedrive('/persons/' + k.kandidatId).data;
        const adresse = holeCustomFieldWert(person.custom_fields, PERSON_ADRESSE_FIELD_CODE);
        Logger.log('  Person: %s | Adresse: %s | Tel: %s | Email: %s', person.name, adresse || '(leer)',
          (person.phones && person.phones[0] && person.phones[0].value) || '(leer)',
          person.primary_email || '(leer)');
        Logger.log('  Notizen: %s', JSON.stringify(person.notes || []));
        const dealsResp = fetchPipedrive('/deals?person_id=' + k.kandidatId + '&limit=10');
        const deals = dealsResp.data || [];
        if (deals.length === 0) {
          Logger.log('  -> keine Deals an dieser Person.');
        }
        deals.forEach(d => Logger.log('  -> Deal %s | "%s" | Status: %s', d.id, d.title, d.status));
      }
    } catch (e) {
      Logger.log('  HARD_ERROR: ' + e.message);
    }
  });
}
