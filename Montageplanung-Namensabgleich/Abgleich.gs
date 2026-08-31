// ============================================================
// Namensabgleich — liest Kunden (Spalte B) aus dem Ziel-Sheet,
// sucht den passenden Pipedrive-Deal (NUR LESEN) und schreibt
// Deal-ID/Adresse/PLZ/Telefon zurück (nur wenn DRY_RUN=false).
// ============================================================
// Rät bei Mehrdeutigkeit NICHT — markiert den Fall stattdessen zur
// manuellen Entscheidung (Kategorie UNKLAR/MEHRDEUTIG/NICHT_GEFUNDEN).

// FIX 31.08.2026 -- normalisiereName() war toter Code (nie aufgerufen) und ist entfernt.
// Der Namensvergleich passiert serverseitig in Pipedrives itemSearch, nicht hier.

// Vor dem echten Lauf einmal ausführen, um das Rohformat der itemSearch-Antwort
// zu verifizieren (Feldnamen wie item.type können sich zwischen Pipedrive-Versionen
// unterscheiden — hier notfalls parsePersonItems()/parseDealItems() unten anpassen).
const TEST_NAME = 'Verena Pizzini';
function testEinzelnerName() {
  const result = fetchPipedrive('/itemSearch?term=' + encodeURIComponent(TEST_NAME)
    + '&item_types=person,deal&limit=10');
  Logger.log(JSON.stringify(result, null, 2));
}

function sucheItems(name, itemTypes) {
  const result = fetchPipedrive('/itemSearch?term=' + encodeURIComponent(name)
    + '&item_types=' + itemTypes + '&limit=10');
  return (result.data && result.data.items) || [];
}

// FIX 31.08.2026 (Korrektheitsfehler): bewerteName() hat mit item_types=person,deal gesucht,
// aber nur die Personen-Treffer benutzt. itemSearch liefert EINE gemeinsam gerankte Liste, und
// limit=10 gilt fuer die Summe -- ein Kunde mit vielen passenden Deal-Titeln konnte die eigentlich
// gesuchte Person also aus den Top 10 draengen. Ergebnis waere ein falsches NICHT_GEFUNDEN gewesen,
// und zwar genau bei den Kunden mit der meisten Historie. Ausserdem widersprach es dem README
// ("Sucht nur nach Personen, nicht nach Deal-Titeln"). Jetzt wirklich nur Personen -- das halbiert
// zusaetzlich die Suchlast pro Name.
const SUCH_ITEM_TYPES = 'person';

// Filtert itemSearch-Treffer auf den angefragten Typ — tolerant gegenüber
// leicht unterschiedlichen Response-Formen (item.type direkt, oder verschachtelt).
function filterByType(items, type) {
  return items
    .map(it => it.item)
    .filter(Boolean)
    .filter(item => (item.type || item.result_type) === type);
}

// ---------- Personendaten (Adresse/PLZ/Telefon) ----------
let personFieldCache = null;
function getPersonFieldKeyByLabel(label) {
  if (!personFieldCache) {
    // limit=500: v2 paginiert bei 100. Ohne das kann ein Feld, das weiter hinten liegt, lautlos
    // fehlen -- und dann meldet pruefeKonfiguration() einen Scheinfehler ("Feld existiert nicht"),
    // obwohl es da ist. Gleiche Falle wie im Dateien-Klassifikation-Pilot am 27.08.
    personFieldCache = fetchPipedrive('/personFields?limit=500').data || [];
  }
  // v2-Gotcha (steht in CLAUDE.md, hier trotzdem erst falsch gemacht): das Klartext-Label steht
  // in field_name, der Identifier in field_code -- "name"/"key" sind bei personFields IMMER
  // undefined, liefern also lautlos nichts.
  const feld = personFieldCache.find(f =>
    (f.field_name || '').trim().toLowerCase() === label.trim().toLowerCase());
  return feld ? feld.field_code : null;
}

// Diagnose-Helper: einmal ausführen, wenn ein Feldname (PLZ_FIELD_LABEL o.ä.) plötzlich nicht
// mehr gefunden wird -- listet alle Person-Custom-Felder mit Name+field_code, damit man den
// aktuellen Namen nachschlagen kann statt zu raten.
function listePersonFields() {
  const felder = fetchPipedrive('/personFields?limit=500').data || [];
  felder.forEach(f => Logger.log('%s -> %s (%s)', f.field_name, f.field_code, f.field_type));
}

