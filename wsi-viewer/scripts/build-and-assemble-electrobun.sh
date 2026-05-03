#!/usr/bin/env bash
# One-shot: build Electrobun artifacts for this host, then assemble the USB folder.
# To include both platforms, place the missing platform's Electrobun artifact in
# artifacts-electrobun/ and rerun with ELECTROBUN_SKIP_BUILD=1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

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
  "$NODE_BIN" "$VITE_CLI" build --config "$ROOT/vite.config.electrobun.ts"

  env_name="${ELECTROBUN_ENV:-stable}"
  if [ -n "${ELECTROBUN_TARGETS:-}" ]; then
    "$NODE_BIN" "$ELECTROBUN_CLI" build --env="$env_name" --targets="$ELECTROBUN_TARGETS"
  else
    "$NODE_BIN" "$ELECTROBUN_CLI" build --env="$env_name"
  fi
fi

python3 "$ROOT/scripts/inline-start-here-assets.py"
bash "$ROOT/scripts/assemble-usb-electrobun-production.sh"
