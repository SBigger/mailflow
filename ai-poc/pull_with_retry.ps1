# Pull Ollama-Modell mit automatischem Retry bei DNS-/Netzwerk-Fehlern
# Verwendung: powershell -File pull_with_retry.ps1 [modellname]

param(
    [string]$Model = "qwen2.5vl:3b",
    [int]$MaxAttempts = 30
)

$ollamaExe = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
$attempt = 1

while ($attempt -le $MaxAttempts) {
    Write-Host "=== Versuch $attempt / $MaxAttempts : pull $Model ===" -ForegroundColor Cyan
    & $ollamaExe pull $Model
    $exitCode = $LASTEXITCODE

    if ($exitCode -eq 0) {
        Write-Host "OK: Modell $Model erfolgreich gepullt!" -ForegroundColor Green

        # Verify it's actually there
        $tags = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing
        $modelData = ($tags.Content | ConvertFrom-Json).models
        $found = $modelData | Where-Object { $_.name -eq $Model }
        if ($found) {
            Write-Host "Bestaetigt in API: $($found.name) ($([math]::Round($found.size/1GB,2)) GB)" -ForegroundColor Green
            exit 0
        } else {
            Write-Host "WARNUNG: pull war OK aber Modell nicht in API-tags. Retry..." -ForegroundColor Yellow
        }
    } else {
        Write-Host "Fehler (exit $exitCode). Warte 15s und retry..." -ForegroundColor Yellow
        Start-Sleep -Seconds 15
    }
    $attempt++
}

Write-Host "FEHLER: $MaxAttempts Versuche fehlgeschlagen" -ForegroundColor Red
exit 1
