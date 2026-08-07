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