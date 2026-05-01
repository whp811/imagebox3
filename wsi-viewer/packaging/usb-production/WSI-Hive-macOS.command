#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
cd "$ROOT"

chflags hidden "$DIR" "$ROOT/WSI Hive.exe" 2>/dev/null || true
if command -v SetFile >/dev/null 2>&1; then
  SetFile -a V "$DIR" "$ROOT/WSI Hive.exe" 2>/dev/null || true
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
