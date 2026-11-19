@echo off
setlocal
title PostgreSQL setup for Discord Bot
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-postgres-windows.ps1"
if errorlevel 1 (
  echo.
  echo Cai dat PostgreSQL that bai. Kiem tra thong bao phia tren.
  pause
)
