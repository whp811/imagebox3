#!/usr/bin/env bash
# Create the clean USB handout:
#   Start Here.html
#   start-here-assets/
#   WSI-Hive-Windows.exe
#   WSI Hive.app
#   Slides/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${DIST_DIR:-$ROOT/dist}"
OUT="${USB_OUT:-$ROOT/release/WSI-Hive-USB}"

if [ ! -d "$SRC" ]; then
  echo "Missing $SRC. Run: npm run build, then electron-builder for mac + win."
  exit 1
fi

shopt -s nullglob

mac_app=""
for candidate in "$SRC"/mac-universal/*.app "$SRC"/mac/*.app "$SRC"/mac-*/*.app; do
  if [ -d "$candidate" ]; then
    mac_app="$candidate"
    break
  fi
done

win_exe=""
for candidate in \
  "$SRC"/WSI-Hive-win-x64-portable.exe \
  "$SRC"/*win*x64*portable*.exe \
  "$SRC"/*portable*.exe; do
  if [ -f "$candidate" ]; then
    win_exe="$candidate"
    break
  fi
done

if [ -z "$mac_app" ]; then
  echo "Missing macOS .app in $SRC. Build with: electron-builder -c electron-builder.json --mac dir --universal"
  exit 1
fi

if [ -z "$win_exe" ]; then
  echo "Missing Windows portable .exe in $SRC. Build with: electron-builder -c electron-builder.json --win portable --x64"
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT/Slides"

if [ -f "$ROOT/Start Here.html" ]; then
  cp -f "$ROOT/Start Here.html" "$OUT/"
fi

if [ -d "$ROOT/start-here-assets" ]; then
  cp -R "$ROOT/start-here-assets" "$OUT/"
fi

if [ -d "$ROOT/Slides" ]; then
  cp -R "$ROOT/Slides/." "$OUT/Slides/" 2>/dev/null || true
  find "$OUT/Slides" -name .DS_Store -delete 2>/dev/null || true
fi

cp -R "$mac_app" "$OUT/WSI Hive.app"
cp -f "$win_exe" "$OUT/WSI-Hive-Windows.exe"
chmod +x "$OUT/WSI Hive.app/Contents/MacOS/"* 2>/dev/null || true

echo "USB production bundle ready:"
find "$OUT" -maxdepth 1 -mindepth 1 -print | sort
