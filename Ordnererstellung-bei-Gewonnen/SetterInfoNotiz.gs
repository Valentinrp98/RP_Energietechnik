// ===== SETTER-INFO ALS NOTIZ BEIM GEWINNEN =====
// Grund: die 11 Quali-Felder (Feldgruppe "Setter Info", angelegt 11.09.2026, siehe
// docs/SPEC-Quali-Felder-Setter.md) sind für den SALES-Prozess gebaut. In der Fulfillment-Pipeline
// stören sie nur -- dort will man den Kontext auf einen Blick, nicht 11 Felder.
//
// Lösung in zwei Teilen:
//   1. Felder per Pipedrive-Einstellung nur in der Sales-Pipeline anzeigen (UI-Handarbeit,
//      "pipeline-specific custom fields", Premium-Feature -- kein Script).
//   2. Diese Datei: beim Gewinnen wird eine kompakte Zusammenfassung als Notiz an den Deal
//      geschrieben, damit Fulfillment den Ersttermin-Kontext lesen kann.
//
// WICHTIG: Die Felder werden NICHT geleert. Eine Notiz ist Freitext -- nicht filterbar, nicht
// auswertbar. Der ganze Sinn der Felder war Auswertbarkeit (Provision pro Setter, welche
// Interesse-Kombination gewinnt, Stromkosten-Median gewonnen vs. verloren). Die Notiz ist eine
// Lesehilfe, keine Datenablage.

// Die Provisionsfelder ("Provision Setter %", "Provision Closer %") stehen BEWUSST NICHT in der
// Notiz: eine Notiz sieht jeder, der den Deal sieht. Sie in die Fulfillment-Pipeline zu kippen
// wäre genau das Gegenteil der noch offenen Sichtbarkeits-Entscheidung (SPEC, Punkt 2).
// Das Feld "Setter" (wer war es) ist dagegen drin -- das ist Kontext, keine Gehaltsinfo.
const SETTER_INFO_FELDER = [
  { key: 'c108b937caf5aad0c2d48dbc3863a794ded9ec2e', label: 'Stromkosten',   suffix: ' €/Monat' },
  { key: 'f5b1f9d0c9fb5779fbd5c2b32d9df474f938c41e', label: 'Verbrauch',     suffix: ' kWh/Jahr' },
  { key: 'b1f1969ced7c29cf0f566319dc9d5c0eb471c699', label: 'Montageart' },
  { key: '2f47be01059ed2c391b80fe2cf76477cb9fcc9bf', label: 'Umsetzung' },
  { key: 'e4c34197894538f20deed0a1ca0ce11304d93977', label: 'Montageort' },
  { key: 'bb4b8c59fa5891867170f6aeaba88cd294307cac', label: 'Interesse' },
  { key: 'f4948cce46f2b5a5ae168cf4ff20d092f2a2f94e', label: 'Einschränkung' },
  { key: '109e5a752dfc57a75aba31d96e87f6442f977e57', label: 'E-Auto' }
];

const SETTER_FIELD_KEY = '75df8ada23f08fa5828020bf92db78bb76ef823a'; // field_type "user"

// Marker-Zeile: steht in jeder erzeugten Notiz und ist die Idempotenz-Bremse. MUSS stabil bleiben --
// wer den Text ändert, sorgt dafür, dass alle bestehenden Deals beim nächsten Event eine ZWEITE
// Notiz bekommen. Der Webhook feuert seit 26.08. bei JEDER Änderung an einem gewonnenen Deal
// (siehe FolderCreation.gs), nicht nur beim Statuswechsel -- ohne diesen Marker entstünde pro
// Feldänderung eine neue Notiz.
const SETTER_INFO_MARKER = 'Setter-Info (Ersttermin)';

