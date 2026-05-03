#!/usr/bin/env python3
"""Embed start-here-assets into Start Here.html as data URIs.

Edit `Start Here.template.html` (paths under .wsi-hive/start-here-assets/), then run from wsi-viewer/:

  python3 scripts/inline-start-here-assets.py

Writes `Start Here.html` (self-contained, no external images).
"""
from __future__ import annotations

import base64
import re
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "Start Here.template.html"
OUTPUT = ROOT / "Start Here.html"
ASSETS = ROOT / "start-here-assets"


def data_uri_for(path: Path) -> str:
    raw = path.read_bytes()
    ext = path.suffix.lower()
    if ext == ".svg":
        text = raw.decode("utf-8")
        return "data:image/svg+xml;charset=utf-8," + quote(text, safe="")
    mime = {
        ".png": "image/png",
        ".ico": "image/x-icon",
        ".jpg": "image/jpeg",
        ".webp": "image/webp",
    }.get(ext, "application/octet-stream")
    b64 = base64.standard_b64encode(raw).decode("ascii")
    return f"data:{mime};base64,{b64}"


def main() -> None:
    if not TEMPLATE.is_file():
        print(f"Missing {TEMPLATE}", file=sys.stderr)
        sys.exit(1)
    if not ASSETS.is_dir():
        print(f"Missing {ASSETS}", file=sys.stderr)
        sys.exit(1)

    text = TEMPLATE.read_text(encoding="utf-8")
    pattern = re.compile(r"\.wsi-hive/start-here-assets/([^\"')\s>]+)")

    def repl(m: re.Match[str]) -> str:
        name = m.group(1)
        path = ASSETS / name
        if not path.is_file():
            raise SystemExit(f"Missing asset: {path}")
        return data_uri_for(path)

    out = pattern.sub(repl, text)
    OUTPUT.write_text(out, encoding="utf-8")
    print(f"Wrote {OUTPUT} (embedded assets from {ASSETS})")


if __name__ == "__main__":
    main()
