// ============================================================================
// DATEI 4 von 4: Zuordnungspruefung.gs  —  NUR LESEN, schreibt NIE nach Pipedrive
// ============================================================================
//
// ZWECK: nachträglich prüfen, ob die per Namensabgleich geschriebenen Artikel-Daten wirklich
// zum richtigen Kunden gehören. Das Namensmatching in syncPerNameVormatching() vergleicht
// AUSSCHLIESSLICH den Personennamen (String-Gleichheit) -- es prüft nie Adresse, Auftragsstatus
// oder Auftragssumme. Diese Datei liefert genau diese unabhängigen Gegenproben, damit man 26
// Zeilen in der Tabelle durchschauen kann statt 26 Deals einzeln in zwei Systemen aufzumachen.
//
// WICHTIG: hier werden fest die PAARE geprüft, die laut Sync-Log tatsächlich geschrieben wurden --
// NICHT das Matching neu ausgeführt. Ein neuer Matching-Lauf würde denselben möglichen Fehler
// nur wiederholen und wieder "passt" sagen.
//
// Konstanten sind absichtlich mit AUDIT_ geprefixt -- gleichnamige const in zwei Dateien desselben
// Apps-Script-Projekts verhindern den Start des ganzen Projekts (siehe CLAUDE.md).
// ============================================================================

const AUDIT_TAB = 'Zuordnungs-Audit';
const AUDIT_PLZ_TOLERANZ_PROZENT = 10;   // erlaubte Abweichung Deal-Wert <-> Auftragssumme

// --- Gruppe A: am 21.08.2026 09:23-09:24 LIVE geschrieben (Status SUCCESS im Sync-Log),
//     gematcht ausschließlich über den Personennamen. Das ist die Gruppe mit Risiko.
const AUDIT_PAARE_GESCHRIEBEN = [
  { deal: 6970, order: '2026-507-A' }, { deal: 5587, order: '2026-62-A'  },
  { deal: 6694, order: '2026-383-A' }, { deal: 5779, order: '2026-418-A' },
  { deal: 5984, order: '2026-255-A' }, { deal: 6659, order: '2026-359-A' },
  { deal: 6084, order: '2026-370-A' }, { deal: 5837, order: '2026-399-A' },
  { deal: 6686, order: '2026-420-A' }, { deal: 6804, order: '2026-463-A' },
  { deal: 5867, order: '2026-491-A' }, { deal: 6971, order: '2026-505-A' },
  { deal: 6843, order: '2026-545-A' }, { deal: 7096, order: '2026-565-A' },
  { deal: 7129, order: '2026-571-A' }, { deal: 5728, order: '2026-346-A' },
  { deal: 6179, order: '2026-356-A' }, { deal: 6738, order: '2026-452-A' },
  { deal: 7177, order: '2026-575-A' }, { deal: 6018, order: '2026-589-A' },
  { deal: 5663, order: '2026-550-A' }  // Override-Fall: Auftrag läuft auf "Johanna Seitz"
];

// --- Gruppe B: Angebotsnummer wurde von setzeBekannteAngebotsnummernUndSync() bereits in den Deal
//     geschrieben (der PATCH dort läuft ungeachtet DRY_RUN!), die Artikel-Felder aber noch NICHT
//     (im Sync-Log nur DRY_RUN vom 21.08. 08:58). Vor dem Scharfschalten hier mitprüfen -- eine
//     falsche Angebotsnummer im Deal ist besonders heikel, weil der 15-Min-Poller sie später als
//     harten Matching-Schlüssel benutzt.
const AUDIT_PAARE_NUR_ANGEBOTSNUMMER = [
  { deal: 6219, order: '2026-470-A' }, { deal: 7059, order: '2026-536-A' },
  { deal: 5307, order: '2026-535-A' }, { deal: 6493, order: '2026-554-A' },
  { deal: 6771, order: '2026-425-A' }
];

