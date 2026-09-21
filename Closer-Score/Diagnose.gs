// ============================================================
// DIAGNOSE — wer ist eigentlich der Closer?
// ============================================================
// Anlass: der DRY-Vollauf am 16.09.2026 zeigte fuer ALLE 86 qualifizierten
// Deals denselben owner_id (26984865). Damit ist owner_id als Empfaenger
// unbrauchbar — der Score ginge immer an dieselbe Person.
//
// Die Frage ist NICHT "welches Feld ist es wohl?", sondern "welches Feld am
// Deal enthaelt ueberhaupt verschiedene Menschen?". Deshalb raet dieses Script
// keine Feldnamen, sondern findet die Kandidaten selbst:
//   Ein Feld ist ein User-Feld, wenn sein Wert im Pipedrive-User-Verzeichnis
//   auffindbar ist. Das gilt fuer Top-Level-Felder und Custom Fields gleich.
// Danach zaehlt es, wie viele VERSCHIEDENE Menschen jedes Feld enthaelt — und
// genau das ist die Entscheidung: ein Feld mit einem einzigen Wert ueber alle
// Deals taugt nicht als Empfaenger, eines mit vielen taugt.
//
// Alles hier ist lesend. Es wird nichts geschrieben und nichts verschickt.

function diagnoseCloserFelder() {
  const verzeichnis = holeUserVerzeichnis();
  const labels = holeFeldLabels();

  const deals = holeFulfillmentDeals().filter(function (d) {
    return istBefuellt((d.custom_fields || {})[FELD_SEVDESK_SUMMARY], 'text');
  });
  if (deals.length === 0) { Logger.log('Keine qualifizierten Deals — Diagnose nicht moeglich.'); return; }
  Logger.log('=== Diagnose auf %s qualifizierten Deals ===\n', String(deals.length));

  // 1. Kandidaten finden: jedes Feld, dessen Wert bei mindestens einem Deal
  //    eine bekannte Pipedrive-User-ID ist. Kein Raten, kein Feldtyp-Filter.
  const kandidaten = {}; // key -> { quelle, treffer }
  deals.forEach(function (d) {
    sammleKandidaten(d, 'top', verzeichnis, kandidaten);
    sammleKandidaten(d.custom_fields || {}, 'custom', verzeichnis, kandidaten);
  });

  const keys = Object.keys(kandidaten);
  if (keys.length === 0) {
    Logger.log('⚠️ Kein einziges Feld enthaelt eine bekannte User-ID. Entweder ist das');
    Logger.log('   User-Verzeichnis leer (%s Eintraege) oder die Deals tragen keine User.', String(Object.keys(verzeichnis).length));
    return;
  }

  // 2. Fuer jeden Kandidaten: wie viele VERSCHIEDENE Menschen stehen drin?
  const auswertung = keys.map(function (key) {
    const quelle = kandidaten[key].quelle;
    const zaehler = {};
    let leer = 0;
    deals.forEach(function (d) {
      const topf = quelle === 'top' ? d : (d.custom_fields || {});
      const id = alsUserId(topf[key]);
      if (id === null) { leer++; return; }
      zaehler[id] = (zaehler[id] || 0) + 1;
    });
    return {
      key: key,
      quelle: quelle,
      label: quelle === 'custom' ? (labels[key] || '(unbekanntes Feld)') : key,
      leer: leer,
      verschieden: Object.keys(zaehler).length,
      zaehler: zaehler
    };
  });

  // Die beste Streuung zuerst — das ist die Rangliste der Brauchbarkeit.
  auswertung.sort(function (a, b) { return b.verschieden - a.verschieden; });

  Logger.log('=== Alle Felder, die Menschen enthalten — sortiert nach Streuung ===');
  Logger.log('| Feld | Quelle | verschiedene Menschen | leer bei |');
  Logger.log('|---|---|---|---|');
  auswertung.forEach(function (a) {
    Logger.log('| %s | %s | %s | %s von %s |',
      a.label, a.quelle === 'top' ? 'Deal-Feld' : 'Custom Field',
      String(a.verschieden), String(a.leer), String(deals.length));
  });

  Logger.log('\n=== Wer steht jeweils drin? ===');
  auswertung.forEach(function (a) {
    const zeilen = Object.keys(a.zaehler)
      .sort(function (x, y) { return a.zaehler[y] - a.zaehler[x]; })
      .map(function (id) { return (verzeichnis[id] || 'User') + ' [ID ' + id + '] (' + a.zaehler[id] + 'x)'; });
    Logger.log('%s [%s]: %s', a.label, a.key, zeilen.join(', ') || '— immer leer —');
  });

  // 3. Die Entscheidung vorbereiten, nicht sie faellen.
  const brauchbar = auswertung.filter(function (a) {
    return a.verschieden > 1 && a.leer < deals.length / 2;
  });
  Logger.log('\n=== Fazit ===');
  if (brauchbar.length === 0) {
    Logger.log('❌ KEIN Feld am Deal unterscheidet die Verkaeufer. Der Closer steht dann nicht');
    Logger.log('   am Deal — er muesste aus einer anderen Quelle kommen (z.B. der Aktivitaet,');
    Logger.log('   die den Termin gehalten hat, oder einem Feld, das erst noch angelegt wird).');
    Logger.log('   Das ist eine Entscheidung fuer Valentin, keine fuer das Script.');
  } else {
    Logger.log('Brauchbare Kandidaten (mehr als ein Mensch, bei der Mehrheit der Deals befuellt):');
    brauchbar.forEach(function (a) {
      Logger.log('  • %s — %s verschiedene Menschen, leer bei %s von %s Deals',
        a.label, String(a.verschieden), String(a.leer), String(deals.length));
      Logger.log('    Zugriff im Code: %s', a.quelle === 'top' ? 'deal.' + a.key : "deal.custom_fields['" + a.key + "']");
    });
    Logger.log('\nDas plausibelste Feld auswaehlen und in Scoring.gs die Owner-Ermittlung');
    Logger.log('darauf umstellen. Die Slack-IDs dazu kommen aus listePipedriveUser().');
  }
}

