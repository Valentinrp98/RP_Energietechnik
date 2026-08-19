// ===== KERNLOGIK =====

/**
 * Kompletter Ablauf für einen Deal: Montagepartner ermitteln, Kundenordner im richtigen
 * Partner-Hauptordner anlegen, Link zurück nach Pipedrive schreiben. Gibt Ergebnis-String zurück.
 * DRY_RUN=true: es wird nichts angelegt/geschrieben, nur geloggt was passieren würde.
 */
function processGewonnenDeal(dealId) {
  // LockService: verhindert, dass zwei fast gleichzeitige Webhook-Aufrufe (z.B. zwei Feldänderungen
  // im selben Deal) parallel denselben Ordner doppelt anlegen. Wartet max. 30s auf den Lock,
  // sonst Fehler (besser als stillschweigend doppelt anlegen).
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return processGewonnenDealUnlocked(dealId);
  } finally {
    lock.releaseLock();
  }
}

function processGewonnenDealUnlocked(dealId) {
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
  if (!partner) {
    // Andere Fehlerursache als "TODO nicht ausgefüllt" -- das ist ein echter Konfigurationsfehler
    // (Options-ID aus Pipedrive nicht in MONTAGEPARTNER_OPTION_IDS bekannt, z.B. neue Partner-Option
    // in Pipedrive angelegt, Script nicht aktualisiert). Muss auffallen, nicht wie TODO aussehen.
    logRow(dealId, deal.title, null, 'FEHLER', null, `Montagepartner-Options-ID ${partnerOptionId} unbekannt -- MONTAGEPARTNER_OPTION_IDS in Config.gs veraltet?`);
    return `FEHLER: unbekannte Montagepartner-Options-ID ${partnerOptionId}`;
  }
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
  if (!adresse && adrObj !== undefined) {
    // adrObj existiert, aber weder formatted_address noch value liefern einen String --
    // das Feld hat vermutlich eine andere Struktur als angenommen. Nicht stillschweigend
    // ignorieren, sondern im Log sichtbar machen (mit debugAdressFeld() im Detail prüfbar).
    logRow(dealId, deal.title, partner, 'WARNUNG', null, `Adresse-Feld hat unerwartete Struktur: ${JSON.stringify(adrObj)} -- debugAdressFeld() mit dealId=${dealId} in SetupHelpers.gs ausführen`);
  }
  const plz = person.custom_fields?.[PLZ_FIELD_KEY] || '';
  const adresseMitPlz = [adresse, plz].filter(Boolean).join(', ');
  const ordnerName = adresseMitPlz ? `${name} - ${adresseMitPlz}` : name;

  // Drive-Prüfungen bewusst VOR dem DRY_RUN-Ausstieg: ein DRY-Lauf soll auch Setup-Fehler
  // (Partner-Root nicht erreichbar, "Montage offen" fehlt) aufdecken, nicht nur Schreibvorgänge
  // simulieren. Lesen ist im DRY-Lauf erlaubt, nur Schreiben nicht -- sonst meldet der DRY-Lauf
  // grünes Licht und der scharfe Lauf produziert reihenweise Setup-Fehler.
  const partnerRoot = DriveApp.getFolderById(parentFolderId);

  // "Montage offen" muss im Partner-Root bereits existieren -- wird bewusst nicht automatisch
  // angelegt, ein fehlender Ordner ist ein Setup-Fehler und soll auffallen statt stillschweigend
  // eine neue Ordnerstruktur zu erzeugen, die vom Partner nicht erwartet wird.
  const montageOffenIter = partnerRoot.getFoldersByName(MONTAGE_OFFEN_ORDNERNAME);
  if (!montageOffenIter.hasNext()) {
    logRow(dealId, deal.title, partner, 'übersprungen', null, `Unterordner "${MONTAGE_OFFEN_ORDNERNAME}" fehlt im Partner-Root -- manuell anlegen`);
    return `übersprungen (Unterordner "${MONTAGE_OFFEN_ORDNERNAME}" fehlt bei "${partner}")`;
  }
  const parentFolder = montageOffenIter.next();

  if (DRY_RUN) {
    logRow(dealId, deal.title, partner, 'DRY-RUN', null, `würde Ordner "${ordnerName}" in Partnerordner ${parentFolderId} anlegen`);
    return `DRY-RUN: würde Ordner "${ordnerName}" bei Partner "${partner}" anlegen`;
  }

  // Sicherheitscheck: existiert der Ordner schon? (z.B. bei erneutem Webhook-Aufruf)
  const vorhandene = parentFolder.getFoldersByName(ordnerName);
  const kundenOrdner = vorhandene.hasNext() ? vorhandene.next() : parentFolder.createFolder(ordnerName);

  // Jeder Unterordner einzeln + idempotent anlegen (nicht nur beim Neu-Anlegen des Hauptordners):
  // falls ein vorheriger Lauf zwischen zwei Unterordnern abgebrochen ist (Quota/Timeout), holt
  // dieser Lauf die fehlenden nach, statt sie für immer wegzulassen.
  KUNDEN_UNTERORDNER_NAMEN.forEach(unterName => {
    if (!kundenOrdner.getFoldersByName(unterName).hasNext()) {
      kundenOrdner.createFolder(unterName);
    }
  });

  const ordnerLink = kundenOrdner.getUrl();
  patchPipedrive(`deals/${dealId}`, { custom_fields: { [KUNDENORDNER_LINK_FIELD_KEY]: ordnerLink } });

  logRow(dealId, deal.title, partner, 'angelegt', ordnerLink, '');
  return `angelegt: ${ordnerLink}`;
}
