# ============================================================
#  Lokale KI + Python - Setup fuer Windows
#  Installiert (falls nicht vorhanden):
#    - Python 3.x
#    - Ollama (lokale KI-Engine, laeuft komplett offline)
#    - ein kleines Sprachmodell (llama3.2, ca. 2 GB)
#  Nutzt winget (Windows Paketmanager, bei Windows 10/11 meist
#  schon vorhanden ueber "App Installer" aus dem Microsoft Store).
# ============================================================

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

Write-Host "===================================================="
Write-Host " Lokale KI + Python - Setup"
Write-Host "===================================================="

if (-not (Test-Command "winget")) {
    Write-Host ""
    Write-Host "FEHLER: winget (Windows Paketmanager) wurde nicht gefunden."
    Write-Host "winget ist Teil von 'App Installer' aus dem Microsoft Store:"
    Write-Host "  1. Microsoft Store oeffnen"
    Write-Host "  2. nach 'App Installer' suchen und installieren/aktualisieren"
    Write-Host "  3. dieses Skript danach erneut ausfuehren"
    Read-Host "Enter zum Beenden druecken"
    exit 1
}

Write-Step "Pruefe Python..."
if (Test-Command "python") {
    Write-Host "Python ist bereits installiert: $(python --version)"
} else {
    Write-Step "Installiere Python..."
    winget install --id Python.Python.3.12 -e --source winget --accept-source-agreements --accept-package-agreements
    Write-Host "Python installiert."
}

Write-Step "Pruefe Ollama (lokale KI-Engine)..."
if (Test-Command "ollama") {
    Write-Host "Ollama ist bereits installiert."
} else {
    Write-Step "Installiere Ollama..."
    winget install --id Ollama.Ollama -e --source winget --accept-source-agreements --accept-package-agreements
    Write-Host "Ollama installiert."
}

Write-Step "Lade kleines KI-Modell herunter (llama3.2, ca. 2 GB, einmalig)..."
if (Test-Command "ollama") {
    ollama pull llama3.2
} else {
    Write-Host "HINWEIS: 'ollama' ist in diesem Fenster noch nicht bekannt (PATH wird erst"
    Write-Host "nach einem Neustart des Terminals aktualisiert)."
    Write-Host "Bitte dieses Fenster schliessen, ein NEUES Terminal oeffnen und ausfuehren:"
    Write-Host "    ollama pull llama3.2"
}

Write-Host ""
Write-Host "===================================================="
Write-Host " Fertig!"
Write-Host "===================================================="
Write-Host ""
Write-Host "KI direkt im Terminal ausprobieren:"
Write-Host "    ollama run llama3.2"
Write-Host ""
Write-Host "KI aus Python ansprechen: siehe beispiel_chat.py in diesem Ordner"
Write-Host "    python beispiel_chat.py"
Write-Host ""
Read-Host "Enter zum Beenden druecken"
