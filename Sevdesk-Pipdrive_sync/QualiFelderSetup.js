// ============================================================================
// EINMALIGES SETUP: Quali-Felder für Setter (Ersttermin)
// Basis: docs/SPEC-Quali-Felder-Setter.md (Stand 11.09.2026, 11 Felder)
// Herleitung/Datenlage: docs/ANALYSE-Quali-Felder-Ersttermin.md
//
// Liegt in diesem Projekt, weil fieldsetup.js hier schon die Sammelstelle für
// "Einmalige Setup- und Wartungsfunktionen für Pipedrive Custom Fields" ist und
// pdFetch() + PIPEDRIVE_API_TOKEN bereits vorhanden sind. Inhaltlich hat es mit
// dem sevdesk-Sync nichts zu tun -- nicht in die Sync-Kette einhängen.
//
// REIHENFOLGE:
//   1. qfCheckVorhandene()   -> read-only, zeigt Namenskollisionen
//   2. qfAnlegen()           -> mit QF_DRY_RUN = true (Log prüfen!)
//   3. QF_DRY_RUN = false    -> qfAnlegen() nochmal, legt scharf an
//   4. qfReport()            -> field_codes + Options-IDs als Markdown fürs REFERENZ-Doku
// ============================================================================

// Sicherheitsschalter: true = nur loggen, NICHTS in Pipedrive anlegen.
const QF_DRY_RUN = false;

// Welche Stufe anlegen? 1 = Must-have + Provision (8 Felder), 2 = zusätzlich der
// Maybe-Block (3 Felder). qfAnlegen() legt alles an mit stufe <= QF_STUFE.
const QF_STUFE = 1;

