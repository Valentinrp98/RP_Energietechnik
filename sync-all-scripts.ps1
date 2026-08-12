# RP Google Scripts - Auto Sync Script
# Synkt alle 3 Apps-Script-Projekte: clasp pull + git commit + git push

# Basis-Pfad
$basePath = "C:\Users\valen\OneDrive\Documents\RP\Claude_Work_RP\RP-Google-Scripts"

# Log-Datei-Pfad
$logPath = Join-Path $basePath "sync-log.txt"

# Projektordner
# Bundesland-aus-PLZ und Montagepartner-aus-Bundesland haben noch kein .clasp.json (nie per
# "clasp clone <scriptId>" verknüpft) -- clasp pull schlägt dort fehl, bis das nachgeholt wird.
# Ordnererstellung-bei-Gewonnen und Sheet-Sync existieren aktuell nur lokal als Code, noch nicht
# im Apps-Script-Editor angelegt -- erst nach "clasp clone <scriptId>" dort hier eintragen.
$projects = @(
    "Drive-Ordner-Automation",
    "Pipedrive-form-prefill-mail-trigger",
    "Sevdesk-Pipdrive_sync",
    "Bundesland-aus-PLZ",
    "Montagepartner-aus-Bundesland"
    # "Ordnererstellung-bei-Gewonnen"  # TODO: einkommentieren, sobald per clasp verknüpft
    # "Sheet-Sync"                     # TODO: einkommentieren, sobald per clasp verknüpft
)

# Heutiges Datum für Commit-Message
$today = Get-Date -Format "dd.MM.yyyy HH:mm"

# Logging-Funktion: schreibt in Datei UND zeigt im Terminal (mit Farbe)
function Write-Log {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    Write-Host $Message -ForegroundColor $Color
    Add-Content -Path $logPath -Value $Message
}

# Neuen Lauf in Log-Datei markieren
Add-Content -Path $logPath -Value "`n`n===================================="
Add-Content -Path $logPath -Value "SYNC-LAUF: $today"
Add-Content -Path $logPath -Value "===================================="

# Custom Message abfragen (optional)
Write-Log "`n📝 Gib eine eigene Message ein (oder Enter für Auto-Message):" Cyan
$customMsg = Read-Host "Message"

if ($customMsg -eq "") {
    $commitMsg = "Sync vom $today"
} else {
    $commitMsg = "$customMsg — Sync $today"
}

Write-Log "`n🚀 Starten mit: '$commitMsg'" Green

# Summary-Arrays
$successful = @()
$failed = @()

# Durch alle Projekte gehen - NUR clasp pull
foreach ($project in $projects) {
    $projectPath = Join-Path $basePath $project
    
    Write-Log "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" White
    Write-Log "📁 $project" Yellow
    Write-Log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" White
    
    # Prüfe ob Ordner existiert
    if (-not (Test-Path $projectPath)) {
        Write-Log "❌ Ordner nicht gefunden: $projectPath" Red
        $failed += $project
        continue
    }
    
    # In Ordner wechseln
    Set-Location $projectPath
    Write-Log "✓ Wechsel zu: $projectPath" Gray
    
    # CLASP PULL
    Write-Log "`n  clasp pull..." Cyan
    try {
        $output = clasp pull 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Log "  ✓ clasp pull erfolgreich" Green
            $successful += $project
        } else {
            Write-Log "  ⚠️  clasp pull Fehler (aber weitermachen):" Yellow
            Write-Log "     $output" Gray
            $failed += $project
        }
    } catch {
        Write-Log "  ⚠️  clasp pull Exception (aber weitermachen)" Yellow
        $failed += $project
    }
}

# Zurück zum Hauptordner für die zentralen Git-Operationen
Set-Location $basePath

Write-Log "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" White
Write-Log "📦 Git: Hauptordner (1 Repo für alles)" Yellow
Write-Log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" White

# 1. GIT ADD (einmalig, für ALLE Projekte zusammen)
Write-Log "`n  1️⃣  git add ." Cyan
try {
    git add . 2>&1 | Out-Null
    Write-Log "  ✓ Dateien hinzugefügt" Green
} catch {
    Write-Log "  ❌ git add Fehler" Red
}

# 2. GIT COMMIT (einmalig)
Write-Log "`n  2️⃣  git commit..." Cyan
$commitOk = $false
try {
    $commit = git commit -m $commitMsg 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Log "  ✓ Commit: '$commitMsg'" Green
        $commitOk = $true
    } elseif ($commit -like "*nothing to commit*") {
        Write-Log "  ℹ️  Keine Änderungen - nichts zu committen" Gray
    } else {
        Write-Log "  ⚠️  Commit Warnung:" Yellow
        Write-Log "     $commit" Gray
    }
} catch {
    Write-Log "  ⚠️  Commit Exception" Yellow
}

# 3. GIT PUSH (einmalig)
Write-Log "`n  3️⃣  git push..." Cyan
try {
    $push = git push 2>&1
    if ($LASTEXITCODE -eq 0 -or $push -like "*Everything up-to-date*") {
        Write-Log "  ✓ Push erfolgreich" Green
    } else {
        Write-Log "  ⚠️  Push Warnung:" Yellow
        Write-Log "     $push" Gray
    }
} catch {
    Write-Log "  ❌ Push Fehler" Red
}

# SUMMARY
Write-Log "`n`n╔════════════════════════════════════╗" White
Write-Log "║          SYNC ABGESCHLOSSEN       ║" White
Write-Log "╚════════════════════════════════════╝" White

Write-Log "`n✅ clasp pull erfolgreich ($($successful.Count)):" Green
$successful | ForEach-Object { Write-Log "   • $_" Green }

if ($failed.Count -gt 0) {
    Write-Log "`n❌ clasp pull Fehler ($($failed.Count)):" Red
    $failed | ForEach-Object { Write-Log "   • $_" Red }
}

if ($commitOk) {
    Write-Log "`n📦 Git: 1 Commit für alle Projekte erstellt & gepusht" Green
} else {
    Write-Log "`n📦 Git: kein neuer Commit (siehe oben)" Gray
}

Write-Log "`n📅 Commit-Message: '$commitMsg'" Gray
Write-Log "`n✨ Fertig!" Cyan

# Optional: Pause damit man die Output sieht
Read-Host "`nEnter zum Beenden"
