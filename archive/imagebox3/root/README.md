# ImageBox3
A JavaScript library for zero-footprint, in-browser patch extraction from TIFF-based Whole Slide Imaging (WSI) data. No (server-side) tiling service needed.
All computation is performed on your device using HTTP Range Requests to retrieve remote patches without downloading the entire image. This ensures complete user governance while operating public and private images alike at zero cost.

**Desktop app:** this repository includes **WSI Hive** under [`wsi-viewer/`](wsi-viewer/) — an Electron + React viewer that bundles Imagebox3 for local, portable slide viewing. See [`wsi-viewer/README.md`](wsi-viewer/README.md).

## Example Usage
Here is how you would retrieve a patch/tile at a specific location in a whole slide image using Imagebox3:

```js
import { Imagebox3 } from "./imagebox3.mjs"

// Create an instance with the URL to the image (or a File object for a local image).
const wholeSlide = new Imagebox3("https://storage.googleapis.com/imagebox_test/openslide-testdata/Aperio/CMU-1.svs")
// Initialize the instance, i.e., retrieve relevant metadata from the file headers.
await wholeSlide.init()

// Get basic image info, such as the width, height and pixelsPerMicron.
const { width: imageWidth, height: imageHeight, pixelsPerMicron } = await wholeSlide.getInfo()

// Fetch patch by passing in parameters corresponding to the coordinates of the top left corner of the patch and its width
// and height in image pixel coordinates, along with the resolution at which it should be returned.
let patchWidth = 512
let patchHeight = 512
let patchTopLeftX = Math.round( (imageWidth - patchWidth) / 2) 
let patchTopLeftY = Math.round( (imageHeight - patchHeight) / 2)
let patchResolution = 512

const patchBlob = await wholeSlide.getTile(patchTopLeftX, patchTopLeftY, patchWidth, patchHeight, patchResolution)

// Render the retrieved PNG blob as an image on a webpage.
const patchObjectURL = URL.createObjectURL(patchBlob)

const img = new Image()
img.src = patchObjectURL
img.onload = () => {
    URL.revokeObjectURL(img.src)
}
```

Use a bundler (Vite, webpack, etc.) and configure `geotiff` and any OpenSlide/WASM assets as required for your target; the **wsi-viewer** app is the supported reference integration.

## API documentation
Run `jsdoc` against this repo to regenerate HTML under `docs/`, or open the existing `docs/index.html` for the class reference.