const QF_FIELDS = [
  // ---------- Stufe 1: Must-have ----------
  {
    stufe: 1,
    field_name: 'Stromkosten €/Monat',
    field_type: 'double',
    hinweis: 'Pflichtfeld im Setter-Briefing. Jahreswert /12 rechnen, ct/kWh NICHT hier rein.'
  },
  {
    stufe: 1,
    field_name: 'Stromverbrauch kWh/Jahr',
    field_type: 'double',
    hinweis: 'Nur die Zahl. "8k" = 8000.'
  },
  {
    stufe: 1,
    field_name: 'Montageart-Präferenz',
    field_type: 'enum',
    options: [
      'Selbstmontage',
      'Hybrid (Teilmontage)',
      'Schlüsselfertig',
      'Beides anbieten',
      'Entscheidet vor Ort',
      'Noch offen'
    ]
  },
  {
    stufe: 1,
    field_name: 'Umsetzungszeitpunkt',
    field_type: 'enum',
    options: [
      'sofort',
      '< 3 Monate',
      'heuer noch',
      'nach dem Winter / Frühjahr',
      'nächstes Jahr oder später',
      'hängt vom Angebot ab'
    ],
    hinweis: 'Briefing-Regel: sagt der Kunde beides ("so schnell wie möglich WENN alles passt"), gewinnt die Bedingung.'
  },
  {
    stufe: 1,
    field_name: 'Interesse an (Ersttermin)',
    field_type: 'set',
    options: [
      'Speicher',
      'Notstrom / Ersatzstrom',
      'Inselbetrieb / Autarkie',
      'Will nicht einspeisen',
      'Einspeisung / Überschuss',
      'Energiegemeinschaft',
      'Dynamischer Stromtarif',
      'Wallbox',
      'Wärmepumpe',
      'Klimaanlage',
      'Heizstab / Warmwasser',
      'Pool / Poolheizung',
      'Förderung',
      'Finanzierung / Leasing',
      'Erweiterung Altanlage',
      'Modularer / etappenweiser Ausbau',
      'Energiemanagement / Smart Home',
      'Monitoring-App',
      'Optik / unauffällige Module',
      'Herkunft der Komponenten (Made in Europe)'
    ],
    hinweis: 'Name bewusst mit "(Ersttermin)" -- das ist KAUFINTERESSE, nicht die verkaufte Anlage (siehe Speicher Kapazität kWh & Co. aus dem sevdesk-Sync).'
  },

  // ---------- Stufe 1: Provision ----------
  {
    stufe: 1,
    field_name: 'Setter',
    field_type: 'user',
    hinweis: 'Benutzerfeld, kein Dropdown -- pflegt sich bei Personalwechsel selbst. Closer = Deal-Besitzer, kein eigenes Feld.'
  },
  {
    stufe: 1,
    field_name: 'Provision Setter %',
    field_type: 'double',
    hinweis: 'Standardwert 5. Real belegt: 3 / 5 / 19 / 20.'
  },
  {
    stufe: 1,
    field_name: 'Provision Closer %',
    field_type: 'double',
    hinweis: 'Optional, Standardwert 20.'
  },

  // ---------- Stufe 2: Maybe ----------
  {
    stufe: 2,
    field_name: 'Geplanter Montageort',
    field_type: 'set',
    options: [
      'Hausdach',
      'Flachdach / Anbau',
      'Garagendach',
      'Carport',
      'Pooldach',
      'Terrassen- / Pergolaüberdachung',
      'Vordach / Überdachung',
      'Balkon',
      'Wintergarten / Glasdach',
      'Fassade',
      'Nebengebäude / Schuppen',
      'Gartenhaus',
      'Stadl / Scheune',
      'Stall',
      'Halle / Betriebsgebäude',
      'Freifläche / Wiese',
      'Zaun',
      'Standort noch offen'
    ],
    hinweis: 'Hausdach ist der Default-Fall -- Feld zahlt sich für die ~12 % Carport/Fassade/Pooldach aus.'
  },
  {
    stufe: 2,
    field_name: 'E-Auto',
    field_type: 'enum',
    options: [
      'ja, vorhanden',
      'geplant / demnächst',
      'überlegt es',
      'nein',
      'nein, definitiv nie'
    ]
  },
  {
    stufe: 2,
    field_name: 'Einschränkung am Standort',
    field_type: 'set',
    options: [
      'Keine bekannt',
      'Denkmalschutz / Ortsbildschutz',
      'Bebauungsplan / Widmung',
      'Genehmigung offen',
      'Dachsanierung nötig',
      'Eternit / Asbest',
      'Statik unklar',
      'Dachfläche zu klein',
      'Verschattung durch Bäume',
      'Verschattung durch Nachbargebäude',
      'Tallage / wenig Wintersonne',
      'Schnee- / Frostlage',
      'Blitzschutz vorhanden',
      'Netzanschluss / Trafo begrenzt',
      'Einspeiselimit Netzbetreiber',
      'Zählerkasten / Verteiler zu klein',
      'Kabelweg schwierig',
      'Zufahrt / Kran nötig',
      'Mietobjekt -- Zustimmung Eigentümer',
      'Miteigentum / WEG-Beschluss nötig'
    ]
  }
];

/**
 * READ-ONLY. Zeigt für jedes geplante Feld, ob der Name schon vergeben ist, und wie viele
 * Optionen angelegt würden. IMMER zuerst laufen lassen -- ein Namenstreffer heißt: entweder
 * existiert das Feld schon (dann überspringt qfAnlegen() es), oder der Name kollidiert mit
 * einem fremden Feld und muss in QF_FIELDS geändert werden.
 */
function qfCheckVorhandene() {
  const res = pdFetch('/dealFields?limit=500', { method: 'get' });
  const vorhanden = new Map(res.data.data.map(f => [f.field_name, f]));

  Logger.log('Pipedrive hat aktuell ' + res.data.data.length + ' Deal-Felder. Geplant: ' + QF_FIELDS.length + '.');
  QF_FIELDS.forEach(f => {
    const optInfo = f.options ? ' -- ' + f.options.length + ' Optionen' : '';
    const alt = vorhanden.get(f.field_name);
    if (alt) {
      Logger.log('⚠ "' + f.field_name + '" EXISTIERT bereits (' + alt.field_type + ') [' + alt.field_code + '] -- wird übersprungen.');
    } else {
      Logger.log('○ [Stufe ' + f.stufe + '] "' + f.field_name + '" (' + f.field_type + ')' + optInfo + ' -- neu');
    }
  });
}

