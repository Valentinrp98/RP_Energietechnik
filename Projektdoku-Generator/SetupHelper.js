// ===== EINMALIGE SETUP-FUNKTIONEN =====
// Im Apps-Script-Editor oben im Dropdown auswählen und ausführen (▷-Button).

/** Einmalig ausführen: legt den täglichen Zeit-Trigger an. Vorher prüfen ob schon einer existiert
 *  (ScriptApp.getProjectTriggers()), sonst läuft er nach einem zweiten Klick doppelt. */
function SETUP_EINMALIG_createDailyTrigger() {
  const bestehende = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'generateDailyProjectDocumentation');
  bestehende.forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('generateDailyProjectDocumentation')
    .timeBased()
    .atHour(2)
    .everyDays(1)
    .create();
  Logger.log('Täglicher Trigger für 2:00 Uhr angelegt.');
}

/** Debug: listet alle Deal-Custom-Fields (field_name + field_code + Options-IDs bei Enum/Set). */
function listDealFieldsHelper() {
  const fields = fetchPipedrive('dealFields?limit=500');
  fields.forEach(f => {
    const optionsInfo = f.options ? ` -- Optionen: ${f.options.map(o => `${o.label}=${o.id}`).join(', ')}` : '';
    Logger.log(`${f.field_name}  -->  ${f.field_code} (${f.field_type})${optionsInfo}`);
  });
}

/**
 * Gleicht alle hartcodierten TODO-Platzhalter und Options-IDs in Config.gs gegen die echte
 * Pipedrive-API ab, BEVOR ein Massenlauf passiert -- Pattern aus den anderen RP-Scripts.
 * Fängt die Fehlerklasse "Feld/Option existiert nicht mehr" ab, statt sie als stille
 * Nicht-Schreibung durchrutschen zu lassen (leeres custom_fields-Patch, Pipedrive antwortet trotzdem 200).
 */
