@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scheduler.ps1" -Mode Start
if errorlevel 1 pause
