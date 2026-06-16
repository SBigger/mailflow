# ─────────────────────────────────────────────────────────────────────────────
# artis MCP-Server – Windows-Setup (PowerShell)
#
# In PowerShell im Ordner apps\mcp-server ausfuehren:
#     .\setup.ps1
#
# Optional die Claude-Desktop-Config gleich anlegen (nur falls noch keine
# existiert – eine vorhandene wird NICHT ueberschrieben):
#     .\setup.ps1 -Write
#
# Hinweis: Falls die Ausfuehrung blockiert wird, einmalig in derselben Konsole:
#     Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
# ─────────────────────────────────────────────────────────────────────────────
param(
    [switch]$Write
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "==> Node-Version:" -ForegroundColor Cyan
node --version

Write-Host "==> Abhaengigkeiten installieren (npm install)..." -ForegroundColor Cyan
npm install

Write-Host "==> Server bauen (npm run build)..." -ForegroundColor Cyan
npm run build

$entry = Join-Path $PSScriptRoot "dist\index.js"
if (-not (Test-Path $entry)) { throw "Build fehlgeschlagen: $entry wurde nicht erstellt." }

# Backslashes fuer JSON verdoppeln
$entryJson = $entry -replace '\\', '\\'

$config = @"
{
  "mcpServers": {
    "artis": {
      "command": "node",
      "args": ["$entryJson"],
      "env": {
        "SUPABASE_URL": "https://DEINPROJEKT.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "DEIN_SERVICE_ROLE_KEY",
        "CUSTOMER_ID": "",
        "MANDANT_ID": "",
        "MCP_ALLOW_WRITES": "false"
      }
    }
  }
}
"@

$configDir  = Join-Path $env:APPDATA "Claude"
$configPath = Join-Path $configDir "claude_desktop_config.json"

Write-Host "`n==> BUILD OK." -ForegroundColor Green
Write-Host "    Server-Datei: $entry`n" -ForegroundColor DarkGray

if ($Write) {
    if (Test-Path $configPath) {
        Write-Host "Es existiert bereits eine Config:" -ForegroundColor Yellow
        Write-Host "  $configPath" -ForegroundColor Yellow
        Write-Host "Sie wird NICHT ueberschrieben. Fuege den 'artis'-Eintrag manuell hinzu (siehe unten)." -ForegroundColor Yellow
    } else {
        New-Item -ItemType Directory -Force -Path $configDir | Out-Null
        $config | Set-Content -Path $configPath -Encoding UTF8
        Write-Host "Config geschrieben nach:" -ForegroundColor Green
        Write-Host "  $configPath" -ForegroundColor Green
        Write-Host "Jetzt SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY darin ausfuellen." -ForegroundColor Green
    }
} else {
    Write-Host "Trage folgenden Inhalt in claude_desktop_config.json ein:" -ForegroundColor Green
    Write-Host "  ($configPath)`n" -ForegroundColor DarkGray
}

Write-Host $config
Write-Host "`nDanach: Werte ausfuellen, Claude Desktop komplett neu starten." -ForegroundColor Cyan
