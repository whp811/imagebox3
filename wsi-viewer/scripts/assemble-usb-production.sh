#!/usr/bin/env bash
# Create the clean USB handout (root only):
#   Start Here.html
#   Slides/
#   WSI Hive.app        (visible on macOS, hidden on Windows)
#   WSI Hive.exe        (visible on Windows, hidden from Finder on macOS only)
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

if [ "$(uname -s 2>/dev/null || true)" = "Darwin" ] && [ -f "$OUT/Start Here.html" ]; then
  "$ROOT/scripts/apply-start-here-icon.sh" "$OUT/Start Here.html" "$ROOT/start-here-assets/start-here-file-icon.png" || true
fi

if [ -d "$ROOT/Slides" ]; then
  cp -R "$ROOT/Slides/." "$OUT/Slides/" 2>/dev/null || true
  find "$OUT/Slides" -name .DS_Store -delete 2>/dev/null || true
fi

cp -R "$mac_app" "$OUT/WSI Hive.app"
cp -f "$win_exe" "$OUT/WSI Hive.exe"
chmod +x "$OUT/WSI Hive.app/Contents/MacOS/"* 2>/dev/null || true

# Finder-only “invisible” flag — avoids chflags on .exe: on ExFAT/FAT32, chflags hidden
# maps to the DOS Hidden bit and Explorer hides the file on Windows too.
hide_exe_from_finder_macos_only() {
  if [ "$(uname -s 2>/dev/null || true)" = "Darwin" ] && command -v SetFile >/dev/null 2>&1; then
    SetFile -a V "$@" 2>/dev/null || true
  fi
}

hide_for_windows() {
  for target in "$@"; do
    if command -v cygpath >/dev/null 2>&1 && command -v cmd.exe >/dev/null 2>&1; then
      cmd.exe /c attrib +h "$(cygpath -w "$target")" >/dev/null 2>&1 || true
    elif command -v attrib >/dev/null 2>&1; then
      attrib +h "$target" >/dev/null 2>&1 || true
    fi
  done
}

# Normal Finder view: hide Windows .exe for Mac users (SetFile only — see above).
hide_exe_from_finder_macos_only "$OUT/WSI Hive.exe"

# Normal Windows Explorer view: Start Here + Slides + Windows app (hide Mac .app).
hide_for_windows "$OUT/WSI Hive.app"

echo "USB production bundle ready:"
find "$OUT" -maxdepth 1 -mindepth 1 -print | sort