// --- Gruppe C: 2. Runde Namensabgleich (21.08.2026 14:48-14:50 LIVE geschrieben, Status
//     "direkt beschrieben" im Sync-Log) -- die 27 Deals aus syncPerNameVormatchingMassentransfer().
//     Neun davon hatten in dem Lauf MEHRERE Order-Revisionen desselben Kontakts (6207, 4945, 5237,
//     5530, 5972, 6037, 6198, 6593, 4876) -- also genau die Fälle, wo "neueste genommen" nur nach
//     update-Timestamp entscheidet, ohne orderType/Status zu prüfen. Diese Gruppe ist der Grund für
//     den Re-Check: das Flag "Kontakt hat X Aufträge -- neuester wurde geraten" unten macht sichtbar,
//     ob Adresse/Geld/Status bei genau diesen 9 trotzdem passen.
const AUDIT_PAARE_GESCHRIEBEN_RUNDE2 = [
  { deal: 6207, order: '2026-357-A' },  { deal: 7071, order: '2026-322-A' },
  { deal: 7072, order: '2026-342-A' },  { deal: 7186, order: '2026-597-A' },
  { deal: 7282, order: '2026-608-A' },  { deal: 7334, order: '2026-609-A' },
  { deal: 4945, order: '2025-1616-A' }, { deal: 5142, order: '2025-1704-A' },
  { deal: 5237, order: '2026-97-A'  },  { deal: 5373, order: '2025-1853-A' },
  { deal: 5530, order: '2025-2054-A' }, { deal: 5749, order: '2025-2101-A' },
  { deal: 5758, order: '2026-617-A' },  { deal: 5829, order: '2026-37-A'  },
  { deal: 5972, order: '2026-480-A' },  { deal: 6006, order: '2026-323-A' },
  { deal: 6013, order: '2026-231-A' },  { deal: 6027, order: '2026-113-A' },
  { deal: 6037, order: '2026-429-A' },  { deal: 6198, order: '2026-54-A'  },
  { deal: 6326, order: '2026-340-A' },  { deal: 6454, order: '2026-317-A' },
  { deal: 6592, order: '2026-449-A' },  { deal: 6593, order: '2026-331-A' },
  { deal: 6952, order: '2026-488-A' },  { deal: 4876, order: '2026-321-A' },
  { deal: 6439, order: '2026-318-A' }
];

// ============================================================================
// HILFSFUNKTIONEN
// ============================================================================

/**
 * Lädt EINMAL alle sevdesk-Aufträge mit allen für die Gegenprobe nötigen Feldern und baut zwei
 * Indizes: nach Angebotsnummer und nach contact.id. Ein einziger Vollscan für alle 26 Zeilen --
 * kein Abruf pro Deal (N+1-Regel aus CLAUDE.md).
 *
 * Die Feldnamen address/status/sumGross/sumNet/orderDate/orderType sind NICHT live verifiziert
 * (anders als addressName/contact/update, die im Produktivbetrieb bestätigt sind). Deshalb wird
 * jedes davon defensiv gelesen; was fehlt, erscheint in der Tabelle als "(n/a)" statt den Lauf
 * abzubrechen. debugOrderFelder() unten zeigt die echten Feldnamen eines Auftrags.
 */
