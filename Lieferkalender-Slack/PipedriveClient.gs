// ============================================================
// PIPEDRIVE — Deals der Pipeline 2 holen, plus PLZ aus den Personen
// ============================================================
// Muster uebernommen aus Fortschritt-Script/Code.gs:92-101 (Cursor-Pagination,
// weicher Ausstieg). Wichtig: der Listen-Endpoint liefert custom_fields schon
// mit — kein Call pro Deal.

function fetchPipedriveJson(pfad, params) {
  const alle = Object.assign({}, params || {});
  const url = PIPEDRIVE_BASE + pfad + '?' + toQueryString(alle);
  const token = getPipedriveToken();  // vor die Schleife: fehlendes Token ist kein Netzwerkfehler
  for (let versuch = 1; versuch <= 3; versuch++) {
    // NETZWERKFEHLER-RETRY (15.09.2026): muteHttpExceptions deckt nur HTTP-Statuscodes ab.
    // Bei Zeitueberschreitung wirft UrlFetchApp.fetch() selbst ("Exception: Timeout: <url>"),
    // noch bevor es eine Response gibt -- das lief an der Statuscode-Pruefung vorbei und riss
    // den ganzen Lauf ab (zuerst am 11.09.2026 in Sheet-Sync/syncNeueZeilen()).
    // POST-Aufrufe, die etwas ANLEGEN, werden bewusst NICHT wiederholt: ein Timeout heisst
    // nicht, dass die Gegenseite es nicht doch ausgefuehrt hat -- das Retry waere ein Duplikat.
    // Hier ausnahmslos GET -- dieses Projekt schreibt nie nach Pipedrive, ein Retry ist gefahrlos.
    let response;
    try {
      response = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { 'x-api-token': token },
        muteHttpExceptions: true
      });
    } catch (e) {
      if (versuch === 3) throw new Error('Pipedrive-Netzwerkfehler bei ' + pfad + ': ' + e.message);
      Utilities.sleep(versuch * 2000);
      continue;
    }
    const code = response.getResponseCode();
    if (code === 429 || code >= 500) {
      if (versuch === 3) throw new Error('Pipedrive ' + code + ' bei ' + pfad + ' nach 3 Versuchen.');
      Utilities.sleep(versuch * 2000); // 2s, 4s
      continue;
    }
    const json = JSON.parse(response.getContentText());
    if (code !== 200 || json.success === false) {
      throw new Error('Pipedrive-Fehler ' + code + ' bei ' + pfad + ': ' + response.getContentText().slice(0, 300));
    }
    return json;
  }
}

// Alle nicht-archivierten Deals der Fulfillment-Pipeline.
// ⚠️ KEIN status-Parameter. v2 kennt nur open|won|lost|deleted; "all_not_deleted"
// wirft HTTP 400. Und status:"won" wird bei RP schon bei der Anlage gesetzt
// (Origin Marketplace/Zapier) — es traegt kein Liefersignal und darf nicht
// filtern, sonst fallen Deals lautlos raus (Befund D20).
function holeFulfillmentDeals() {
  const start = Date.now();
  const deals = [];
  let cursor = null;
  do {
    if (Date.now() - start > MAX_LAUFZEIT_MS) {
      Logger.log('⚠️ Zeitlimit beim Deal-Abruf nach %s Deals — Lauf wird abgebrochen, damit kein halber Snapshot geschrieben wird.', deals.length);
      throw new Error('Zeitlimit beim Deal-Abruf. Lauf abgebrochen (Snapshot unveraendert).');
    }
    const params = { pipeline_id: PIPELINE_ID, limit: 100, include_option_labels: true };
    if (cursor) params.cursor = cursor;
    const json = fetchPipedriveJson('/deals', params);
    (json.data || []).forEach(function (d) { deals.push(d); });
    cursor = json.additional_data && json.additional_data.next_cursor;
  } while (cursor);
  return deals;
}

