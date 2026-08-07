function ordnerErstellen() {
  var parentOrdnerId = '1wP9ChpzdI1__8gbe3yvQuuf5o0vQ6CtS';
  var parentOrdner = DriveApp.getFolderById(parentOrdnerId);

  var unterordnerNamen = ['AB', 'Fotos', 'Projektdokumentation', 'Stromrechnung'];
  unterordnerNamen.forEach(function(name) {
    parentOrdner.createFolder(name);
    Logger.log('Erstellt: ' + name);
  });
}