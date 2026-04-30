// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import OpenSeadragon from 'openseadragon'

const TS = 256
const TILE_WORKERS = 4
const WSI_SOURCE_RE = /\.(svs|tif|tiff|gtiff|ndpi)$/i

function getImageSourceName(imageSource) {
  if (imageSource instanceof File) return imageSource.name
  if (typeof imageSource !== 'string') return ''
  try {
    const u = new URL(imageSource)
    return u.searchParams.get('name') || u.pathname
  } catch {
    return imageSource
  }
}

class OpenSlideWsi {
  constructor(imageSource, numWorkers) {
    if (!(imageSource instanceof File) && typeof imageSource !== 'string') {
      throw new Error('Unsupported OpenSlide source')
    }
    const srcName = getImageSourceName(imageSource)
    if (!WSI_SOURCE_RE.test(srcName)) {
      throw new Error(`Unsupported OpenSlide source: ${srcName}. Use .svs, .tif, .tiff, .gtiff, or .ndpi.`)
    }
    this.source = imageSource
    this.numWorkers = Number.isInteger(numWorkers) ? numWorkers : 1
    this.os = null
    this.slide = null
    this.levelCount = 0
    this.levelDimensions = []
    this.levelDownsamples = []
  }

  async init() {
    const { default: OpenSlide } = await import('@conflux-xyz/openslide-wasm')
    this.os = new OpenSlide({ workers: this.numWorkers || 1 })
    await this.os.initialize()
    this.slide = await this.os.open(this.source)

    this.levelCount = await this.slide.getLevelCount()
    this.levelDimensions = []
    this.levelDownsamples = []
    for (let i = 0; i < this.levelCount; i += 1) {
      this.levelDimensions[i] = await this.slide.getLevelDimensions(i)
      this.levelDownsamples[i] = await this.slide.getLevelDownsample(i)
    }
  }

  getLevels() {
    return this.levelDimensions.map(([width, height], index) => ({
      width,
      height,
      downsample: this.levelDownsamples[index],
      nativeLevel: index,
    }))
  }

  rgbaToCanvas(data, width, height) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')?.putImageData(new ImageData(data, width, height), 0, 0)
    return canvas
  }

  async readRegionCanvas(x, y, level, width, height, signal) {
    const data = await this.slide.readRegion(x, y, level, width, height, { signal })
    return this.rgbaToCanvas(data, width, height)
  }

  destroy() {
    const terminateWorkers = () => {
      this.os?.workers?.forEach((w) => w.worker?.terminate?.())
    }
    const closeRequest = this.slide?.close?.()
    if (closeRequest?.finally) {
      void closeRequest.finally(terminateWorkers)
    } else {
      terminateWorkers()
    }
  }
}

async function readOpenSlideTileToCanvas(slide, level, x, y, signal) {
  const left = x * level.tileWidth
  const top = y * level.tileHeight
  const right = Math.min(left + level.tileWidth, level.width)
  const bottom = Math.min(top + level.tileHeight, level.height)
  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)
  const downsample = level.downsample || level.fullWidth / level.width
  return await slide.readRegionCanvas(
    Math.round(left * downsample),
    Math.round(top * downsample),
    level.nativeLevel,
    width,
    height,
    signal,
  )
}

export class OpenSlideTileSource extends OpenSeadragon.TileSource {
  constructor(
    public slide,
    public wsiUrl,
    public options = { tileSize: TS, cacheSize: 100 },
  ) {
    super({ width: 1, height: 1, tileSize: TS, tileOverlap: 0, maxLevel: 0, minLevel: 0 } as any)
    this._ready = false
    this.fullWidth = 1
    this.fullHeight = 1
  }

  async initFromOpenSlide() {
    const levels = this.slide.getLevels?.() || []
    if (!levels.length) {
      throw new Error('No OpenSlide levels found')
    }
    const fullW = levels[0].width
    const fullH = levels[0].height
    this.width = this.fullWidth = fullW
    this.height = this.fullHeight = fullH
    this.tileSize = this.options.tileSize
    this.tileOverlap = 0
    this.dimensions = new OpenSeadragon.Point(fullW, fullH)
    this.aspectRatio = fullW / fullH
    this.minLevel = 0
    this.levels = levels
      .map((level) => ({
        ...level,
        fullWidth: fullW,
        fullHeight: fullH,
        tileWidth: this.tileSize,
        tileHeight: this.tileSize,
      }))
      .sort((a, b) => a.width - b.width)
    this.maxLevel = this.levels.length - 1
    this._ready = true
    return this
  }

  getTileWidth(level) {
    return this.levels?.[level]?.tileWidth || this.tileSize
  }

  getTileHeight(level) {
    return this.levels?.[level]?.tileHeight || this.tileSize
  }

  getLevelScale(level) {
    if (this.levels?.length > 0 && level >= 0 && level <= this.maxLevel) {
      return this.levels[level].width / this.levels[this.maxLevel].width
    }
    return NaN
  }

  getTileUrl(level, x, y) {
    return `${level}/${x}/${y}`
  }

  downloadTileStart(context) {
    context.userData.aborted = false
    const { src } = context
    const [level, x, y] = String(src)
      .split('/')
      .map((p) => parseInt(p, 10))
    if (!this.levels || level < 0 || level >= this.levels.length) {
      context.finish(null, src, 'level')
      return
    }
    const levelInfo = this.levels[level]
    const tw = Math.ceil(Math.min(levelInfo.tileWidth, levelInfo.width - x * levelInfo.tileWidth))
    const th = Math.ceil(Math.min(levelInfo.tileHeight, levelInfo.height - y * levelInfo.tileHeight))
    if (tw <= 0 || th <= 0) {
      context.finish(null, src, 'empty')
      return
    }
    const abortController = new AbortController()
    context.userData.abortController = abortController
    readOpenSlideTileToCanvas(this.slide, levelInfo, x, y, abortController.signal)
      .then((canvas) => {
        if (!context.userData.aborted) {
          context.finish(canvas)
        }
      })
      .catch((e) => {
        if (!context.userData.aborted) {
          context.finish(null, src, String(e))
        }
      })
  }

  downloadTileAbort(context) {
    context.userData.aborted = true
    context.userData.abortController?.abort()
  }

  createTileCache(cacheObject, data) {
    cacheObject._data = data
    cacheObject._renderedContext = data?.getContext?.('2d') || null
  }

  destroyTileCache(cacheObject) {
    const canvas = cacheObject._renderedContext?.canvas || cacheObject._data
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
    cacheObject._data = null
    cacheObject._renderedContext = null
  }

  getTileCacheData(cacheObject) {
    return cacheObject._data
  }

  getTileCacheDataAsImage(cacheObject) {
    return cacheObject._data
  }

  getTileCacheDataAsContext2D(cacheObject) {
    if (!cacheObject._renderedContext) {
      cacheObject._renderedContext = cacheObject._data?.getContext?.('2d') || null
    }
    return cacheObject._renderedContext
  }
}

Object.defineProperty(OpenSlideTileSource.prototype, 'ready', {
  get() {
    return this._ready
  },
  set() {},
})

export async function buildOpenSlideOpenSeadragonTileSource(wsiUrl: string) {
  const slide = new OpenSlideWsi(wsiUrl, TILE_WORKERS)
  await slide.init()
  const tileSource = new OpenSlideTileSource(slide, wsiUrl)
  await tileSource.initFromOpenSlide()
  return { slide, tileSource: tileSource as any }
}