// Eigener Scharfschalter, unabhaengig von DRY_RUN. DRY_RUN steht in diesem Projekt auf false
// (die Ordnererstellung laeuft ja live) -- ohne diesen Schalter waere die Notiz mit dem ersten
// clasp push sofort scharf, ohne dass sie je an einem Deal getestet wurde.
// Scharf seit 14.09.2026 (Testlauf an Deal 7621, Notiz 13061).
const SETTER_NOTIZ_AKTIV = true;

const NL = String.fromCharCode(10);

/**
 * Schreibt die Setter-Quali-Infos als Notiz an den Deal. Idempotent: existiert am Deal schon eine
 * Notiz mit SETTER_INFO_MARKER, passiert nichts. Gibt einen Status-String zurück (analog zu
 * schreibeKundendatenSnapshot()).
 *
 * Options-Labels werden LIVE aus /dealFields geholt, nicht hartcodiert: die set-Felder sind bewusst
 * mit langen Optionslisten gebaut und wachsen weiter (SPEC: "nicht jeden Tag 1 Option hinzufügen").
 * Eine hartcodierte ID→Label-Tabelle wäre nach der ersten neuen Option still falsch.
 */
function schreibeSetterInfoNotiz(dealId, deal, nurVorschau) {
  if (!SETTER_NOTIZ_AKTIV && !nurVorschau) {
    Logger.log(`Setter-Info Deal ${dealId}: SETTER_NOTIZ_AKTIV = false -- Modul ist noch nicht scharf.`);
    return 'inaktiv';
  }
  const cf = deal.custom_fields || {};

  // Billiger Vorab-Ausstieg: kein einziges Quali-Feld befüllt -> nichts zu berichten.
  const hatDaten = SETTER_INFO_FELDER.some(f => !istLeer(cf[f.key])) || !istLeer(cf[SETTER_FIELD_KEY]);
  if (!hatDaten) {
    Logger.log(`Setter-Info Deal ${dealId}: keine Quali-Felder befuellt -- nichts zu tun.`);
    return 'übersprungen (keine Quali-Daten)';
  }

  if (hatSetterInfoNotiz(dealId)) {
    Logger.log(`Setter-Info Deal ${dealId}: Notiz existiert bereits -- nichts zu tun.`);
    return 'übersprungen (Notiz existiert)';
  }

  const labelMap = ladeOptionsLabels();
  const zeilen = [];

  const setterName = loeseBenutzerAuf(cf[SETTER_FIELD_KEY]);
  if (setterName) zeilen.push(`<b>Setter:</b> ${escapeHtml(setterName)}`);

  SETTER_INFO_FELDER.forEach(f => {
    const text = formatiereFeldwert(cf[f.key], labelMap[f.key]);
    if (text) zeilen.push(`<b>${escapeHtml(f.label)}:</b> ${escapeHtml(text)}${f.suffix ? escapeHtml(f.suffix) : ''}`);
  });

  if (zeilen.length === 0) {
    Logger.log(`Setter-Info Deal ${dealId}: nach Formatierung nichts uebrig -- nichts zu tun.`);
    return 'übersprungen (keine Quali-Daten)';
  }

  const content = `<b>${SETTER_INFO_MARKER}</b><br>${zeilen.join('<br>')}` +
    `<br><br><i>Automatisch beim Gewinnen erzeugt. Quelle sind die Felder der Gruppe „Setter Info" am Deal -- ` +
    `die bleiben befüllt, diese Notiz ist nur die Lesefassung.</i>`;

  // Vorschau: schreibt garantiert nichts, egal wie DRY_RUN oder SETTER_NOTIZ_AKTIV stehen.
  // Bewusst VOR der DRY_RUN-Pruefung -- DRY_RUN steht in diesem Projekt auf false.
  if (nurVorschau) {
    // Tags raus UND Entities zurueck: in der echten Notiz ist "&lt;" korrekt (der Inhalt ist HTML,
    // ein rohes "<" wuerde Pipedrive als Tag-Anfang schlucken) -- nur zum Lesen stoert es.
    const klartext = zeilen.join(NL)
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    Logger.log('--- VORSCHAU Deal ' + dealId + ' (' + deal.title + ') ---' + NL + klartext);
    return 'Vorschau';
  }

  if (DRY_RUN) {
    logRow(dealId, deal.title, null, 'DRY-RUN', null, `Setter-Info-Notiz wuerde geschrieben: ${zeilen.join(' | ')}`);
    return 'DRY-RUN';
  }

  postPipedriveV1('notes', { deal_id: dealId, content: content });
  logRow(dealId, deal.title, null, 'angelegt', null, `Setter-Info-Notiz geschrieben (${zeilen.length} Zeilen)`);
  return 'geschrieben';
}