function checkConfiguration() {
  const probleme = [];
  const configWerte = {
    DOKU_STATUS_FIELD_KEY, DOKU_STATUS_OPTION_TRIGGER, DOKU_STATUS_OPTION_DONE, DOKU_LINK_FIELD_KEY,
    NOTIZEN_INTERN_FIELD_KEY, NETZANSUCHEN_FIELD_KEY, DACHFORM_FIELD_KEY, EINDECKUNG_FIELD_KEY,
    AUSRICHTUNG_FIELD_KEY, DC_TERMIN_FIELD_KEY, AC_TERMIN_FIELD_KEY, IB_TERMIN_FIELD_KEY,
    DC_KABELWEG_FIELD_KEY, AC_KABELWEG_FIELD_KEY, ORT_VERTEILER_FIELD_KEY,
    ANLAGENDETAILS_FIELD_KEY, LIEFERTERMIN_FIELD_KEY, NOTIZEN_KUNDE_FIELD_KEY
  };
  Object.entries(configWerte).forEach(([name, wert]) => {
    if (String(wert).startsWith('TODO_')) probleme.push(`${name} ist noch nicht ausgefüllt (${wert})`);
  });

  if (probleme.length === 0) {
    const fields = fetchPipedrive('dealFields?limit=500');
    const byCode = Object.fromEntries(fields.map(f => [f.field_code, f]));

    const statusFeld = byCode[DOKU_STATUS_FIELD_KEY];
    if (!statusFeld) {
      probleme.push(`DOKU_STATUS_FIELD_KEY "${DOKU_STATUS_FIELD_KEY}" existiert nicht (mehr) in dealFields`);
    } else {
      Logger.log(`Status-Feld "${statusFeld.field_name}" hat field_type "${statusFeld.field_type}".`);
      if (statusFeld.field_type !== 'enum' && statusFeld.field_type !== 'set') {
        // Gotcha aus Sheet-Sync: manche Auswahlfelder sind trotz Options-Liste field_type
        // "autocomplete" und wollen den Text-Label als String, nicht die numerische Options-ID --
        // genau der Typfehler, der hier am 17.08. schon einmal als Pipedrive-400 zugeschlagen hat.
        probleme.push(
          `DOKU_STATUS_FIELD_KEY ist field_type "${statusFeld.field_type}", nicht "enum" -- ` +
          `dieses Script schreibt die numerische Options-ID (${DOKU_STATUS_OPTION_DONE}). ` +
          `Bei "autocomplete" muss stattdessen der Label-String geschrieben werden, sonst 200 ohne Wirkung.`
        );
      }
      const optionIds = (statusFeld.options || []).map(o => String(o.id));
      if (!optionIds.includes(String(DOKU_STATUS_OPTION_TRIGGER))) probleme.push(`DOKU_STATUS_OPTION_TRIGGER "${DOKU_STATUS_OPTION_TRIGGER}" ist keine gültige Options-ID von "${statusFeld.field_name}" (gültig: ${optionIds.join(', ')})`);
      if (!optionIds.includes(String(DOKU_STATUS_OPTION_DONE))) probleme.push(`DOKU_STATUS_OPTION_DONE "${DOKU_STATUS_OPTION_DONE}" ist keine gültige Options-ID von "${statusFeld.field_name}" (gültig: ${optionIds.join(', ')})`);
    }

    const linkFeld = byCode[DOKU_LINK_FIELD_KEY];
    if (!linkFeld) {
      probleme.push(`DOKU_LINK_FIELD_KEY "${DOKU_LINK_FIELD_KEY}" existiert nicht (mehr) in dealFields`);
    } else {
      Logger.log(`Link-Feld "${linkFeld.field_name}" hat field_type "${linkFeld.field_type}".`);
    }
    if (!byCode[KUNDENORDNER_LINK_FIELD_KEY]) probleme.push(`KUNDENORDNER_LINK_FIELD_KEY "${KUNDENORDNER_LINK_FIELD_KEY}" existiert nicht (mehr) in dealFields -- Feld evtl. in Ordnererstellung-bei-Gewonnen geändert`);

    // --- Alle Inhaltsfelder: existiert der field_code überhaupt? ---
    // Ohne das zeigt ein umbenanntes/gelöschtes Feld still "(leer)" im fertigen Doc statt eines Fehlers.
    CONTENT_FIELDS.forEach(f => {
      if (!byCode[f.key]) probleme.push(`Inhaltsfeld "${f.label}" (${f.key}) existiert nicht (mehr) in dealFields`);
    });
    if (!byCode[MONTAGEPARTNER_FIELD_KEY]) probleme.push(`MONTAGEPARTNER_FIELD_KEY existiert nicht (mehr) in dealFields`);

    // --- Alle hartcodierten Options-IDs gegen die echten Optionen abgleichen ---
    // Ohne das zeigt ein umbenanntes/gelöschtes Enum still eine rohe Zahl im Doc statt des Labels.
    const enumChecks = [
      { key: NETZANSUCHEN_FIELD_KEY, map: NETZANSUCHEN_OPTION_IDS, label: 'Netzansuchen' },
      { key: DACHFORM_FIELD_KEY, map: DACHFORM_OPTION_IDS, label: 'Dachform' },
      { key: EINDECKUNG_FIELD_KEY, map: EINDECKUNG_OPTION_IDS, label: 'Eindeckung' },
      { key: AUSRICHTUNG_FIELD_KEY, map: AUSRICHTUNG_OPTION_IDS, label: 'Ausrichtung' },
      { key: MONTAGEPARTNER_FIELD_KEY, map: MONTAGEPARTNER_OPTION_IDS, label: 'Montagepartner' }
    ];
    enumChecks.forEach(({ key, map, label }) => {
      const feld = byCode[key];
      if (!feld) return; // schon oben gemeldet
      const echt = Object.fromEntries((feld.options || []).map(o => [String(o.id), o.label]));
      Object.entries(map).forEach(([erwartetesLabel, id]) => {
        if (!echt[String(id)]) {
          probleme.push(`${label}: Options-ID ${id} ("${erwartetesLabel}") existiert nicht mehr (gültig: ${Object.entries(echt).map(([i, l]) => `${l}=${i}`).join(', ')})`);
        } else if (echt[String(id)] !== erwartetesLabel) {
          probleme.push(`${label}: Options-ID ${id} heißt in Pipedrive jetzt "${echt[String(id)]}", im Script steht "${erwartetesLabel}" -- Config.js nachziehen`);
        }
      });
    });
  }

  if (probleme.length > 0) {
    Logger.log(`checkConfiguration: ${probleme.length} Problem(e):\n` + probleme.join('\n'));
  } else {
    Logger.log('checkConfiguration: alles passt.');
  }
  return probleme;
}

/** Für Einzeltests: einen bekannten Deal durchlaufen lassen (Deal-ID unten anpassen). Der
 *  ▷-Button im Editor ruft ohne Argumente auf -- deshalb Konstante statt Funktionsparameter. */
function testEinzelDeal() {
  starteLauf('testEinzelDeal');
  const dealId = 7253; // hier Test-Deal-ID eintragen
  try {
    const deal = fetchPipedrive(`deals/${dealId}`);
    const result = processDeal(deal);
    logRow(deal.id, deal.title, result.kunde, result.status, result.docUrl, result.completeness, result.detail);
    Logger.log(JSON.stringify(result));
  } finally {
    flushLog();
  }
}
