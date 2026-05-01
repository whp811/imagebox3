@echo off
setlocal
set "SYSTEM=%~dp0"
for %%I in ("%SYSTEM%..") do set "ROOT=%%~fI\"
cd /d "%ROOT%"

attrib +h "%ROOT%.wsi-hive" >nul 2>&1
attrib +h "%ROOT%WSI Hive.app" >nul 2>&1

set "APP=%ROOT%WSI Hive.exe"
if exist "%APP%" (
  start "" "%APP%"
  exit /b 0
)

for %%F in ("%ROOT%WSI-Hive-Windows.exe" "%ROOT%WSI-Hive-win-*-portable.exe" "%ROOT%*portable*.exe") do (
  if exist "%%~fF" (
    start "" "%%~fF"
    exit /b 0
  )
)

echo Missing WSI Hive.exe next to this launcher.
echo Copy the full WSI Hive USB production folder to the flash drive.
pause
exit /b 1
