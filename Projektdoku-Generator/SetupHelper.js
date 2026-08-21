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

/**
 * Diagnose (21.08.): warum liegen bei Deal 7072 (Hemetinger) offenbar 2 Docs im Ordner? Listet alle
 * Dateien im "2_Projektdokumentation"-Unterordner mit Erstelldatum + Datei-ID, plus den aktuell in
 * Pipedrive gespeicherten Link und den aktuellen Anlagendetails-Wert. Rein lesend.
 */
function zeigeHemetingerDiagnose() {
  const dealId = 7072;
  const deal = fetchPipedrive(`deals/${dealId}`);
  const cf = deal.custom_fields || {};
  Logger.log(`Deal ${dealId}: KUNDENORDNER_LINK_FIELD_KEY = ${cf[KUNDENORDNER_LINK_FIELD_KEY] || '(leer)'}`);
  Logger.log(`Deal ${dealId}: DOKU_LINK_FIELD_KEY = ${cf[DOKU_LINK_FIELD_KEY] || '(leer)'}`);
  Logger.log(`Deal ${dealId}: Anlagendetails = ${cf[ANLAGENDETAILS_FIELD_KEY] || '(leer)'}`);
  Logger.log(`Deal ${dealId}: Status = ${cf[DOKU_STATUS_FIELD_KEY]}`);

  const projektdokuFolder = findProjektdokuUnterordner(cf[KUNDENORDNER_LINK_FIELD_KEY]);
  if (!projektdokuFolder) {
    Logger.log('Unterordner nicht gefunden.');
    return;
  }
  const it = projektdokuFolder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    Logger.log(`Datei: "${f.getName()}" -- ID ${f.getId()} -- erstellt ${f.getDateCreated()} -- Papierkorb: ${f.isTrashed()}`);
  }
}

/**
 * Einmalige Diagnose: Montagepartner für eine feste Liste von Deal-IDs abfragen -- für die
 * Partner-Info "viele offene Netzanmeldungen" nach dem ersten Live-Batch (21.08.). Rein lesend,
 * kein Log-Sheet-Eintrag, nur Logger.log (Tab-getrennt zum einfachen Weiterverarbeiten).
 */
function zeigeMontagepartnerFuerDeals() {
  const dealIds = [
    5307, 5587, 5663, 5728, 5779, 5837, 5867, 5984, 6018, 6084, 6179, 6207, 6219,
    6406, 6493, 6591, 6659, 6686, 6694, 6738, 6771, 6804, 6843, 6908, 6922, 6970,
    6971, 7059, 7065, 7071, 7072, 7096, 7107, 7129, 7177, 7186, 7282, 7334
  ];
  dealIds.forEach(dealId => {
    const deal = fetchPipedrive(`deals/${dealId}`);
    const cf = deal.custom_fields || {};
    const partner = resolveEnumLabel(cf[MONTAGEPARTNER_FIELD_KEY], MONTAGEPARTNER_ID_TO_NAME);
    Logger.log(`${dealId}\t${deal.title}\t${partner}`);
  });
}

/**
 * Diagnose (21.08.): zeigt pro Deal, warum versucheNetzstatusUebergeben() nichts geschrieben hat --
 * Anlagendetails leer? Adresse leer? aktueller Netzstatus-Rohwert? Rein lesend, kein Schreibvorgang.
 */
function zeigeNetzstatusDiagnose() {
  const dealIds = [
    5307, 5587, 5663, 5728, 5779, 5837, 5867, 5984, 6018, 6084, 6179, 6207, 6219,
    6406, 6493, 6591, 6659, 6686, 6694, 6738, 6771, 6804, 6843, 6908, 6922, 6970,
    6971, 7059, 7065, 7071, 7072, 7096, 7107, 7129, 7177, 7186, 7282, 7334,
    4945, 5142, 5237, 5373, 5530, 5749, 5758, 5829, 5972, 6006, 6013, 6027, 6037,
    6198, 6326, 6454, 6592, 6593, 6952, 4876, 6439
  ];
  dealIds.forEach(dealId => {
    const deal = fetchPipedrive(`deals/${dealId}`);
    const cf = deal.custom_fields || {};
    const person = deal.person_id ? fetchPipedrive(`persons/${deal.person_id.value || deal.person_id}`) : null;
    const adresse = person && person.custom_fields
      ? formatAdresse(person.custom_fields[ADRESSE_FIELD_KEY], person.custom_fields[PLZ_FIELD_KEY])
      : { text: '(leer)', warnung: null };
    const netzstatusRoh = cf[NETZSTATUS_FIELD_KEY];
    Logger.log(`${dealId}\tAnlagendetails=${cf[ANLAGENDETAILS_FIELD_KEY] ? 'JA' : 'leer'}\tAdresse=${adresse.text}\tNetzstatus=${netzstatusRoh === undefined || netzstatusRoh === null ? 'leer' : netzstatusRoh}`);
  });
}