/**
 * Legt alle Felder aus QF_FIELDS mit stufe <= QF_STUFE an.
 * Idempotent: bestehende Feldnamen werden übersprungen, keine Duplikate.
 * Solange QF_DRY_RUN = true passiert NICHTS in Pipedrive, es wird nur geloggt.
 */
function qfAnlegen() {
  const res = pdFetch('/dealFields?limit=500', { method: 'get' });
  const vorhandeneNamen = new Set(res.data.data.map(f => f.field_name));

  const zuTun = QF_FIELDS.filter(f => f.stufe <= QF_STUFE);
  Logger.log((QF_DRY_RUN ? '=== DRY RUN ===' : '=== SCHARF ===') + ' Stufe <= ' + QF_STUFE + ': ' + zuTun.length + ' Felder.');

  let angelegt = 0, uebersprungen = 0, fehler = 0;

  zuTun.forEach(f => {
    if (vorhandeneNamen.has(f.field_name)) {
      Logger.log('⏭ "' + f.field_name + '" existiert schon -- übersprungen.');
      uebersprungen++;
      return;
    }

    const payload = { field_name: f.field_name, field_type: f.field_type };
    if (f.options) payload.options = f.options.map(label => ({ label: label }));

    if (QF_DRY_RUN) {
      Logger.log('[DRY RUN] würde anlegen: "' + f.field_name + '" (' + f.field_type + ')' + (f.options ? ' mit ' + f.options.length + ' Optionen' : ''));
      return;
    }

    const r = pdFetch('/dealFields', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload)
    });

    if (r.code === 200 || r.code === 201) {
      Logger.log('✓ "' + f.field_name + '" angelegt -- field_code: ' + r.data.data.field_code);
      angelegt++;
    } else {
      Logger.log('✗ "' + f.field_name + '" FEHLGESCHLAGEN (' + r.code + '): ' + r.raw);
      if (f.field_type === 'user') {
        Logger.log('   ↳ Hinweis: wenn Pipedrive den Typ "user" per API ablehnt, das Feld "Setter" manuell in der UI als Benutzerfeld anlegen (NICHT auf enum ausweichen).');
      }
      fehler++;
    }
  });

  Logger.log('\nFertig. angelegt: ' + angelegt + ' | übersprungen: ' + uebersprungen + ' | Fehler: ' + fehler);
  if (!QF_DRY_RUN && angelegt > 0) {
    Logger.log('👉 Jetzt qfReport() laufen lassen und die Ausgabe in docs/REFERENZ-Pipedrive-AppsScript.md eintragen.');
  }
}

/**
 * READ-ONLY. Gibt field_codes und Options-IDs aller Quali-Felder als fertige Markdown-Tabelle
 * aus -- 1:1 zum Einfügen in docs/REFERENZ-Pipedrive-AppsScript.md. Nach dem scharfen Lauf
 * ausführen; Options-IDs sind pro Feld neu vergeben und nirgends sonst dokumentiert.
 */
function qfReport() {
  const res = pdFetch('/dealFields?limit=500', { method: 'get' });
  const namen = new Set(QF_FIELDS.map(f => f.field_name));
  const treffer = res.data.data.filter(f => namen.has(f.field_name));

  Logger.log('| Feld | Typ | field_code |');
  Logger.log('|---|---|---|');
  treffer.forEach(f => Logger.log('| ' + f.field_name + ' | `' + f.field_type + '` | `' + f.field_code + '` |'));

  treffer.filter(f => f.options && f.options.length).forEach(f => {
    Logger.log('\n**' + f.field_name + '** -- Options-IDs:');
    f.options.forEach(o => Logger.log("  '" + o.label + "': " + o.id + ','));
  });

  const fehlend = QF_FIELDS.filter(f => !treffer.some(t => t.field_name === f.field_name));
  if (fehlend.length) {
    Logger.log('\n⚠ Noch nicht angelegt: ' + fehlend.map(f => f.field_name).join(', '));
  }
}
