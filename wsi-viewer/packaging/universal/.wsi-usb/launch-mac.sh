#!/bin/bash
# Picks a .app under .wsi-usb/mac* and opens it. The Slides/ folder is on the drive root
# (sibling to .wsi-usb) — the Electron app resolves that via the embedded path in slides-root.ts
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
B="$DIR/.wsi-usb"
cd "$DIR"

hide_engine_folder() {
  if [ -d "$B" ]; then
    chflags hidden "$B" 2>/dev/null || true
  fi
}

for d in "$B/mac" "$B/mac-arm64" "$B/mac-x64" "$B/darwin"; do
  if [ -d "$d" ]; then
    APP=$(find "$d" -maxdepth 2 -name "*.app" -print -quit 2>/dev/null)
    if [ -n "$APP" ] && [ -d "$APP" ]; then
      open "$APP"
      hide_engine_folder
      exit 0
    fi
  fi
done

APP=$(find "$B" -maxdepth 1 -name "*.app" -print -quit 2>/dev/null)
if [ -n "$APP" ] && [ -d "$APP" ]; then
  open "$APP"
  hide_engine_folder
  exit 0
fi

APP=$(find . -maxdepth 1 -name "*.app" -print -quit 2>/dev/null)
if [ -n "$APP" ] && [ -d "$APP" ]; then
  open "$APP"
  hide_engine_folder
  exit 0
fi

echo "No macOS WSI Hive .app under .wsi-usb/ — copy a Mac build to .wsi-usb/mac/ or see PACK.md"
echo "Press Enter to close."
read -r _
exit 1
