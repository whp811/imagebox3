# WSI Hive

Portable desktop app: **React** + **OpenSlide WASM** + **OpenSeadragon 5** for local whole-slide viewing, packaged with Electron, Tauri, or Electrobun. No network required at runtime.

**Copy the built app to a USB drive** (or any folder); the user runs it from there with **no install and no download**. Put slides in a `Slides` folder next to the app. See [`FLASH_DRIVE.md`](FLASH_DRIVE.md).

## Layout

- Put the app bundle and a sibling folder `Slides` on the same drive (e.g. encrypted USB). **Dev mode** uses `Slides` under the `wsi-viewer` project directory.
- `Slides` may contain WSI files (`.svs`, `.tif`, `.tiff`, `.ndpi`, `.mrxs`, etc.) in subfolders or at the top level. The app scans recursively.
- `Slides` may also contain `.zip` bundles. Each ZIP can hold a WSI plus a small `Evidence/` folder. First scan reads only the ZIP directory plus small Evidence text/image sidecars (`.json`, `.xml`, `.txt`, `.csv`, `.tsv`, `.ini`, `.yaml`, `.yml`, `.jpg`, `.png`, `.webp`) to find slide ID, stain, and label thumbnail; it skips the raw WSI bytes. Stored/no-compression WSI entries open directly (`zip -0 slide.zip slide.svs metadata.json`). Deflated/compressed WSI entries are extracted on first open into `.wsi-hive-data/zip-cache` and reused while the source ZIP is unchanged. `npm run dist:usb` rewrites bundled ZIP WSI entries to stored/no-compression so patient handouts open them directly.

## Commands

```bash
cd wsi-viewer
npm install
npm run dev          # Vite + Electron
npm run build        # output to out/
npm run dist         # electron-builder → dist/
npm run dist:usb     # release/WSI-Hive-USB — Start Here + Slides + dual-platform apps
bash scripts/build-and-assemble-electrobun.sh  # release/Electrobun-WSI-Hive-USB
```

## How it works

- **Main process** registers `wsi://` **fetch + Range** so OpenSlide WASM can read local paths and stored WSI entries inside ZIPs without copying slides out. Compressed WSI entries are transparently materialized into the portable cache before viewing.
- **Electrobun** uses the same renderer API but serves slide bytes from a local `127.0.0.1` range server because Electrobun does not use Electron's protocol handler.
- **Renderer** loads OpenSlide WASM + custom **OpenSeadragon** tile source reading each visible tile via `readRegion`.
- **OpenSeadragon** control images: copied to `public/osd` via `postinstall`.

## USB root for Mac + Windows

Production USB handout for Mac + Windows keeps the patient-facing root clean:

- `Start Here.html` — patient guide.
- `Slides/` — put `.svs`, `.ndpi`, `.tif`, `.tiff`, `.mrxs`, etc. here.
- `WSI Hive.app` — macOS app bundle, visible on Mac and hidden on Windows.
- `WSI Hive.exe` — portable Windows app, visible on Windows and hidden from Finder on Mac.

From `wsi-viewer/`, run `npm run dist:usb`. Output lands in `release/WSI-Hive-USB/`.

## Electrobun USB build

From `wsi-viewer/`, run `bash scripts/build-and-assemble-electrobun.sh`. Output lands in `release/Electrobun-WSI-Hive-USB/`.

Electrobun currently builds the host platform in this script. To make the final Mac + Windows folder, build on the missing platform and copy its `artifacts-electrobun/*win*.zip` or macOS `.app` into this checkout, then rerun:

```bash
ELECTROBUN_SKIP_BUILD=1 bash scripts/build-and-assemble-electrobun.sh
```

Use `SKIP_WIN=1` or `SKIP_MAC=1` only for a single-platform test bundle.

## One zip for Mac + Windows + Linux

You still need separate native builds because each OS uses a different executable format. For Linux too, use `npm run universal:assemble`; it creates root starters plus hidden payloads in `release/WSI-Hive-universal/`.

Details: `packaging/universal/PACK.md` and `README.txt` (copied into the release folder).

## Packaging (per OS)

`npm run dist` uses `electron-builder.json` (portable on Windows, dmg/zip on macOS, AppImage/tar.gz on Linux). Adjust `files` and targets as needed.

## Privacy

- No telemetry; no external URLs in the viewer path. Stays on disk under your control. Thumbnails use `getThumbnail` in-process (object URLs; revoke not aggressive—fine for normal session sizes).

## Notes

- shadcn/ui: this UI uses **Tailwind**-style layout and tokens. You can run `npx shadcn@latest init` in this folder and restyle; structure is already componentized (`App`, `WsiOsdView`).
- If OpenSlide **workers** fail under `sandbox: true` in your environment, set `webPreferences.sandbox` to `false` in `src/main/index.ts` (trade security vs compatibility).
