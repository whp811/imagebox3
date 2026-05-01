#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-"$ROOT/Start Here.html"}"
ICON_PNG="${2:-"$ROOT/start-here-assets/start-here-file-icon.png"}"

if [ "$(uname -s 2>/dev/null || true)" != "Darwin" ]; then
  echo "Skipping custom Start Here icon: macOS required."
  exit 0
fi

if [ ! -f "$TARGET" ]; then
  echo "Missing target file: $TARGET" >&2
  exit 1
fi

if [ ! -f "$ICON_PNG" ]; then
  echo "Missing icon source: $ICON_PNG" >&2
  exit 1
fi

for tool in sips DeRez Rez SetFile; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool" >&2
    exit 1
  fi
done

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

RSRC="$TMPDIR/start-here-file-icon.rsrc"
PNG="$TMPDIR/start-here-file-icon.png"

cp "$ICON_PNG" "$PNG"
sips -i "$PNG" >/dev/null
DeRez -only icns "$PNG" > "$RSRC"

SetFile -a c "$TARGET" 2>/dev/null || true
xattr -d com.apple.ResourceFork "$TARGET" 2>/dev/null || true

Rez -append "$RSRC" -o "$TARGET"
SetFile -a C "$TARGET"

echo "Applied custom Start Here icon: $TARGET"
