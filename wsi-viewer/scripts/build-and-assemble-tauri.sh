#!/usr/bin/env bash
# One-shot: build Tauri artifacts then assemble USB folder (Tauri track only).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/build-tauri.sh"
bash "$ROOT/scripts/assemble-usb-tauri-production.sh"
