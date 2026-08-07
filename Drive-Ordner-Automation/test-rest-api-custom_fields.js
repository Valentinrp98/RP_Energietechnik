function testDealMitCustomFields() {
  var token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  var firma = 'rp-energietechnik';
  var dealId = 30; // testweise der erste Deal aus deiner Liste

  var url = 'https://' + firma + '.pipedrive.com/api/v2/deals/' + dealId;

  var options = {
    method: 'get',
    headers: { 'x-api-token': token },
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  Logger.log(response.getResponseCode());
  Logger.log(response.getContentText());
}

// Zusätzlich: welche Custom Fields gibt's überhaupt, mit Klartext-Namen?
function testDealFields() {
  var token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  var firma = 'rp-energietechnik';
  var url = 'https://' + firma + '.pipedrive.com/api/v2/dealFields';

  var options = {
    method: 'get',
    headers: { 'x-api-token': token },
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  Logger.log(response.getResponseCode());
  Logger.log(response.getContentText());
}