// Die PLZ haengt an der Person, nicht am Deal. Ein Bulk-Sweep ueber /persons
// baut die Map person_id -> { plzFeld, plzAdresse } — deutlich guenstiger als
// ein Call pro Deal.
function holePersonenPlzMap() {
  const map = {};
  let cursor = null;
  do {
    // limit 500 statt 100: RP hat ~7000 Personen, das sind 14 Calls statt 70 —
    // und zwar bei JEDEM Lauf. Beim 15-Minuten-Trigger ist das der Unterschied
    // zwischen 1.344 und 6.720 Calls am Tag, und zwischen ~4 s und ~20 s
    // Laufzeit. 500 ist das v2-Maximum fuer Listen-Endpunkte.
    const params = { limit: 500 };
    if (cursor) params.cursor = cursor;
    const json = fetchPipedriveJson('/persons', params);
    (json.data || []).forEach(function (p) {
      const cf = p.custom_fields || {};
      const adresse = cf[PERSON_ADRESSE_FIELD_KEY];
      map[p.id] = {
        plzFeld: normalisierePlz(cf[PERSON_PLZ_FIELD_KEY]),
        plzAdresse: normalisierePlz(plzAusAdressfeld(adresse)),
        // Name und Telefon kommen im selben Abruf mit — kein zusaetzlicher
        // Call. Gebraucht fuer die CT-Kundenerinnerung ({vorname}, {walink}).
        vorname: String(p.first_name || '').trim(),
        nachname: String(p.last_name || '').trim(),
        telefon: primaereNummer(p.phones)
      };
    });
    cursor = json.additional_data && json.additional_data.next_cursor;
  } while (cursor);
  return map;
}

// Address-Custom-Fields liefern ein Objekt mit Subfeldern (postal_code,
// locality, formatted_address, value). Die Subfelder sind nur befuellt, wenn die
// Adresse per Google-Maps-Autocomplete angelegt wurde; bei freier Texteingabe
// steht alles in value. Beide Faelle abdecken
// (REFERENZ-Pipedrive-AppsScript.md, Abschnitt Address-Custom-Fields).
function plzAusAdressfeld(adresse) {
  if (!adresse) return null;
  if (typeof adresse === 'string') return ersteViererZahl(adresse);
  if (adresse.postal_code) return adresse.postal_code;
  return ersteViererZahl(adresse.formatted_address || adresse.value || '');
}

function ersteViererZahl(text) {
  const treffer = /\b(\d{4})\b/.exec(String(text));
  return treffer ? treffer[1] : null;
}

// Person-Telefon heisst in v2 "phones" (Array mit value/label/primary), nicht
// mehr "phone" wie in v1 — verifiziert im Projekt Telefon-Qualifizierung.
// primary gewinnt, sonst der erste Eintrag mit Inhalt.
function primaereNummer(phones) {
  if (!phones || !phones.length) return '';
  for (let i = 0; i < phones.length; i++) {
    if (phones[i] && phones[i].primary && phones[i].value) return String(phones[i].value).trim();
  }
  for (let i = 0; i < phones.length; i++) {
    if (phones[i] && phones[i].value) return String(phones[i].value).trim();
  }
  return '';
}

function normalisierePlz(wert) {
  if (wert === null || wert === undefined || wert === '') return null;
  const nurZiffern = String(wert).replace(/\D/g, '');
  // Im PLZ-Feld stand schon eine Telefonnummer (REFERENZ, Abschnitt Logging).
  // Alles, was keine 4-stellige oesterreichische PLZ ist, gilt als unbrauchbar.
  return nurZiffern.length === 4 ? nurZiffern : null;
}

// Ein Datumsfeld liefert entweder "2026-09-14" oder null. Kein Zeitzonenthema,
// solange nicht in ein Date-Objekt umgewandelt wird — deshalb bleibt es String.
function leseTerminfeld(deal, feldName) {
  // Pseudo-Feld: das Datum steht nicht am Deal, sondern in einer Activity.
  // _ctMapAktuell setzt sweep() einmal pro Lauf (siehe CtTermine.gs).
  if (feldName === CT_PSEUDO_FELD) {
    const ct = ctFuerDeal(_ctMapAktuell, deal);
    return ct ? ct.datum : '';
  }
  const key = TERMIN_FELDER[feldName];
  const wert = (deal.custom_fields || {})[key];
  if (!wert) return '';
  return String(wert).slice(0, 10);
}

function leseMontagepartner(deal) {
  const wert = (deal.custom_fields || {})[MONTAGEPARTNER_FIELD_KEY];
  if (!wert) return '';
  if (typeof wert === 'object' && wert.label) return wert.label;
  return MONTAGEPARTNER_LABELS[Number(wert)] || String(wert);
}

function leseKundenordner(deal) {
  const wert = (deal.custom_fields || {})[KUNDENORDNER_FIELD_KEY];
  return wert ? String(wert) : '';
}
