@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0playtest.ps1" -Mode Start
if errorlevel 1 pause
