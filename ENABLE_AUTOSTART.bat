@echo off
setlocal
title Discord Bot Autostart
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\enable-autostart.ps1"
if errorlevel 1 echo Khong the cai tu khoi dong. Xem thong bao o tren.
pause
