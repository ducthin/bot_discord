@echo off
setlocal
title Discord Bot
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1"
if errorlevel 1 (
  echo.
  echo Khong the khoi dong. Xem thong bao loi phia tren.
  pause
)
