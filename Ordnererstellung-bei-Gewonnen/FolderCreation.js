// ===== KERNLOGIK =====

/**
 * Löst eine Google-Drive-Verknüpfung (Shortcut) zu ihrem Zielordner auf.
 * DriveApp (Basisdienst) kann Shortcuts nicht auflösen -- dafür bräuchte es den Advanced-Drive-
 * Service. Stattdessen direkter REST-Call gegen die Drive-API v3 mit dem Script-eigenen
 * OAuth-Token (den hat das Script bereits, weil DriveApp an anderer Stelle schreibt).
 * Gibt null zurück, wenn der Call fehlschlägt oder kein Ziel gefunden wird -- bewusst kein throw,
 * der Aufrufer soll das wie "Ordner nicht gefunden" behandeln, nicht wie ein API-Totalausfall.
 */
function loeseShortcutAuf(shortcutId) {
  const url = `https://www.googleapis.com/drive/v3/files/${shortcutId}?fields=shortcutDetails`;
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) return null;
  const targetId = JSON.parse(response.getContentText()).shortcutDetails?.targetId;
  return targetId ? DriveApp.getFolderById(targetId) : null;
}

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
  //
  // Fall Kreuzeder (2026-08-19, Produktivtest Deal 6961): manche Partner sind nur per Shortcut
  // eingebunden (zeigt auf einen Ordner im eigenen Drive des Partners). getFoldersByName() findet
  // das nicht -- ein Shortcut hat einen anderen mimeType als ein echter Ordner. Deshalb Fallback:
  // Shortcut mit passendem Namen suchen und über die Drive-REST-API auflösen.
  const montageOffenIter = partnerRoot.getFoldersByName(MONTAGE_OFFEN_ORDNERNAME);
  let parentFolder = null;
  if (montageOffenIter.hasNext()) {
    parentFolder = montageOffenIter.next();
  } else {
    const shortcutIter = partnerRoot.getFilesByName(MONTAGE_OFFEN_ORDNERNAME);
    const shortcut = shortcutIter.hasNext() ? shortcutIter.next() : null;
    if (shortcut && shortcut.getMimeType() === 'application/vnd.google-apps.shortcut') {
      parentFolder = loeseShortcutAuf(shortcut.getId());
    }
  }
  if (!parentFolder) {
    logRow(dealId, deal.title, partner, 'übersprungen', null, `Unterordner "${MONTAGE_OFFEN_ORDNERNAME}" fehlt im Partner-Root (auch nicht als Verknüpfung gefunden) -- manuell prüfen`);
    return `übersprungen (Unterordner "${MONTAGE_OFFEN_ORDNERNAME}" fehlt bei "${partner}")`;
  }

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
