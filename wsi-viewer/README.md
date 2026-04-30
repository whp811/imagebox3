# WSI Hive

Portable **Electron** desktop app: **React** + **Imagebox3** (GeoTIFF + OpenSlide WASM) + **OpenSeadragon 5** for local whole-slide viewing. No network required at runtime.

**Copy the built app to a USB drive** (or any folder); the user runs it from there with **no install and no download**. Put slides in a `Slides` folder next to the app. See [`FLASH_DRIVE.md`](FLASH_DRIVE.md).

## Layout

- Put the app bundle and a sibling folder `Slides` on the same drive (e.g. encrypted USB). **Dev mode** uses `Slides` under the `wsi-viewer` project directory.
- `Slides` may contain WSI files (`.svs`, `.tif`, `.tiff`, `.ndpi`, `.mrxs`, etc.) in subfolders or at the top level. The app scans recursively.

## Commands

```bash
cd wsi-viewer
npm install
npm run dev          # Vite + Electron
npm run build        # output to out/
npm run dist         # electron-builder → dist/
```

## How it works

- **Main process** registers `wsi://` **fetch + Range** so `geotiff`/`fromUrl` can read local paths without copying slides out.
- **Renderer** loads `Imagebox3` + custom **OpenSeadragon** tile source calling `getTile` for each view tile.
- **OpenSeadragon** control images: copied to `public/osd` via `postinstall`.

## One zip for Mac + Windows + Linux (what you asked for)

You still need **three separate builds** (OS cannot run one native binary for all), but the **user** can get **one folder or one .zip** that works like this:

1. **Build** or **CI** produces `dist/` on **macOS**, **Windows**, and **Linux** (each platform’s own `npm run dist`, or a GitHub Actions matrix).
2. From `wsi-viewer/`, run **`npm run universal:assemble`**. It places **three** root starters (**WSI-Hive-Windows.bat**, **WSI-Hive-macOS.command**, **WSI-Hive-Linux.sh**), a template **Slides/**, and the platform **payloads** under **.wsi-usb/{win,mac,linux}/** in `release/WSI-Hive-universal/`.
3. **Zip that folder** and put it on a USB drive. The user **double-clicks their OS’s** starter. The **.wsi-usb** tree is made low-profile after a successful first launch (see `PACK.md`).

No one cross-platform binary: the OS you’re on is the one you click.

Details: `packaging/universal/PACK.md` and `README.txt` (copied into the release folder).

## Packaging (per OS)

`npm run dist` uses `electron-builder.json` (portable on Windows, dmg/zip on macOS, AppImage/tar.gz on Linux). Adjust `files` and targets as needed.

## Privacy

- No telemetry; no external URLs in the viewer path. Stays on disk under your control. Thumbnails use `getThumbnail` in-process (object URLs; revoke not aggressive—fine for normal session sizes).

## Notes

- shadcn/ui: this UI uses **Tailwind**-style layout and tokens. You can run `npx shadcn@latest init` in this folder and restyle; structure is already componentized (`App`, `WsiOsdView`).
- Very large slide libraries: thumbnail queue is staggered; increase delay in `App.tsx` if the machine chokes.
- If OpenSlide **workers** fail under `sandbox: true` in your environment, set `webPreferences.sandbox` to `false` in `src/main/index.ts` (trade security vs compatibility).
