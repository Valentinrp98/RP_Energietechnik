// Apps-Script-Globals, gestubbt. DRY_RUN=true -> verarbeiteDeal() ruft keine API.
const _pad = n => String(n).padStart(2, '0');
var Utilities = {
  formatDate: (d, tz, fmt) => (fmt === 'yyyy-MM-dd')
    ? `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`
    : `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}_${_pad(d.getHours())}${_pad(d.getMinutes())}`,
  getUuid: () => 'abcdef12-0000-0000-0000-000000000000',
  sleep: () => {}
};
var Session = { getScriptTimeZone: () => 'Europe/Vienna' };
var logs = [];
var Logger = { log: m => logs.push(String(m)) };
var PropertiesService = { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) };
var SpreadsheetApp = {};
var LockService = {};
var UrlFetchApp = {};
var ScriptApp = {};
