@echo off
setlocal
fltmc >nul 2>&1
if errorlevel 1 (
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0desktop-repair-network-profile.ps1"
set "fix_exit=%errorlevel%"
echo.
if "%fix_exit%"=="0" (
  echo Luzhou desktop SSH repair completed successfully.
) else (
  echo Repair stopped safely. Please keep this window open for review.
)
pause
exit /b %fix_exit%