/** true, wenn der Wert als "nicht befüllt" gilt (deckt null, undefined, '' und leere Arrays ab). */
function istLeer(wert) {
  if (wert === null || wert === undefined || wert === '') return true;
  if (Array.isArray(wert)) return wert.length === 0;
  return false;
}

/**
 * Macht aus einem Custom-Field-Rohwert lesbaren Text.
 * v2 liefert bei enum eine Options-ID (Zahl), bei set ein Array von Options-IDs, sonst den Wert
 * direkt. Ohne passende Options-Tabelle bliebe also "344" statt "Speicher" stehen.
 */
function formatiereFeldwert(wert, optionen) {
  if (istLeer(wert)) return '';
  if (Array.isArray(wert)) {
    return wert.map(id => (optionen && optionen[id]) || `?(${id})`).join(', ');
  }
  if (optionen && optionen[wert] !== undefined) return optionen[wert];
  return String(wert);
}

/**
 * Holt einmal alle dealFields und baut {field_key: {optionId: label}} für die Setter-Info-Felder.
 * Ein Aufruf pro gewonnenem Deal -- vernachlässigbar gegenüber der Alternative (hartcodierte
 * Options-IDs, die nach jeder neu angelegten Option still falsche Labels liefern).
 */
function ladeOptionsLabels() {
  const fields = fetchPipedrive('dealFields?limit=500');
  const relevant = new Set(SETTER_INFO_FELDER.map(f => f.key));
  const map = {};
  fields.forEach(f => {
    if (!relevant.has(f.field_code) || !f.options) return;
    const tabelle = {};
    f.options.forEach(o => { tabelle[o.id] = o.label; });
    map[f.field_code] = tabelle;
  });
  return map;
}

/**
 * Löst die User-ID des "Setter"-Felds (field_type "user") in einen Namen auf.
 * Users liegen nur in der v1-API -- v2 hat keinen /users-Endpunkt.
 * Ein Fehler hier darf die Notiz nicht verhindern: dann steht der Setter eben nicht drin.
 */
function loeseBenutzerAuf(userId) {
  if (istLeer(userId)) return '';
  try {
    const user = fetchPipedriveV1(`users/${userId}`);
    return user?.name || '';
  } catch (err) {
    Logger.log(`Setter-Info: Benutzer ${userId} nicht aufloesbar (${err.message}) -- Setter-Zeile entfaellt.`);
    return '';
  }
}

/**
 * Prüft, ob am Deal schon eine Setter-Info-Notiz hängt. Notes gibt es nur in v1.
 * Fehlerfall = "ja, existiert": lieber keine Notiz als bei jeder Deal-Änderung eine neue.
 */
function hatSetterInfoNotiz(dealId) {
  try {
    const notes = fetchPipedriveV1(`notes?deal_id=${dealId}&limit=100`) || [];
    return notes.some(n => (n.content || '').indexOf(SETTER_INFO_MARKER) !== -1);
  } catch (err) {
    logRow(dealId, null, null, 'WARNUNG', null, `Setter-Info: Notiz-Pruefung fehlgeschlagen (${err.message}) -- Notiz wird NICHT geschrieben (Duplikat-Schutz).`);
    return true;
  }
}