// Sammelt aus einem Objekt alle Keys ein, deren Wert eine bekannte User-ID ist.
function sammleKandidaten(objekt, quelle, verzeichnis, sammlung) {
  Object.keys(objekt).forEach(function (key) {
    const id = alsUserId(objekt[key]);
    if (id === null || !verzeichnis[id]) return;
    if (!sammlung[key]) sammlung[key] = { quelle: quelle, treffer: 0 };
    sammlung[key].treffer++;
  });
}

// Pipedrive liefert User-Referenzen mal als Zahl, mal als {id, name, email},
// bei Custom Fields auch mal als String. Alles auf eine Zahl bringen — oder
// null, wenn es keine sein kann.
function alsUserId(wert) {
  if (wert === null || wert === undefined) return null;
  if (typeof wert === 'number') return wert;
  if (typeof wert === 'string') return /^[0-9]+$/.test(wert) ? Number(wert) : null;
  if (typeof wert === 'object' && typeof wert.id === 'number') return wert.id;
  return null;
}

// { <userId>: "Name" } — auch inaktive User, damit alte Deals nicht ins Leere zeigen.
function holeUserVerzeichnis() {
  const json = fetchPipedriveJson('/users', {}, PIPEDRIVE_BASE_V1);
  const verzeichnis = {};
  (json.data || []).forEach(function (u) {
    verzeichnis[u.id] = u.name + (u.active_flag === false ? ' (inaktiv)' : '');
  });
  return verzeichnis;
}

// { <field_code>: "Label" } fuer die Custom Fields.
// ⚠️ limit=500 ist Pflicht: ohne kommen nur 100 der 168 Felder zurueck.
// ⚠️ In v2 steht das Label in field_name und die Kennung in field_code —
// `name` ist immer undefined (REFERENZ-Pipedrive-AppsScript.md).
function holeFeldLabels() {
  const json = fetchPipedriveJson('/dealFields', { limit: 500 });
  const labels = {};
  (json.data || []).forEach(function (f) {
    if (f.field_code) labels[f.field_code] = f.field_name;
  });
  return labels;
}
