@echo off
REM ============================================================
REM  Artis Agent - EXE Build Script
REM  Voraussetzung: pip install -r requirements.txt
REM ============================================================
set "PYTHON_PATH=C:\Users\Roger\AppData\Local\Python\bin"

echo Vorab alte Reste wegräumen, falls das Skript hängen blieb
if exist "build" rd /s /q "build"
if exist "smartis-agent.spec" del /f /q "smartis-agent.spec"

echo Installiere Abhaengigkeiten...
"%PYTHON_PATH%\python.exe" -m pip install -r requirements.txt

echo.
echo Erstelle EXE...
"%PYTHON_PATH%\python.exe" -m PyInstaller ^
  --onefile ^
  --noconsole ^
  --name "sm-artis-agent" ^
  --add-data ".;." ^
  agent.py

echo.
if exist "dist\sm-artis-agent.exe" (
    echo ============================================================
    echo  EXE erfolgreich erstellt: dist\sm-artis-agent.exe
    echo.
    echo  Naechste Schritte:
    echo  1. dist\sm-artis-agent.exe einmal ausfuehren (Installation)
    echo  2. Bestaetigung abwarten
    echo  3. Fertig - Browser oeffnet Dokumente automatisch
    echo ============================================================
) else (
    echo FEHLER: EXE wurde nicht erstellt.
)
pause