// ===== v1-HELFER =====
// Notes und Users gibt es nur in der v1-API (siehe CLAUDE.md: v1 ist nicht abgeschaltet, u.a.
// Webhooks-Registrierung und Files laufen ebenfalls dort). v1 nimmt den Token als Query-Parameter,
// nicht als x-api-token-Header -- deshalb eigene Helfer statt fetchPipedrive/patchPipedrive.
// Retry-Verhalten (429/5xx) kommt über callPipedriveWithRetry aus Config.gs, identisch zu v2.

function fetchPipedriveV1(path) {
  const trenner = path.indexOf('?') === -1 ? '?' : '&';
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v1/${path}${trenner}api_token=${encodeURIComponent(getApiToken())}`;
  return callPipedriveWithRetry(() => UrlFetchApp.fetch(url, { muteHttpExceptions: true }), path);
}

function postPipedriveV1(path, payload) {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v1/${path}?api_token=${encodeURIComponent(getApiToken())}`;
  return callPipedriveWithRetry(() => UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  }), path);
}

/** Notiz-Inhalt ist HTML -- Feldwerte sind Freitext und könnten < oder & enthalten. */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ===== TEST =====

/**
 * READ-ONLY. Sucht Deals, bei denen die Quali-Felder ueberhaupt befuellt sind -- ohne solche
 * gibt es nichts zu testen. Die Felder existieren erst seit 11.09.2026, es kann also gut sein,
 * dass noch kein einziger Deal befuellt ist. Dann sagt das Log genau das.
 */
function findeTestDeals() {
  const alleKeys = SETTER_INFO_FELDER.map(f => f.key).concat([SETTER_FIELD_KEY]);
  const deals = fetchPipedrive('deals?limit=500&sort_by=update_time&sort_direction=desc');
  const treffer = deals.filter(d => {
    const cf = d.custom_fields || {};
    return alleKeys.some(k => !istLeer(cf[k]));
  });

  Logger.log(`${deals.length} Deals geprueft, ${treffer.length} mit befuellten Quali-Feldern:`);
  treffer.slice(0, 20).forEach(d => {
    const cf = d.custom_fields || {};
    const anzahl = alleKeys.filter(k => !istLeer(cf[k])).length;
    Logger.log(`  Deal ${d.id} -- "${d.title}" (${d.status}) -- ${anzahl} Felder befuellt`);
  });
  if (!treffer.length) {
    Logger.log('Keine. Zum Testen einfach an einem beliebigen Deal ein paar Quali-Felder ausfuellen.');
  }
}

/**
 * READ-ONLY VORSCHAU. Zeigt im Log, wie die Notiz fuer diesen Deal aussehen wuerde.
 * Schreibt NICHTS -- unabhaengig von DRY_RUN und SETTER_NOTIZ_AKTIV. Gefahrlos.
 */
function vorschauSetterInfoNotiz() {
  const DEAL_ID = 0; // <-- Deal-ID aus findeTestDeals() eintragen
  if (!DEAL_ID) {
    Logger.log('Bitte DEAL_ID in vorschauSetterInfoNotiz() eintragen (Kandidaten: findeTestDeals()).');
    return;
  }
  const deal = fetchPipedrive(`deals/${DEAL_ID}`);
  Logger.log(`Ergebnis: ${schreibeSetterInfoNotiz(DEAL_ID, deal, true)}`);
}

/**
 * SCHREIBT WIRKLICH (wenn SETTER_NOTIZ_AKTIV = true). Erst laufen lassen, wenn die Vorschau passt.
 */
function testSetterInfoNotiz() {
  const DEAL_ID = 0; // <-- Deal-ID eintragen
  if (!DEAL_ID) {
    Logger.log('Bitte DEAL_ID in testSetterInfoNotiz() eintragen.');
    return;
  }
  const deal = fetchPipedrive(`deals/${DEAL_ID}`);
  Logger.log(`Ergebnis: ${schreibeSetterInfoNotiz(DEAL_ID, deal)}`);
  flushLog();
}