/** Debug: zeigt den Pipedrive-Feldnamen (Label) von Adresse-/PLZ-Feld am Kontakt (personFields),
 *  plus deren aktuellen Rohwert + Person-Link bei den 2 Deals mit korrigierter Adresse -- zum
 *  Wiederfinden in der Pipedrive-UI, wenn der Feldname am Kontakt nicht auf Anhieb auffindbar ist. */
function zeigeAdressUndPlzFeldName() {
  const fields = fetchPipedrive('personFields?limit=500');
  const byCode = Object.fromEntries(fields.map(f => [f.field_code, f]));
  const adresseFeld = byCode[ADRESSE_FIELD_KEY];
  const plzFeld = byCode[PLZ_FIELD_KEY];
  Logger.log(`Adresse-Feld heißt in Pipedrive (am Kontakt): "${adresseFeld ? adresseFeld.field_name : '??? nicht gefunden'}"`);
  Logger.log(`PLZ-Feld heißt in Pipedrive (am Kontakt): "${plzFeld ? plzFeld.field_name : '??? nicht gefunden'}"`);

  [5142, 6037].forEach(dealId => {
    const deal = fetchPipedrive(`deals/${dealId}`);
    const personId = deal.person_id && (deal.person_id.value || deal.person_id);
    if (!personId) { Logger.log(`Deal ${dealId}: keine Person verknüpft`); return; }
    const person = fetchPipedrive(`persons/${personId}`);
    Logger.log(`Deal ${dealId} -- Person ${personId} (${person.name}): https://rp-energietechnik.pipedrive.com/person/${personId}`);
    Logger.log(`  [v2] Adresse=${JSON.stringify(person.custom_fields[ADRESSE_FIELD_KEY])}`);
    Logger.log(`  [v2] PLZ=${JSON.stringify(person.custom_fields[PLZ_FIELD_KEY])}`);

    // Gegenprobe über v1: falls v2 hier gecachte/veraltete Werte für Adress-Custom-Fields liefert
    // (unverifiziert, aber die Werte nach dem manuellen Neuspeichern in der UI blieben unverändert),
    // zeigt der Vergleich, ob das ein v2-spezifisches Problem ist oder die Bearbeitung nicht
    // gespeichert wurde.
    const token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
    const v1Url = `https://rp-energietechnik.pipedrive.com/api/v1/persons/${personId}?api_token=${encodeURIComponent(token)}`;
    const v1Response = UrlFetchApp.fetch(v1Url, { muteHttpExceptions: true });
    const v1Data = JSON.parse(v1Response.getContentText());
    if (v1Data.success && v1Data.data) {
      Logger.log(`  [v1] Adresse=${JSON.stringify(v1Data.data[ADRESSE_FIELD_KEY])}`);
      Logger.log(`  [v1] PLZ=${JSON.stringify(v1Data.data[PLZ_FIELD_KEY])}`);
    } else {
      Logger.log(`  [v1] Abruf fehlgeschlagen: ${v1Response.getContentText().substring(0, 150)}`);
    }
  });
}

