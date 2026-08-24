// ===== KUNDENDATEN-SNAPSHOT =====
// Grund: Mail-Vorlagen in Pipedrive nutzen Person-Merge-Felder (kleines Personen-Symbol). Die
// ziehen ihre Werte vom Empfänger der jeweiligen Mail, NICHT vom Deal. Schickt man aus Versehen
// an eine andere Person, als die am Deal hängt, zeigt die Mail trotzdem "richtig" aus, enthält
// aber die falschen Kundendaten. Diese Deal-Custom-Fields ($-Symbol) sind ein einmaliger Snapshot
// beim Gewinnen -- fix am Deal, unabhängig davon, an wen später gemailt wird.

/**
 * Schreibt Name/Telefonnummer/Adresse der verknüpften Person in die Kundendaten-Snapshot-Felder
 * am Deal. Läuft unabhängig vom Ordner-Anlegen-Flow (siehe FolderCreation.gs) -- deshalb dort ganz
 * am Anfang aufgerufen, VOR den Ordner-spezifischen Skip-Bedingungen (Montagepartner fehlt o.ä.),
 * damit der Snapshot auch dann geschrieben wird, wenn die Ordner-Logik aus anderen Gründen aussteigt.
 * Überschreibt nichts, wenn alle 3 Felder schon befüllt sind (idempotent bei mehrfachem Webhook-Aufruf).
 */
function schreibeKundendatenSnapshot(dealId, deal) {
  const cf = deal.custom_fields || {};
  if (cf[KUNDE_NAME_FIELD_KEY] && cf[KUNDE_TELEFON_FIELD_KEY] && cf[KUNDE_ADRESSE_FIELD_KEY]) {
    logRow(dealId, deal.title, null, 'übersprungen', null, 'Kundendaten-Snapshot bereits vollständig befüllt');
    return;
  }

  const person = fetchPipedrive(`persons/${deal.person_id}`);
  const name = person.name || '';

  // person.phones: Array von {value, label, primary}. Primäre Nummer bevorzugen, sonst erste.
  const phones = person.phones || [];
  const telefonEintrag = phones.find(p => p.primary) || phones[0];
  const telefon = telefonEintrag?.value || '';

  // Gleiche Adresse-Feld-Logik wie in FolderCreation.gs: Subfelder nur befüllt, wenn die Adresse
  // per Google-Maps-Autocomplete angelegt wurde, sonst steht alles in "value".
  const adrObj = person.custom_fields?.[ADRESSE_FIELD_KEY];
  const adresse = adrObj?.formatted_address || adrObj?.value || '';
  if (!adresse && adrObj !== undefined) {
    logRow(dealId, deal.title, null, 'WARNUNG', null, `Kundendaten-Snapshot: Adresse-Feld hat unerwartete Struktur: ${JSON.stringify(adrObj)}`);
  }

  const payload = {};
  if (name) payload[KUNDE_NAME_FIELD_KEY] = name;
  if (telefon) payload[KUNDE_TELEFON_FIELD_KEY] = telefon;
  if (adresse) payload[KUNDE_ADRESSE_FIELD_KEY] = adresse;

  if (Object.keys(payload).length === 0) {
    logRow(dealId, deal.title, null, 'übersprungen', null, 'Kundendaten-Snapshot: Person hat weder Name noch Telefon noch Adresse');
    return;
  }

  if (DRY_RUN) {
    logRow(dealId, deal.title, null, 'DRY-RUN', null, `Kundendaten-Snapshot würde schreiben: ${JSON.stringify(payload)}`);
    return;
  }

  patchPipedrive(`deals/${dealId}`, { custom_fields: payload });
  logRow(dealId, deal.title, null, 'angelegt', null, `Kundendaten-Snapshot geschrieben: ${JSON.stringify(payload)}`);
}
