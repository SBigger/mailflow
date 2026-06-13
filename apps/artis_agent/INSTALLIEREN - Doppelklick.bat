@echo off
REM ============================================================
REM  Artis Smartis-Agent - Installation (PDF-Capture)
REM  Kopiert artis_agent.exe nach %LOCALAPPDATA%\SmartisAgent
REM  und startet ihn einmal: registriert Autostart + URI-Schema
REM  und legt das Tray-Symbol an.
REM ============================================================
setlocal
set "DEST=%LOCALAPPDATA%\SmartisAgent"
set "SRC=%~dp0artis_agent.exe"

if not exist "%SRC%" (
    echo FEHLER: artis_agent.exe nicht gefunden neben dieser Datei.
    echo   Erwartet: %SRC%
    pause & exit /b 1
)

REM Laufende Instanz beenden, damit die EXE ueberschrieben werden kann
taskkill /IM artis_agent.exe /F >nul 2>&1

if not exist "%DEST%" mkdir "%DEST%"
copy /Y "%SRC%" "%DEST%\artis_agent.exe" >nul
if errorlevel 1 (
    echo FEHLER beim Kopieren nach %DEST%
    pause & exit /b 1
)

echo Agent installiert nach: %DEST%\artis_agent.exe
echo Starte Agent (Autostart + Tray werden eingerichtet)...
start "" "%DEST%\artis_agent.exe"

echo.
echo =====================================================
echo  Fertig. Der Agent laeuft jetzt im Tray (unten rechts).
echo  PDF oeffnen und  Alt+Shift+S  druecken.
echo  Voraussetzung: die Smartis-Desktop-App (artis) ist offen.
echo =====================================================
pause
