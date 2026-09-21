// ============================================================
// SLACK — die einzige Schreiboperation dieses Projekts
// ============================================================
// HTTP-Muster uebernommen aus Lieferkalender-Slack/Config.gs:161. Bewusst
// kopiert statt neu geschrieben: die Fallen sind dort schon geloest.
// Insbesondere: Slack antwortet auch bei FEHLERN mit HTTP 200, der Erfolg
// steht in json.ok. Nie dem Statuscode trauen.

function fetchSlackJson(method, params, payload) {
  const url = SLACK_API_BASE + '/' + method + (params ? '?' + toQueryString(params) : '');
  for (let versuch = 1; versuch <= 3; versuch++) {
    const optionen = {
      method: payload ? 'post' : 'get',
      headers: { Authorization: 'Bearer ' + getSlackToken() },
      muteHttpExceptions: true
    };
    if (payload) {
      optionen.contentType = 'application/json; charset=utf-8';
      optionen.payload = JSON.stringify(payload);
    }
    const response = UrlFetchApp.fetch(url, optionen);
    const code = response.getResponseCode();
    if (code === 429) {
      const retryAfter = Number(response.getHeaders()['Retry-After'] || response.getHeaders()['retry-after'] || 2);
      if (versuch === 3) throw new Error('Slack-Rate-Limit (' + method + ') nach 3 Versuchen weiter aktiv.');
      Utilities.sleep(retryAfter * 1000);
      continue;
    }
    const json = JSON.parse(response.getContentText());
    if (!json.ok) {
      // Bei missing_scope nennt Slack im Body beides: welchen Scope der Call
      // braucht (needed) und welche der Token wirklich traegt (provided).
      let zusatz = '';
      if (json.needed || json.provided) {
        zusatz = ' | benoetigt: ' + (json.needed || '?') + ' | Token hat: ' + (json.provided || '?');
      }
      throw new Error('Slack-API-Fehler bei ' + method + ': ' + json.error + zusatz);
    }
    return json;
  }
}

// DM an einen Menschen: die USER-ID (U...) direkt als `channel` uebergeben.
// Kein conversations.open, kein im:write — chat:write reicht.
function sendeDm(slackUserId, text) {
  return fetchSlackJson('chat.postMessage', null, {
    channel: slackUserId,
    text: text,
    unfurl_links: false,
    unfurl_media: false
  });
}

// ============================================================
// NACHRICHTENTEXT
// ============================================================
// Aufgebaut in drei Themen statt einer langen Liste: bei einem schwachen Deal
// standen sonst zehn Stichpunkte untereinander und der Closer sah nur eine Wand.
// Drei Bloecke mit je einem Punktestand zeigen ihm sofort, WO er nachlegen muss.
// Vollstaendige Themen kosten nur eine Zeile am Ende — das Lob soll da sein,
// aber nicht den Blick auf die Luecken verstellen.

function baueNachricht(ergebnis) {
  const zeilen = [];
  zeilen.push(ergebnis.ampel + ' *Projektübergabe ' + ergebnis.titel + '* — ' +
              ergebnis.punkte + ' von ' + ergebnis.maximum + ' Punkten');

  const offen = ergebnis.gruppen.filter(function (g) { return g.fehlt.length > 0; });
  const vollstaendig = ergebnis.gruppen.filter(function (g) { return g.fehlt.length === 0; });

  if (offen.length === 0) {
    zeilen.push('');
    zeilen.push('Vollständig übergeben. Danke — so kann Fulfillment sofort loslegen. 👌');
  } else {
    zeilen.push('');
    zeilen.push(ergebnis.ampel === '🟢' ? 'Sauber übergeben! Nur Kleinigkeiten offen:'
                                        : 'Danke fürs Übergeben! Das fehlt noch:');
    offen.forEach(function (g) {
      zeilen.push('');
      zeilen.push('*' + g.name + '*  ·  ' + g.punkte + ' von ' + g.maximum + ' Punkten');
      g.fehlt.forEach(function (m) {
        zeilen.push('• ' + m.label + (m.hinweis ? ' — ' + m.hinweis : ''));
      });
    });
    if (vollstaendig.length > 0) {
      zeilen.push('');
      zeilen.push('✅ Komplett: ' + vollstaendig.map(function (g) { return g.name; }).join(' · '));
    }
  }

  zeilen.push('');
  zeilen.push('Deal: ' + DEAL_URL_BASE + ergebnis.dealId);
  zeilen.push('_Rein informativ — es hängt nichts daran. Beim nächsten gleich mitnehmen._');
  return zeilen.join('\n');
}

// Wer bekommt die DM? Der Closer aus CLOSER_FELD, wenn er in CLOSER_SLACK_IDS
// steht. Sonst Valentin mit Hinweis — damit ein fehlender Mapping-Eintrag
// auffaellt, statt die Meldung still verschwinden zu lassen.
function bestimmeEmpfaenger(ergebnis) {
  const slackId = CLOSER_SLACK_IDS[ergebnis.closerId];
  if (slackId) return { slackId: slackId, zusatz: '' };
  return {
    slackId: VALENTIN_USER_ID,
    zusatz: '\n\n⚠️ _Kein Slack-Mapping für Pipedrive-User `' + ergebnis.closerId +
            '` — deshalb ging diese Meldung an dich statt an den Closer. Eintrag in `Closer-Score/Config.gs` → `CLOSER_SLACK_IDS` ergänzen._'
  };
}
