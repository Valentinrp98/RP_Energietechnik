# RP Google Scripts - Auto Sync Script
# Synkt alle 3 Apps-Script-Projekte: clasp pull + git commit + git push

# Basis-Pfad
$basePath = "C:\Users\valen\OneDrive\Documents\RP\Claude_Work_RP\RP-Google-Scripts"

# Log-Datei-Pfad
$logPath = Join-Path $basePath "sync-log.txt"

# Projektordner
$projects = @(
    "Drive-Ordner-Automation",
    "Pipedrive-form-prefill-mail-trigger",
    "Sevdesk-Pipdrive_sync"
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

# Durch alle Projekte gehen
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
    
    # 1. CLASP PULL
    Write-Log "`n  1️⃣  clasp pull..." Cyan
    try {
        $output = clasp pull 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Log "  ✓ clasp pull erfolgreich" Green
        } else {
            Write-Log "  ⚠️  clasp pull Fehler (aber weitermachen):" Yellow
            Write-Log "     $output" Gray
        }
    } catch {
        Write-Log "  ⚠️  clasp pull Exception (aber weitermachen)" Yellow
    }
    
    # 2. GIT ADD
    Write-Log "`n  2️⃣  git add ." Cyan
    try {
        git add . 2>&1 | Out-Null
        Write-Log "  ✓ Dateien hinzugefügt" Green
    } catch {
        Write-Log "  ❌ git add fehler" Red
        $failed += $project
        continue
    }
    
    # 3. GIT COMMIT
    Write-Log "`n  3️⃣  git commit..." Cyan
    try {
        $commit = git commit -m $commitMsg 2>&1
        if ($LASTEXITCODE -eq 0 -or $commit -like "*nothing to commit*") {
            Write-Log "  ✓ Commit: '$commitMsg'" Green
        } else {
            Write-Log "  ⚠️  Commit Warnung:" Yellow
            Write-Log "     $commit" Gray
        }
    } catch {
        Write-Log "  ⚠️  Commit Exception (aber weitermachen)" Yellow
    }
    
    # 4. GIT PUSH
    Write-Log "`n  4️⃣  git push..." Cyan
    try {
        $push = git push 2>&1
        if ($LASTEXITCODE -eq 0 -or $push -like "*Everything up-to-date*") {
            Write-Log "  ✓ Push erfolgreich" Green
            $successful += $project
        } else {
            Write-Log "  ⚠️  Push Warnung (aber OK):" Yellow
            Write-Log "     $push" Gray
            $successful += $project
        }
    } catch {
        Write-Log "  ❌ Push fehler" Red
        $failed += $project
    }
}

# SUMMARY
Write-Log "`n`n╔════════════════════════════════════╗" White
Write-Log "║          SYNC ABGESCHLOSSEN       ║" White
Write-Log "╚════════════════════════════════════╝" White

Write-Log "`n✅ Erfolgreich ($($successful.Count)):" Green
$successful | ForEach-Object { Write-Log "   • $_" Green }

if ($failed.Count -gt 0) {
    Write-Log "`n❌ Fehler ($($failed.Count)):" Red
    $failed | ForEach-Object { Write-Log "   • $_" Red }
}

Write-Log "`n📅 Commit-Message: '$commitMsg'" Gray
Write-Log "`n✨ Fertig!" Cyan

# Optional: Pause damit man die Output sieht
Read-Host "`nEnter zum Beenden"
