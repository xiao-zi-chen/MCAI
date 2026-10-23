@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0squads.ps1" -Mode Doctor -MemoryGB 2
pause
