# Testet die Logik des Fortschritt-Scripts lokal in node -- ohne Pipedrive, ohne Sheets.
#
# Aufruf (aus diesem Ordner):
#   .\run-tests.ps1
#
# Es werden nur die reinen Rechenteile getestet: Ableitungsregeln, Fortschritt-Text, Diff-Logik,
# PATCH-Guard, Ampel-Status. Alles davon laeuft ohne Netzwerk, weil DRY_RUN=true ist und
# verarbeiteDeal() dann keine API anfaesst.
#
# WICHTIG: Diese Dateien liegen bewusst AUSSERHALB des clasp-Ordners "Fortschritt-Script".
# Eine zusaetzliche .js im rootDir wuerde bei einem versehentlichen `clasp push` dieselben
# Konstanten ein zweites Mal deklarieren -- dann startet das Apps-Script-Projekt gar nicht mehr.

$ErrorActionPreference = 'Stop'

$quelle = Join-Path $PSScriptRoot '..\..\Fortschritt-Script'
$ziel = Join-Path $env:TEMP 'fortschritt-tests.js'

$dateien = @(
  (Join-Path $PSScriptRoot 'stubs.js'),
  (Join-Path $quelle 'Config.gs'),
  (Join-Path $quelle 'Regeln.gs'),
  (Join-Path $quelle 'Code.gs'),
  (Join-Path $PSScriptRoot 'test_body.js')
)

foreach ($d in $dateien) {
  if (-not (Test-Path $d)) { throw "Datei fehlt: $d" }
}

# Ein einziges Script bauen: in Apps Script teilen alle .gs-Dateien denselben Scope, das wird hier
# nachgebildet. Nebeneffekt: doppelt deklarierte Konstanten fallen genauso auf wie im Editor.
Get-Content $dateien -Raw -Encoding UTF8 | Set-Content $ziel -Encoding UTF8

node $ziel
$code = $LASTEXITCODE

Remove-Item $ziel -ErrorAction SilentlyContinue
exit $code
