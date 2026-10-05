// ===== VERLORENE SEELEN (02.10.2026) =====
//
// Abgleich #sales ab 11.08. gegen die Partner-Sheets: gewonnene Fulfillment-Deals, die in KEINEM
// Sheet stehen. Ursache: syncNeueZeilen() nimmt nur Deals mit Projektdoku-Status 234/235 -- bei
// diesen ist das Feld leer (kein Strom/keine Stromrechnung da -> Doku nie "rdy for creation").
//
// Hier wird die Zeile direkt über createSheetRowForDeal() angelegt, OHNE den Doku-Status in
// Pipedrive anzufassen (sonst würde auch der Projektdoku-Generator losgehen). Schreibt NIE nach
// Pipedrive (nur GET der Deals).
//
// Schutz pro Deal (sonst übersprungen + geloggt): status=won, kein Stornogrund, Partner gesetzt.
//
// Ablauf:  1. verloreneSeelenVorschau()  -> nur lesen, zeigt Partner + ob schon eine Zeile da ist
//          2. verloreneSeelenEinpflegen() -> legt die Zeilen an (Ergebnis im Ausführungsprotokoll + Log-Sheet)

const VERLORENE_SEELEN = [
  // ALE (7492 + 7350 = verschoben, nicht storniert)
  7362, 7538, 7483, 7493, 7468, 7550, 5069, 7492, 7350,
  // Kreuzeder
  7402, 6814, 7657, 7500, 7446,
  // Berger
  7439
];

const STORNOGRUND_FIELD_KEY_VS = '78f141d32919d24cc9e45f070f260bd421b984e3';

// Nachzügler (02.10. abends): 4975 Rene Schwab -- won 09.09., verschoben auf 01.02.2027, SBG ->
// Kreuzeder. Am Deal fehlten Montagepartner + Kundenordner -> erst in Pipedrive den Partner setzen,
// Ordnererstellung abwarten (Link im Deal), dann hier einpflegen. Ohne die beiden bricht der
// Schutz unten bzw. createSheetRowForDeal() sauber ab (kein-partner / kein-ordnerlink).
const VERLORENE_SEELEN_NACHZUEGLER = [4975];

// Restseelen (03.10.): gewonnen + Montagepartner gesetzt, aber nie nach Fulfillment verschoben
// (meist Pipeline 1 Stage 1) -> in keinem Sheet. VP 03.10.: „alle verlorenen Seelen einem Partner
// zuordnen“. Zeile kommt ins Sheet des Partners, der AM DEAL steht; Pipeline/Stage bleibt unberührt.
// Vorschau zeigt zusätzlich, ob der Partner zum Bundesland passt (Regel Montagepartner-aus-Bundesland).
// 03.10.: 4975 mit rein (= VERLORENE_SEELEN_NACHZUEGLER), damit EIN Lauf alles anlegt. Liste vor dem
// Einpflegen an Marcos Freigabe anpassen; Deals ohne Ordner-Link werden ohnehin übersprungen.
const VERLORENE_SEELEN_REST = [
  6754, 6762, 7112, 418, 4975, // Kreuzeder (418 = Altdeal 2024, Stage 6_Geliefert)
  6734, 6775, 7155,           // ALE
  7091,                       // Berger
  6864, 6872, 6964, 7040,     // Tirol (6864 on hold, Dachdecker zuerst)
  7321                        // Vorarlberg
];

const BUNDESLAND_FIELD_KEY_VS = '43a5e2fa23f0659ac07ca499a629d5c391cfc440';
const BUNDESLAND_VS = { 162: 'Wien', 163: 'Niederösterreich', 164: 'Oberösterreich', 165: 'Salzburg',
  166: 'Kärnten', 167: 'Steiermark', 168: 'Tirol', 169: 'Vorarlberg', 170: 'Burgenland' };
// = BUNDESLAND_TO_MONTAGEPARTNER aus Montagepartner-aus-Bundesland/Code.js (eigenes Projekt, darum Kopie)
const BUNDESLAND_PARTNER_VS = { 162: 157, 163: 157, 170: 157, 167: 157, 166: 158, 164: 161, 165: 161, 168: 243, 169: 244 };

function verloreneSeelenRestVorschau() {
  verloreneSeelen_(false, VERLORENE_SEELEN_REST);
}

function verloreneSeelenRestEinpflegen() {
  verloreneSeelen_(true, VERLORENE_SEELEN_REST);
}

