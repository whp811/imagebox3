# Assembling the “universal” folder

This is **one zip** that contains **three** platform-specific apps (not one binary for all OSes) plus a clean **root** layout: three visible starters, **Slides/**, and a single support tree **.wsi-usb/** (hidden after a first successful run on that OS, where the OS supports it).

## What to copy into this directory

After `npm run dist` in `wsi-viewer/`, `electron-builder` writes to `wsi-viewer/dist/`. The assemble script then copies per-platform **payloads** **into** **`.wsi-usb/{win,mac,linux}/`** (not as loose top-level `win/`, `mac/`, `linux/`), and copies a template **Slides/** to the **bundle root** so the **Slides** folder sits next to the three root starters. Typical layout of the final zip:

| Platform | Copied to | Notes |
|----------|------------|--------|
| **macOS** | `.wsi-usb/mac/…` | The `.app` bundle (e.g. `WSI Hive.app`) from `mac*` `dist` output. |
| **Windows** | `.wsi-usb/win/` | The portable `WSI-Hive-*-portable.exe` only (one file; do not ship `win-unpacked/`) — NSIS `*-Setup*.exe` is a separate, optional installer, not the USB “single file” story. |
| **Linux** | `.wsi-usb/linux/` | The `.AppImage` (single file). |

| Root (end user) | |
|-----------------|---|
| **Start Here.html** | User guide with launch links, screenshots, security-warning help, troubleshooting, FAQs, and support contact information. |
| **WSI-Hive-Windows.bat** | Starts the Windows portable under `.wsi-usb\win\`. On success, hides the whole **.wsi-usb** in Explorer. |
| **WSI-Hive-macOS.command** | Opens the `.app` under `.wsi-usb/mac/…`. On success, hides **.wsi-usb** in Finder when possible. |
| **WSI-Hive-Linux.sh** | Runs the AppImage in `.wsi-usb/linux/`. |
| **Slides/** | Put .svs / .ndpi / .tif / … here (sibling to **.wsi-usb**; the app resolves the root via the path in `getApplicationRootDir()` in `src/main/slides-root.ts` when the executable lives under **.wsi-usb**). |

**Electron** treats the **parent of** **`.wsi-usb`** on the drive as the **bundle root** (so `Slides` stays on the **root of the handout** next to the three visible starters, not under **.wsi-usb**). Names inside `dist/` can vary by version and arch; the launchers search common patterns.

## One-command assembly (after local builds or manual copy)

From `wsi-viewer/`:

```bash
./scripts/assemble-universal-bundle.sh
```

The script only **organizes** files; it does not cross-compile. To produce all three at once, use **CI** (e.g. GitHub Actions) with a matrix: `macos-latest`, `windows-latest`, `ubuntu-latest`, each running `npm ci && npm run dist`, then upload artifacts and merge into one zip in a final job.

## Why not a single native binary?

macOS, Windows, and Linux use different executable formats, system libraries, and (for Electron) different Chromium builds. A “universal” experience is: **one zip**, **three** obvious starters, **one** `Slides/`, and **one** hidden (after first run) **.wsi-usb/**, not one `.exe` that runs on all three.