function auditLadeAlleAuftraege() {
  const alle = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = sevdeskFetch(`/Order?limit=${limit}&offset=${offset}`);
    if (!data.objects || data.objects.length === 0) break;
    data.objects.forEach(o => {
      alle.push({
        id: o.id,
        orderNumber: o.orderNumber || '',
        addressName: o.addressName || '',
        adresse: String(o.address || '').replace(/\s*\n\s*/g, ', ').trim(),
        orderDate: o.orderDate || '',
        update: o.update || '',
        status: o.status !== undefined && o.status !== null ? String(o.status) : '',
        orderType: o.orderType || '',
        summeBrutto: o.sumGross !== undefined && o.sumGross !== null ? Number(o.sumGross) : null,
        summeNetto: o.sumNet !== undefined && o.sumNet !== null ? Number(o.sumNet) : null,
        contactId: o.contact && o.contact.id ? String(o.contact.id) : ''
      });
    });
    if (data.objects.length < limit) break;
    offset += limit;
    if (offset > 20000) { Logger.log('⚠️ Sicherheitsnetz bei 20000 Aufträgen -- es gibt mehr!'); break; }
  }

  const nachNummer = {};
  const nachKontakt = {};
  const nachName = {};
  alle.forEach(o => {
    if (o.orderNumber) (nachNummer[o.orderNumber] = nachNummer[o.orderNumber] || []).push(o);
    if (o.contactId)   (nachKontakt[o.contactId]  = nachKontakt[o.contactId]  || []).push(o);
    const n = nameNormalisiert(o.addressName);
    if (n) (nachName[n] = nachName[n] || []).push(o);
  });

  Logger.log(`${alle.length} Aufträge geladen (${Object.keys(nachNummer).length} verschiedene Angebotsnummern, ${Object.keys(nachKontakt).length} Kontakte).`);
  return { alle, nachNummer, nachKontakt, nachName };
}

/** Erste 4-stellige Zahl aus einem Text -- Notfall-PLZ, wenn das PLZ-Feld am Kontakt leer ist. */
function auditPlzAusText(text) {
  const m = String(text || '').match(/\b\d{4}\b/);
  return m ? m[0] : '';
}

/** Kompakte Auftragszeile für die Auflistung "alle Aufträge dieses Kontakts". */
function auditOrderKurz(o) {
  const summe = o.summeBrutto !== null ? `${o.summeBrutto}€` : (o.summeNetto !== null ? `${o.summeNetto}€ netto` : '?€');
  return `${o.orderNumber || o.id} (${o.orderDate ? String(o.orderDate).substring(0, 10) : '?'}, Status ${o.status || '?'}, ${o.orderType || '?'}, ${summe})`;
}

// ============================================================================
// HAUPTFUNKTION: die Gegenprobe
// ============================================================================

/**
 * Prüft für jedes geschriebene Deal/Auftrag-Paar vier voneinander UNABHÄNGIGE Merkmale, die das
 * Namensmatching selbst nie angeschaut hat:
 *   1. Adresse/PLZ  -- steht die PLZ der Pipedrive-Person in der Auftragsadresse?
 *   2. Geld         -- passt der Deal-Wert zur Auftragssumme? (stärkster unabhängiger Beweis)
 *   3. Eindeutigkeit -- trägt der Kontakt mehrere Aufträge / gibt es mehrere Kontakte mit dem Namen?
 *   4. Status       -- ist der zugeordnete Auftrag überhaupt angenommen (500) oder z.B. abgelehnt?
 * Zusätzlich: hat die Person in Pipedrive mehrere Deals? (dann könnten die Daten am falschen hängen)
 *
 * Schreibt NICHTS nach Pipedrive/sevdesk -- nur in den neuen Sheet-Tab "Zuordnungs-Audit".
 */
