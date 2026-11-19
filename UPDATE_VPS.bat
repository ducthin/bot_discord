@echo off
setlocal
title Discord Bot - Ubuntu VPS
echo 1. Cap nhat VPS ngay
echo 2. Tu cap nhat khi luu code ^(can SSH key^)
echo 3. Cai SSH key cho che do tu dong
choice /c 123 /n /m "Chon 1, 2 hoac 3: "
if errorlevel 255 exit /b 1
if not errorlevel 1 exit /b 1
if errorlevel 3 (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy-vps.ps1" -InstallKey
) else if errorlevel 2 (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy-vps.ps1" -Watch
) else (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy-vps.ps1"
)
pause
