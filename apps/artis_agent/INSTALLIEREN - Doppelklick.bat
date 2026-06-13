@echo off
REM ============================================================
REM  Artis Smartis-Agent - Installation (Ordner-Variante / onedir)
REM  Kopiert den Ordner "artis_agent" (EXE + _internal) nach
REM  %LOCALAPPDATA%\SmartisAgent\app und startet ihn einmal:
REM  registriert Autostart + URI-Schema und legt das Tray-Symbol an.
REM  Ordner-Variante = robust gegen Virenscanner (kein Temp-Entpacken).
REM ============================================================
setlocal
set "DEST=%LOCALAPPDATA%\SmartisAgent\app"
set "SRC=%~dp0artis_agent"

if not exist "%SRC%\artis_agent.exe" (
    echo FEHLER: Ordner "artis_agent" mit artis_agent.exe nicht gefunden.
    echo Bitte das ZIP zuerst ENTPACKEN ^(nicht aus dem ZIP heraus starten^)
    echo und diese .bat im entpackten Ordner doppelklicken.
    pause & exit /b 1
)

REM Laufende Instanz beenden, damit Dateien ueberschrieben werden koennen
taskkill /IM artis_agent.exe /F >nul 2>&1

if not exist "%DEST%" mkdir "%DEST%"
echo Kopiere Agent nach %DEST% ...
xcopy /E /I /Y "%SRC%\*" "%DEST%\" >nul
if errorlevel 1 (
    echo FEHLER beim Kopieren nach %DEST%
    pause & exit /b 1
)

echo Starte Agent ^(Autostart + Tray werden eingerichtet^) ...
start "" "%DEST%\artis_agent.exe"

echo.
echo =====================================================
echo  Fertig. Der Agent laeuft jetzt im Tray (unten rechts).
echo  PDF oeffnen und  Alt+Shift+S  druecken.
echo  Voraussetzung: die Smartis-Desktop-App (artis) ist offen.
echo =====================================================
pause