function pruefeZuordnungAlle() {
  const idx = auditLadeAlleAuftraege();

  const zeilen = [];
  const gruppen = [
    { label: 'GESCHRIEBEN', paare: AUDIT_PAARE_GESCHRIEBEN },
    { label: 'nur Angebotsnr.', paare: AUDIT_PAARE_NUR_ANGEBOTSNUMMER },
    { label: 'GESCHRIEBEN Runde 2', paare: AUDIT_PAARE_GESCHRIEBEN_RUNDE2 }
  ];

  gruppen.forEach(gruppe => {
    gruppe.paare.forEach(paar => {
      const flags = [];

      // --- Pipedrive-Seite
      const dealResp = pipedriveFetch(`/deals/${paar.deal}`, { method: 'get' });
      if (!dealResp.success || !dealResp.data) {
        zeilen.push([gruppe.label, paar.deal, '(Deal nicht lesbar)', '', '', '', paar.order, '', '', '', '', '', '', '', '🔴 Deal nicht abrufbar']);
        return;
      }
      const deal = dealResp.data;
      const cf = deal.custom_fields || {};
      const angebotsnummerImDeal = cf[FIELD_KEYS.sevdesk_angebotsnummer] || '';
      const moduleImDeal = cf[FIELD_KEYS.Module_Anzahl];

      const personRef = deal.person_id;
      const personId = personRef && (personRef.value || personRef);
      let personName = '', personAdresse = '', personPlz = '', andereDeals = '';
      if (personId) {
        const pResp = pipedriveFetch(`/persons/${personId}`, { method: 'get' });
        if (pResp.success && pResp.data) {
          personName = pResp.data.name || '';
          personAdresse = holeAdresseFuerLog(pResp.data);
          const plzFeld = (pResp.data.custom_fields || {})[PLZ_FIELD_KEY];
          personPlz = plzFeld ? String(plzFeld) : auditPlzAusText(personAdresse);
        }
        // Hat die Person mehrere Deals? Dann kann der Namensabgleich die Artikel-Daten am
        // falschen Deal derselben Person abgelegt haben (Fall Mario Messiha 6591/7107).
        const dealsResp = pipedriveFetch(`/deals?person_id=${personId}&limit=100`, { method: 'get' });
        const dealsDerPerson = (dealsResp.success && dealsResp.data) ? dealsResp.data : [];
        if (dealsDerPerson.length > 1) {
          andereDeals = dealsDerPerson.map(d => `${d.id}/${d.status}`).join(' ');
          flags.push(`🟡 Person hat ${dealsDerPerson.length} Deals`);
        }
      } else {
        flags.push('🔴 keine Person am Deal');
      }

      // --- sevdesk-Seite
      const kandidaten = idx.nachNummer[paar.order] || [];
      if (kandidaten.length === 0) {
        zeilen.push([gruppe.label, paar.deal, deal.title || '', personName, personAdresse, deal.value || '',
                     paar.order, '(Auftrag nicht gefunden)', '', '', '', '', '', andereDeals,
                     '🔴 Angebotsnummer existiert in sevdesk nicht (mehr)']);
        return;
      }
      if (kandidaten.length > 1) flags.push(`🔴 ${kandidaten.length} Aufträge mit derselben Angebotsnummer`);
      const order = kandidaten[0];

      // --- Gegenprobe 1: Adresse/PLZ
      if (!personPlz) {
        flags.push('🟡 keine PLZ in Pipedrive -- Adressabgleich nicht möglich');
      } else if (!order.adresse) {
        flags.push('🟡 keine Adresse am sevdesk-Auftrag -- Adressabgleich nicht möglich');
      } else if (order.adresse.indexOf(personPlz) === -1) {
        flags.push(`🔴 PLZ ${personPlz} steht NICHT in der Auftragsadresse`);
      }

      // --- Gegenprobe 2: Geld
      const dealWert = Number(deal.value) || 0;
      const orderSumme = order.summeBrutto !== null ? order.summeBrutto : order.summeNetto;
      if (!dealWert) {
        flags.push('🟡 Deal-Wert 0/leer -- Geldabgleich nicht möglich');
      } else if (orderSumme === null || !orderSumme) {
        flags.push('🟡 keine Auftragssumme -- Geldabgleich nicht möglich');
      } else {
        const abweichung = Math.abs(dealWert - orderSumme) / Math.max(dealWert, orderSumme) * 100;
        if (abweichung > AUDIT_PLZ_TOLERANZ_PROZENT) {
          flags.push(`🔴 Wert weicht ${abweichung.toFixed(0)}% ab (Deal ${dealWert} vs. Auftrag ${orderSumme})`);
        }
      }

      // --- Gegenprobe 3: Eindeutigkeit
      const alleDesKontakts = idx.nachKontakt[order.contactId] || [];
      if (alleDesKontakts.length > 1) {
        flags.push(`🟡 Kontakt hat ${alleDesKontakts.length} Aufträge -- "neuester" wurde geraten`);
      }
      const gleichnamige = idx.nachName[nameNormalisiert(order.addressName)] || [];
      const gleichnamigeKontakte = [...new Set(gleichnamige.map(o => o.contactId))];
      if (gleichnamigeKontakte.length > 1) {
        flags.push(`🔴 ${gleichnamigeKontakte.length} verschiedene sevdesk-Kontakte heißen "${order.addressName}"`);
      }
      if (personName && nameNormalisiert(personName) !== nameNormalisiert(order.addressName)) {
        flags.push(`🟡 Name abweichend: Pipedrive "${personName}" vs. sevdesk "${order.addressName}"`);
      }

      // --- Gegenprobe 4: Status
      if (order.status && order.status !== String(SEVDESK_STATUS_ANGENOMMEN)) {
        flags.push(`🟡 Auftragsstatus ${order.status} (nicht 500/Angenommen)`);
      }

      // --- Konsistenz Deal <-> Log
      if (angebotsnummerImDeal && angebotsnummerImDeal !== paar.order) {
        flags.push(`🔴 Deal trägt jetzt Angebotsnummer "${angebotsnummerImDeal}", laut Log geschrieben wurde "${paar.order}"`);
      }
      if (gruppe.label.indexOf('GESCHRIEBEN') === 0 && (moduleImDeal === null || moduleImDeal === undefined)) {
        flags.push('🟡 Module_Anzahl im Deal leer, obwohl Log SUCCESS meldet');
      }

      zeilen.push([
        gruppe.label, paar.deal, deal.title || '', personName, personAdresse, dealWert,
        paar.order, order.addressName, order.adresse || '(n/a)',
        order.orderDate ? String(order.orderDate).substring(0, 10) : '(n/a)',
        order.status || '(n/a)', orderSumme === null ? '(n/a)' : orderSumme,
        alleDesKontakts.length, alleDesKontakts.map(auditOrderKurz).join(' | '),
        andereDeals,
        flags.length ? flags.join(' || ') : '✓ keine Auffälligkeit'
      ]);

      Logger.log(`Deal ${paar.deal} (${personName}) <- ${paar.order} (${order.addressName}): ${flags.length ? flags.join(' || ') : 'OK'}`);
    });
  });

  auditSchreibeTabelle(zeilen);

  const rot = zeilen.filter(z => String(z[z.length - 1]).indexOf('🔴') > -1).length;
  const gelb = zeilen.filter(z => String(z[z.length - 1]).indexOf('🟡') > -1 && String(z[z.length - 1]).indexOf('🔴') === -1).length;
  Logger.log(`\n=== ERGEBNIS: ${zeilen.length} Paare geprüft -- 🔴 ${rot} kritisch, 🟡 ${gelb} zu prüfen, ✓ ${zeilen.length - rot - gelb} sauber ===`);
  Logger.log(`Details im Tab "${AUDIT_TAB}" des Sync-Log-Sheets.`);
}

