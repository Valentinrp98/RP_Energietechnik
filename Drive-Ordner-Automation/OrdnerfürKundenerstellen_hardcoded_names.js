function ordnerName_(text) {
  return text.replace(/[\s+]+/g, '_'); // Leerzeichen UND Pluszeichen → Unterstrich
}

function ordnerFuerKundenErstellen() {
  var partnerOrdnerId = '10BaT1-qjhlhBK0h9QYUki6wGQNUdGGcE'; //testid war 1DbZvsuIMEuUQLn4sGOt0p4EMPUFZ2XEM <--------------------Adresse des Ordners
  var partnerOrdner = DriveApp.getFolderById(partnerOrdnerId);

  var kunden = [
    { name: 'Max Mustermann', adresse: 'Musterstraße 1, 4600 Wels' },
    //{ name: 'Anna Berger', adresse: 'Hauptplatz 5, 4020 Linz' },
    //{ name: 'Josef Huber', adresse: 'Dorfweg 12, 4840 Vöcklabruck' },
    //{ name: 'Sabine Wagner', adresse: 'Bahnhofstraße 22, 4780 Schärding' },
    { name: 'Thomas Gruber', adresse: 'Feldgasse 8, 4600 Thalheim bei Wels' }
  ];

  var unterordnerNamen = [
    '1_AB',
    '2_Projektdokumentation',
    '3_Stromrechnung',
    '4_Fotos',
    '5_Abschlussdoks.-Zaehlern._Fertigm._Prüfprot.'
  ];

  kunden.forEach(function(kunde) {
    var ordnerName = kunde.name + ' - ' + kunde.adresse; // normale Schreibweise, keine Unterstriche

    // Sicherheitscheck: existiert der Ordner schon?
    var vorhandene = partnerOrdner.getFoldersByName(ordnerName);
    if (vorhandene.hasNext()) {
      Logger.log('Übersprungen (existiert schon): ' + ordnerName);
      return; // nichts erstellen, nichts anfassen
    }

    var kundenOrdner = partnerOrdner.createFolder(ordnerName);
    unterordnerNamen.forEach(function(name) {
      kundenOrdner.createFolder(ordnerName_(name)); // nur Unterordner mit Unterstrich-Sanitizing
    });
    Logger.log('Erstellt: ' + kundenOrdner.getUrl());
  });
}