/**
 * ⚠️⚠️ NUR EINMALIG AUSFÜHREN – BEREITS ERLEDIGT AM 06.08.2026 ⚠️⚠️
 * Erstellt 12 Deal-Custom-Fields in Pipedrive.
 * Ein erneuter Aufruf erzeugt DUPLIKATE, die manuell in der UI gelöscht werden müssen!
 */
function SETUP_EINMALIG_createDealFields() {
  const url = `https://${PIPEDRIVE_DOMAIN}.pipedrive.com/api/v2/dealFields`;

  const felder = [
    // ===== VOM SELLER (sollten Pflichtfeld werden) =====
    { field_name: 'Dachform', field_type: 'enum',
      options: [{ label: 'Satteldach' }, { label: 'Walmdach' }, { label: 'Pultdach' }, { label: 'Flachdach' }] },
    { field_name: 'Eindeckung des Daches', field_type: 'enum',
      options: [{ label: 'Ziegeldach' }, { label: 'Blechdach Trapez' }, { label: 'Blechdach Falz' },
                { label: 'Welleternit' }, { label: 'Flachdach (Kies)' }, { label: 'Flachdach (Beton)' }, { label: 'Flachdach (begrünt)' }] },

    // ===== VOM KUNDEN (via Formular, später zurückgeschrieben) =====
    { field_name: 'Dachneigung in Grad', field_type: 'double' },
    { field_name: 'Gebäudehöhe in m', field_type: 'double' },
    { field_name: 'Unterkonstruktion des Daches', field_type: 'enum',
      options: [{ label: 'Sparren' }, { label: 'Pfetten' }] },
    { field_name: 'Höhe Sparren/Pfetten in m', field_type: 'double' },
    { field_name: 'Breite Sparren/Pfetten in m', field_type: 'double' },
    { field_name: 'Blitzschutz vorhanden', field_type: 'enum',
      options: [{ label: 'Ja' }, { label: 'Nein' }] },
    { field_name: 'Störflächen am Dach', field_type: 'enum',
      options: [{ label: 'Ja' }, { label: 'Nein' }] },
    { field_name: 'Kabelweg DC (Dach zu Wechselrichter) in m', field_type: 'double' },
    { field_name: 'Kabelweg AC (Wechselrichter zu Verteiler) in m', field_type: 'double' },

    // ===== INTERN (Tracking, für spätere Polling-Funktion) =====
    { field_name: 'Doku Link verschickt', field_type: 'enum',
      options: [{ label: 'Ja' }, { label: 'Nein' }] }
  ];

  felder.forEach(feld => {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-token': getApiToken() },
      payload: JSON.stringify(feld),
      muteHttpExceptions: true
    });
    Logger.log(feld.field_name + ' → Status ' + response.getResponseCode() + ': ' + response.getContentText());
  });
}

/**
 * EINMALIG: Umfrage-Antwort von Tobias Knittelfelder (Deal 7093, 24.08.2026) einspielen.
 * Deckt NUR das Hauptdach ab (Formular-Antwort) -- die separaten Zubau-Details aus der
 * Kunden-Mail (Sandwichpaneele, 3,5°, ...) gehören zu einem ANDEREN Dach (Nebengebäude, siehe
 * Foto+Skizze vom 25.08.) und landen deshalb NICHT in Dachform/Eindeckung/Neigung, sondern
 * unten separat als Text in den internen Notizen -- sonst würden sie die echten Hauptdach-Werte
 * überschreiben.
 * Die 4 Formular-Restantworten (keine eigenen Pipedrive-Felder vorhanden, siehe Chat 25.08.)
 * kommen in "Sonstige Mitteilung Kunde".
 */
