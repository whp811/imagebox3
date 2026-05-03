#!/usr/bin/env bash
# Create the Electrobun USB handout:
#   Start Here.html
#   Slides/
#   WSI Hive.app
#   WSI Hive.exe
#   .installer/ (hidden Windows Electrobun sidecar when needed)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${ELECTROBUN_BUILD_DIR:-$ROOT/build-electrobun}"
ARTIFACTS_DIR="${ELECTROBUN_ARTIFACTS_DIR:-$ROOT/artifacts-electrobun}"
OUT="${USB_OUT_ELECTROBUN:-$ROOT/release/Electrobun-WSI-Hive-USB}"
TMP="$ROOT/.runtime/electrobun-usb-assemble"

rm -rf "$TMP"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

find_first_mac_app() {
  for base in "$BUILD_DIR" "$ARTIFACTS_DIR"; do
    [ -d "$base" ] || continue
    find "$base" -maxdepth 6 -type d -name "*.app" -print -quit
  done
}

find_first_windows_zip() {
  [ -d "$ARTIFACTS_DIR" ] || return 0
  find "$ARTIFACTS_DIR" -maxdepth 3 -type f \( -iname "*win*.zip" -o -iname "*windows*.zip" \) -print -quit
}

find_first_windows_exe() {
  for base in "$@"; do
    [ -d "$base" ] || continue
    find "$base" -maxdepth 6 -type f \( -iname "*setup*.exe" -o -iname "*.exe" \) -print -quit
  done
}

mac_app="$(find_first_mac_app || true)"

win_search_roots=()
if [ -n "${ELECTROBUN_WIN_ZIP:-}" ]; then
  if [ ! -f "$ELECTROBUN_WIN_ZIP" ]; then
    echo "ELECTROBUN_WIN_ZIP does not exist: $ELECTROBUN_WIN_ZIP"
    exit 1
  fi
  mkdir -p "$TMP/win"
  unzip -q "$ELECTROBUN_WIN_ZIP" -d "$TMP/win"
  win_search_roots+=("$TMP/win")
else
  win_zip="$(find_first_windows_zip || true)"
  if [ -n "$win_zip" ]; then
    mkdir -p "$TMP/win"
    unzip -q "$win_zip" -d "$TMP/win"
    win_search_roots+=("$TMP/win")
  fi
fi
win_search_roots+=("$BUILD_DIR" "$ARTIFACTS_DIR")
win_exe="$(find_first_windows_exe "${win_search_roots[@]}" || true)"
installer_dir=""
if [ -n "$win_exe" ] && [ -d "$(dirname "$win_exe")/.installer" ]; then
  installer_dir="$(dirname "$win_exe")/.installer"
fi

if [ -z "$mac_app" ]; then
  if [ "${SKIP_MAC:-}" = "1" ]; then
    echo "WARN: no Electrobun macOS .app found — continuing (SKIP_MAC=1)."
  else
    echo "Missing Electrobun macOS .app under $BUILD_DIR or $ARTIFACTS_DIR."
    echo "Build on macOS with: bash scripts/build-and-assemble-electrobun.sh"
    exit 1
  fi
fi

if [ -z "$win_exe" ]; then
  if [ "${SKIP_WIN:-}" = "1" ]; then
    echo "WARN: no Electrobun Windows .exe found — continuing (SKIP_WIN=1)."
  else
    echo "Missing Electrobun Windows .exe/zip under $BUILD_DIR or $ARTIFACTS_DIR."
    echo "Build on Windows, then copy artifacts-electrobun/*win*.zip here, or set ELECTROBUN_WIN_ZIP=/path/to/package.zip."
    exit 1
  fi
fi

rm -rf "$OUT"
mkdir -p "$OUT/Slides"

if [ -f "$ROOT/Start Here.html" ]; then
  cp -f "$ROOT/Start Here.html" "$OUT/"
else
  echo "WARN: missing $ROOT/Start Here.html — USB folder will have no start guide."
fi

if [ "$(uname -s 2>/dev/null || true)" = "Darwin" ] && [ -f "$OUT/Start Here.html" ]; then
  "$ROOT/scripts/apply-start-here-icon.sh" "$OUT/Start Here.html" "$ROOT/start-here-assets/start-here-file-icon.png" || true
fi

if [ -d "$ROOT/Slides" ]; then
  python3 "$ROOT/scripts/prepare-usb-slides.py" "$ROOT/Slides" "$OUT/Slides"
else
  printf '%s\n' "Put whole-slide images in this folder." >"$OUT/Slides/PUT-SLIDES-HERE.txt"
fi

if [ -n "$mac_app" ]; then
  cp -R "$mac_app" "$OUT/WSI Hive.app"
  chmod +x "$OUT/WSI Hive.app/Contents/MacOS/"* 2>/dev/null || true
fi

if [ -n "$win_exe" ]; then
  cp -f "$win_exe" "$OUT/WSI Hive.exe"
  if [ -n "$installer_dir" ]; then
    cp -R "$installer_dir" "$OUT/.installer"
  else
    echo "WARN: Windows Electrobun .installer sidecar not found next to $win_exe."
  fi
fi

hide_exe_from_finder_macos_only() {
  if [ "$(uname -s 2>/dev/null || true)" = "Darwin" ] && command -v SetFile >/dev/null 2>&1; then
    SetFile -a V "$@" 2>/dev/null || true
  fi
}

hide_for_windows() {
  for target in "$@"; do
    [ -e "$target" ] || continue
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
hide_for_windows "$OUT/WSI Hive.app" "$OUT/.installer"

echo "Electrobun USB bundle ready — copy this entire folder to the flash drive:"
echo "  $OUT"
echo ""
echo "Contents (top level):"
find "$OUT" -maxdepth 1 -mindepth 1 -print | sort
