# WSI Hive

Portable Electron whole-slide viewer using OpenSlide WASM + OpenSeadragon.

The active app lives in [`wsi-viewer/`](wsi-viewer/). It opens local WSI files from a sibling `Slides/` folder and supports `.svs`, `.tif`, `.tiff`, `.gtiff`, and `.ndpi` through OpenSlide WASM.

The viewer does not depend on any legacy browser-only Imagebox3 tree; if you still have an old `archive/` snapshot, it is excluded from tooling (see `.graphifyignore`) and safe to delete when you no longer want it in the repo.
