#!/usr/bin/env bash
# Build Tauri desktop bundles (does not run Electron or electron-vite).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo not found — install Rust: https://rustup.rs"
  exit 1
fi

exec npm run tauri:build