/**
 * Korrektur nach v2-Bug (21.08.2026): nach Neuspeichern der Adresse per Autocomplete in der
 * Pipedrive-UI zeigen v1-API und UI selbst die korrekte Adresse -- v2 blieb aber >30 Min. auf dem
 * alten postal_code/formatted_address hängen (siehe zeigeAdressUndPlzFeldName()-Gegenprobe). Da
 * DocGeneration.js über v2 liest, schreibt ein Doc-Neubau sonst wieder die falsche PLZ rein.
 * Umgeht den kaputten UI->v2-Sync, indem der korrigierte Adress-Objekt-Wert direkt per v2-PATCH
 * gesetzt wird (nur postal_code + formatted_address geändert, Rest 1:1 aus dem zuletzt gelesenen
 * v2-Stand übernommen). NICHT allgemein für andere Deals verwenden -- nur für diese 2, deren
 * korrekter Zielwert durch Valentins Bestätigung (Linz 4020 / Feldbach 8330) bekannt ist.
 */
function korrigierePlzInAdressfeldV2() {
  const korrekturen = [
    {
      personId: 4967, name: 'Mehmet Ünsal',
      adresse: {
        value: 'Türkenstraße 11, Linz-Land, Österreich', subpremise: '', street_number: '11',
        route: 'Türkenstraße', sublocality: '', locality: '', admin_area_level_1: 'Oberösterreich',
        admin_area_level_2: 'Linz-Land', country: 'Österreich',
        postal_code: '4020', formatted_address: 'Türkenstraße 11, 4020, Österreich'
      }
    },
    {
      personId: 5797, name: 'Harald Lamprecht',
      adresse: {
        value: 'Pertlstein 82, 8330 Feldbach, Österreich', subpremise: '', street_number: '82',
        route: 'Pertlstein', sublocality: '', locality: 'Feldbach', admin_area_level_1: 'Steiermark',
        admin_area_level_2: 'Südoststeiermark', country: 'Österreich',
        postal_code: '8330', formatted_address: 'Pertlstein 82, 8330 Feldbach, Österreich'
      }
    }
  ];

  korrekturen.forEach(k => {
    const result = patchPipedrive(`persons/${k.personId}`, { custom_fields: { [ADRESSE_FIELD_KEY]: k.adresse } });
    const zurueck = result && result.custom_fields && result.custom_fields[ADRESSE_FIELD_KEY];
    const ok = zurueck && String(zurueck.postal_code) === k.adresse.postal_code;
    Logger.log(`Person ${k.personId} (${k.name}): ${ok ? '✓ korrigiert, postal_code jetzt ' + zurueck.postal_code : '✗ NICHT angekommen: ' + JSON.stringify(zurueck)}`);
  });
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
    DOKU_STATUS_FIELD_KEY, DOKU_STATUS_OPTION_TRIGGER, DOKU_STATUS_OPTION_DONE, DOKU_STATUS_OPTION_NEU_ERSTELLEN, DOKU_LINK_FIELD_KEY,
    NOTIZEN_INTERN_FIELD_KEY, NETZANSUCHEN_FIELD_KEY, DACHFORM_FIELD_KEY, EINDECKUNG_FIELD_KEY,
    AUSRICHTUNG_FIELD_KEY, DC_TERMIN_FIELD_KEY, AC_TERMIN_FIELD_KEY, IB_TERMIN_FIELD_KEY,
    DC_KABELWEG_FIELD_KEY, AC_KABELWEG_FIELD_KEY, ORT_VERTEILER_FIELD_KEY,
    ANLAGENDETAILS_FIELD_KEY, LIEFERTERMIN_FIELD_KEY, NOTIZEN_KUNDE_FIELD_KEY
  };
  Object.entries(configWerte).forEach(([name, wert]) => {
    if (String(wert).startsWith('TODO_')) probleme.push(`${name} ist noch nicht ausgefüllt (${wert})`);
  });

  // Die API-Prüfungen laufen IMMER, auch wenn oben schon ein TODO offen ist. Vorher hing der ganze
  // Block an "probleme.length === 0" -- ein einziger offener Platzhalter hat damit genau die
  // Prüfungen abgeschaltet, für die diese Funktion existiert (Feld-Existenz, Options-IDs, field_type).
  // Einzelne Werte, die noch ein TODO sind, werden unten übersprungen statt doppelt gemeldet.
  const istTodo = wert => String(wert).startsWith('TODO_');
  {
    const fieldsResponse = fetchPipedriveRaw('dealFields?limit=500');
    const fields = fieldsResponse.data || [];
    // Ohne diesen Check würde ein abgeschnittenes Ergebnis real existierende Felder als
    // "existiert nicht (mehr)" melden -- Fehlalarm statt Fehlerfund.
    if (fieldsResponse.additional_data && fieldsResponse.additional_data.next_cursor) {
      probleme.push('dealFields ist auf 500 Einträge abgeschnitten (next_cursor vorhanden) -- die Feld-Prüfungen unten sind unvollständig, Pagination nachrüsten');
    }
    const byCode = Object.fromEntries(fields.map(f => [f.field_code, f]));

    const statusFeld = byCode[DOKU_STATUS_FIELD_KEY];
    if (!statusFeld) {
      probleme.push(`DOKU_STATUS_FIELD_KEY "${DOKU_STATUS_FIELD_KEY}" existiert nicht (mehr) in dealFields`);
    } else {
      Logger.log(`Status-Feld "${statusFeld.field_name}" hat field_type "${statusFeld.field_type}".`);
      // Nur "enum" ist zulässig: dieses Script schreibt einen einzelnen numerischen Wert.
      // "set" (Mehrfachauswahl) erwartet ein Array und würde den Skalar still verwerfen (200 ohne
      // Wirkung); "autocomplete" hat trotz Options-Liste den Text-Label als Wert -- genau der
      // Typfehler, der hier am 17.08. schon einmal als Pipedrive-400 zugeschlagen hat.
      if (statusFeld.field_type !== 'enum') {
        probleme.push(
          `DOKU_STATUS_FIELD_KEY ist field_type "${statusFeld.field_type}", nicht "enum" -- ` +
          `dieses Script schreibt die numerische Options-ID (${DOKU_STATUS_OPTION_DONE}). ` +
          `Bei "autocomplete" muss der Label-String geschrieben werden, bei "set" ein Array -- sonst 200 ohne Wirkung.`
        );
      }
      const optionIds = (statusFeld.options || []).map(o => String(o.id));
      const pruefeOption = (name, wert) => {
        if (istTodo(wert)) return; // schon oben als "nicht ausgefüllt" gemeldet
        if (!optionIds.includes(String(wert))) probleme.push(`${name} "${wert}" ist keine gültige Options-ID von "${statusFeld.field_name}" (gültig: ${optionIds.join(', ')})`);
      };
      pruefeOption('DOKU_STATUS_OPTION_TRIGGER', DOKU_STATUS_OPTION_TRIGGER);
      pruefeOption('DOKU_STATUS_OPTION_DONE', DOKU_STATUS_OPTION_DONE);
      pruefeOption('DOKU_STATUS_OPTION_NEU_ERSTELLEN', DOKU_STATUS_OPTION_NEU_ERSTELLEN);
    }

    const linkFeld = byCode[DOKU_LINK_FIELD_KEY];
    if (!linkFeld) {
      probleme.push(`DOKU_LINK_FIELD_KEY "${DOKU_LINK_FIELD_KEY}" existiert nicht (mehr) in dealFields`);
    } else {
      Logger.log(`Link-Feld "${linkFeld.field_name}" hat field_type "${linkFeld.field_type}".`);
    }
    if (!byCode[KUNDENORDNER_LINK_FIELD_KEY]) probleme.push(`KUNDENORDNER_LINK_FIELD_KEY "${KUNDENORDNER_LINK_FIELD_KEY}" existiert nicht (mehr) in dealFields -- Feld evtl. in Ordnererstellung-bei-Gewonnen geändert`);

    // --- Netzstatus: geteiltes Feld mit Fortschritt-Script/Sheet-Sync, IDs von dort übernommen ---
    const netzstatusFeld = byCode[NETZSTATUS_FIELD_KEY];
    if (!netzstatusFeld) {
      probleme.push(`NETZSTATUS_FIELD_KEY "${NETZSTATUS_FIELD_KEY}" existiert nicht (mehr) in dealFields`);
    } else {
      if (netzstatusFeld.field_type !== 'enum') {
        probleme.push(`NETZSTATUS_FIELD_KEY ist field_type "${netzstatusFeld.field_type}", nicht "enum" -- dieses Script schreibt die numerische Options-ID (${NETZSTATUS_UEBERGEBEN}).`);
      }
      const netzstatusOptionIds = (netzstatusFeld.options || []).map(o => String(o.id));
      if (!netzstatusOptionIds.includes(String(NETZSTATUS_OFFEN))) probleme.push(`NETZSTATUS_OFFEN "${NETZSTATUS_OFFEN}" ist keine gültige Options-ID von "${netzstatusFeld.field_name}" (gültig: ${netzstatusOptionIds.join(', ')})`);
      if (!netzstatusOptionIds.includes(String(NETZSTATUS_UEBERGEBEN))) probleme.push(`NETZSTATUS_UEBERGEBEN "${NETZSTATUS_UEBERGEBEN}" ist keine gültige Options-ID von "${netzstatusFeld.field_name}" (gültig: ${netzstatusOptionIds.join(', ')})`);
    }

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

    // --- Person-Felder (Adresse/PLZ für den Doc-Kopf) ---
    // Stehen in personFields, nicht in dealFields. Ohne diese Prüfung stünde im Kopf der
    // Partner-Doku nach einer Feld-Umbenennung still "(leer)" -- genau die Fehlerklasse, die
    // diese Funktion sonst abfängt.
    const personFieldsResponse = fetchPipedriveRaw('personFields?limit=500');
    const personByCode = Object.fromEntries((personFieldsResponse.data || []).map(f => [f.field_code, f]));
    if (personFieldsResponse.additional_data && personFieldsResponse.additional_data.next_cursor) {
      probleme.push('personFields ist auf 500 Einträge abgeschnitten -- Adress-/PLZ-Prüfung unvollständig');
    }
    if (!personByCode[ADRESSE_FIELD_KEY]) probleme.push(`ADRESSE_FIELD_KEY "${ADRESSE_FIELD_KEY}" existiert nicht (mehr) in personFields -- Adresse im Doc-Kopf bliebe leer`);
    if (!personByCode[PLZ_FIELD_KEY]) probleme.push(`PLZ_FIELD_KEY "${PLZ_FIELD_KEY}" existiert nicht (mehr) in personFields`);
  }

  if (probleme.length > 0) {
    Logger.log(`checkConfiguration: ${probleme.length} Problem(e):\n` + probleme.join('\n'));
  } else {
    Logger.log('checkConfiguration: alles passt.');
  }
  return probleme;
}

