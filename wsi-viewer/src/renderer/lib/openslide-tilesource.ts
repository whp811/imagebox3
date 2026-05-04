// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import OpenSeadragon from 'openseadragon'

const IS_ELECTROBUN = import.meta.env.VITE_ELECTROBUN === '1'
const TS = 256
const TILE_WORKERS = IS_ELECTROBUN ? 1 : 4
const TILE_CACHE_SIZE = IS_ELECTROBUN ? 24 : 100
const TILE_READ_TIMEOUT_MS = IS_ELECTROBUN ? 45_000 : 0
const TILE_READ_CONCURRENCY = IS_ELECTROBUN ? 1 : TILE_WORKERS
const TILE_READ_QUEUE_MAX = IS_ELECTROBUN ? 8 : 64
const WSI_SOURCE_RE = /\.(svs|tif|tiff|gtiff|ndpi)$/i
const SHARED_CONTEXT_IDLE_MS = 15_000
let sharedOpenSlidePromise = null
let sharedOpenSlideContext = null
let sharedOpenSlideReleaseId = null
let sharedOpenSlideUsers = 0

async function createOpenSlideContext(numWorkers) {
  const { default: OpenSlide } = await import('@conflux-xyz/openslide-wasm')
  const os = new OpenSlide({ workers: numWorkers || 1 })
  await os.initialize()
  return os
}

async function getOpenSlideContext(numWorkers) {
  if (!IS_ELECTROBUN) {
    return createOpenSlideContext(numWorkers)
  }
  if (sharedOpenSlideReleaseId) {
    window.clearTimeout(sharedOpenSlideReleaseId)
    sharedOpenSlideReleaseId = null
  }
  if (!sharedOpenSlidePromise) {
    sharedOpenSlidePromise = createOpenSlideContext(numWorkers)
      .then((os) => {
        sharedOpenSlideContext = os
        return os
      })
      .catch((error) => {
        sharedOpenSlidePromise = null
        sharedOpenSlideContext = null
        throw error
      })
  }
  return sharedOpenSlidePromise
}

function invalidateSharedOpenSlideContext(os) {
  if (sharedOpenSlideReleaseId) {
    window.clearTimeout(sharedOpenSlideReleaseId)
    sharedOpenSlideReleaseId = null
  }
  if (sharedOpenSlideContext === os) {
    sharedOpenSlidePromise = null
    sharedOpenSlideContext = null
  }
  if (sharedOpenSlideUsers <= 0) {
    os?.workers?.forEach((w) => w.worker?.terminate?.())
  }
}

