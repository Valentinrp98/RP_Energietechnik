// ============================================================================
// EINMALIGES SETUP: Kostenübernahme Dach-/Elektromontage (Gruppe "Abschluss")
// Stand 30.09.2026. Füllen: KostenFuellen.js. Anzeige: Sheet-Sync, Spalte "Kostenübernahme"
// in den Partner-Sheets ALE / Kreuzeder / Berger.
//
// Zwei Felder (Entscheidung VP 30.09.2026):
//   Dachmontage bezahlt von     RP / Kunde
//   Elektromontage bezahlt von  RP / Kunde
// Nur RP oder Kunde -- "Kunde zahlt direkt an Partner" gibt es nicht (VP 30.09.).
// Wird beim Closing-Termin gesetzt. Full Service oder Finanzierung zugesagt ->
// setzt KostenFuellen.js automatisch RP. Von Hand geändert wird nie überschrieben.
//
// Logik steht in FeldSetupHelpers.js. Nicht in die Sync-Kette einhängen.
//
// REIHENFOLGE:
//   1. kfCheckVorhandene()   -> read-only, zeigt neu / passt / Konflikt
//   2. kfAnlegen()           -> mit KF_DRY_RUN = true (Log prüfen!)
//   3. KF_DRY_RUN = false    -> kfAnlegen() nochmal, legt scharf an
//   4. kfReport()            -> field_codes + Options-IDs für Sheet-Sync/Config.gs + REFERENZ-Doku
//   5. UI: beide Felder in die Gruppe "Abschluss" ziehen (per API nicht möglich)
// ============================================================================

// Sicherheitsschalter: true = nur loggen, NICHTS in Pipedrive anlegen.
// 30.09.2026 11:23 scharf gelaufen (beide Felder angelegt), danach wieder zurück auf true.
const KF_DRY_RUN = true;

// Namen + Optionen müssen mit KostenFuellen.js (KFU_FELD_DACH / KFU_FELD_ELEKTRO /
// KFU_OPTION_RP) übereinstimmen -- das Script sucht Felder und Optionen per Name.
// Bewusst Literale (Ladereihenfolge der Dateien, siehe StornoFelderSetup.js).
function kfFeld_(fieldName, was) {
  return {
    field_name: fieldName,
    field_type: 'enum',
    options: ['RP', 'Kunde'],
    description: 'Wer zahlt die ' + was + '? Beim Closing-Termin setzen. ' +
                 'Full Service oder Finanzierung zugesagt -> wird automatisch "RP" (stündlich). ' +
                 'Von Hand geändert wird nie überschrieben. Erscheint im Partner-Sheet ' +
                 'in der Spalte "Kostenübernahme".'
  };
}

const KF_FIELDS = [
  kfFeld_('Dachmontage bezahlt von',    'Dachmontage'),
  kfFeld_('Elektromontage bezahlt von', 'Elektromontage')
];

function kfCheckVorhandene() { feldSetupCheck(KF_FIELDS); }
function kfAnlegen()         { feldSetupAnlegen(KF_FIELDS, KF_DRY_RUN); }
function kfReport()          { feldSetupReport(KF_FIELDS); }