/** Für Einzeltests: eine Liste bekannter Deals durchlaufen lassen (Deal-IDs unten anpassen). Der
 *  ▷-Button im Editor ruft ohne Argumente auf -- deshalb Konstante statt Funktionsparameter.
 *  forceRegenerate=true pro Eintrag simuliert den Status "Projektdoku neu erstellen" (altes Doc wird
 *  verworfen und mit dem aktuellen Feldstand komplett neu gebaut). */
function testEinzelDeal() {
  starteLauf('testEinzelDeal');
  // Doc-Neubau (21.08.) für Ünsal (5142) + Lamprecht (6037), NACHDEM korrigierePlzInAdressfeldV2()
  // die per v2-Bug hängengebliebene falsche PLZ im Adresse-Feld direkt korrigiert hat -- ihr Doc vom
  // vorigen Lauf zeigt noch die alte falsche Adresse. forceRegenerate:true wirft das alte Doc weg
  // und baut mit dem jetzigen (korrigierten) Feldstand neu.
  const testDeals = [
    5142, 6037
  ].map(dealId => ({ dealId, forceRegenerate: true }));
  try {
    testDeals.forEach(({ dealId, forceRegenerate }) => {
      if (!dealId) return; // noch nicht ausgefüllte Zeile -- "deals/0" wäre nur ein 4xx
      // Pro Deal fangen: ohne das reißt der erste Fehler (Tippfehler in der ID, gelöschter Deal)
      // die restlichen Test-Deals mit, obwohl die unabhängig voneinander sind.
      try {
        const deal = fetchPipedrive(`deals/${dealId}`);
        const result = processDeal(deal, forceRegenerate);
        logRow(deal.id, deal.title, result.kunde, result.status, result.docUrl, result.completeness, result.detail);
        Logger.log(`Deal ${dealId}: ${JSON.stringify(result)}`);
      } catch (e) {
        logRow(dealId, null, null, 'HARD_ERROR', null, null, e.message);
        Logger.log(`Deal ${dealId}: HARD_ERROR -- ${e.message}`);
      }
    });
  } finally {
    flushLog();
  }
}
