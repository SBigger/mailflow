@echo off
REM ================================================================
REM  FiBu Overnight Test Runner
REM  Führt alle Playwright-Tests durch und öffnet den HTML-Report
REM ================================================================

echo.
echo ====================================================
echo   Artis FiBu – Overnight E2E Test Suite
echo   %DATE% %TIME%
echo ====================================================
echo.

REM Sicherstellen dass test-results Ordner existiert
if not exist "test-results" mkdir test-results

REM Auth-State löschen damit frischer Login erzwungen wird
if exist "tests\setup\.auth-state.json" (
  echo Alten Auth-State loeschen...
  del "tests\setup\.auth-state.json"
)

echo Starte Playwright Tests...
echo (Ctrl+C zum Abbrechen)
echo.

npx playwright test --project=setup --project=fibu 2>&1 | tee test-results\overnight-%DATE:~-4%-%DATE:~3,2%-%DATE:~0,2%.log

echo.
echo ====================================================
echo   Tests abgeschlossen: %DATE% %TIME%
echo ====================================================
echo.
echo Oeffne HTML-Report...
npx playwright show-report

pause