function ermittlePersonDaten(personId) {
  const person = fetchPipedrive('/persons/' + personId);
  const p = person.data || {};
  const custom = p.custom_fields || {};

  const telefon = (p.phones && p.phones.length) ? p.phones[0].value : '';

  const plzKey = getPersonFieldKeyByLabel(PLZ_FIELD_LABEL);
  const plzRoh = plzKey ? custom[plzKey] : undefined;
  const plz = (plzRoh && plzRoh.value !== undefined) ? plzRoh.value : (plzRoh || '');

  const adresseKey = getPersonFieldKeyByLabel('Adresse');
  let adresse = '';
  if (adresseKey && custom[adresseKey]) {
    const feld = custom[adresseKey];
    // Zusammengesetztes Adressfeld: formatted_address bevorzugen, sonst value (Freitext-Fall)
    adresse = feld.formatted_address || feld.value || '';
  }

  return { telefon: telefon, plz: plz, adresse: adresse };
}

// ---------- Deal-Auflösung: bevorzugt den "won"-Deal der Person ----------
function ermittleWonDeal(personId) {
  const result = fetchPipedrive('/deals?person_id=' + personId + '&status=won&limit=5');
  const deals = result.data || [];
  if (deals.length === 1) {
    // add_time kommt als volles Datetime von Pipedrive (z.B. "2026-07-14 09:32:10") -- als
    // reines Datum ins Sheet schreiben, Uhrzeit interessiert für die Sortierung nicht.
    // add_time kommt als "YYYY-MM-DD HH:MM:SS". Nur der Datumsteil interessiert.
    const addTime = deals[0].add_time ? deals[0].add_time.split(' ')[0] : '';
    return { gefunden: true, dealId: deals[0].id, dealTitel: deals[0].title, addTime: addTime };
  }
  if (deals.length > 1) {
    return { gefunden: false, hinweis: deals.length + ' won-Deals bei dieser Person — manuell auswählen: '
      + deals.map(d => d.id + ':' + d.title).join(' | ') };
  }
  return { gefunden: false, hinweis: 'Kein won-Deal bei dieser Person gefunden (evtl. noch offen, verloren, oder zu Lead konvertiert)' };
}

// ---------- Kernbewertung pro Name ----------
function bewerteName(name) {
  const items = sucheItems(name, SUCH_ITEM_TYPES);
  const personTreffer = filterByType(items, 'person');

  if (personTreffer.length === 0) {
    return { kategorie: 'NICHT_GEFUNDEN', hinweis: 'Keine Person in Pipedrive gefunden' };
  }

  if (personTreffer.length > 1) {
    // Nicht sofort aufgeben -- prüfen, welcher der Namens-Duplikate überhaupt einen won-Deal
    // hat. Das ist keine Ratearei, sondern eine echte Zusatzinfo aus Pipedrive: hat nur EIN
    // Kandidat einen gewonnenen Deal, ist das die Antwort. Haben mehrere oder keiner einen,
    // bleibt es MEHRDEUTIG/UNKLAR -- da wird weiterhin nicht geraten.
    const kandidatenMitWonDeal = [];
    personTreffer.forEach(p => {
      const wd = ermittleWonDeal(p.id);
      if (wd.gefunden) kandidatenMitWonDeal.push({ person: p, wonDeal: wd });
    });

    if (kandidatenMitWonDeal.length === 1) {
      const treffer = kandidatenMitWonDeal[0];
      const daten = ermittlePersonDaten(treffer.person.id);
      return {
        kategorie: 'WON',
        dealId: treffer.wonDeal.dealId,
        dealTitel: treffer.wonDeal.dealTitel,
        erstellungsdatum: treffer.wonDeal.addTime,
        personId: treffer.person.id,
        telefon: daten.telefon,
        plz: daten.plz,
        adresse: daten.adresse,
        hinweis: 'Von ' + personTreffer.length + ' gleichnamigen Personen hatte nur eine (id ' + treffer.person.id + ') einen won-Deal -- automatisch aufgelöst'
      };
    }
    if (kandidatenMitWonDeal.length > 1) {
      return {
        kategorie: 'MEHRDEUTIG',
        hinweis: kandidatenMitWonDeal.length + ' der ' + personTreffer.length + ' gleichnamigen Personen haben je einen won-Deal -- manuell auswählen: '
          + kandidatenMitWonDeal.map(k => k.person.id + ':' + k.wonDeal.dealId + ':' + k.wonDeal.dealTitel).join(' | ')
      };
    }
    return {
      kategorie: 'MEHRDEUTIG',
      hinweis: personTreffer.length + ' Personen-Kandidaten, KEINER hat einen won-Deal: '
        + personTreffer.map(p => p.id + ':' + p.name).join(' | ')
    };
  }

  const person = personTreffer[0];
  const wonDeal = ermittleWonDeal(person.id);
  if (!wonDeal.gefunden) {
    return { kategorie: 'UNKLAR', personId: person.id, hinweis: wonDeal.hinweis };
  }

  const daten = ermittlePersonDaten(person.id);
  return {
    kategorie: 'WON',
    dealId: wonDeal.dealId,
    dealTitel: wonDeal.dealTitel,
    erstellungsdatum: wonDeal.addTime,
    personId: person.id,
    telefon: daten.telefon,
    plz: daten.plz,
    adresse: daten.adresse,
    hinweis: ''
  };
}

