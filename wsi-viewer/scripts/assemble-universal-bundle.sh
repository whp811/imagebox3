#!/usr/bin/env bash
# After building on each platform (or copying CI artifacts), create a single folder
# you can zip for end users. Run from wsi-viewer/ :  ./scripts/assemble-universal-bundle.sh
#
# Layout: at the root, Start Here.html (self-contained), the three OS
# starters, Slides/, README, PACK.md, and a single hidden (after first run)
# .wsi-usb/ tree with win/, mac/, linux/ payloads.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/dist"
OUT="${UNIVERSAL_OUT:-$ROOT/release/WSI-Hive-universal}"
PACK="$ROOT/packaging/universal"

if [ ! -d "$SRC" ]; then
  echo "No $SRC — run: npm run build && npm run dist  (in wsi-viewer/) first on this machine."
  exit 1
fi

mkdir -p "$OUT"
cp -f "$PACK/README.txt" "$OUT/" 2>/dev/null || true
cp -f "$PACK/PACK.md" "$OUT/" 2>/dev/null || true
cp -f "$ROOT/Start Here.html" "$OUT/" 2>/dev/null || true
if [ -f "$OUT/Start Here.html" ]; then
  OUT="$OUT" python3 - <<'PY'
from pathlib import Path
import os
out = Path(os.environ["OUT"]) / "Start Here.html"
text = out.read_text(encoding="utf-8")
text = text.replace('href="Slides/.wsi-hive/WSI-Hive-Windows.bat"', 'href="WSI-Hive-Windows.bat"')
text = text.replace('href="Slides/.wsi-hive/WSI-Hive-macOS.command"', 'href="WSI-Hive-macOS.command"')
out.write_text(text, encoding="utf-8")
PY
fi
if [ "$(uname -s 2>/dev/null || true)" = "Darwin" ] && [ -f "$OUT/Start Here.html" ]; then
  "$ROOT/scripts/apply-start-here-icon.sh" "$OUT/Start Here.html" "$ROOT/start-here-assets/start-here-file-icon.png" || true
fi
cp -f "$PACK/WSI-Hive-Windows.bat" "$OUT/" 2>/dev/null || true
cp -f "$PACK/WSI-Hive-macOS.command" "$OUT/" 2>/dev/null || true
cp -f "$PACK/WSI-Hive-Linux.sh" "$OUT/" 2>/dev/null || true
if [ -d "$PACK/Slides" ]; then
  mkdir -p "$OUT/Slides"
  cp -R "$PACK/Slides/." "$OUT/Slides/" 2>/dev/null || true
fi
rm -rf "$OUT/.wsi-usb"
if [ -d "$PACK/.wsi-usb" ]; then
  cp -R "$PACK/.wsi-usb" "$OUT/"
fi
mkdir -p "$OUT/.wsi-usb/win" "$OUT/.wsi-usb/linux" "$OUT/.wsi-usb/mac"

# macOS .app from dir target
for d in "$SRC"/mac* "$SRC"/mac; do
  if [ -d "$d" ]; then
    find "$d" -maxdepth 2 -name "*.app" -exec cp -R {} "$OUT/.wsi-usb/mac/" \; 2>/dev/null || true
  fi
done

# Windows: portable exes only
find "$SRC" -maxdepth 1 -name "WSI-Hive-*-portable.exe" -exec cp {} "$OUT/.wsi-usb/win/" \; 2>/dev/null || true
find "$SRC" -maxdepth 1 -name "*portable*.exe" -exec cp {} "$OUT/.wsi-usb/win/" \; 2>/dev/null || true

# Linux AppImage
find "$SRC" -maxdepth 1 -name "*.AppImage" -exec cp {} "$OUT/.wsi-usb/linux/" \; 2>/dev/null || true

chmod +x "$OUT/WSI-Hive-macOS.command" "$OUT/WSI-Hive-Linux.sh" 2>/dev/null || true
chmod +x "$OUT/.wsi-usb/launch-mac.sh" "$OUT/.wsi-usb/launch-linux.sh" 2>/dev/null || true

# Optional: pre-hide .wsi-usb on a Mac-assembled copy (FAT/ExFAT sticks moved to Windows
# are hidden the first time WSI-Hive-Windows.bat succeeds via attrib)
if [ "$(uname -s 2>/dev/null || true)" = "Darwin" ] && [ -d "$OUT/.wsi-usb" ]; then
  chflags hidden "$OUT/.wsi-usb" 2>/dev/null || true
fi

echo "Assembled: $OUT"
echo "Next: zip that folder, or add missing platforms from other machines/CI and re-run."
ls -la "$OUT"
