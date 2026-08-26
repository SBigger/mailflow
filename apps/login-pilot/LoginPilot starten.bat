@echo off
cd /d "%~dp0"

if not exist node_modules (
    echo Installiere Abhaengigkeiten (einmalig)...
    call npm install --omit=dev
    if errorlevel 1 (
        echo Fehler bei npm install. Bitte Node.js installieren: https://nodejs.org
        pause
        exit /b 1
    )
)

echo Starte LoginPilot...
call npx electron .
