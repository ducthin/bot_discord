@echo off
setlocal
title Reset PostgreSQL password
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\reset-postgres-password.ps1"
pause
