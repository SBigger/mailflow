@echo off
title Steuern nP
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js wurde nicht gefunden.
  echo.
  echo   Diese Variante braucht Node.js. Zwei Moeglichkeiten:
  echo     1. Node.js von https://nodejs.org installieren ^(LTS^), dann erneut starten
  echo     2. Stattdessen die Electron-Variante nutzen - die braucht kein Node
  echo.
  pause
  exit /b 1
)
start "" http://localhost:5180
node server.mjs
pause
