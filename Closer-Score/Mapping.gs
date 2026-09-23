// ============================================================
// MAPPING — CLOSER_SLACK_IDS automatisch erzeugen
// ============================================================
// Das Mapping von Hand zu pflegen heisst: Pipedrive-ID raussuchen, Slack-Profil
// oeffnen, "Mitglieds-ID kopieren", einfuegen, und das fuenfmal ohne Vertipper.
// Das muss nicht sein — beide Seiten kennen die Firmen-E-Mail, und die ist der
// verlaessliche gemeinsame Nenner.
//
// baueCloserMapping() holt die Pipedrive-User, matcht sie ueber die E-Mail gegen
// die Slack-Tabelle unten und druckt den fertigen Block ins Log. Der wird in
// Config.gs ueber CLOSER_SLACK_IDS drueberkopiert — bewusst als Copy-Paste und
// nicht automatisch geschrieben: wer eine DM bekommt, soll im Code stehen und
// nicht in einer Property, die man beim Nachlesen uebersieht.
//
// Alles hier ist lesend. Es wird nichts geschrieben und nichts verschickt.

// Slack-Mitglieds-IDs, abgefragt am 22.09.2026 ueber die Slack-Nutzersuche.
// Schluessel ist die E-Mail in Kleinbuchstaben.
// Kommt jemand neu dazu: hier eine Zeile ergaenzen, dann baueCloserMapping().
const SLACK_NACH_MAIL = {
  'valentin@rp-energietechnik.at': 'U0BM9J0KPQT',   // Valentin Palla
  'marco@rp-energietechnik.at':    'U06TCB95A9Y',   // Marco Benhammadi, CFO
  'andre@rp-energietechnik.at':    'U07030XUKJ8',   // André Rechberger, CSO
  'sean@rp-energietechnik.at':     'U08356D2VFU',   // Sean Golubovic, CTO
  'sergen@rp-energietechnik.at':   'U0BGM3RRYB0',   // Sergen Caf
  'patryk@rp-energietechnik.at':   'U0BMM6A63LH',   // Patryk Mazur
  'ramon@rp-energietechnik.at':    'U0BHKLB6GUU',   // Ramon Beyeler
  'jonathan@rp-energietechnik.at': 'U0BH9M1QTD1',   // Jonathan Rössner
  'sven@rp-energietechnik.at':     'U0BPY5FKQ5C',   // Sven Mlinar
  'florian@rp-energietechnik.at':  'U0C27EY6KT5'    // florian
};

function baueCloserMapping() {
  // 1. Wer taucht ueberhaupt als Closer auf, und wie oft? Nur ueber diese Leute
  //    lohnt das Nachdenken — der Rest des Verzeichnisses ist Rauschen.
  const deals = holeFulfillmentDeals().filter(function (d) {
    return istBefuellt((d.custom_fields || {})[FELD_SEVDESK_SUMMARY], 'text');
  });
  const anzahl = {};
  deals.forEach(function (d) {
    const id = closerAus(d);
    if (id === null || id === undefined) return;
    anzahl[id] = (anzahl[id] || 0) + 1;
  });

  // 2. Pipedrive-Verzeichnis mit E-Mail — holeUserVerzeichnis() liefert nur den
  //    Namen, und ueber Namen zu matchen geht bei "Andre" vs "André" schief.
  const json = fetchPipedriveJson('/users', {}, PIPEDRIVE_BASE_V1);
  const user = {};
  (json.data || []).forEach(function (u) {
    user[u.id] = { name: u.name, mail: (u.email || '').toLowerCase(), aktiv: u.active_flag !== false };
  });

  Logger.log('=== Closer laut %s auf %s qualifizierten Deals ===\n', CLOSER_FELD, String(deals.length));

  const ids = Object.keys(anzahl).sort(function (a, b) { return anzahl[b] - anzahl[a]; });
  const zeilen = [];
  const offen = [];

  ids.forEach(function (id) {
    const u = user[id];
    if (!u) {
      Logger.log('  ⚠️ Pipedrive-User %s (%s Deals) steht nicht im Verzeichnis — geloescht?', id, String(anzahl[id]));
      offen.push(id);
      return;
    }
    const slack = SLACK_NACH_MAIL[u.mail];
    if (slack) {
      Logger.log('  ✅ %s  (%s Deals)  %s  →  %s', u.name, String(anzahl[id]), u.mail, slack);
      zeilen.push('  ' + id + ': \'' + slack + '\',' + fuelle(30 - String(id).length - slack.length) +
                  '// ' + u.name + '  (' + anzahl[id] + ' von ' + deals.length + ' Deals)');
    } else {
      Logger.log('  ❌ %s  (%s Deals)  %s  →  keine Slack-ID zu dieser Adresse', u.name, String(anzahl[id]), u.mail || '(keine E-Mail hinterlegt)');
      offen.push(u.name + ' <' + (u.mail || 'ohne E-Mail') + '>');
      zeilen.push('  // ' + id + ': \'U…\',   // ' + u.name + '  (' + anzahl[id] + ' Deals) — Slack-ID fehlt');
    }
  });

  Logger.log('\n=== Das hier in Config.gs ueber CLOSER_SLACK_IDS kopieren ===\n');
  Logger.log('const CLOSER_SLACK_IDS = {\n%s\n};', zeilen.join('\n'));

  if (offen.length) {
    Logger.log('\n⚠️ Ohne Slack-ID bleiben: %s', offen.join(', '));
    Logger.log('   Entweder ist die Pipedrive-E-Mail eine andere als die Slack-E-Mail,');
    Logger.log('   oder die Person fehlt in SLACK_NACH_MAIL (Mapping.gs).');
  }

  // 3. Die Warnung, die wichtiger ist als das Mapping selbst.
  if (ids.length) {
    const groesster = anzahl[ids[0]] / deals.length;
    if (groesster > 0.7) {
      Logger.log('\n⚠️ ACHTUNG: %s%% aller Deals haengen an einer einzigen Person (%s).',
                 String(Math.round(groesster * 100)), (user[ids[0]] || {}).name || ids[0]);
      Logger.log('   Falls das nicht wirklich der Closer ist, sondern nur der, der die Deals');
      Logger.log('   anlegt, bekommt derjenige fast alle Rueckmeldungen — und die Erziehung');
      Logger.log('   erreicht die anderen nie. Vor dem Scharfschalten an 2-3 bekannten Deals');
      Logger.log('   gegenpruefen: steht in %s der Mensch, der das Geschaeft gemacht hat?', CLOSER_FELD);
    }
  }
}

function fuelle(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += ' ';
  return s;
}
