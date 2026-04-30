#!/bin/bash
# Runs a Linux AppImage (or binary) from .wsi-usb/linux/
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LDIR="$DIR/.wsi-usb/linux"
cd "$DIR"

if [ -d "$LDIR" ]; then
  for f in "$LDIR"/*.AppImage "$LDIR"/*WSI*linux*AppImage; do
    if [ -f "$f" ]; then
      chmod +x "$f" 2>/dev/null || true
      exec "$f" "$@"
    fi
  done
  BIN=$(find "$LDIR" -maxdepth 3 -type f \( -name "WSI Hive" -o -name "wsi-hive" \) 2>/dev/null | head -1)
  if [ -n "$BIN" ] && [ -x "$BIN" ]; then
    exec "$BIN" "$@"
  fi
fi

echo "No Linux AppImage under .wsi-usb/linux/ — see packaging/universal/PACK.md"
exit 1
