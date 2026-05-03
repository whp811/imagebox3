#!/usr/bin/env python3
"""Copy Slides for USB output, storing WSI entries inside ZIP bundles.

OpenSlide needs random byte ranges. A deflated WSI inside a ZIP must be unpacked
before viewing, which makes first open look broken for multi-GB slides on USB.
This keeps ZIP sidecars as-is but rewrites WSI entries with ZIP_STORED.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import zipfile
from pathlib import Path


WSI_EXTS = {".svs", ".tif", ".tiff", ".gtiff", ".ndpi"}
COPY_CHUNK_BYTES = 1024 * 1024


def is_wsi_entry(name: str) -> bool:
    return Path(name.replace("\\", "/")).suffix.lower() in WSI_EXTS


def clone_zip_info(info: zipfile.ZipInfo, *, compress_type: int) -> zipfile.ZipInfo:
    cloned = zipfile.ZipInfo(filename=info.filename, date_time=info.date_time)
    cloned.comment = info.comment
    cloned.extra = info.extra
    cloned.internal_attr = info.internal_attr
    cloned.external_attr = info.external_attr
    cloned.create_system = info.create_system
    cloned.compress_type = compress_type
    return cloned


def copy_zip_entry(
    source_zip: zipfile.ZipFile,
    output_zip: zipfile.ZipFile,
    info: zipfile.ZipInfo,
) -> bool:
    should_store = is_wsi_entry(info.filename)
    compress_type = zipfile.ZIP_STORED if should_store else info.compress_type
    cloned = clone_zip_info(info, compress_type=compress_type)

    if info.is_dir():
        output_zip.writestr(cloned, b"")
        return False

    with source_zip.open(info, "r") as src, output_zip.open(cloned, "w", force_zip64=True) as dst:
        shutil.copyfileobj(src, dst, length=COPY_CHUNK_BYTES)
    return should_store and info.compress_type != zipfile.ZIP_STORED


def copy_zip_with_stored_wsi_entries(src: Path, dst: Path) -> None:
    tmp = dst.with_suffix(dst.suffix + ".tmp")
    tmp.unlink(missing_ok=True)
    normalized = 0
    with zipfile.ZipFile(src, "r") as source_zip, zipfile.ZipFile(tmp, "w", allowZip64=True) as output_zip:
        output_zip.comment = source_zip.comment
        for info in source_zip.infolist():
            if info.flag_bits & 0x1:
                raise RuntimeError(f"Encrypted ZIP entries are not supported: {src}")
            if copy_zip_entry(source_zip, output_zip, info):
                normalized += 1
    tmp.replace(dst)
    if normalized:
        print(f"Stored {normalized} WSI ZIP entr{'y' if normalized == 1 else 'ies'}: {dst}")


def copy_slides(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True, exist_ok=True)

    for path in src.rglob("*"):
        rel = path.relative_to(src)
        if any(part == ".DS_Store" for part in rel.parts):
            continue
        target = dst / rel
        if path.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        if not path.is_file():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        if path.suffix.lower() == ".zip":
            copy_zip_with_stored_wsi_entries(path, target)
        else:
            shutil.copy2(path, target)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("src", type=Path)
    parser.add_argument("dst", type=Path)
    args = parser.parse_args()

    if not args.src.is_dir():
        args.dst.mkdir(parents=True, exist_ok=True)
        (args.dst / "PUT-SLIDES-HERE.txt").write_text("Put whole-slide images in this folder.\n")
        return 0

    copy_slides(args.src, args.dst)
    return 0


if __name__ == "__main__":
    sys.exit(main())
