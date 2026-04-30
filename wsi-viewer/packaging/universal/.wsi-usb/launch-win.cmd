@echo off
setlocal
set "W=%~dp0win"
if not exist "%W%\" (
  echo No %W% folder. Assemble a full bundle into .wsi-usb — see packaging/universal/PACK.md
  pause
  exit /b 1
)
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" if exist "%W%\WSI-Hive-win-arm64-portable.exe" (
  start "" "%W%\WSI-Hive-win-arm64-portable.exe" & exit /b 0
)
if exist "%W%\WSI-Hive-win-x64-portable.exe" (
  start "" "%W%\WSI-Hive-win-x64-portable.exe" & exit /b 0
)
if exist "%W%\WSI-Hive-win-arm64-portable.exe" (
  start "" "%W%\WSI-Hive-win-arm64-portable.exe" & exit /b 0
)
for %%F in ("%W%"\*portable*.exe) do start "" "%%F" & exit /b 0
if exist "%W%\WSI Hive.exe" start "" "%W%\WSI Hive.exe" & exit /b 0
if exist "%W%\WSI Hive portable.exe" start "" "%W%\WSI Hive portable.exe" & exit /b 0
for %%F in ("%W%"\*.exe) do start "" "%%F" & exit /b 0
echo No Windows WSI Hive portable .exe in %W% — see .wsi-usb\README.txt
pause
exit /b 1
