/**
 * OpenSeadragon 5 tile source backed by Imagebox3 (wsi:// or https URL) + getTile.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import OpenSeadragon from 'openseadragon'
import { globals } from 'geotiff'

const TS = 256
const TILE_WORKERS = 4

function getPhotometricInterpretation(fileDirectory) {
  return fileDirectory.PhotometricInterpretation ?? fileDirectory.photometricInterpretation
}

function canConvertDecodedTileDirectly(image) {
  if (!image.isTiled || image.planarConfiguration === 2) {
    return false
  }
  const fileDirectory = image.fileDirectory
  const samplesPerPixel = fileDirectory.SamplesPerPixel ?? 1
  switch (getPhotometricInterpretation(fileDirectory)) {
    case globals.photometricInterpretations.WhiteIsZero:
    case globals.photometricInterpretations.BlackIsZero:
    case globals.photometricInterpretations.Palette:
      return samplesPerPixel === 1
    case globals.photometricInterpretations.RGB:
    case globals.photometricInterpretations.YCbCr:
    case globals.photometricInterpretations.CIELab:
      return samplesPerPixel === 3
    case globals.photometricInterpretations.CMYK:
      return samplesPerPixel === 4
    default:
      return false
  }
}

function rgbaFromYCbCr(input) {
  const rgba = new Uint8ClampedArray((input.length * 4) / 3)
  for (let i = 0, j = 0; i < input.length; i += 3, j += 4) {
    const y = input[i]
    const cb = input[i + 1]
    const cr = input[i + 2]
    rgba[j] = y + 1.402 * (cr - 0x80)
    rgba[j + 1] = y - 0.34414 * (cb - 0x80) - 0.71414 * (cr - 0x80)
    rgba[j + 2] = y + 1.772 * (cb - 0x80)
    rgba[j + 3] = 255
  }
  return rgba
}

function rgbaFromRGB(input) {
  const rgba = new Uint8ClampedArray((input.length * 4) / 3)
  const rgba32 = new Uint32Array(rgba.buffer)
  for (let i = 0, j = 0; i < input.length; i += 3, j += 1) {
    rgba32[j] = (255 << 24) | (input[i + 2] << 16) | (input[i + 1] << 8) | input[i]
  }
  return rgba
}

function rgbaFromWhiteIsZero(input, max) {
  const rgba = new Uint8ClampedArray(input.length * 4)
  for (let i = 0, j = 0; i < input.length; i += 1, j += 4) {
    const value = 256 - (input[i] / max) * 256
    rgba[j] = value
    rgba[j + 1] = value
    rgba[j + 2] = value
    rgba[j + 3] = 255
  }
  return rgba
}

function rgbaFromBlackIsZero(input, max) {
  const rgba = new Uint8ClampedArray(input.length * 4)
  for (let i = 0, j = 0; i < input.length; i += 1, j += 4) {
    const value = (input[i] / max) * 256
    rgba[j] = value
    rgba[j + 1] = value
    rgba[j + 2] = value
    rgba[j + 3] = 255
  }
  return rgba
}

function rgbaFromPalette(input, colorMap) {
  const rgba = new Uint8ClampedArray(input.length * 4)
  const greenOffset = colorMap.length / 3
  const blueOffset = (colorMap.length / 3) * 2
  for (let i = 0, j = 0; i < input.length; i += 1, j += 4) {
    const mapIndex = input[i]
    rgba[j] = (colorMap[mapIndex] / 65536) * 256
    rgba[j + 1] = (colorMap[mapIndex + greenOffset] / 65536) * 256
    rgba[j + 2] = (colorMap[mapIndex + blueOffset] / 65536) * 256
    rgba[j + 3] = 255
  }
  return rgba
}

function rgbaFromCMYK(input) {
  const rgba = new Uint8ClampedArray(input.length)
  for (let i = 0, j = 0; i < input.length; i += 4, j += 4) {
    const c = input[i]
    const m = input[i + 1]
    const y = input[i + 2]
    const k = input[i + 3]
    rgba[j] = 255 * ((255 - c) / 256) * ((255 - k) / 256)
    rgba[j + 1] = 255 * ((255 - m) / 256) * ((255 - k) / 256)
    rgba[j + 2] = 255 * ((255 - y) / 256) * ((255 - k) / 256)
    rgba[j + 3] = 255
  }
  return rgba
}

function rgbaFromCIELab(input) {
  const Xn = 0.95047
  const Yn = 1.0
  const Zn = 1.08883
  const rgba = new Uint8ClampedArray((input.length * 4) / 3)

  for (let i = 0, j = 0; i < input.length; i += 3, j += 4) {
    const L = input[i]
    const a = (input[i + 1] << 24) >> 24
    const bValue = (input[i + 2] << 24) >> 24

    let y = (L + 16) / 116
    let x = a / 500 + y
    let z = y - bValue / 200

    x = Xn * (x ** 3 > 0.008856 ? x ** 3 : (x - 16 / 116) / 7.787)
    y = Yn * (y ** 3 > 0.008856 ? y ** 3 : (y - 16 / 116) / 7.787)
    z = Zn * (z ** 3 > 0.008856 ? z ** 3 : (z - 16 / 116) / 7.787)

    let r = x * 3.2406 + y * -1.5372 + z * -0.4986
    let g = x * -0.9689 + y * 1.8758 + z * 0.0415
    let b = x * 0.0557 + y * -0.204 + z * 1.057

    r = r > 0.0031308 ? 1.055 * r ** (1 / 2.4) - 0.055 : 12.92 * r
    g = g > 0.0031308 ? 1.055 * g ** (1 / 2.4) - 0.055 : 12.92 * g
    b = b > 0.0031308 ? 1.055 * b ** (1 / 2.4) - 0.055 : 12.92 * b

    rgba[j] = Math.max(0, Math.min(1, r)) * 255
    rgba[j + 1] = Math.max(0, Math.min(1, g)) * 255
    rgba[j + 2] = Math.max(0, Math.min(1, b)) * 255
    rgba[j + 3] = 255
  }
  return rgba
}

function convertPixelsToCanvas(data, width, height, fileDirectory) {
  data = new Uint8ClampedArray(data)
  const photometricInterpretation = getPhotometricInterpretation(fileDirectory)
  let rgba

  switch (photometricInterpretation) {
    case globals.photometricInterpretations.WhiteIsZero:
      rgba = rgbaFromWhiteIsZero(data, 2 ** fileDirectory.BitsPerSample[0])
      break
    case globals.photometricInterpretations.BlackIsZero:
      rgba = rgbaFromBlackIsZero(data, 2 ** fileDirectory.BitsPerSample[0])
      break
    case globals.photometricInterpretations.RGB:
      rgba = rgbaFromRGB(data)
      break
    case globals.photometricInterpretations.Palette:
      rgba = rgbaFromPalette(data, fileDirectory.ColorMap ?? fileDirectory.colorMap)
      break
    case globals.photometricInterpretations.CMYK:
      rgba = rgbaFromCMYK(data)
      break
    case globals.photometricInterpretations.YCbCr:
      rgba = rgbaFromYCbCr(data)
      break
    case globals.photometricInterpretations.CIELab:
      rgba = rgbaFromCIELab(data)
      break
    default:
      rgba = rgbaFromRGB(data)
      break
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')?.putImageData(new ImageData(rgba, canvas.width, canvas.height), 0, 0)
  return canvas
}

function convertDecodedTileToCanvas(raster, level) {
  return convertPixelsToCanvas(
    raster.data,
    level.tileWidth,
    level.image.getBlockHeight?.(raster.y) || level.tileHeight,
    level.image.fileDirectory,
  )
}

async function readRasterTileToCanvas(level, x, y, pool, signal) {
  const left = x * level.tileWidth
  const top = y * level.tileHeight
  const right = Math.min(left + level.tileWidth, level.width)
  const bottom = Math.min(top + level.tileHeight, level.height)
  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)
  const options = {
    window: [left, top, right, bottom],
    width,
    height,
    interleave: true,
    signal,
  }
  if (pool) {
    options.pool = pool
  }
  const data = await level.image.readRasters(options)
  return convertPixelsToCanvas(data, width, height, level.image.fileDirectory)
}

async function readOpenSlideTileToCanvas(imagebox, level, x, y, signal) {
  const left = x * level.tileWidth
  const top = y * level.tileHeight
  const right = Math.min(left + level.tileWidth, level.width)
  const bottom = Math.min(top + level.tileHeight, level.height)
  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)
  const downsample = level.downsample || level.fullWidth / level.width
  return await imagebox.readOpenSlideRegionCanvas(
    Math.round(left * downsample),
    Math.round(top * downsample),
    level.nativeLevel,
    width,
    height,
    signal,
  )
}

export class Imagebox3TileSource extends OpenSeadragon.TileSource {
  constructor(
    public imagebox,
    public wsiUrl,
    public options = { tileSize: TS, cacheSize: 100 }
  ) {
    super({ width: 1, height: 1, tileSize: TS, tileOverlap: 0, maxLevel: 0, minLevel: 0 } as any)
    this._ready = false
    this.fullWidth = 1
    this.fullHeight = 1
  }

  /**
   * Build OSD levels from native TIFF pyramid levels. This follows upstream
   * WSITileSource: OSD requests native TIFF tile x/y instead of resampled windows.
   */
  async initFromImagebox3() {
    const ib = this.imagebox
    if (ib.isOpenSlide?.()) {
      const levels = ib.getOpenSlideLevels?.() || []
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
          openSlide: true,
        }))
        .sort((a, b) => a.width - b.width)
      this.maxLevel = this.levels.length - 1
      this._ready = true
      return this
    }

    const pyramid = ib.getPyramid?.()
    const slideImages = [...(pyramid?.slideImages || [])].sort((a, b) => b.getWidth() - a.getWidth())
    const tiledImages = slideImages.filter((image) => image.fileDirectory?.TileWidth && image.fileDirectory?.TileLength)
    const images = (tiledImages.length >= 2 ? tiledImages : slideImages).filter(
      (image, index, list) => index === 0 || image.getWidth() < list[index - 1].getWidth(),
    )
    if (!images.length) {
      throw new Error('No slide pyramid levels found')
    }

    const fullW = images[0].getWidth()
    const fullH = images[0].getHeight()
    this.width = this.fullWidth = fullW
    this.height = this.fullHeight = fullH
    this.tileSize = this.options.tileSize
    this.tileOverlap = 0
    this.dimensions = new OpenSeadragon.Point(fullW, fullH)
    this.aspectRatio = fullW / fullH
    this.minLevel = 0
    this.levels = images.map((image) => ({
      width: image.getWidth(),
      height: image.getHeight(),
      tileWidth: image.getTileWidth?.() || this.tileSize,
      tileHeight: image.getTileHeight?.() || this.tileSize,
      directNative: canConvertDecodedTileDirectly(image),
      image,
    }))
    this.levels.sort((a, b) => a.width - b.width)
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
    const tilePromise = levelInfo.openSlide
      ? readOpenSlideTileToCanvas(this.imagebox, levelInfo, x, y, abortController.signal)
      : levelInfo.directNative
      ? levelInfo.image.getTileOrStrip(x, y, null, this.imagebox.workerPool, abortController.signal).then((raster) => {
          if (!raster) {
            return null
          }
          return convertDecodedTileToCanvas(raster, levelInfo)
        })
      : readRasterTileToCanvas(levelInfo, x, y, this.imagebox.workerPool, abortController.signal)

    tilePromise
      .then((canvas) => {
        if (context.userData.aborted) {
          return
        }
        if (!canvas) {
          context.finish(null, src, 'tile')
          return
        }
        context.finish(canvas)
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

Object.defineProperty(Imagebox3TileSource.prototype, 'ready', {
  get() {
    return this._ready
  },
  set() {},
})

export async function buildImagebox3OpenSeadragonTileSource(wsiUrl: string) {
  const { default: Imagebox3 } = await import('../../wsi/imagebox3.mjs')
  const ib = new Imagebox3(wsiUrl, TILE_WORKERS)
  await ib.init()
  if (!ib.isOpenSlide?.()) {
    await ib.createWorkerPool(TILE_WORKERS)
  }
  const ts = new Imagebox3TileSource(ib, wsiUrl)
  await ts.initFromImagebox3()
  return { imagebox3: ib, tileSource: ts as any }
}