/** Legt den Audit-Tab an (bzw. leert ihn) und schreibt alles in EINEM setValues(). */
function auditSchreibeTabelle(zeilen) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(AUDIT_TAB);
  if (!sheet) sheet = ss.insertSheet(AUDIT_TAB);
  sheet.clear();

  const kopf = ['Gruppe', 'Deal_ID', 'Deal_Titel', 'PD_Person', 'PD_Adresse', 'PD_Wert',
                'Angebotsnr', 'sevdesk_Name', 'sevdesk_Adresse', 'Auftragsdatum', 'Status',
                'Auftragssumme', 'Aufträge_Kontakt', 'Alle_Aufträge_des_Kontakts',
                'Andere_Deals_der_Person', 'BEFUND'];
  const daten = [kopf].concat(zeilen);
  sheet.getRange(1, 1, daten.length, kopf.length).setValues(daten);
  sheet.getRange(1, 1, 1, kopf.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

// ============================================================================
// BEGLEIT-FUNKTIONEN
// ============================================================================

/**
 * Zeigt die echten Feldnamen eines sevdesk-Auftrags. Vor pruefeZuordnungAlle() einmal laufen
 * lassen: wenn address/status/sumGross hier anders heißen, stehen in der Audit-Tabelle sonst
 * überall "(n/a)" und die halbe Gegenprobe fällt still aus.
 */
function debugOrderFelder() {
  const data = sevdeskFetch('/Order?limit=1');
  const o = data.objects && data.objects[0];
  if (!o) { Logger.log('Kein Auftrag geladen.'); return; }
  Logger.log('=== Alle Feldnamen eines Auftrags ===');
  Logger.log(Object.keys(o).sort().join(', '));
  Logger.log('\n=== Für das Audit relevante Werte ===');
  ['orderNumber', 'addressName', 'address', 'orderDate', 'update', 'status', 'orderType', 'sumNet', 'sumGross']
    .forEach(f => Logger.log(`${f}: ${JSON.stringify(o[f])}`));
}

/**
 * Bestandsaufnahme über ALLE Deals der Fulfillment-Pipeline: wer hat schon Angebotsnummer und
 * Artikel-Daten, wer nicht. Antwortet auf "sind wirklich alle durch, oder fehlen noch welche" --
 * die 21 geschriebenen kommen aus einer handgepflegten Liste, nicht aus der Pipeline selbst.
 * Pipeline-Name wird zur Laufzeit aufgelöst, nicht hartcodiert vertraut.
 */
function listeFulfillmentDealsStatus() {
  const pipes = pipedriveFetch('/pipelines?limit=100', { method: 'get' });
  const fulfillment = ((pipes.success && pipes.data) || []).find(p => /fulfillment/i.test(p.name || ''));
  if (!fulfillment) { Logger.log('✗ Keine Pipeline mit "Fulfillment" im Namen gefunden.'); return; }
  Logger.log(`Pipeline "${fulfillment.name}" = ID ${fulfillment.id}`);

  const deals = [];
  let cursor = null;
  do {
    const pfad = `/deals?pipeline_id=${fulfillment.id}&limit=100` + (cursor ? `&cursor=${cursor}` : '');
    const resp = pipedriveFetch(pfad, { method: 'get' });
    if (!resp.success) { Logger.log('✗ Deal-Abruf fehlgeschlagen: ' + JSON.stringify(resp).substring(0, 200)); return; }
    (resp.data || []).forEach(d => deals.push(d));
    cursor = resp.additional_data && resp.additional_data.next_cursor ? resp.additional_data.next_cursor : null;
  } while (cursor);

  let mitAllem = 0, nurNummer = 0, leer = 0;
  const offene = [];
  deals.forEach(d => {
    const cf = d.custom_fields || {};
    const nummer = cf[FIELD_KEYS.sevdesk_angebotsnummer];
    const module = cf[FIELD_KEYS.Module_Anzahl];
    if (nummer && module) mitAllem++;
    else if (nummer) { nurNummer++; offene.push(`${d.id} (${d.title}) -- Angebotsnr ${nummer}, aber keine Artikel-Daten`); }
    else { leer++; offene.push(`${d.id} (${d.title}) -- weder Angebotsnr noch Artikel-Daten`); }
  });

  Logger.log(`\n=== ${deals.length} Deals in der Fulfillment-Pipeline ===`);
  Logger.log(`✓ ${mitAllem} vollständig (Angebotsnr + Artikel-Daten)`);
  Logger.log(`◐ ${nurNummer} nur Angebotsnummer`);
  Logger.log(`✗ ${leer} ohne beides`);
  Logger.log('\n=== Noch offen ===');
  offene.forEach(z => Logger.log(z));
}
