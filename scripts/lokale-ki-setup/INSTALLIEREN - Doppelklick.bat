@echo off
REM ============================================================
REM  Lokale KI + Python - Setup (Doppelklick)
REM  Installiert Python + Ollama (lokale KI-Engine) + ein kleines
REM  Sprachmodell. Danach laeuft alles komplett offline auf
REM  diesem PC, ohne Cloud und ohne laufende Kosten.
REM ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-lokale-ki.ps1"
