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

  // Kundendaten-Snapshot (siehe KundendatenSnapshot.gs): läuft für JEDEN frisch gewonnenen Deal,
  // deshalb bewusst hier VOR den Ordner-spezifischen Skip-Bedingungen unten (Montagepartner fehlt,
  // Kundenordner-Link schon gesetzt usw.) -- der Snapshot ist eine eigene Automatisierung, keine
  // Voraussetzung für die Ordnererstellung. Prüfung auf person_id passiert in der Funktion selbst.
  schreibeKundendatenSnapshot(dealId, deal);

  // Setter-Info als Notiz (siehe SetterInfoNotiz.gs): gleiche Logik wie oben -- eigene
  // Automatisierung, laeuft unabhaengig von der Ordnererstellung. Idempotent ueber einen
  // Marker in der Notiz, sonst gaebe es bei jeder Deal-Aenderung eine neue.
  // try/catch bewusst NUR hier: die Notiz ist die neueste und am wenigsten erprobte der drei
  // Automatisierungen in dieser Funktion. Ohne Netz wuerde ein Fehler darin (z.B. Notes-API
  // zickt) den ganzen Aufruf abbrechen und die etablierte Ordnererstellung mit runterreissen.
  try {
    schreibeSetterInfoNotiz(dealId, deal);
  } catch (err) {
    logRow(dealId, deal.title, null, 'WARNUNG', null, `Setter-Info-Notiz fehlgeschlagen (Ordnererstellung laeuft weiter): ${err.message}`);
  }

  // Diese beiden Skips sind seit der Webhook-Robustheits-Änderung (2026-08-26, doPost reagiert auf
  // JEDE Deal-Änderung bei gewonnenem Deal statt nur den Status-Wechsel) der Normalfall, nicht die
  // Ausnahme: ein fertiger Deal ohne Montagepartner bekommt bei jeder weiteren Feldänderung erneut
  // einen Aufruf. Bewusst NUR Logger.log (Debug), NICHT logRow (Sheet) -- exakt der
  // Montagepartner-Nulllauf-Fall aus dem Automations-Dashboard-Konzept ("nichts passiert gehört
  // nicht ins Sheet"): 6.246 identische "übersprungen"-Zeilen hätten die echten Fehler unsichtbar
  // gemacht. Echte Anomalien (FEHLER/WARNUNG unten) bleiben im Sheet.
  if (cf[KUNDENORDNER_LINK_FIELD_KEY]) {
    Logger.log(`[${dealId}] übersprungen: Ordner-Link bereits gesetzt (${cf[KUNDENORDNER_LINK_FIELD_KEY]})`);
    return 'übersprungen (Ordner-Link bereits gesetzt)';
  }

  const partnerOptionId = cf[MONTAGEPARTNER_FIELD_KEY];
  if (!partnerOptionId) {
    Logger.log(`[${dealId}] übersprungen: kein Montagepartner gesetzt`);
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
    // FIX 27.08.2026: war nach dem Log-Spam-Fix (658d4ab) nur noch Logger.log -- damit fiel ein
    // reiner Config-Fehler NIRGENDS mehr auf. Der Deal wird still nie bearbeitet, doPost antwortet
    // "ok", im Sheet steht nichts. Das ist kein wiederholbarer Normalfall wie "Partner noch nicht
    // gesetzt", sondern eine Bringschuld in Config.gs. Deshalb ins Sheet, aber gedrosselt:
    // hoechstens eine Zeile pro Partner und Tag, statt einer pro Event.
    logRowGedrosselt(`ordnerid:${partner}`, dealId, deal.title, partner, 'FEHLER',
      `keine Drive-Ordner-ID für "${partner}" konfiguriert (PARTNER_TO_DRIVE_FOLDER_ID in Config.gs) -- Deals dieses Partners bekommen KEINEN Ordner`);
    return `übersprungen (Drive-Ordner-ID für "${partner}" fehlt in Config.gs)`;
  }

  if (!deal.person_id) {
    Logger.log(`[${dealId}] übersprungen: Deal hat keine verknüpfte Person`);
    return 'übersprungen (keine verknüpfte Person)';
  }
  const person = fetchPipedrive(`persons/${deal.person_id}`);
  const name = person.name || deal.title || `Deal ${dealId}`;
  const adrObj = person.custom_fields?.[ADRESSE_FIELD_KEY];
  const adresse = adrObj?.formatted_address || adrObj?.value || '';
  // != null statt !== undefined -- ein leeres Adressfeld kommt als null, und "null !== undefined"
  // ist true, also gab es fuer jede Person ohne Adresse eine WARNUNG-Zeile pro Event.
  if (!adresse && adrObj != null) {
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
    // FIX 27.08.2026: vorher wurde nur der ERSTE Namenstreffer geprueft. Liegt im Partner-Root
    // noch eine andere Datei namens "Montage offen" (PDF, Sheet, alte Notiz) und kommt sie zuerst,
    // schlug der mimeType-Check fehl und der tatsaechlich vorhandene Shortcut wurde nie probiert --
    // der Deal landete im Skip unten. Deshalb den Iterator durchlaufen, bis ein Shortcut da ist.
    const shortcutIter = partnerRoot.getFilesByName(MONTAGE_OFFEN_ORDNERNAME);
    while (!parentFolder && shortcutIter.hasNext()) {
      const kandidat = shortcutIter.next();
      if (kandidat.getMimeType() === 'application/vnd.google-apps.shortcut') {
        parentFolder = loeseShortcutAuf(kandidat.getId());
      }
    }
  }
  if (!parentFolder) {
    // FIX 27.08.2026: ebenfalls ein Setup-Fehler, der nach 658d4ab unsichtbar war -- und zwar ein
    // AKUTER: fuer "Tiroler Partner" und "Vorarlberg Partner" steht in Config.gs ausdruecklich
    // "Montage offen-Unterordner noch anlegen!", und Montagepartner-aus-Bundesland vergibt genau
    // diese beiden automatisch fuer Tirol/Vorarlberg. Ein gewonnener Tirol-Deal fiel damit lautlos
    // durch: kein Ordner, keine Sheet-Zeile, HTTP 200. Gedrosselt ins Sheet, eine Zeile pro
    // Partner und Tag.
    logRowGedrosselt(`montageoffen:${partner}`, dealId, deal.title, partner, 'FEHLER',
      `Unterordner "${MONTAGE_OFFEN_ORDNERNAME}" fehlt im Partner-Root von "${partner}" (auch nicht als Verknüpfung) -- Deals dieses Partners bekommen KEINEN Ordner`);
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
