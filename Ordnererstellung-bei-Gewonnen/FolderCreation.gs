// ===== KERNLOGIK =====

/**
 * Kompletter Ablauf für einen Deal: Montagepartner ermitteln, Kundenordner im richtigen
 * Partner-Hauptordner anlegen, Link zurück nach Pipedrive schreiben. Gibt Ergebnis-String zurück.
 * DRY_RUN=true: es wird nichts angelegt/geschrieben, nur geloggt was passieren würde.
 */
function processGewonnenDeal(dealId) {
  const deal = fetchPipedrive(`deals/${dealId}`);
  const cf = deal.custom_fields || {};

  if (cf[KUNDENORDNER_LINK_FIELD_KEY]) {
    logRow(dealId, deal.title, null, 'übersprungen', cf[KUNDENORDNER_LINK_FIELD_KEY], 'Ordner-Link bereits gesetzt');
    return 'übersprungen (Ordner-Link bereits gesetzt)';
  }

  const partnerOptionId = cf[MONTAGEPARTNER_FIELD_KEY];
  if (!partnerOptionId) {
    logRow(dealId, deal.title, null, 'übersprungen', null, 'kein Montagepartner gesetzt');
    return 'übersprungen (kein Montagepartner gesetzt)';
  }
  const partner = MONTAGEPARTNER_ID_TO_NAME[partnerOptionId];
  const parentFolderId = PARTNER_TO_DRIVE_FOLDER_ID[partner];
  if (!parentFolderId || parentFolderId.startsWith('TODO_')) {
    logRow(dealId, deal.title, partner, 'übersprungen', null, 'keine Drive-Ordner-ID für diesen Partner konfiguriert (Config.gs)');
    return `übersprungen (Drive-Ordner-ID für "${partner}" fehlt in Config.gs)`;
  }

  if (!deal.person_id) {
    logRow(dealId, deal.title, partner, 'übersprungen', null, 'Deal hat keine verknüpfte Person');
    return 'übersprungen (keine verknüpfte Person)';
  }
  const person = fetchPipedrive(`persons/${deal.person_id}`);
  const name = person.name || deal.title || `Deal ${dealId}`;
  const adrObj = person.custom_fields?.[ADRESSE_FIELD_KEY];
  const adresse = adrObj?.formatted_address || adrObj?.value || '';
  const ordnerName = adresse ? `${name} - ${adresse}` : name;

  if (DRY_RUN) {
    logRow(dealId, deal.title, partner, 'DRY-RUN', null, `würde Ordner "${ordnerName}" in Partnerordner ${parentFolderId} anlegen`);
    return `DRY-RUN: würde Ordner "${ordnerName}" bei Partner "${partner}" anlegen`;
  }

  const parentFolder = DriveApp.getFolderById(parentFolderId);

  // Sicherheitscheck: existiert der Ordner schon? (z.B. bei erneutem Webhook-Aufruf)
  const vorhandene = parentFolder.getFoldersByName(ordnerName);
  let kundenOrdner;
  if (vorhandene.hasNext()) {
    kundenOrdner = vorhandene.next();
  } else {
    kundenOrdner = parentFolder.createFolder(ordnerName);
    KUNDEN_UNTERORDNER_NAMEN.forEach(unterName => kundenOrdner.createFolder(unterName));
  }

  const ordnerLink = kundenOrdner.getUrl();
  patchPipedrive(`deals/${dealId}`, { custom_fields: { [KUNDENORDNER_LINK_FIELD_KEY]: ordnerLink } });

  logRow(dealId, deal.title, partner, 'angelegt', ordnerLink, '');
  return `angelegt: ${ordnerLink}`;
}
