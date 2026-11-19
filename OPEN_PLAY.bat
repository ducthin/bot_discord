@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process 'https://teoteo.site/play/'"
if errorlevel 1 pause