// ---------- Log-Tab im selben Spreadsheet (nicht in den Datenzeilen) ----------
function getLogTab(sheet) {
  let tab = sheet.getSheetByName('Log_Namensabgleich');
  if (!tab) {
    tab = sheet.insertSheet('Log_Namensabgleich');
    tab.appendRow(['Zeitstempel', 'Zeile', 'Kunde', 'Kategorie', 'Deal-ID', 'Deal-Titel', 'Hinweis']);
  }
  return tab;
}

// ---------- Hauptlauf ----------
/**
 * "YYYY-MM-DD" als echtes Date-Objekt, aus den Teilen gebaut.
 *
 * FIX 31.08.2026: vorher wurde der reine String ins Sheet geschrieben. Ob Sheets daraus ein Datum
 * oder Text macht, haengt an der Zellformatierung -- und eine Spalte, in der Text und Datumswerte
 * gemischt stehen, sortiert nicht verlaesslich. Genau darauf baut aber
 * sortiereNachErstellungsdatum() auf. Bewusst NICHT new Date("2026-07-14"): das parst V8 als
 * UTC-Mitternacht, was in einer Zone westlich von UTC einen Tag zu frueh ergibt (dieselbe Falle
 * wie in Projektdoku-Generator/formatPipedriveDate). Aus den Teilen gebaut ist es eindeutig.
 */
