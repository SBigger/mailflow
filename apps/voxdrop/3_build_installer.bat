@echo off
cd /d "%~dp0"
echo.
echo ========================================
echo  VoxDrop by Artis - Build
echo ========================================
echo.

REM ── 1. Icon erstellen
echo [1/3] Erstelle icon.ico ...
python icon_erstellen.py
if errorlevel 1 (
    echo FEHLER: icon_erstellen.py ist fehlgeschlagen.
    pause & exit /b
)
if not exist "icon.ico" (
    echo FEHLER: icon.ico wurde nicht erstellt.
    pause & exit /b
)
echo icon.ico OK.

REM ── 2. PyInstaller
echo [2/3] Erstelle VoxDrop.exe ...
taskkill /F /IM VoxDrop.exe >nul 2>&1
timeout /t 2 >nul
rmdir /s /q build >nul 2>&1
rmdir /s /q dist  >nul 2>&1
pip install pyinstaller >nul 2>&1
python -m PyInstaller ^
  --onefile ^
  --noconsole ^
  --name VoxDrop ^
  --icon icon.ico ^
  --collect-all faster_whisper ^
  --collect-all ctranslate2 ^
  --collect-all sounddevice ^
  --hidden-import huggingface_hub ^
  --hidden-import openai ^
  --hidden-import pyperclip ^
  --hidden-import pyautogui ^
  --hidden-import pynput ^
  --hidden-import pystray ^
  voxdrop.py
if not exist "dist\VoxDrop.exe" (
    echo FEHLER: VoxDrop.exe wurde nicht erstellt.
    pause & exit /b
)
echo VoxDrop.exe OK.

REM ── 3. Inno Setup
echo [3/3] Erstelle Installer ...
set ISCC=
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" set ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe
if exist "C:\Program Files\Inno Setup 6\ISCC.exe"       set ISCC=C:\Program Files\Inno Setup 6\ISCC.exe

if "%ISCC%"=="" (
    echo Inno Setup nicht gefunden - wird installiert...
    winget install --id JRSoftware.InnoSetup --silent --accept-source-agreements --accept-package-agreements
    if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" set ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe
    if exist "C:\Program Files\Inno Setup 6\ISCC.exe"       set ISCC=C:\Program Files\Inno Setup 6\ISCC.exe
)

if "%ISCC%"=="" (
    echo FEHLER: Inno Setup nicht installierbar.
    echo Bitte manuell: https://jrsoftware.org/isdl.php
    pause & exit /b
)

"%ISCC%" installer.iss
if not exist "VoxDrop_Setup.exe" (
    echo FEHLER: VoxDrop_Setup.exe nicht erstellt.
    pause & exit /b
)

echo.
echo ========================================
echo  Fertig! VoxDrop_Setup.exe ist bereit.
echo  Weitergeben an Mitarbeiter.
echo ========================================
echo.
pause
