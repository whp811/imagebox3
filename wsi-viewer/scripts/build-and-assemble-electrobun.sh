#!/usr/bin/env bash
# One-shot: build Electrobun artifacts for this host, then assemble the USB folder.
# macOS only builds the macOS Electrobun target (see scripts/electrobun-cli-build.cjs).
# To add Windows to the USB folder, copy a Windows Electrobun zip into artifacts-electrobun/
# or set ELECTROBUN_WIN_ZIP, then rerun with ELECTROBUN_SKIP_BUILD=1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# USB assembly expects a Windows .exe unless SKIP_WIN=1 (see assemble-usb-electrobun-production.sh).
if [ "$(uname -s 2>/dev/null || true)" = "Darwin" ] && [ "${SKIP_WIN+set}" != set ]; then
  export SKIP_WIN=1
fi

resolve_node() {
  if [ -n "${NODE_BIN:-}" ]; then
    if "$NODE_BIN" --version >/dev/null 2>&1; then
      printf '%s\n' "$NODE_BIN"
      return 0
    fi
    echo "NODE_BIN is set but does not run: $NODE_BIN" >&2
    return 1
  fi

  for candidate in \
    "$(command -v node 2>/dev/null || true)" \
    "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"; do
    [ -n "$candidate" ] || continue
    if "$candidate" --version >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  echo "No working Node.js found. Install/fix Node, or set NODE_BIN=/path/to/node." >&2
  return 1
}

NODE_BIN="$(resolve_node)"
VITE_CLI="$ROOT/node_modules/vite/bin/vite.js"
ELECTROBUN_CLI="$ROOT/node_modules/electrobun/bin/electrobun.cjs"

if [ ! -f "$VITE_CLI" ] || [ ! -f "$ELECTROBUN_CLI" ]; then
  echo "Missing node_modules. Run npm install in $ROOT first."
  exit 1
fi

if [ "${ELECTROBUN_SKIP_BUILD:-}" != "1" ]; then
  "$NODE_BIN" "$ROOT/scripts/ensure-electrobun-mac-iconset.cjs"
  "$NODE_BIN" "$VITE_CLI" build --config "$ROOT/vite.config.electrobun.ts"

  "$NODE_BIN" "$ROOT/scripts/electrobun-cli-build.cjs"
fi

python3 "$ROOT/scripts/inline-start-here-assets.py"
bash "$ROOT/scripts/assemble-usb-electrobun-production.sh"
