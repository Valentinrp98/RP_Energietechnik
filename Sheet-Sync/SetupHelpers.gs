// ===== EINMALIGE SETUP-FUNKTIONEN =====
// Im Apps-Script-Editor oben im Dropdown auswählen und ausführen (▷-Button).

/**
 * Richtet alle Trigger ein: zeitgesteuert für neue Zeilen + Pipedrive->Sheet-Sync (alle 15 Min),
 * plus installierbare onEdit-Trigger für jedes konfigurierte Partner-Sheet (Sheet->Pipedrive).
 * NUR EINMAL ausführen, danach löscht removeAllTriggers() bei Bedarf alles wieder.
 */
function installTriggers() {
  ScriptApp.newTrigger('syncNeueZeilen').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('syncPipedriveToSheetFields').timeBased().everyMinutes(15).create();

  Object.entries(PARTNER_TO_SHEET_ID).forEach(([partner, sheetId]) => {
    if (sheetId.startsWith('TODO_')) {
      Logger.log(`Übersprungen: keine Sheet-ID für "${partner}" -- kein onEdit-Trigger eingerichtet.`);
      return;
    }
    ScriptApp.newTrigger('handleSheetEdit').forSpreadsheet(sheetId).onEdit().create();
    Logger.log(`onEdit-Trigger für "${partner}" eingerichtet.`);
  });

  Logger.log('Fertig. Mit listInstalledTriggers() prüfen.');
}

function listInstalledTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    Logger.log(`${t.getHandlerFunction()} -- ${t.getEventType()} -- ${t.getTriggerSourceId ? t.getTriggerSourceId() : ''}`);
  });
}

/** Entfernt ALLE Trigger dieses Projekts (zum saubereren Neu-Einrichten). */
function removeAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('Alle Trigger entfernt.');
}

/** Debug: listet alle Deal-Custom-Fields (field_name + field_code). */
function listDealFieldsHelper() {
  const fields = fetchPipedrive('dealFields?limit=500');
  fields.forEach(f => Logger.log(`${f.field_name}  -->  ${f.field_code}`));
}

/** Für Einzeltests: Zeilen-Erstellung für einen bekannten Deal. */
function testCreateSheetRow() {
  const result = createSheetRowForDeal(7253); // Test-Deal-ID, ggf. anpassen
  Logger.log(result);
}