function schreibeUmfrageKnittelfelder7093() {
  const dealId = 7093;

  const internNotiz = [
    'ZUBAU-DACH (separates Nebengebäude, NICHT das Hauptdach -- Angaben lt. Mail + Skizze 25.08.2026):',
    'Ausrichtung (Gefällerichtung): Nord-Nordwest (N NW)',
    'Deckung: Sandwichpaneele',
    'Größe: ca. 90m² (Skizze: 13,8x4,9m + 6,5x3,5m, L-Form)',
    'Neigung: 3,5°',
    'Belastung (Verkehrs-/Schneelast/PV lt. Paneele): 2,25 kN/m²',
    'Beschattung: Mauer Nachbargebäude Süd-Südost (S SO), ca. 60cm über Dachniveau',
    'Kabelweg: West-Südwest (W SW) seitig vom Dach ins Gebäude, innen Platz für Speicher/WR',
    'Zuleitung ins Gebäude vorhanden: 5x6mm² vom Hauptzählerkasten'
  ].join('\n');

  // Grundsatz (Valentin, 25.08.): Sonstige Mitteilung Kunde soll ALLE Formular-Antworten
  // enthalten, die kein eigenes Pipedrive-Feld haben -- nicht nur eine Auswahl davon.
  // ACHTUNG: dieses Feld ist "autocomplete", NICHT normaler Freitext -- max. 255 Zeichen,
  // sonst 400 ERR_SCHEMA_VALIDATION_FAILED (live entdeckt 25.08., noch nirgends dokumentiert).
  // Deshalb hier bewusst knapp gehalten statt vollständiger Sätze.
  const kundeNotiz = [
    'Belegung: Infos lt. Mail.',
    'Dachpläne: Ja.',
    'Kabelweg (Hauptdach): W-SW seitig ins Gebäude.',
    'Sonstiges: Infos lt. Mail.',
    'Visualisierung: Datei-Upload (nicht im Copy-Paste enthalten).'
  ].join(' ');
  if (kundeNotiz.length > 255) {
    throw new Error(`kundeNotiz ist ${kundeNotiz.length} Zeichen -- über dem 255er-Limit von "Sonstige Mitteilung Kunde", kürzen!`);
  }

  const result = patchPipedrive(`deals/${dealId}`, {
    custom_fields: {
      [DACHFORM_FIELD_KEY]: 91, // Flachdach (Hauptdach)
      [EINDECKUNG_FIELD_KEY]: 93, // Blechdach Trapez (Hauptdach)
      [DACHNEIGUNG_FIELD_KEY]: 3,
      [GEBAEUDEHOEHE_FIELD_KEY]: 3,
      [UNTERKONSTRUKTION_FIELD_KEY]: 100, // Pfetten
      [HOEHE_SPARREN_FIELD_KEY]: 2.46,
      [BREITE_SPARREN_FIELD_KEY]: 0.14,
      [BLITZSCHUTZ_FIELD_KEY]: 102, // Nein
      [STOERFLAECHEN_FIELD_KEY]: 103, // Ja
      [NOTIZEN_KUNDE_FIELD_KEY]: kundeNotiz,
      [NOTIZEN_INTERN_FIELD_KEY]: internNotiz
    }
  });
  Logger.log(`Deal ${dealId} aktualisiert. Custom Fields jetzt: ${JSON.stringify(result.custom_fields, null, 2)}`);
}

/**
 * EINMALIG: Korrigiert Deal 7093 (Tobias Knittelfelder) -- Valentin hat am 25.08. bestätigt, dass
 * NUR der Zubau für die PV-Anlage verwendet wird (nicht das Hauptgebäude). Die ursprünglich per
 * schreibeUmfrageKnittelfelder7093() gesetzten Dachform/Eindeckung/Neigung-Werte waren fürs
 * Hauptdach gedacht und falsch -- korrigiert auf die echten Zubau-Werte aus der Kunden-Mail.
 * Gebäudehöhe/Unterkonstruktion/Sparren-Maße/Blitzschutz/Störflächen aus dem Formular bleiben
 * unverändert (Valentin bestätigt: die galten schon für den Zubau).
 */
function korrigiereAufZubauKnittelfelder7093() {
  const dealId = 7093;

  const internNotiz = [
    'ZUBAU-DACH (das ist der einzige für die PV-Anlage genutzte Dachteil, lt. Mail + Skizze 25.08.2026):',
    'Ausrichtung (Gefällerichtung): Nord-Nordwest (N NW)',
    'Größe: ca. 90m² (Skizze: 13,8x4,9m + 6,5x3,5m, L-Form)',
    'Belastung (Verkehrs-/Schneelast/PV lt. Paneele): 2,25 kN/m²',
    'Beschattung: Mauer Nachbargebäude Süd-Südost (S SO), ca. 60cm über Dachniveau',
    'Kabelweg: West-Südwest (W SW) seitig vom Dach ins Gebäude, innen Platz für Speicher/WR',
    'Zuleitung ins Gebäude vorhanden: 5x6mm² vom Hauptzählerkasten'
  ].join('\n');

  const result = patchPipedrive(`deals/${dealId}`, {
    custom_fields: {
      [EINDECKUNG_FIELD_KEY]: 255, // Sandwichpaneele (statt fälschlich Blechdach Trapez)
      [DACHNEIGUNG_FIELD_KEY]: 3.5, // statt fälschlich 3
      [NOTIZEN_INTERN_FIELD_KEY]: internNotiz
    }
  });
  Logger.log(`Deal ${dealId} korrigiert. Eindeckung=${result.custom_fields[EINDECKUNG_FIELD_KEY]}, Neigung=${result.custom_fields[DACHNEIGUNG_FIELD_KEY]}`);
}