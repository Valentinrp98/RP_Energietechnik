// ===== NETZANMELDUNG-ESKALATION =====
// Zwei unabhängige Fristen, beide ab dem Tag gezählt, an dem ENTWEDER Netzstatus="übergeben"
// ODER Fortschritt="Netz übergeben" zum ersten Mal gesehen wurde (beide Felder haben dieselbe
// Bedeutung an dieser Stelle, Valentins Vorgabe 2026-08-17: "beide, sobald eines gesetzt ist"):
//   1. NETZANMELDUNG_ESKALATION_WARTETAGE (5 Tage) UND Netzstatus noch nicht "eingereicht"/
//      "Zählpunkt da"/"Fertigmeldung raus" -> Aktivität, damit Valentin beim Monteur nachhaken kann.
//   2. KUNDENTERMIN_ESKALATION_WARTETAGE (3 Tage) UND weder DC- noch AC-Termin gesetzt (= kein
//      Kundentermin angefragt) -> eigene Aktivität.
// Die beiden Checks laufen UNABHÄNGIG vom aktuellen Feldstatus (nicht nur, solange der Deal noch
// exakt "übergeben" ist) -- sonst würde z.B. eine bereits erledigte Netzanmeldung (Netzstatus
// schon "eingereicht") die Kundentermin-Prüfung mit stoppen, obwohl die nichts miteinander zu tun
// haben. Einmal gestempelt, bleibt der Fristbeginn stehen, auch wenn sich die Felder später ändern.
// Für einen täglichen Trigger gedacht (siehe installTriggers() in SetupHelpers.gs).
//
// Braucht drei neue Pipedrive-Datumsfelder, die es noch nicht gibt (TODO_ in Config.gs):
//   - NETZSTATUS_UEBERGEBEN_AM_FIELD_KEY: wird vom Script selbst gestempelt, sobald es einen Deal
//     zum ersten Mal mit Netzstatus="übergeben" ODER Fortschritt="Netz übergeben" sieht -- das ist
//     der Fristbeginn. Ohne dieses Feld gäbe es keinen zuverlässigen Anker (Pipedrive protokolliert
//     nicht "seit wann" ein Auswahlfeld einen bestimmten Wert hat, jedenfalls nicht ohne die
//     Changelog-API zu bemühen).
//   - NETZANMELDUNG_ESKALATION_GEMELDET_AM_FIELD_KEY / KUNDENTERMIN_ESKALATION_GEMELDET_AM_FIELD_KEY:
//     verhindern, dass an jedem Tag NACH Fristablauf erneut eine Aktivität angelegt wird (sonst
//     bekäme Valentin ab Tag 5 jeden Tag eine neue "Netzanmeldung"-Aktivität für denselben Deal).

