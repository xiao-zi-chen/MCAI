@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0squads.ps1" -Mode Start -MemoryGB 2
if errorlevel 1 pause
