// ============================================================
// BEWERTUNG — aus einem Deal wird Punktzahl, Ampel und Maengelliste
// ============================================================

// Maximum: 28 Punkte ohne Finanzierung, 31 mit.
//   7 Felder a 3 Punkte                                             = 21
//   Must knows + Projektdoku-Notizen a 2                            =  4
//   Fotos-Checkliste 0-3                                            =  3  -> 28
//   F-Rate/F-Laufzeit/F-Anzahlung 0-3 (nur bei "Finanzierung: Ja")  =  3  -> 31
// (Bis 16.09.2026 stand hier faelschlich 28/25 — die Checkliste war in der
//  Summe vergessen. Gerechnet hat der Code immer richtig.)
//
// Jeder Posten traegt eine `gruppe`. Daraus baut Slack.gs die drei Themen der
// Nachricht; hier wird nur mitgefuehrt, nicht formatiert.
function bewerteDeal(deal) {
  const cf = deal.custom_fields || {};
  const erreicht = [];   // { label, punkte }
  const fehlt = [];      // { label, punkte, hinweis }
  let punkte = 0;
  let maximum = 0;

  // ---- Die neun Einzelfelder ----
  SCORE_FELDER.forEach(function (feld) {
    maximum += feld.punkte;
    if (istBefuellt(cf[feld.code], feld.typ)) {
      punkte += feld.punkte;
      erreicht.push({ label: feld.label, punkte: feld.punkte, gruppe: feld.gruppe });
    } else {
      fehlt.push({ label: feld.label, punkte: feld.punkte, max: feld.punkte, erreichtePunkte: 0, hinweis: '', gruppe: feld.gruppe });
    }
  });

  // ---- Finanzierungs-Details, nur wenn "Ja" ----
  // Bei Nein (304) oder "nur als Vergleich" (306) entfallen sie komplett: sie
  // zaehlen weder als erreicht noch als moeglich. Genau so von Valentin
  // vorgegeben ("wenn finanzierung nein brauch ich das andere auch nicht").
  if (optionIds(cf[FINANZIERUNG_FELD]).indexOf(FINANZIERUNG_JA_ID) !== -1) {
    maximum += FINANZIERUNG_DETAILS.length;
    const fehlendeDetails = [];
    FINANZIERUNG_DETAILS.forEach(function (feld) {
      if (istBefuellt(cf[feld.code], feld.typ)) punkte += 1;
      else fehlendeDetails.push(feld.label);
    });
    const trefferDetails = FINANZIERUNG_DETAILS.length - fehlendeDetails.length;
    if (fehlendeDetails.length === 0) {
      erreicht.push({ label: 'Finanzierungs-Details', punkte: FINANZIERUNG_DETAILS.length, gruppe: GRUPPE_FINANZIERUNG_DETAILS });
    } else {
      fehlt.push({
        label: 'Finanzierungs-Details',
        gruppe: GRUPPE_FINANZIERUNG_DETAILS,
        punkte: fehlendeDetails.length,
        max: FINANZIERUNG_DETAILS.length,
        erreichtePunkte: trefferDetails,
        hinweis: fehlendeDetails.join(', ') + ' fehlt' + (fehlendeDetails.length > 1 ? 'en' : '') +
                 ' (' + trefferDetails + ' von ' + FINANZIERUNG_DETAILS.length + ' da)'
      });
    }
  }

  // ---- Fotos-Checkliste, gestaffelt 3/2/1 ----
  maximum += CHECKLISTE_PFLICHT.length;
  const gesetzt = optionIds(cf[CHECKLISTE_FELD]);
  const fehlendeHaken = CHECKLISTE_PFLICHT
    .filter(function (o) { return gesetzt.indexOf(o.id) === -1; })
    .map(function (o) { return o.label; });
  const treffer = CHECKLISTE_PFLICHT.length - fehlendeHaken.length;
  punkte += treffer;
  if (fehlendeHaken.length === 0) {
    erreicht.push({ label: 'Fotos-Checkliste', punkte: CHECKLISTE_PFLICHT.length, gruppe: GRUPPE_CHECKLISTE });
  } else {
    // Wenn gar nichts angehakt ist, ist das Aufzaehlen aller drei Namen nur
    // Laenge — dann sagt die Kurzform mehr.
    const alleFehlen = fehlendeHaken.length === CHECKLISTE_PFLICHT.length;
    fehlt.push({
      label: 'Fotos-Checkliste',
      gruppe: GRUPPE_CHECKLISTE,
      punkte: fehlendeHaken.length,
      max: CHECKLISTE_PFLICHT.length,
      erreichtePunkte: treffer,
      hinweis: alleFehlen
        ? 'nichts angehakt'
        : fehlendeHaken.join(', ') + ' fehlt' + (fehlendeHaken.length > 1 ? 'en' : '')
    });
  }

  const anteil = maximum > 0 ? punkte / maximum : 0;
  const ampel = anteil >= AMPEL_GRUEN_ANTEIL ? '🟢' : (anteil >= AMPEL_GELB_ANTEIL ? '🟡' : '🔴');

  return {
    dealId: deal.id,
    titel: deal.title || ('Deal ' + deal.id),
    closerId: closerAus(deal),          // nur noch Vergleichswert, NICHT der Empfaenger
    empfaenger: bestimmeCloser(deal),   // die Wahrheit steht in #sales, siehe SalesKanal.gs
    punkte: punkte,
    maximum: maximum,
    anteil: anteil,
    ampel: ampel,
    erreicht: erreicht,
    fehlt: fehlt,
    gruppen: fasseGruppenZusammen(erreicht, fehlt)
  };
}

