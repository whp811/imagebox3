/**
 * OpenSeadragon 5 tile source backed by Imagebox3 (wsi:// or https URL) + getTile.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import OpenSeadragon from 'openseadragon'

const TS = 256

export class Imagebox3TileSource extends OpenSeadragon.TileSource {
  constructor(
    public imagebox,
    public wsiUrl,
    public options = { tileSize: TS, cacheSize: 100 }
  ) {
    super({ width: 1, height: 1, tileSize: TS, tileOverlap: 0, maxLevel: 0, minLevel: 0 } as any)
    this._ready = false
    this._tileCache = new Map()
    this._maxCache = options.cacheSize
    this.fullWidth = 1
    this.fullHeight = 1
  }

  /**
   * Build power-of-two pyramid in image space. OSD level 0 = lowest res (smallest w/h), max = full slide.
   */
  async initFromImagebox3() {
    const ib = this.imagebox
    const { width: fullW, height: fullH } = await ib.getInfo()
    this.width = this.fullWidth = fullW
    this.height = this.fullHeight = fullH
    this.tileSize = this.options.tileSize
    this.tileOverlap = 0
    this.dimensions = new OpenSeadragon.Point(fullW, fullH)
    this.aspectRatio = fullW / fullH
    this.minLevel = 0
    this.levels = []
    for (let L = 0; L < 32; L++) {
      const w = fullW / 2 ** L
      const h = fullH / 2 ** L
      if (w < 16 && h < 16) {
        break
      }
      const down = fullW / w
      this.levels.push({
        width: w,
        height: h,
        downsample: down,
        tileWidth: this.tileSize,
        tileHeight: this.tileSize,
      })
    }
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
    const { src } = context
    const [level, x, y] = String(src)
      .split('/')
      .map((p) => parseInt(p, 10))
    if (!this.levels || level < 0 || level >= this.levels.length) {
      context.finish(null, src, 'level')
      return
    }
    const levelInfo = this.levels[level]
    const down = this.fullWidth / levelInfo.width
    const x0 = x * this.tileSize
    const y0 = y * this.tileSize
    const tw = Math.min(this.tileSize, levelInfo.width - x0)
    const th = Math.min(this.tileSize, levelInfo.height - y0)
    if (tw <= 0 || th <= 0) {
      context.finish(null, src, 'empty')
      return
    }
    const l0X = Math.floor(x0 * down)
    const l0Y = Math.floor(y0 * down)
    const l0W = Math.max(1, Math.ceil(tw * down))
    const l0H = Math.max(1, Math.ceil(th * down))
    const k = `${level}|${x}|${y}`
    const c = this._tileCache.get(k)
    if (c) {
      context.finish(c.cloneNode())
      return
    }
    this.imagebox
      .getTile(l0X, l0Y, l0W, l0H, this.tileSize)
      .then((blob) => {
        if (!blob) {
          context.finish(null, src, 'blob')
          return
        }
        const u = URL.createObjectURL(blob)
        const im = new Image()
        im.onload = () => {
          URL.revokeObjectURL(u)
          if (this._tileCache.size >= this._maxCache) {
            this._tileCache.delete(this._tileCache.keys().next().value)
          }
          this._tileCache.set(k, im)
          context.finish(im)
        }
        im.onerror = () => {
          URL.revokeObjectURL(u)
          context.finish(null, src, 'err')
        }
        im.src = u
      })
      .catch((e) => context.finish(null, src, String(e)))
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
  const ib = new Imagebox3(wsiUrl, 0)
  await ib.init()
  const ts = new Imagebox3TileSource(ib, wsiUrl)
  await ts.initFromImagebox3()
  return { imagebox3: ib, tileSource: ts as any }
}
