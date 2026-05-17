@echo off
title FiBu Übernacht-Tests
color 0A
cls

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║      Artis FiBu – Übernacht-Test-Suite       ║
echo  ║               %DATE%               ║
echo  ╚══════════════════════════════════════════════╝
echo.
echo  Schritt 1/3: Einloggen...
echo  ─────────────────────────────────────────────
echo  Ein Browser öffnet sich. Bitte einloggen,
echo  danach schliesst er sich automatisch.
echo.
pause

node tests/setup/capture-auth.js
if errorlevel 1 (
  echo.
  echo  ❌ Login fehlgeschlagen. Bitte nochmal versuchen.
  pause
  exit /b 1
)

echo.
echo  ✅ Login gespeichert!
echo.
echo  Schritt 2/3: Tests starten (78 Tests)...
echo  ─────────────────────────────────────────────
echo  Laufen jetzt durch die ganze Nacht.
echo  Dieses Fenster offen lassen!
echo.

if not exist "test-results" mkdir test-results
npx playwright test 2>&1 | tee "test-results\overnight-%DATE:~6,4%-%DATE:~3,2%-%DATE:~0,2%.log"

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║         Tests abgeschlossen! ✅              ║
echo  ╚══════════════════════════════════════════════╝
echo.
echo  Schritt 3/3: Report öffnen...

npx playwright show-report

pause
