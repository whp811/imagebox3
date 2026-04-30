# Imagebox3 Archive

Imagebox3 was removed from the active viewer on 2026-04-30. Current app path is OpenSlide WASM only.

## What Moved Here

- `root/imagebox3.mjs`: original top-level Imagebox3 library entry.
- `root/README.md`: original Imagebox3 README/API example.
- `docs/`: generated Imagebox3 API docs.
- `decoders/`: legacy GeoTIFF/JPEG2000 decoder assets.
- `wsi-viewer/src/wsi/imagebox3.mjs`: Electron viewer Imagebox3 wrapper, including GeoTIFF driver and prior OpenSlide fallback.
- `wsi-viewer/src/renderer/lib/imagebox3-tilesource.ts`: old OpenSeadragon tile source with GeoTIFF/Imagebox tile path.
- `wsi-viewer/public/decoders/`: old public decoder links used by the GeoTIFF/JPEG2000 path. Actual decoder files are in `decoders/`.

## How It Used To Work

Active viewer path was:

1. `WsiOsdView.tsx` imported `buildImagebox3OpenSeadragonTileSource`.
2. `imagebox3-tilesource.ts` created an `Imagebox3` instance for the `wsi://` URL.
3. `wsi-viewer/src/wsi/imagebox3.mjs` selected a driver:
   - `GeoTIFFDriver` for tiled TIFF/SVS/GeoTIFF.
   - `OpenSlideDriver` for NDPI fallback, later toggled toward OpenSlide for all WSI.
4. `GeoTIFFDriver` used `geotiff` + range reads against the app `wsi://` protocol.
5. Tiles came back as canvas data and were handed to OpenSeadragon.

This worked best for tiled TIFF/SVS. It failed or slowed badly on the local NDPI because that NDPI stores pyramid levels as huge single-strip JPEGs; small viewport tiles forced big strip decodes.

## Current Replacement

Active viewer path now is:

1. `WsiOsdView.tsx` imports `buildOpenSlideOpenSeadragonTileSource`.
2. `openslide-tilesource.ts` builds OpenSeadragon levels from OpenSlide pyramid metadata.
3. `wsi-viewer/src/renderer/lib/openslide-tilesource.ts` owns OpenSlide WASM init/open/read/close.
4. All current WSI extensions route through OpenSlide WASM.

## Restore Imagebox3 Path

To regress:

1. Copy archived files back:
   - `archive/imagebox3/wsi-viewer/src/wsi/imagebox3.mjs` -> `wsi-viewer/src/wsi/imagebox3.mjs`
   - `archive/imagebox3/wsi-viewer/src/renderer/lib/imagebox3-tilesource.ts` -> `wsi-viewer/src/renderer/lib/imagebox3-tilesource.ts`
   - optional decoder files: `archive/imagebox3/decoders` -> `decoders`
   - optional public decoder links: recreate `wsi-viewer/public/decoders` to point at `../../../decoders`
   - optional top-level library/docs: `archive/imagebox3/root/imagebox3.mjs`, `archive/imagebox3/docs`, `archive/imagebox3/decoders`
2. In `wsi-viewer/src/renderer/components/WsiOsdView.tsx`, restore import/use:
   - import `buildImagebox3OpenSeadragonTileSource` from `../lib/imagebox3-tilesource`
   - use returned `{ imagebox3, tileSource }`
   - destroy via `imagebox3.destroyWorkerPool?.()`
3. In `wsi-viewer/src/wsi/imagebox3.mjs`, set `USE_OPENSLIDE_FOR_ALL_WSI = false` if you want GeoTIFF/Imagebox for `.svs/.tif/.tiff/.gtiff` and OpenSlide only for `.ndpi`.
4. Re-add active dependency if removed:
   - `cd wsi-viewer && npm install geotiff@2.1.2`
5. Re-enable embedded WSI label thumbnails in `App.tsx` only if you want old GeoTIFF metadata/label probing.
6. Run:
   - `npm run typecheck`
   - `npm run build`
   - open `.svs` and `.ndpi` in Electron.

## Keep Archived

Do not import from `archive/` in active app. Archive is source reference only.