// Pro Thema: erreichte und moegliche Punkte plus die Luecken. Die Reihenfolge
// kommt aus GRUPPEN, nicht aus der Reihenfolge der Treffer — sonst waechst und
// schrumpft die Nachricht je nachdem, was gerade fehlt.
function fasseGruppenZusammen(erreicht, fehlt) {
  return GRUPPEN.map(function (name) {
    let punkte = 0, maximum = 0;
    erreicht.forEach(function (p) { if (p.gruppe === name) { punkte += p.punkte; maximum += p.punkte; } });
    const luecken = [];
    fehlt.forEach(function (p) {
      if (p.gruppe !== name) return;
      // ⚠️ NICHT p.punkte aufaddieren: bei Checkliste und Finanzierungs-Details
      // ist das nur die Zahl der FEHLENDEN Haken. Das Maximum ist der ganze
      // Posten, und die schon erreichten Teilpunkte zaehlen mit.
      maximum += p.max;
      punkte += p.erreichtePunkte;
      luecken.push(p);
    });
    return { name: name, punkte: punkte, maximum: maximum, fehlt: luecken };
  }).filter(function (g) { return g.maximum > 0; }); // eine leere Gruppe taucht nicht auf
}

// ⚠️ NICHT MEHR der Empfaenger. Bis 23.09.2026 stand hier, CLOSER_FELD sage,
// wer die DM bekommt. Die Messung mit pruefeSalesKanal() hat das widerlegt:
// bei 63 von 75 zuordenbaren Deals widerspricht creator_user_id dem, was der
// Closer selbst in #sales gepostet hat. Der Empfaenger kommt jetzt aus
// bestimmeCloser() (SalesKanal.gs); diese Funktion bleibt als Vergleichswert.
// Pipedrive liefert User-Referenzen mal als blanke Zahl, mal als Objekt.
function closerAus(deal) {
  const wert = deal[CLOSER_FELD];
  if (wert === null || wert === undefined) return null;
  if (typeof wert === 'object') return wert.id !== undefined ? wert.id : null;
  return wert;
}

// ---------- Wert-Interpretation ----------

// Pipedrive v2 liefert Custom-Fields je nach Typ unterschiedlich. Ohne
// include_option_labels sind enum/set nackte Options-IDs (Zahl bzw. Array von
// Zahlen); mit Labels kaemen Objekte. Beides abgedeckt, damit ein spaeterer
// Parameter-Wechsel den Score nicht lautlos auf null zieht.
function istBefuellt(wert, typ) {
  if (wert === null || wert === undefined) return false;

  if (typ === 'set') return optionIds(wert).length > 0;
  if (typ === 'enum') return optionIds(wert).length > 0;

  if (typ === 'zahl') {
    // 0 ist bei F-Anzahlung ein legitimer Wert und zaehlt als ausgefuellt.
    // Nur null/undefined/'' sind "nicht ausgefuellt".
    if (wert === '') return false;
    const n = Number(wert);
    return !isNaN(n);
  }

  // typ === 'text' — deckt auch F-Laufzeit ab. Die ist varchar, nicht double:
  // laut Closing-Cheatsheet gehoert dort "0" hinein, wenn nichts besprochen
  // wurde. Leer ist also NICHT dasselbe wie "0", und "0" zaehlt hier als
  // ausgefuellt. Genau deshalb steht sie als 'text' in FINANZIERUNG_DETAILS.
  return String(wert).trim() !== '';
}

// Holt aus einem enum/set-Wert die Options-IDs als Zahlen-Array — egal ob
// Zahl, String, Objekt {id,label} oder Array davon.
function optionIds(wert) {
  if (wert === null || wert === undefined || wert === '') return [];
  const liste = Array.isArray(wert) ? wert : [wert];
  return liste.map(function (eintrag) {
    if (eintrag && typeof eintrag === 'object') return Number(eintrag.id);
    return Number(eintrag);
  }).filter(function (n) { return !isNaN(n); });
}
