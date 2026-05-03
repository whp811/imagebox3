@echo off
setlocal
set "L=%~dp0"
if exist "%L%WSI Hive.exe" (
  for %%I in ("%L%.") do set "ROOT=%%~fI\"
) else (
  for %%I in ("%L%..\..") do set "ROOT=%%~fI\"
)
cd /d "%ROOT%"

REM Clears hidden flag if release was assembled on Mac (chflags can map to DOS hidden on ExFAT).
attrib -h "%ROOT%WSI Hive.exe" >nul 2>&1

attrib +h "%ROOT%Slides\.wsi-hive" >nul 2>&1
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
