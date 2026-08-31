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
    // won_time IST am 31.08.2026 gegen die v2-Doku verifiziert (Standardfeld der Deal-Antwort,
    // kein include_fields noetig) -- der frueher hier stehende Unsicherheits-Vorbehalt ist damit
    // erledigt. Zusaetzlich liefert v2 "local_won_date" bereits als reines Datum in der
    // Firmen-Zeitzone; das ist die bessere Quelle als selbst aus UTC umzurechnen, deshalb Vorrang.
    const addTime = pipedriveDatumTeil(deals[0].add_time);
    const wonTime = pipedriveDatumTeil(deals[0].local_won_date || deals[0].won_time);
    return { gefunden: true, dealId: deals[0].id, dealTitel: deals[0].title, addTime: addTime, wonTime: wonTime };
  }
  if (deals.length > 1) {
    return { gefunden: false, hinweis: deals.length + ' won-Deals bei dieser Person — manuell auswählen: '
      + deals.map(d => d.id + ':' + d.title).join(' | ') };
  }
  return { gefunden: false, hinweis: 'Kein won-Deal bei dieser Person gefunden (evtl. noch offen, verloren, oder zu Lead konvertiert)' };
}

// ---------- Anreicherung für bereits bekannte (z.B. manuell eingetragene) Deal-ID ----------
// Für Zeilen, wo Valentin die Deal-ID selbst gesetzt hat (z.B. nach einer MEHRDEUTIG/UNKLAR-
// Entscheidung im Chat) -- Namenssuche komplett übersprungen, direkt der Deal abgerufen.
function ermittleDatenFuerDeal(dealId) {
  const result = fetchPipedrive('/deals/' + dealId);
  const deal = result.data;
  if (!deal) return null;

  // v2 liefert person_id als blanken Integer (in v1 war es ein Objekt) -- am 31.08.2026 gegen die
  // Doku verifiziert: "person_id": 1, // No longer an object. Die frueher hier stehende
  // Abwehrkette (.value || .id || ...) ist damit nicht mehr noetig; das verschachtelte Objekt kam
  // aus itemSearch, das ist eine andere Antwortform als /deals/{id}.
  const personId = deal.person_id || null;
  const daten = personId ? ermittlePersonDaten(personId) : { telefon: '', plz: '', adresse: '' };

  return {
    dealTitel: deal.title || '',
    adresse: daten.adresse,
    plz: daten.plz,
    telefon: daten.telefon,
    erstellungsdatum: pipedriveDatumTeil(deal.add_time),
    gewonnenAm: pipedriveDatumTeil(deal.local_won_date || deal.won_time)
  };
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
        gewonnenAm: treffer.wonDeal.wonTime,
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
    gewonnenAm: wonDeal.wonTime,
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

/**
 * Pipedrive-v2-Zeitstempel -> "YYYY-MM-DD" in Script-Zeitzone.
 *
 * FIX 31.08.2026 (kritisch): der Code hat `add_time.split(' ')[0]` gemacht, also das v1-Format
 * "2026-07-14 09:32:10" angenommen. **v2 liefert ISO/TZ**: "2026-07-14T09:32:10Z" -- da ist kein
 * Leerzeichen drin, split(' ')[0] gibt den GANZEN String zurueck. Der alsDatum()-Regex greift
 * darauf nicht, also wurde das Erstellungsdatum gar nicht geschrieben und die Notiz haette
 * "Deal gewonnen am 2026-07-14T09:32:10Z" gelautet. Damit war auch
 * sortiereNachErstellungsdatum() wirkungslos -- es gab nichts zu sortieren.
 * Belegt: https://pipedrive.readme.io/docs/pipedrive-api-v2-migration-guide#deal-object
 * ("add_time": "2024-07-01T05:46:33Z", // In TZ format now)
 *
 * Umrechnung bewusst ueber ein echtes Date + formatDate in Script-Zeitzone, nicht per String-
 * Abschneiden: ein Deal, der um 23:30 UTC angelegt wurde, gehoert in Wien schon zum naechsten Tag.
 * Das "Z" macht den String eindeutig, deshalb ist new Date() hier - anders als bei einem nackten
 * "2026-07-14" - unproblematisch.
 * Das alte v1-Format mit Leerzeichen wird weiter akzeptiert, damit ein Format-Rueckschritt nicht
 * still zu leeren Datumsfeldern fuehrt.
 */
function pipedriveDatumTeil(zeitstempel) {
  const roh = String(zeitstempel || '').trim();
  if (!roh) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(roh)) return roh; // schon ein reines Datum (z.B. local_won_date)
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(roh)) {
    const alsInstant = new Date(roh.indexOf('T') !== -1 ? roh : roh.replace(' ', 'T') + 'Z');
    if (!isNaN(alsInstant.getTime())) {
      return Utilities.formatDate(alsInstant, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
  }
  Logger.log('WARNUNG: Zeitstempel "%s" nicht interpretierbar -- Datum bleibt leer.', roh);
  return '';
}

/**
 * Setzt die "Deal gewonnen am"-Notiz an der Deal-ID-Zelle, OHNE eine vorhandene Notiz zu zerstoeren.
 *
 * FIX 31.08.2026: vorher ein blankes setNote(), das den Zellinhalt komplett ersetzt. Laut Kommentar
 * im Code werden Notizen an derselben Zelle aber auch fuer manuelle Vermerke benutzt ("unsichere
 * manuelle Zuordnung") -- ein Lauf haette solche Vermerke stillschweigend geloescht, und niemand
 * haette gemerkt, dass da mal etwas stand.
 */
function setzeGewonnenNotiz(zelle, gewonnenAm) {
  const zeile = 'Deal gewonnen am ' + gewonnenAm;
  const bestehend = (zelle.getNote() || '').trim();
  if (!bestehend) { zelle.setNote(zeile); return; }
  if (bestehend.indexOf(zeile) !== -1) return; // schon drin, nichts zu tun
  // Frueheres "Deal gewonnen am ..." ersetzen, alles andere behalten.
  const ohneAlteZeile = bestehend.split('\n').filter(z => z.indexOf('Deal gewonnen am ') !== 0);
  zelle.setNote(ohneAlteZeile.concat(zeile).join('\n').trim());
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

      if (bestehendeDealId && !FORCE_OVERWRITE) {
        // Namenssuche überspringen (die Deal-ID steht schon fest, z.B. weil Valentin eine
        // MEHRDEUTIG/UNKLAR-Zeile manuell im Chat aufgelöst hat) -- aber Adresse/PLZ/Telefon/
        // Erstellungsdatum/Gewonnen-Notiz trotzdem nachziehen, wenn sie noch leer sind. Sonst
        // müsste Valentin die nach jeder manuellen Deal-ID von Hand nachtragen.
        uebersprungenSchonGesetzt++;
        if (!DRY_RUN) {
          const zn = i + 2;
          // FIX 31.08.2026 (N+1): hier standen zwei zusaetzliche getValues()/getValue()-Aufrufe pro
          // Zeile -- obwohl "bereich" oben schon die KOMPLETTE Datenmatrix im Speicher haelt. Bei
          // Kreuzeder (~82 Zeilen, ueberwiegend mit Deal-ID) waren das ~164 unnoetige Roundtrips
          // ins Sheet pro Lauf. CLAUDE.md: "Verknuepfte Entitaeten einmal vorladen statt pro
          // Datensatz einzeln abzurufen."
          const lBisNBestehend = [
            zeile[COL.ADRESSE - 1], zeile[COL.PLZ - 1], zeile[COL.TELEFON - 1]
          ];
          const erstellungsdatumBestehend = zeile[COL.ERSTELLUNGSDATUM - 1];
          // FIX 31.08.2026 (unerfuellbarer Guard): die Bedingung hing auch an Adresse/PLZ/Telefon.
          // Hat eine Person in Pipedrive gar keine Telefonnummer, bleibt die Spalte zwangslaeufig
          // leer -- und dann wurde die Zeile bei JEDEM Lauf erneut angereichert (2 API-Calls, ohne
          // dass sich je etwas aendert). Dieselbe Fehlerklasse wie die Selbst-Trigger-Kette in
          // Ordnererstellung: die Abbruchbedingung muss erreichbar sein.
          // add_time existiert bei jedem echten Deal, das Erstellungsdatum ist also der zuverlaessige
          // Marker "diese Zeile wurde schon angereichert". Nachtraeglich in Pipedrive ergaenzte
          // Adressen holt man bei Bedarf mit FORCE_OVERWRITE.
          if (!erstellungsdatumBestehend) {
            try {
              const angereichert = ermittleDatenFuerDeal(bestehendeDealId);
              if (angereichert) {
                tab.getRange(zn, COL.ADRESSE, 1, 3).setValues([[
                  lBisNBestehend[0] || angereichert.adresse || '',
                  lBisNBestehend[1] || angereichert.plz || '',
                  lBisNBestehend[2] || angereichert.telefon || ''
                ]]);
                if (!erstellungsdatumBestehend) {
                  const datum = alsDatum(angereichert.erstellungsdatum);
                  if (datum) tab.getRange(zn, COL.ERSTELLUNGSDATUM).setValue(datum);
                }
                if (angereichert.gewonnenAm) {
                  setzeGewonnenNotiz(tab.getRange(zn, COL.DEAL_ID), angereichert.gewonnenAm);
                }
                logZeilen.push([new Date(), zn, kunde, 'ANGEREICHERT', bestehendeDealId, angereichert.dealTitel, 'Deal-ID war schon gesetzt -- Adresse/PLZ/Telefon/Datum nachgezogen']);
              }
            } catch (e) {
              logZeilen.push([new Date(), zn, kunde, 'ANREICHERUNG_FEHLER', bestehendeDealId, '', e.message]);
            }
          }
        }
        continue;
      }

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

        const dealIdZelle = tab.getRange(zeilenNr, COL.DEAL_ID);
        dealIdZelle.setValue(bewertung.dealId); // zuletzt, siehe a)
        // Gewonnen-Datum ist bewusst KEINE eigene Sheet-Spalte (Kopfzeile ist fix, siehe
        // project_montage_sheets_migration) -- nur intern relevant, deshalb als Zellen-Notiz an
        // der Deal-ID, gleiche Konvention wie bei unsicheren manuellen Zuordnungen (2026-08-31).
        if (bewertung.gewonnenAm) {
          setzeGewonnenNotiz(dealIdZelle, bewertung.gewonnenAm);
        }
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
