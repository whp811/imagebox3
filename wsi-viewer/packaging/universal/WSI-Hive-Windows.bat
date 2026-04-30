@echo off
cd /d "%~dp0"
if not exist "%~dp0.wsi-usb\launch-win.cmd" (
  echo Missing .wsi-usb\launch-win.cmd - copy the full WSI-Hive drive bundle, not a single file.
  pause
  exit /b 1
)
call "%~dp0.wsi-usb\launch-win.cmd"
if %ERRORLEVEL% equ 0 if exist "%~dp0.wsi-usb" (
  attrib +h /d /s "%~dp0.wsi-usb" >nul 2>&1
)
exit /b %ERRORLEVEL%
