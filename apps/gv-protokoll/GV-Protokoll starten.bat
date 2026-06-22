@echo off
chcp 65001 >nul
title GV-Protokoll
cd /d "%~dp0"

rem Python finden (python oder py)
where python >nul 2>nul && (set "PY=python") || (set "PY=py")

echo.
echo   ============================================
echo     GV-Protokoll wird gestartet ...
echo     Dieses Fenster bitte OFFEN lassen,
echo     solange du die App benutzt.
echo   ============================================
echo.

rem Mini-Server im Hintergrund-Fenster starten
start "GV-Protokoll Server - bitte offen lassen" /min %PY% -m http.server 8770

rem kurz warten, dann Browser oeffnen
timeout /t 1 /nobreak >nul
start "" http://localhost:8770/

exit
