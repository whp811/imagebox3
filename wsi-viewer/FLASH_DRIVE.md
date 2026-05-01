# WSI Hive on a USB flash drive (no install, no download)

## What you want

- You **copy the app onto a USB stick** (or encrypted drive) **once** — from a build machine or a provided zip.
- The **user does not download** anything from the internet to use it.
- They **open the app from the drive** and view slides. **Slide files stay on the drive** (in the `Slides` folder); the app reads them in place and does **not** copy whole slides off the volume.
- The app is configured so **Electron’s own profile and cache** also live **next to the app** on that drive (hidden folder `.wsi-hive-data`), not under the user’s home directory.

## Folder layout on the stick

The **production Mac + Windows handout** uses exactly three root items:

```text
USB root/
  Start Here.html
  WSI-Hive-Windows.exe
  WSI Hive.app
  Slides/
```

`Start Here.html` is the user-facing guide. It includes launch links, screenshots, security-warning help, troubleshooting, FAQs, flash-drive care instructions, legal/clinical warnings, and UHN Laboratory Medicine Program contact information.

The **application itself** is a **single native package per platform** (no `win-unpacked` folder, no tree of runtime DLLs next to the app):

- **Windows:** one portable `.exe` (`WSI-Hive-Windows.exe` in `release/WSI-Hive-USB/`). All app resources are **inside** that file; the OS may use `%TEMP%` for extraction while running — that is outside your USB, not a second “app folder” you ship.
- **macOS:** one `WSI Hive.app` **bundle** — in Finder it looks like **a single app icon** (a package folder under the hood).

Also on the same volume, **next to** the executable / `.app`, keep:

- **`Slides\`** (or `Slides/`) — put .svs / .ndpi / .tif / … here.
- **ZIP bundles are supported** under `Slides/`: put the raw WSI and small `Evidence/` folder in one `.zip`. First scan reads only small Evidence text/image files for slide ID, stain, and label thumbnail; it skips raw WSI bytes. Stored/no-compression WSI entries open directly (`zip -0 slide.zip slide.svs metadata.json`). Deflated/compressed WSI entries are extracted on first open into `.wsi-hive-data/zip-cache` and reused while the source ZIP is unchanged.
- **`.wsi-hive-data\`** — **created on first run** (cache, settings on the drive; dot-prefixed so it is hidden in many file managers; Windows builds also mark it hidden in Explorer).

```text
E:\
  WSI-Hive-Windows.exe
  WSI Hive.app
  Slides\           ← your slide files
  .wsi-hive-data\  ← first-run (optional to hide on Windows; see above)
```

**If you use the all-in-one zip from `npm run universal:assemble`:** you get a **root** with three clearly named starters (**WSI-Hive-Windows** / **WSI-Hive-macOS** / **WSI-Hive-Linux**), a **Slides** folder, and the per-OS app binaries under **.wsi-usb/** (intended to be out of the way in the file manager after a successful first start). Put slides in the root **Slides** folder, not under **.wsi-usb**.

**macOS:** the folder that **contains** **Slides** and **.wsi-usb**; `WSI Hive.app` is inside **.wsi-usb/mac/** in the supplied bundle.

**Linux:** the folder that contains the `.AppImage` and `Slides/`.

## First run (no network)

- You do **not** need the internet to **view** slides. (Building the app from source is a separate step on a developer machine.)
- If the OS shows a security warning (unsigned app), that is a **one-time** system dialog, not a “download the app” step.

## “Click to run”

- **Windows:** double-click **WSI-Hive-Windows.exe**.
- **macOS:** double-click **WSI Hive.app**.
- **Linux:** run the `AppImage` (you may need `chmod +x` on Linux-native filesystems; on FAT32 USB, use the provided shell launcher if we ship one, or see `packaging/universal/PACK.md`).

## If something writes outside the drive

- **Slide pixels:** read through the in-app `wsi://` handler from the file path you chose; they are not uploaded.
- **Electron data:** packaged builds set `userData` / `cache` to `.wsi-hive-data` **next to the app** (see `src/main/index.ts`).
- **OS temp:** the OS may still use `/tmp` or `%TEMP%` for tiny transient buffers; that is normal and is not your slide library.

## Building the copy that goes on the stick

On your machine: `cd wsi-viewer && npm run dist:usb`, then copy the **contents** of `release/WSI-Hive-USB/` to the USB root. **Do not** require the end user to run `npm` or install Node.
