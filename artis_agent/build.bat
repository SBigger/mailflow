@echo off
REM ============================================================
REM  Artis Agent - EXE Build Script
REM  Voraussetzung: pip install -r requirements.txt
REM ============================================================

echo Installiere Abhaengigkeiten...
pip install -r requirements.txt

echo.
echo Erstelle EXE...
python -m PyInstaller ^
  --onefile ^
  --noconsole ^
  --name "artis_agent" ^
  --add-data ".;." ^
  agent.py

echo.
if exist "dist\artis_agent.exe" (
    echo ============================================================
    echo  EXE erfolgreich erstellt: dist\artis_agent.exe
    echo.
    echo  Naechste Schritte:
    echo  1. dist\artis_agent.exe einmal ausfuehren (Installation)
    echo  2. Bestaetigung abwarten
    echo  3. Fertig - Browser oeffnet Dokumente automatisch
    echo ============================================================
) else (
    echo FEHLER: EXE wurde nicht erstellt.
)
pause
