// ============================================================
// Zusatz: gröbere/breitere Suche für die letzten 7 unauffindbaren Fälle
// ============================================================
// NUR LESEN. Sucht mit einzelnen Wort-Bestandteilen statt dem vollen
// Namen (z. B. nur Nachname, oder Firmenname ohne Rechtsform) und
// nutzt zusätzlich die generische itemSearch über alle Objekttypen
// (Deal/Person/Organisation/Lead) statt der engeren Einzel-Endpoints.
// Liefert nur Kandidaten zum Ansehen — entscheidet nichts automatisch.

const RECHTSFORM_STOPWORTE = ['gmbh', 'kg', 'og', 'gesbr', 'verein', 'e.v.', 'ev'];

const UNAUFFINDBARE_FAELLE = [
  'Opencarbox GmbH',
  'Christian van Dyk',
  'Sasa Usic',
  'Verein HW',
  'Waldhaus GmbH',
  'Johanna Seitz',
  'Kalman KG'
];

function tokenisiereName(name) {
  return name.split(/\s+/)
    .filter(w => RECHTSFORM_STOPWORTE.indexOf(w.toLowerCase().replace(/\./g, '')) === -1);
}

// Test an einem festen Namen — vor dem Vollauf einmal ausführen
const TEST_TOKEN = 'Waldhaus';
function testItemSearch() {
  const result = fetchPipedrive('/itemSearch?term=' + encodeURIComponent(TEST_TOKEN)
    + '&item_types=deal,person,organization,lead&limit=10');
  Logger.log(JSON.stringify(result, null, 2));
}

function loggeItemSearchTreffer(token) {
  try {
    const result = fetchPipedrive('/itemSearch?term=' + encodeURIComponent(token)
      + '&item_types=deal,person,organization,lead&limit=10');
    const items = (result.data && result.data.items) || [];
    if (items.length === 0) {
      Logger.log('    Token "%s": keine Treffer', token);
      return;
    }
    items.forEach(it => {
      const obj = it.item;
      const bezeichner = obj.title || obj.name || '(ohne Titel)';
      Logger.log('    Token "%s" -> %s %s: "%s"%s (score %s)',
        token, obj.type, obj.id, bezeichner,
        obj.status ? ' [' + obj.status + ']' : '', it.result_score);
    });
  } catch (e) {
    Logger.log('    Token "%s": Fehler %s', token, e.message);
  }
}

// Ad-hoc-Suche für einen einzelnen Begriff (z. B. Sean vermutet "Herzwerk" statt "Heinz Wehrle" für Verein HW)
const AD_HOC_SUCHBEGRIFF = 'Herzwerk';
function sucheAdHocBegriff() {
  Logger.log('=== Suche: %s ===', AD_HOC_SUCHBEGRIFF);
  loggeItemSearchTreffer(AD_HOC_SUCHBEGRIFF);
}

function breiteSucheUnklareFaelle() {
  UNAUFFINDBARE_FAELLE.forEach(name => {
    Logger.log('=== ' + name + ' ===');
    const tokens = tokenisiereName(name);
    // ganzer (bereinigter) Name zuerst
    loggeItemSearchTreffer(tokens.join(' '));
    // dann jedes einzelne Wort ab 3 Buchstaben (kurze Wörter wie "van" bringen nur Rauschen)
    tokens.forEach(token => {
      if (token.length >= 3 && token !== tokens.join(' ')) {
        loggeItemSearchTreffer(token);
      }
    });
  });
}
