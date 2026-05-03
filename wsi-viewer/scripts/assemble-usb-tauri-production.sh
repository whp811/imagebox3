#!/usr/bin/env bash
# USB layout mirroring assemble-usb-production.sh — reads Tauri bundle outputs instead of Electron dist/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${TAURI_BUNDLE_DIR:-$ROOT/src-tauri/target/release/bundle}"
OUT="${USB_OUT_TAURI:-$ROOT/release/WSI-Hive-Tauri-USB}"

if [ ! -d "$SRC" ]; then
  echo "Missing $SRC. Run: bash scripts/build-tauri.sh (or npm run tauri:build) first."
  exit 1
fi

shopt -s nullglob

mac_app=""
for candidate in "$SRC"/macos/*.app "$SRC"/macos/**/*.app "$SRC"/dmg/**/*.app; do
  if [ -d "$candidate" ]; then
    mac_app="$candidate"
    break
  fi
done

win_exe=""
for candidate in \
  "$SRC"/nsis/*.exe \
  "$SRC"/msi/*.msi \
  "$SRC"/*installer*.exe \
  "$SRC"/windows/**/*.exe; do
  if [ -f "$candidate" ]; then
    win_exe="$candidate"
    break
  fi
done

if [ -z "$mac_app" ]; then
  echo "Missing macOS .app under $SRC (expected bundle/macos/*.app after tauri build)."
  exit 1
fi

if [ -z "$win_exe" ]; then
  if [ "${SKIP_WIN:-}" = "1" ]; then
    echo "WARN: no Windows exe under $SRC — continuing (SKIP_WIN=1)."
  else
    echo "Missing Windows installer/exe under $SRC."
    echo "Build on Windows or set SKIP_WIN=1 for macOS-only folder."
    exit 1
  fi
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
if [ -n "${win_exe:-}" ]; then
  cp -f "$win_exe" "$OUT/WSI Hive.exe"
fi
chmod +x "$OUT/WSI Hive.app/Contents/MacOS/"* 2>/dev/null || true

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

if [ -f "$OUT/WSI Hive.exe" ]; then
  hide_exe_from_finder_macos_only "$OUT/WSI Hive.exe"
fi
hide_for_windows "$OUT/WSI Hive.app"

echo "Tauri USB bundle ready:"
find "$OUT" -maxdepth 1 -mindepth 1 -print | sort