function verloreneSeelenVorschau() {
  verloreneSeelen_(false, VERLORENE_SEELEN);
}

function verloreneSeelenEinpflegen() {
  verloreneSeelen_(true, VERLORENE_SEELEN);
}

function verloreneSeelenNachzueglerVorschau() {
  verloreneSeelen_(false, VERLORENE_SEELEN_NACHZUEGLER);
}

function verloreneSeelenNachzueglerEinpflegen() {
  verloreneSeelen_(true, VERLORENE_SEELEN_NACHZUEGLER);
}

function verloreneSeelen_(scharf, dealIds) {
  // Derselbe Script-Lock wie syncNeueZeilen() (5-Min-Trigger): sonst berechnen beide dieselbe
  // nächste freie Zeile im selben Partner-Sheet und überschreiben sich. waitLock statt tryLock:
  // von Hand gestartet, also lieber kurz warten als still aussteigen.
  const lock = LockService.getScriptLock();
  if (scharf) lock.waitLock(120000);

  starteLauf(scharf ? 'verloreneSeelenEinpflegen' : 'verloreneSeelenVorschau');
  const cache = neuerSheetCache();
  const zaehler = {};
  try {
    dealIds.forEach(dealId => {
      const deal = fetchPipedrive(`deals/${dealId}`);
      const cf = deal.custom_fields || {};
      const partner = MONTAGEPARTNER_ID_TO_NAME[cf[MONTAGEPARTNER_FIELD_KEY]];
      const kopf = `${dealId} ${deal.title} | ${partner || '(kein Partner)'} | status=${deal.status} stage=${deal.stage_id}`;

      let grund = null;
      if (deal.status !== 'won') grund = `nicht gewonnen (status=${deal.status})`;
      else if (cf[STORNOGRUND_FIELD_KEY_VS]) grund = `Stornogrund gesetzt (${cf[STORNOGRUND_FIELD_KEY_VS]})`;
      else if (!partner) grund = 'kein Montagepartner am Deal';
      if (grund) {
        zaehler.uebersprungen = (zaehler.uebersprungen || 0) + 1;
        Logger.log(`ÜBERSPRUNGEN ${kopf} -- ${grund}`);
        logRow('verloreneSeelen', dealId, partner || '', 'Zeile', 'MANUELL_KLAEREN', grund);
        return;
      }

      if (!scharf) {
        const eintrag = cachePartnerEintrag(partner, cache);
        const zeile = eintrag.fehler ? null
          : cacheDealIdZeilen(eintrag, cacheSpaltenIndex(eintrag, COL.dealId))[String(dealId)];
        const ordnerFehlt = !cf[KUNDENORDNER_LINK_FIELD_KEY];
        const blId = cf[BUNDESLAND_FIELD_KEY_VS];
        const soll = BUNDESLAND_PARTNER_VS[blId];
        const bl = !blId ? ' | ⚠ Bundesland leer'
          : soll === Number(cf[MONTAGEPARTNER_FIELD_KEY]) ?` | ${BUNDESLAND_VS[blId]} ✓`
          : ` | ⚠ ${BUNDESLAND_VS[blId] || blId} -> laut Regel ${MONTAGEPARTNER_ID_TO_NAME[soll] || '?'}`;
        Logger.log(`VORSCHAU ${kopf}${bl} -- ${eintrag.fehler ? `Sheet-Fehler: ${eintrag.fehler}`
          : zeile ? `steht schon in Zeile ${zeile}`
          : ordnerFehlt ? 'Kundenordner-Link fehlt noch -> würde übersprungen' : 'würde angelegt'}`);
        const art = eintrag.fehler ? 'sheet-fehler' : zeile ? 'steht-schon' : ordnerFehlt ? 'ordner-fehlt' : 'wuerde-angelegt';
        zaehler[art] = (zaehler[art] || 0) + 1;
        return;
      }

      const result = createSheetRowForDeal(deal, cache);
      zaehler[result.code] = (zaehler[result.code] || 0) + 1;
      Logger.log(`${kopf} -- [${result.code}] ${result.text}`);
    });
  } finally {
    Logger.log('Summe: ' + JSON.stringify(zaehler));
    if (scharf) logLaufEnde(zaehler.uebersprungen ? 'MANUELL_KLAEREN' : 'OK', zaehler);
    flushLog();
    if (scharf) lock.releaseLock();
  }
}
