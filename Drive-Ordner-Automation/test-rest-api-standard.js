function testPipedriveVerbindung() {
  var token = PropertiesService.getScriptProperties().getProperty('PIPEDRIVE_API_TOKEN');
  var firma = 'rp-energietechnik'; // der Teil vor .pipedrive.com in eurer URL
  var url = 'https://' + firma + '.pipedrive.com/api/v2/deals?limit=5';

  var options = {
    method: 'get',
    headers: {
      'x-api-token': token
    },
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  Logger.log(response.getResponseCode());
  Logger.log(response.getContentText());
}