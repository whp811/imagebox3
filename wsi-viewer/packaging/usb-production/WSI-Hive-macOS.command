#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$DIR/WSI Hive.exe" ] || [ -d "$DIR/WSI Hive.app" ]; then
  ROOT="$DIR"
else
  ROOT="$(cd "$DIR/../.." && pwd)"
fi
cd "$ROOT"

if [ -d "$ROOT/Slides/.wsi-hive" ]; then
  chflags hidden "$ROOT/Slides/.wsi-hive" 2>/dev/null || true
  if command -v SetFile >/dev/null 2>&1; then
    SetFile -a V "$ROOT/Slides/.wsi-hive" 2>/dev/null || true
  fi
fi
if [ -f "$ROOT/WSI Hive.exe" ]; then
  # Finder-only: avoid chflags on .exe — on ExFAT it maps to DOS Hidden and Explorer hides the file on Windows.
  if command -v SetFile >/dev/null 2>&1; then
    SetFile -a V "$ROOT/WSI Hive.exe" 2>/dev/null || true
  fi
fi

APP="$ROOT/WSI Hive.app"
if [ -d "$APP" ]; then
  open "$APP"
  exit 0
fi

APP="$(find "$ROOT" -maxdepth 1 -name "*.app" -print -quit 2>/dev/null)"
if [ -n "$APP" ] && [ -d "$APP" ]; then
  open "$APP"
  exit 0
fi

echo "Missing WSI Hive.app next to this launcher."
echo "Copy the full WSI Hive USB production folder to the flash drive."
echo "Press Enter to close."
read -r _
exit 1
