#!/bin/bash
# Double-click: starts the macOS build. Payload lives in .wsi-usb/ (can be hidden after a successful start).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$DIR/.wsi-usb/launch-mac.sh"