function releaseSharedOpenSlideContext(os) {
  if (sharedOpenSlideContext !== os || sharedOpenSlideUsers > 0) {
    return
  }
  if (sharedOpenSlideReleaseId) {
    window.clearTimeout(sharedOpenSlideReleaseId)
  }
  sharedOpenSlideReleaseId = window.setTimeout(() => {
    if (sharedOpenSlideContext === os && sharedOpenSlideUsers <= 0) {
      sharedOpenSlidePromise = null
      sharedOpenSlideContext = null
      os?.workers?.forEach((w) => w.worker?.terminate?.())
    }
    sharedOpenSlideReleaseId = null
  }, SHARED_CONTEXT_IDLE_MS)
}

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
    this.usesSharedContext = false
    this.destroyed = false
    this.levelCount = 0
    this.levelDimensions = []
    this.levelDownsamples = []
  }

  async init() {
    this.os = await getOpenSlideContext(this.numWorkers)
    if (this.destroyed) {
      throw new Error('Slide open aborted')
    }
    this.slide = await this.os.open(this.source)
    if (IS_ELECTROBUN) {
      this.usesSharedContext = true
      sharedOpenSlideUsers += 1
    }
    if (this.destroyed) {
      const closeRequest = this.slide.close?.()
      let closeFailed = false
      if (closeRequest?.catch) {
        await closeRequest.catch(() => {
          closeFailed = true
        })
      }
      if (this.usesSharedContext) {
        sharedOpenSlideUsers = Math.max(0, sharedOpenSlideUsers - 1)
        this.usesSharedContext = false
      }
      if (closeFailed) {
        invalidateSharedOpenSlideContext(this.os)
      }
      throw new Error('Slide open aborted')
    }

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
    canvas.getContext('2d', { alpha: false })?.putImageData(new ImageData(data, width, height), 0, 0)
    return canvas
  }

  async readRegionCanvas(x, y, level, width, height, signal) {
    if (this.destroyed || signal?.aborted) {
      throw new Error('Slide read aborted')
    }
    const data = await this.slide.readRegion(x, y, level, width, height, { signal })
    if (this.destroyed || signal?.aborted) {
      throw new Error('Slide read aborted')
    }
    return this.rgbaToCanvas(data, width, height)
  }

  destroy() {
    if (this.destroyed) {
      return Promise.resolve()
    }
    this.destroyed = true
    const slide = this.slide
    const os = this.os
    const usesSharedContext = this.usesSharedContext
    this.usesSharedContext = false
    this.slide = null
    const closeRequest = slide?.close?.()
    let workersTerminated = false
    let releasedSharedContext = false
    const releaseSharedContext = () => {
      if (!usesSharedContext || releasedSharedContext) {
        return
      }
      releasedSharedContext = true
      sharedOpenSlideUsers = Math.max(0, sharedOpenSlideUsers - 1)
      releaseSharedOpenSlideContext(os)
    }
    const terminateWorkers = () => {
      if (workersTerminated) {
        return
      }
      workersTerminated = true
      os?.workers?.forEach((w) => w.worker?.terminate?.())
    }
    if (closeRequest?.finally) {
      if (IS_ELECTROBUN) {
        return closeRequest
          .catch(() => {
            releaseSharedContext()
            invalidateSharedOpenSlideContext(os)
          })
          .finally(() => {
            releaseSharedContext()
          })
      }
      const fallback = window.setTimeout(terminateWorkers, 1500)
      return closeRequest
        .catch(() => undefined)
        .finally(() => {
          window.clearTimeout(fallback)
          terminateWorkers()
        })
    }
    if (!IS_ELECTROBUN) {
      terminateWorkers()
    }
    if (usesSharedContext) {
      releaseSharedContext()
    }
    return Promise.resolve()
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
    public options = { tileSize: TS, cacheSize: TILE_CACHE_SIZE },
  ) {
    super({ width: 1, height: 1, tileSize: TS, tileOverlap: 0, maxLevel: 0, minLevel: 0 } as any)
    this._ready = false
    this._destroyed = false
    this.activeDownloads = new Set()
    this.pendingTileJobs = []
    this.activeTileReads = 0
    this.tileReadsStopped = false
    this.tileReadsStopReason = null
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

  finishTileJob(tileJob, ...args) {
    const { context } = tileJob
    if (context.userData.finished) {
      return false
    }
    context.userData.finished = true
    if (tileJob.timeoutId) {
      window.clearTimeout(tileJob.timeoutId)
      tileJob.timeoutId = undefined
    }
    tileJob.finish(...args)
    return true
  }

  removePendingTileJob(tileJob) {
    const index = this.pendingTileJobs.indexOf(tileJob)
    if (index >= 0) {
      this.pendingTileJobs.splice(index, 1)
      return true
    }
    return false
  }

  stopTileReads(reason) {
    if (this.tileReadsStopped) {
      return
    }
    this.tileReadsStopped = true
    this.tileReadsStopReason = reason
    const pendingJobs = this.pendingTileJobs.splice(0)
    for (const pendingJob of pendingJobs) {
      pendingJob.context.userData.aborted = true
      pendingJob.abortController.abort()
      this.finishTileJob(pendingJob, null, pendingJob.context.src, reason)
      this.activeDownloads.delete(pendingJob)
    }
  }

  enqueueTileJob(tileJob) {
    if (this._destroyed || this.tileReadsStopped) {
      this.finishTileJob(tileJob, null, tileJob.context.src, this.tileReadsStopReason || 'destroyed')
      this.activeDownloads.delete(tileJob)
      return
    }
    if (this.pendingTileJobs.length >= TILE_READ_QUEUE_MAX) {
      tileJob.context.userData.aborted = true
      tileJob.abortController.abort()
      this.finishTileJob(tileJob, null, tileJob.context.src, 'Tile read queue is full')
      this.activeDownloads.delete(tileJob)
      return
    }
    this.pendingTileJobs.push(tileJob)
    this.pumpTileQueue()
  }

  pumpTileQueue() {
    if (this._destroyed || this.tileReadsStopped) {
      return
    }
    while (this.activeTileReads < TILE_READ_CONCURRENCY && this.pendingTileJobs.length > 0) {
      const tileJob = this.pendingTileJobs.shift()
      if (!tileJob || tileJob.context.userData.aborted || tileJob.context.userData.finished) {
        if (tileJob) {
          this.activeDownloads.delete(tileJob)
        }
        continue
      }
      this.startTileJob(tileJob)
    }
  }

  startTileJob(tileJob) {
    const { abortController, context, levelInfo, x, y } = tileJob
    const { src } = context
    tileJob.started = true
    this.activeTileReads += 1
    if (TILE_READ_TIMEOUT_MS > 0) {
      tileJob.timeoutId = window.setTimeout(() => {
        context.userData.aborted = true
        abortController.abort()
        this.stopTileReads(`Timed out after ${TILE_READ_TIMEOUT_MS}ms`)
        this.finishTileJob(tileJob, null, src, this.tileReadsStopReason)
      }, TILE_READ_TIMEOUT_MS)
    }
    readOpenSlideTileToCanvas(this.slide, levelInfo, x, y, abortController.signal)
      .then((canvas) => {
        if (!this._destroyed && !context.userData.aborted) {
          this.finishTileJob(tileJob, canvas)
          return
        }
        if (canvas) {
          canvas.width = 0
          canvas.height = 0
        }
      })
      .catch((e) => {
        if (!this._destroyed && !context.userData.aborted) {
          this.finishTileJob(tileJob, null, src, String(e))
        }
      })
      .finally(() => {
        if (tileJob.timeoutId) {
          window.clearTimeout(tileJob.timeoutId)
          tileJob.timeoutId = undefined
        }
        this.activeTileReads = Math.max(0, this.activeTileReads - 1)
        this.activeDownloads.delete(tileJob)
        this.pumpTileQueue()
      })
  }

  downloadTileStart(context) {
    if (this._destroyed || this.tileReadsStopped) {
      context.finish(null, context.src, this.tileReadsStopReason || 'destroyed')
      return
    }
    const originalFinish = context.finish.bind(context)
    context.userData.aborted = false
    context.userData.finished = false
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
    const tileJob = {
      abortController,
      context,
      finish: originalFinish,
      levelInfo,
      started: false,
      timeoutId: undefined,
      x,
      y,
    }
    context.userData.tileJob = tileJob
    this.activeDownloads.add(tileJob)
    this.enqueueTileJob(tileJob)
  }

  downloadTileAbort(context) {
    context.userData.aborted = true
    const tileJob = context.userData.tileJob
    if (tileJob?.timeoutId) {
      window.clearTimeout(tileJob.timeoutId)
    }
    tileJob?.abortController?.abort()
    if (tileJob && !tileJob.started) {
      this.removePendingTileJob(tileJob)
      this.activeDownloads.delete(tileJob)
    }
  }

  destroy() {
    this._destroyed = true
    this.stopTileReads('destroyed')
    for (const tileJob of this.activeDownloads) {
      if (tileJob.timeoutId) {
        window.clearTimeout(tileJob.timeoutId)
        tileJob.timeoutId = undefined
      }
      tileJob.abortController.abort()
      this.finishTileJob(tileJob, null, tileJob.context.src, 'destroyed')
    }
    this.activeDownloads.clear()
    this.levels = []
  }

  createTileCache(cacheObject, data) {
    cacheObject._data = data
    cacheObject._renderedContext = null
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
      cacheObject._renderedContext = cacheObject._data?.getContext?.('2d', { alpha: false }) || null
    }
    return cacheObject._renderedContext
  }

  hasTransparency() {
    return false
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