function ueberwacheNetzanmeldungUndKundentermin() {
  if (NETZSTATUS_UEBERGEBEN_AM_FIELD_KEY.startsWith('TODO_')
    || NETZANMELDUNG_ESKALATION_GEMELDET_AM_FIELD_KEY.startsWith('TODO_')
    || KUNDENTERMIN_ESKALATION_GEMELDET_AM_FIELD_KEY.startsWith('TODO_')) {
    Logger.log('Eskalations-Feldcodes noch nicht vollständig in Config.gs eingetragen -- nichts zu tun.');
    return;
  }

  const heute = new Date();
  let cursor = null;
  let geprueft = 0;
  const summary = { uebergebenGestempelt: 0, netzanmeldungEskalation: 0, kundenterminEskalation: 0, fehler: 0 };

  do {
    const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/deals?status=won&limit=100`
      + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const response = callPipedriveWithRetryRaw(url);
    const deals = response.data || [];
    cursor = response.additional_data?.next_cursor || null;

    deals.forEach(deal => {
      const cf = deal.custom_fields || {};
      const netzstatusUebergeben = cf[NETZSTATUS_FIELD_KEY] === NETZSTATUS_OPTION_IDS.uebergeben;
      const fortschrittNetzUebergeben = cf[FORTSCHRITT_FIELD_KEY] === FORTSCHRITT_LABELS.NetzUebergeben;
      const hatStempel = !!cf[NETZSTATUS_UEBERGEBEN_AM_FIELD_KEY];

      // Weder aktuell "übergeben" in einem der beiden Felder, noch je gestempelt -- für diesen
      // Deal gab es die Übergabe noch nie, nichts zu tun.
      if (!netzstatusUebergeben && !fortschrittNetzUebergeben && !hatStempel) return;
      geprueft++;

      try {
        if (!hatStempel) {
          // Fristbeginn stempeln, EINMALIG -- ab jetzt läuft die Uhr, unabhängig davon, ob sich
          // Netzstatus/Fortschritt danach weiterbewegen.
          const heuteIso = Utilities.formatDate(heute, Session.getScriptTimeZone(), 'yyyy-MM-dd');
          if (DRY_RUN) {
            logRow('pipedrive_to_sheet', deal.id, null, 'Netzstatus übergeben am', 'DRY-RUN', `würde auf ${heuteIso} stempeln`);
          } else {
            patchPipedrive(`deals/${deal.id}`, { custom_fields: { [NETZSTATUS_UEBERGEBEN_AM_FIELD_KEY]: heuteIso } });
            logRow('pipedrive_to_sheet', deal.id, null, 'Netzstatus übergeben am', 'gestempelt', heuteIso);
          }
          summary.uebergebenGestempelt++;
          return; // Frist beginnt heute -- an diesem Tag noch nichts zu eskalieren
        }

        const tageSeitUebergeben = (heute - new Date(cf[NETZSTATUS_UEBERGEBEN_AM_FIELD_KEY])) / (1000 * 60 * 60 * 24);

        // 1) Netzanmeldung-Eskalation (5 Tage) -- nur relevant, solange Netzstatus noch NICHT
        // signalisiert, dass die Anmeldung schon raus ist. Unabhängig davon geprüft, ob der Deal
        // GERADE JETZT "übergeben" ist oder nur mal gestempelt wurde.
        const netzanmeldungNochOffen = ![NETZSTATUS_OPTION_IDS.eingereicht, NETZSTATUS_OPTION_IDS.zaehlpunktDa, NETZSTATUS_OPTION_IDS.fertigmeldungRaus]
          .includes(cf[NETZSTATUS_FIELD_KEY]);
        if (netzanmeldungNochOffen && tageSeitUebergeben >= NETZANMELDUNG_ESKALATION_WARTETAGE && !cf[NETZANMELDUNG_ESKALATION_GEMELDET_AM_FIELD_KEY]) {
          meldeEskalation(deal, 'Netzanmeldung eingereicht', NETZANMELDUNG_ESKALATION_GEMELDET_AM_FIELD_KEY,
            `Netzanmeldung noch offen (${Math.floor(tageSeitUebergeben)} Tage seit Übergabe) -- beim Monteur nachhaken`);
          summary.netzanmeldungEskalation++;
        }

        // 2) Kundentermin-Eskalation (3 Tage) -- "kein Kundentermin angefragt" = weder DC- noch
        // AC-Termin gesetzt. Komplett unabhängig von Check 1.
        const keinKundentermin = !cf[DC_TERMIN_FIELD_KEY] && !cf[AC_TERMIN_FIELD_KEY];
        if (keinKundentermin && tageSeitUebergeben >= KUNDENTERMIN_ESKALATION_WARTETAGE && !cf[KUNDENTERMIN_ESKALATION_GEMELDET_AM_FIELD_KEY]) {
          meldeEskalation(deal, 'Kundentermin anfragen', KUNDENTERMIN_ESKALATION_GEMELDET_AM_FIELD_KEY,
            `Noch kein Kundentermin (${Math.floor(tageSeitUebergeben)} Tage seit Übergabe) -- Termin anfragen`);
          summary.kundenterminEskalation++;
        }
      } catch (err) {
        logRow('pipedrive_to_sheet', deal.id, null, 'Netzanmeldung-Eskalation', 'FEHLER', err.message);
        Logger.log(`FEHLER bei Netzanmeldung-Eskalation für Deal ${deal.id}: ${err.message}`);
        summary.fehler++;
      }
    });
  } while (cursor);

  Logger.log(`Fertig. ${geprueft} relevante Deals geprüft. ${JSON.stringify(summary)}`);
}

/**
 * Legt die Eskalations-Aktivität an und stempelt sofort das zugehörige "gemeldet am"-Feld --
 * beides in einem Rutsch, damit bei DRY_RUN weder Aktivität noch Stempel passieren, und im
 * scharfen Lauf nie eine Aktivität ohne den Stempel entsteht (sonst würde am nächsten Tag erneut
 * eskaliert werden).
 */
function meldeEskalation(deal, betreffPrefix, gemeldetAmFieldKey, logDetail) {
  const kundenName = deal.title || `Deal ${deal.id}`;
  if (DRY_RUN) {
    logRow('pipedrive_to_sheet', deal.id, null, betreffPrefix, 'DRY-RUN', logDetail);
    return;
  }
  const ownerIdRaw = deal.owner_id;
  const ownerId = ownerIdRaw && typeof ownerIdRaw === 'object' ? ownerIdRaw.id : ownerIdRaw;
  erstellePipedriveAktivitaet(deal.id, `${betreffPrefix}: ${kundenName}`, ownerId, AKTIVITAET_TYP_ESKALATION);

  const heuteIso = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  patchPipedrive(`deals/${deal.id}`, { custom_fields: { [gemeldetAmFieldKey]: heuteIso } });
  logRow('pipedrive_to_sheet', deal.id, null, betreffPrefix, 'Aktivität angelegt', logDetail);
}
