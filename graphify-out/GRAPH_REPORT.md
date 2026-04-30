# Graph Report - /Users/mw/Documents/GitHub/imagebox3  (2026-04-29)

## Corpus Check
- 86 files · ~124,531 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 199 nodes · 308 edges · 14 communities detected
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 26 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_WSI desktop shell|WSI desktop shell]]
- [[_COMMUNITY_Decoder modules|Decoder modules]]
- [[_COMMUNITY_GeoTIFF  pyramid|GeoTIFF / pyramid]]
- [[_COMMUNITY_OpenSeadragon UI|OpenSeadragon UI]]
- [[_COMMUNITY_Demo service worker|Demo service worker]]
- [[_COMMUNITY_JSDoc HTML|JSDoc HTML]]
- [[_COMMUNITY_Imagebox3 core|Imagebox3 core]]
- [[_COMMUNITY_Electron protocol|Electron protocol]]
- [[_COMMUNITY_Slide scanning|Slide scanning]]
- [[_COMMUNITY_Thumbnails  tiles|Thumbnails / tiles]]
- [[_COMMUNITY_Prettify  docs JS|Prettify / docs JS]]
- [[_COMMUNITY_Legacy bundle|Legacy bundle]]
- [[_COMMUNITY_Font assets|Font assets]]
- [[_COMMUNITY_OpenSlide API|OpenSlide API]]

## God Nodes (most connected - your core abstractions)
1. `OpenSlideApi` - 15 edges
2. `Imagebox3` - 14 edges
3. `handleMessage()` - 14 edges
4. `createPool()` - 10 edges
5. `sendCommand()` - 10 edges
6. `OpenSlideDriver` - 9 edges
7. `getHandle()` - 9 edges
8. `Imagebox3 vendored geotiff npm openslide local assets` - 9 edges
9. `getImageThumbnail()` - 8 edges
10. `getImageTile()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `Imagebox3 CDN geotiff jsdelivr remote openslide URL` --implements_described_library--> `ImageBox3 zero-footprint range requests governance`  [INFERRED]
  imagebox3.mjs → README.md
- `getSlidesRootPath sibling Slides folder` --user_controlled_Slides_sibling_folder--> `No telemetry local disk control`  [INFERRED]
  wsi-viewer/src/main/slides-root.ts → wsi-viewer/README.md
- `wsi custom protocol privileged fetch range` --local_files_served_without_cloud_upload--> `No telemetry local disk control`  [INFERRED]
  wsi-viewer/src/main/wsi-protocol.ts → wsi-viewer/README.md
- `Imagebox3 CDN geotiff jsdelivr remote openslide URL` --structural_parallel_vendored_differs_geotiff_openslide_urls--> `Imagebox3 vendored geotiff npm openslide local assets`  [INFERRED]
  imagebox3.mjs → wsi-viewer/src/wsi/imagebox3.mjs
- `decodeBlock()` --calls--> `set()`  [INFERRED]
  /Users/mw/Documents/GitHub/imagebox3/decoders/decoder_33005.js → /Users/mw/Documents/GitHub/imagebox3/wsi-viewer/src/renderer/lib/imagebox3-tilesource.ts

## Communities

### Community 0 - "WSI desktop shell"
Cohesion: 0.07
Nodes (35): contextIsolation true nodeIntegration false, electron-vite main preload renderer builds, webPreferences sandbox true, GeoTIFFDriver geotiff pyramid, OpenSlideDriver openslide-wasm workers, buildImagebox3OpenSeadragonTileSource dynamic import, Imagebox3TileSource extends OSD TileSource, BrowserWindow with sandbox and preload (+27 more)

### Community 1 - "Decoder modules"
Cohesion: 0.13
Nodes (8): set(), doPostMessage(), exhaustiveCheck(), fileEntriesFromFilesOrFileEntries(), handleMessage(), OpenSlideApi, Queue, randomString()

### Community 2 - "GeoTIFF / pyramid"
Cohesion: 0.2
Nodes (14): createPool(), destroyPool(), GeoTIFFDriver, getAllImagesInPyramid(), getImageCompression(), getImageInfo(), getImagePyramid(), getImageSetsInPyramid() (+6 more)

### Community 3 - "OpenSeadragon UI"
Cohesion: 0.16
Nodes (18): constructor(), ensureFileOrUrl(), fetchFileFromUrl(), getBestLevelForDownsample(), getHandle(), getLevelCount(), getLevelDimensions(), getLevelDownsample() (+10 more)

### Community 4 - "Demo service worker"
Cohesion: 0.11
Nodes (4): Imagebox3, buildImagebox3OpenSeadragonTileSource(), get(), Imagebox3TileSource

### Community 5 - "JSDoc HTML"
Cohesion: 0.29
Nodes (9): getPropertyValue(), B(), C(), D(), E(), L(), M(), u() (+1 more)

### Community 6 - "Imagebox3 core"
Cohesion: 0.33
Nodes (2): OpenSlideDriver, close()

### Community 8 - "Electron protocol"
Cohesion: 0.4
Nodes (1): loadHashParams()

### Community 9 - "Slide scanning"
Cohesion: 0.67
Nodes (2): constructor(), decodeBlock()

### Community 10 - "Thumbnails / tiles"
Cohesion: 0.83
Nodes (3): ensureSlidesDir(), getApplicationRootDir(), getSlidesRootPath()

### Community 26 - "Prettify / docs JS"
Cohesion: 1.0
Nodes (1): registerWsiSchemesEarly before app ready

### Community 27 - "Legacy bundle"
Cohesion: 1.0
Nodes (1): prefixUrl /osd/images/

### Community 28 - "Font assets"
Cohesion: 1.0
Nodes (1): power-of-two pyramid from getInfo dimensions

### Community 29 - "OpenSlide API"
Cohesion: 1.0
Nodes (1): ScannedSlide SlidesInfo types

## Knowledge Gaps
- **17 isolated node(s):** `registerWsiSchemesEarly before app ready`, `ensureSlidesDir mkdir recursive`, `absolute path encoded base64url in URL`, `WSI_EXTS svs tif ndpi mrxs isyntax etc`, `ScannedSlide id base64url path` (+12 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Imagebox3 core`** (7 nodes): `.destroyWorkerPool()`, `OpenSlideDriver`, `.constructor()`, `.destroy()`, `.getTile()`, `.rgbaToBlob()`, `close()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Electron protocol`** (5 nodes): `index.js`, `createOverlay()`, `index.js`, `loadHashParams()`, `setupEventListeners()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Slide scanning`** (4 nodes): `constructor()`, `decodeBlock()`, `decoder_33005.js`, `decoder_33005.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Prettify / docs JS`** (1 nodes): `registerWsiSchemesEarly before app ready`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Legacy bundle`** (1 nodes): `prefixUrl /osd/images/`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Font assets`** (1 nodes): `power-of-two pyramid from getInfo dimensions`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `OpenSlide API`** (1 nodes): `ScannedSlide SlidesInfo types`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Imagebox3` connect `Demo service worker` to `GeoTIFF / pyramid`, `Imagebox3 core`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Why does `OpenSlideDriver` connect `Imagebox3 core` to `GeoTIFF / pyramid`, `OpenSeadragon UI`, `Demo service worker`, `JSDoc HTML`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._
- **What connects `registerWsiSchemesEarly before app ready`, `ensureSlidesDir mkdir recursive`, `absolute path encoded base64url in URL` to the rest of the system?**
  _17 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `WSI desktop shell` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Decoder modules` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._
- **Should `Demo service worker` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._