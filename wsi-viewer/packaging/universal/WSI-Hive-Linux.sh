#!/bin/bash
# Run with bash, or: chmod +x and double-click in your file manager.
# Starts the Linux AppImage. Payload lives in .wsi-usb/ (visible unless your desktop hides dot-folders).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$DIR/.wsi-usb/launch-linux.sh"