function alsDatum(isoDatum) {
  const m = String(isoDatum || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function starteAbgleich() {
  const startZeit = Date.now();
  const spreadsheet = SpreadsheetApp.openById(TARGET_SHEET_ID);
  const tab = getTargetTab(spreadsheet);
  const logTab = getLogTab(spreadsheet);

  const letzteZeile = tab.getLastRow();
  if (letzteZeile < 2) {
    Logger.log('Keine Datenzeilen im Ziel-Sheet gefunden.');
    return;
  }

  const bereich = tab.getRange(2, 1, letzteZeile - 1, 17).getValues();
  const logZeilen = [];
  // FIX 31.08.2026: der Log-Puffer wird jetzt in einem finally geschrieben. Vorher lag das
  // setValues() linear am Ende -- eine Exception davor (Sheets-Quota beim Schreiben einer Zeile,
  // Pipedrive-4xx ausserhalb des inneren try) hat den KOMPLETTEN Lauf-Log verworfen. Bei DRY_RUN
  // ist der Log das einzige Ergebnis, und bei LIVE ist er der Nachweis, welche Zeilen schon
  // geschrieben wurden. Gleiche Luecke wie im Dateien-Klassifikation-Pilot (27.08.).
  // Zaehler MUESSEN ausserhalb des try stehen -- die Zusammenfassung unten liest sie nach dem
  // finally, und let ist blockskopiert.
  let verarbeitet = 0;
  let uebersprungenLeer = 0;
  let uebersprungenSchonGesetzt = 0;
  let zeitlimitErreicht = false;

  try {

    for (let i = 0; i < bereich.length; i++) {
      const zeile = bereich[i];
      const kunde = (zeile[COL.KUNDEN - 1] || '').toString().trim();
      const bestehendeDealId = (zeile[COL.DEAL_ID - 1] || '').toString().trim();

      if (!kunde) { uebersprungenLeer++; continue; }
      if (bestehendeDealId && !FORCE_OVERWRITE) { uebersprungenSchonGesetzt++; continue; }

      if (!DRY_RUN && verarbeitet >= LIMIT_PRO_LAUF) {
        Logger.log('LIMIT_PRO_LAUF (%s) erreicht — Rest bleibt für den nächsten Lauf offen.', LIMIT_PRO_LAUF);
        break;
      }
      if (Date.now() - startZeit > MAX_LAUFZEIT_MS) {
        zeitlimitErreicht = true;
        Logger.log('Weiches Zeitlimit erreicht — Rest bleibt für den nächsten Lauf offen (bereits gesetzte Deal-IDs werden übersprungen).');
        break;
      }

      const zeilenNr = i + 2;
      let bewertung;
      try {
        bewertung = bewerteName(kunde);
      } catch (e) {
        bewertung = { kategorie: 'HARD_ERROR', hinweis: e.message };
      }

      logZeilen.push([new Date(), zeilenNr, kunde, bewertung.kategorie,
        bewertung.dealId || '', bewertung.dealTitel || '', bewertung.hinweis || '']);

      if (!DRY_RUN && bewertung.kategorie === 'WON') {
        // FIX 31.08.2026, zwei Dinge auf einmal:
        //
        // a) Reihenfolge. Vorher wurde die Deal-ID ZUERST geschrieben. Bricht der Lauf danach ab
        //    (Quota, Zeitlimit, Netzfehler), hat die Zeile eine Deal-ID -- und weil genau daran die
        //    Idempotenz haengt ("bestehendeDealId -> ueberspringen"), wird sie NIE wieder angefasst.
        //    Adresse/PLZ/Telefon blieben dauerhaft leer, ohne dass es auffaellt. Deal-ID kommt jetzt
        //    zuletzt: sie ist die Quittung, dass der Rest schon steht.
        //
        // b) Anzahl der Schreibvorgaenge. Fuenf setValue() pro Zeile sind fuenf Roundtrips ins Sheet
        //    (CLAUDE.md: "niemals appendRow pro Zeile ... ein setValues() am Ende"). Adresse/PLZ/
        //    Telefon liegen zufaellig zusammenhaengend in L:N, gehen also in EINEM Aufruf raus.
        //    Damit 3 statt 5 Roundtrips, bei 44 Namen ~90 gesparte Aufrufe.
        const lBisN = [[
          bewertung.adresse || '',
          bewertung.plz || '',
          bewertung.telefon || ''
        ]];
        if (bewertung.adresse || bewertung.plz || bewertung.telefon) {
          tab.getRange(zeilenNr, COL.ADRESSE, 1, 3).setValues(lBisN);
        }
        const datum = alsDatum(bewertung.erstellungsdatum);
        if (datum) tab.getRange(zeilenNr, COL.ERSTELLUNGSDATUM).setValue(datum);
        tab.getRange(zeilenNr, COL.DEAL_ID).setValue(bewertung.dealId); // zuletzt, siehe a)
      }

      verarbeitet++;
    }
  } finally {
    if (logZeilen.length) {
      logTab.getRange(logTab.getLastRow() + 1, 1, logZeilen.length, logZeilen[0].length).setValues(logZeilen);
    }
  }

  const zusammenfassung = logZeilen.reduce((acc, z) => {
    acc[z[3]] = (acc[z[3]] || 0) + 1;
    return acc;
  }, {});
  Logger.log('Fertig. DRY_RUN=%s. %s Namen verarbeitet, %s übersprungen (schon Deal-ID), %s übersprungen (leer)%s.',
    DRY_RUN, verarbeitet, uebersprungenSchonGesetzt, uebersprungenLeer, zeitlimitErreicht ? ', Zeitlimit erreicht' : '');
  Logger.log('Kategorien: %s', JSON.stringify(zusammenfassung));
  Logger.log('Log-Tab: %s (Tab "Log_Namensabgleich")', spreadsheet.getUrl());
}

// ---------- Einmalige Sortierung nach Erstellungsdatum ----------
// Bewusst NICHT automatisch nach jedem Lauf aufgerufen: Valentins Vorgabe ist eine fixe,
// stabile Zeilenreihenfolge -- kein Auto-Resort bei jeder Änderung, sonst "springt" die
// Liste dem Montagepartner ständig unter den Augen weg. Nach dem Befüllen der Deal-IDs
// (und damit der Erstellungsdaten) einmal manuell aufrufen.
function sortiereNachErstellungsdatum() {
  const spreadsheet = SpreadsheetApp.openById(TARGET_SHEET_ID);
  const tab = getTargetTab(spreadsheet);
  const letzteZeile = tab.getLastRow();
  if (letzteZeile < 3) {
    Logger.log('Weniger als 2 Datenzeilen -- nichts zu sortieren.');
    return;
  }
  // getLastColumn() statt hartcodierter 17: kommt im Sheet je eine Spalte dazu, wuerde ein Sort
  // ueber nur 17 Spalten die Zeilen gegen den Rest verschieben und die Tabelle stillschweigend
  // zerreissen. Das ist der eine Aufruf hier, bei dem ein Fehler nicht reparierbar ist.
  const breite = Math.max(tab.getLastColumn(), 17);
  tab.getRange(2, 1, letzteZeile - 1, breite).sort({ column: COL.ERSTELLUNGSDATUM, ascending: true });
  Logger.log('Sortiert nach Erstellungsdatum (Spalte %s, aufsteigend). Zeilen ohne Datum landen am Ende.',
    COL.ERSTELLUNGSDATUM);
}
