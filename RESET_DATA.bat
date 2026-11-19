@echo off
setlocal
title Reset Discord Bot data
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1" -ResetData
if errorlevel 1 (
  echo.
  echo Khong the xoa du lieu. Xem thong bao phia tren.
)
pause
