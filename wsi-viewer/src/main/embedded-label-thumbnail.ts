import { open } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import {
  ZIP_STORED,
  getZipEntryInfo,
  materializeZipEntrySourceForViewing,
  parseZipEntrySource,
  readStoredZipEntryRange,
} from './zip-source'

const TAG_IMAGE_WIDTH = 256
const TAG_IMAGE_LENGTH = 257
const TAG_BITS_PER_SAMPLE = 258
const TAG_COMPRESSION = 259
const TAG_PHOTOMETRIC = 262
const TAG_IMAGE_DESCRIPTION = 270
const TAG_STRIP_OFFSETS = 273
const TAG_SAMPLES_PER_PIXEL = 277
const TAG_ROWS_PER_STRIP = 278
const TAG_STRIP_BYTE_COUNTS = 279
const TAG_PLANAR_CONFIGURATION = 284
const TAG_PREDICTOR = 317

const TYPE_ASCII = 2
const TYPE_SHORT = 3
const TYPE_LONG = 4
const TYPE_LONG8 = 16

const COMPRESSION_NONE = 1
const COMPRESSION_LZW = 5
const COMPRESSION_JPEG_OLD = 6
const COMPRESSION_JPEG = 7

const PHOTOMETRIC_WHITE_IS_ZERO = 0

const MAX_IFDS = 32
const MAX_IFD_ENTRIES = 512
const MAX_TAG_BYTES = 64 * 1024
const MAX_EMBEDDED_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_EMBEDDED_LABEL_PIXELS = 4_000_000

type Endian = 'little' | 'big'

type TiffReader = {
  read(position: number, length: number): Promise<Buffer>
  close?(): Promise<void>
}

type TiffHeader = {
  endian: Endian
  bigTiff: boolean
  firstIfdOffset: number
}

type TiffIfd = {
  index: number
  width?: number
  height?: number
  bitsPerSample: number[]
  compression?: number
  photometric?: number
  description?: string
  stripOffsets: number[]
  samplesPerPixel: number
  rowsPerStrip?: number
  stripByteCounts: number[]
  planarConfiguration?: number
  predictor?: number
}

class FileReader implements TiffReader {
  constructor(private handle: FileHandle) {}

  static async open(path: string) {
    return new FileReader(await open(path, 'r'))
  }

  async read(position: number, length: number) {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await this.handle.read(buffer, 0, length, position)
    return bytesRead === length ? buffer : buffer.subarray(0, bytesRead)
  }

  async close() {
    await this.handle.close()
  }
}

class StoredZipReader implements TiffReader {
  constructor(private zipPath: string, private entryName: string) {}

  async read(position: number, length: number) {
    if (length <= 0) {
      return Buffer.alloc(0)
    }
    return readStoredZipEntryRange(this.zipPath, this.entryName, position, position + length - 1)
  }
}

function typeSize(type: number) {
  switch (type) {
    case 1:
    case TYPE_ASCII:
    case 6:
    case 7:
      return 1
    case TYPE_SHORT:
    case 8:
      return 2
    case TYPE_LONG:
    case 9:
    case 11:
      return 4
    case 5:
    case 10:
    case 12:
    case TYPE_LONG8:
    case 17:
    case 18:
      return 8
    default:
      return 1
  }
}

function readUInt16(buffer: Buffer, offset: number, endian: Endian) {
  return endian === 'little' ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset)
}

function readUInt32(buffer: Buffer, offset: number, endian: Endian) {
  return endian === 'little' ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset)
}

function readUInt64(buffer: Buffer, offset: number, endian: Endian) {
  const value = endian === 'little' ? buffer.readBigUInt64LE(offset) : buffer.readBigUInt64BE(offset)
  return Number(value)
}

function readOffset(buffer: Buffer, offset: number, endian: Endian, bigTiff: boolean) {
  return bigTiff ? readUInt64(buffer, offset, endian) : readUInt32(buffer, offset, endian)
}

function numberArrayFromTag(type: number, data: Buffer, endian: Endian) {
  const size = typeSize(type)
  const count = Math.floor(data.length / size)
  const out: number[] = []
  for (let i = 0; i < count; i += 1) {
    const offset = i * size
    if (type === TYPE_SHORT) {
      out.push(readUInt16(data, offset, endian))
    } else if (type === TYPE_LONG) {
      out.push(readUInt32(data, offset, endian))
    } else if (type === TYPE_LONG8) {
      out.push(readUInt64(data, offset, endian))
    }
  }
  return out
}

async function readTagData(
  reader: TiffReader,
  entry: Buffer,
  type: number,
  count: number,
  endian: Endian,
  bigTiff: boolean,
  maxBytes = MAX_TAG_BYTES,
) {
  const inlineBytes = bigTiff ? 8 : 4
  const valueOffset = bigTiff ? 12 : 8
  const byteLength = Math.min(typeSize(type) * count, maxBytes)
  if (byteLength <= inlineBytes) {
    return entry.subarray(valueOffset, valueOffset + byteLength)
  }
  const dataOffset = readOffset(entry, valueOffset, endian, bigTiff)
  return reader.read(dataOffset, byteLength)
}

async function readHeader(reader: TiffReader): Promise<TiffHeader | undefined> {
  const header = await reader.read(0, 16)
  if (header.length < 8) {
    return undefined
  }
  const byteOrder = header.toString('ascii', 0, 2)
  const endian: Endian | undefined = byteOrder === 'II' ? 'little' : byteOrder === 'MM' ? 'big' : undefined
  if (!endian) {
    return undefined
  }
  const magic = readUInt16(header, 2, endian)
  if (magic === 42) {
    return { endian, bigTiff: false, firstIfdOffset: readUInt32(header, 4, endian) }
  }
  if (magic === 43 && header.length >= 16) {
    return { endian, bigTiff: true, firstIfdOffset: readUInt64(header, 8, endian) }
  }
  return undefined
}

async function readIfds(reader: TiffReader) {
  const header = await readHeader(reader)
  if (!header) {
    return []
  }

  const ifds: TiffIfd[] = []
  const { endian, bigTiff } = header
  let ifdOffset = header.firstIfdOffset
  for (let index = 0; ifdOffset > 0 && index < MAX_IFDS; index += 1) {
    const countBytes = bigTiff ? 8 : 2
    const countBuffer = await reader.read(ifdOffset, countBytes)
    if (countBuffer.length < countBytes) {
      break
    }
    const entryCount = bigTiff ? readUInt64(countBuffer, 0, endian) : readUInt16(countBuffer, 0, endian)
    if (entryCount <= 0 || entryCount > MAX_IFD_ENTRIES) {
      break
    }

    const entrySize = bigTiff ? 20 : 12
    const nextOffsetBytes = bigTiff ? 8 : 4
    const directory = await reader.read(ifdOffset + countBytes, entryCount * entrySize + nextOffsetBytes)
    if (directory.length < entryCount * entrySize + nextOffsetBytes) {
      break
    }

    const ifd: TiffIfd = {
      index,
      bitsPerSample: [],
      stripOffsets: [],
      samplesPerPixel: 1,
      stripByteCounts: [],
    }

    for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
      const entry = directory.subarray(entryIndex * entrySize, (entryIndex + 1) * entrySize)
      const tag = readUInt16(entry, 0, endian)
      if (![
        TAG_IMAGE_WIDTH,
        TAG_IMAGE_LENGTH,
        TAG_BITS_PER_SAMPLE,
        TAG_COMPRESSION,
        TAG_PHOTOMETRIC,
        TAG_IMAGE_DESCRIPTION,
        TAG_STRIP_OFFSETS,
        TAG_SAMPLES_PER_PIXEL,
        TAG_ROWS_PER_STRIP,
        TAG_STRIP_BYTE_COUNTS,
        TAG_PLANAR_CONFIGURATION,
        TAG_PREDICTOR,
      ].includes(tag)) {
        continue
      }

      const type = readUInt16(entry, 2, endian)
      const count = bigTiff ? readUInt64(entry, 4, endian) : readUInt32(entry, 4, endian)
      const data = await readTagData(reader, entry, type, count, endian, bigTiff)

      if (tag === TAG_IMAGE_DESCRIPTION && type === TYPE_ASCII) {
        ifd.description = data.toString('utf8').replace(/\0.*$/g, '').trim()
        continue
      }

      const values = numberArrayFromTag(type, data, endian)
      const first = values[0]
      if (typeof first !== 'number') {
        continue
      }

      switch (tag) {
        case TAG_IMAGE_WIDTH:
          ifd.width = first
          break
        case TAG_IMAGE_LENGTH:
          ifd.height = first
          break
        case TAG_BITS_PER_SAMPLE:
          ifd.bitsPerSample = values
          break
        case TAG_COMPRESSION:
          ifd.compression = first
          break
        case TAG_PHOTOMETRIC:
          ifd.photometric = first
          break
        case TAG_STRIP_OFFSETS:
          ifd.stripOffsets = values
          break
        case TAG_SAMPLES_PER_PIXEL:
          ifd.samplesPerPixel = first
          break
        case TAG_ROWS_PER_STRIP:
          ifd.rowsPerStrip = first
          break
        case TAG_STRIP_BYTE_COUNTS:
          ifd.stripByteCounts = values
          break
        case TAG_PLANAR_CONFIGURATION:
          ifd.planarConfiguration = first
          break
        case TAG_PREDICTOR:
          ifd.predictor = first
          break
      }
    }

    ifds.push(ifd)
    ifdOffset = readOffset(directory, entryCount * entrySize, endian, bigTiff)
  }
  return ifds
}

function isSupportedCandidate(ifd: TiffIfd) {
  if (!ifd.width || !ifd.height || !ifd.compression) {
    return false
  }
  if (!ifd.stripOffsets.length || ifd.stripOffsets.length !== ifd.stripByteCounts.length) {
    return false
  }
  if (ifd.planarConfiguration && ifd.planarConfiguration !== 1) {
    return false
  }
  if (![1, 3, 4].includes(ifd.samplesPerPixel)) {
    return false
  }
  const bits = ifd.bitsPerSample.length ? ifd.bitsPerSample : [8]
  if (bits.some((bit) => bit !== 8)) {
    return false
  }
  if (![COMPRESSION_NONE, COMPRESSION_LZW, COMPRESSION_JPEG_OLD, COMPRESSION_JPEG].includes(ifd.compression)) {
    return false
  }
  if ([COMPRESSION_JPEG_OLD, COMPRESSION_JPEG].includes(ifd.compression) && ifd.stripOffsets.length !== 1) {
    return false
  }
  return ifd.width * ifd.height <= MAX_EMBEDDED_LABEL_PIXELS
}

function scoreCandidate(ifd: TiffIfd, base?: TiffIfd) {
  if (!isSupportedCandidate(ifd)) {
    return -1
  }

  const description = (ifd.description || '').toLowerCase()
  let score = 0
  if (/\b(label|barcode)\b/.test(description)) {
    score += 10_000
  } else if (/\bmacro\b/.test(description)) {
    score += 5_000
  } else {
    if (ifd.index === 0 || !ifd.width || !ifd.height) {
      return -1
    }
    const ratio = ifd.width / ifd.height
    const baseRatio = base?.width && base.height ? base.width / base.height : 0
    const ratioDiff = baseRatio > 0 ? Math.abs(Math.log(ratio / baseRatio)) : 1
    const elongated = ratio >= 2 || ratio <= 0.5
    if (!elongated && ratioDiff < 0.2) {
      return -1
    }
    score += 1_000
    if (elongated) {
      score += 500
    }
    score += Math.min((ifd.width * ifd.height) / 1000, 2000)
  }

  if ([COMPRESSION_JPEG_OLD, COMPRESSION_JPEG].includes(ifd.compression || 0)) {
    score += 200
  } else {
    score += 100
  }
  return score
}

function selectLabelIfd(ifds: TiffIfd[]) {
  const base = ifds[0]
  return ifds
    .map((ifd) => ({ ifd, score: scoreCandidate(ifd, base) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score)[0]?.ifd
}

function tiffLzwDecode(input: Buffer, maxOutputBytes: number) {
  const clearCode = 256
  const endCode = 257
  let bitOffset = 0
  let codeSize = 9
  let nextCode = 258
  let dictionary: number[][] = []

  function reset() {
    dictionary = Array.from({ length: 258 }, (_, index) => (index < 256 ? [index] : []))
    codeSize = 9
    nextCode = 258
  }

  function readCode() {
    let code = 0
    for (let bit = 0; bit < codeSize; bit += 1) {
      const byte = input[bitOffset >> 3]
      code = (code << 1) | ((byte >> (7 - (bitOffset & 7))) & 1)
      bitOffset += 1
    }
    return code
  }

  reset()
  let previous: number[] | null = null
  const chunks: number[][] = []
  let total = 0
  while (bitOffset + codeSize <= input.length * 8) {
    const code = readCode()
    if (code === clearCode) {
      reset()
      previous = null
      continue
    }
    if (code === endCode) {
      break
    }

    let entry = dictionary[code]
    if (!entry?.length && previous && code === nextCode) {
      entry = previous.concat(previous[0])
    }
    if (!entry?.length) {
      throw new Error('Invalid TIFF LZW data')
    }

    chunks.push(entry)
    total += entry.length
    if (total > maxOutputBytes) {
      throw new Error('Embedded label image is larger than allowed')
    }

    if (previous && nextCode < 4096) {
      dictionary[nextCode] = previous.concat(entry[0])
      nextCode += 1
      if (nextCode === (1 << codeSize) - 1 && codeSize < 12) {
        codeSize += 1
      }
    }
    previous = entry
  }

  const out = Buffer.alloc(total)
  let offset = 0
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.length; index += 1) {
      out[offset] = chunk[index]
      offset += 1
    }
  }
  return out
}

async function readRasterData(reader: TiffReader, ifd: TiffIfd) {
  const width = ifd.width || 0
  const height = ifd.height || 0
  const samples = ifd.samplesPerPixel || 1
  const rowBytes = width * samples
  const expectedBytes = rowBytes * height
  if (expectedBytes <= 0 || expectedBytes > MAX_EMBEDDED_LABEL_PIXELS * 4) {
    return undefined
  }

  const out = Buffer.alloc(expectedBytes)
  const rowsPerStrip = Math.max(1, ifd.rowsPerStrip || height)
  let outOffset = 0
  for (let index = 0; index < ifd.stripOffsets.length; index += 1) {
    const rows = Math.min(rowsPerStrip, height - index * rowsPerStrip)
    const expectedStripBytes = Math.max(0, rows * rowBytes)
    if (expectedStripBytes <= 0) {
      break
    }

    const strip = await reader.read(ifd.stripOffsets[index], ifd.stripByteCounts[index])
    const decoded = ifd.compression === COMPRESSION_LZW
      ? tiffLzwDecode(strip, expectedStripBytes)
      : strip
    if (decoded.length < expectedStripBytes) {
      return undefined
    }
    decoded.copy(out, outOffset, 0, expectedStripBytes)
    outOffset += expectedStripBytes
  }

  if (ifd.predictor === 2) {
    for (let row = 0; row < height; row += 1) {
      const rowOffset = row * rowBytes
      for (let index = samples; index < rowBytes; index += 1) {
        out[rowOffset + index] = (out[rowOffset + index] + out[rowOffset + index - samples]) & 0xff
      }
    }
  }
  return out
}

function rasterToRgb(raster: Buffer, ifd: TiffIfd) {
  const width = ifd.width || 0
  const height = ifd.height || 0
  const samples = ifd.samplesPerPixel || 1
  const rgb = Buffer.alloc(width * height * 3)
  let src = 0
  let dst = 0
  for (let index = 0; index < width * height; index += 1) {
    if (samples === 1) {
      const value = ifd.photometric === PHOTOMETRIC_WHITE_IS_ZERO ? 255 - raster[src] : raster[src]
      rgb[dst] = value
      rgb[dst + 1] = value
      rgb[dst + 2] = value
    } else {
      rgb[dst] = raster[src]
      rgb[dst + 1] = raster[src + 1]
      rgb[dst + 2] = raster[src + 2]
    }
    src += samples
    dst += 3
  }
  return rgb
}

let crcTable: number[] | undefined

function crc32(buffer: Buffer) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, index) => {
      let c = index
      for (let bit = 0; bit < 8; bit += 1) {
        c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      }
      return c >>> 0
    })
  }
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(8 + data.length + 4)
  chunk.writeUInt32BE(data.length, 0)
  typeBuffer.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length)
  return chunk
}

async function rgbPngDataUrl(rgb: Buffer, width: number, height: number) {
  const { deflateSync } = await import('node:zlib')
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const rowBytes = width * 3
  const raw = Buffer.alloc((rowBytes + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const srcOffset = y * rowBytes
    const dstOffset = y * (rowBytes + 1)
    raw[dstOffset] = 0
    rgb.copy(raw, dstOffset + 1, srcOffset, srcOffset + rowBytes)
  }

  const png = Buffer.concat([
    header,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  return `data:image/png;base64,${png.toString('base64')}`
}

async function imageDataUrlForIfd(reader: TiffReader, ifd: TiffIfd) {
  if (!ifd.width || !ifd.height || !ifd.compression) {
    return undefined
  }

  if ([COMPRESSION_JPEG_OLD, COMPRESSION_JPEG].includes(ifd.compression)) {
    const byteCount = ifd.stripByteCounts[0]
    if (byteCount > MAX_EMBEDDED_IMAGE_BYTES) {
      return undefined
    }
    const data = await reader.read(ifd.stripOffsets[0], byteCount)
    if (data[0] === 0xff && data[1] === 0xd8) {
      return `data:image/jpeg;base64,${data.toString('base64')}`
    }
    return undefined
  }

  if (![COMPRESSION_NONE, COMPRESSION_LZW].includes(ifd.compression)) {
    return undefined
  }

  const raster = await readRasterData(reader, ifd)
  if (!raster) {
    return undefined
  }
  return rgbPngDataUrl(rasterToRgb(raster, ifd), ifd.width, ifd.height)
}

async function readFromReader(reader: TiffReader) {
  const ifds = await readIfds(reader)
  const labelIfd = selectLabelIfd(ifds)
  return labelIfd ? imageDataUrlForIfd(reader, labelIfd) : undefined
}

async function readFromFile(path: string) {
  const reader = await FileReader.open(path)
  try {
    return await readFromReader(reader)
  } finally {
    await reader.close()
  }
}

export async function readEmbeddedLabelThumbnailDataUrl(source: string, cacheRoot: string) {
  const zipSource = parseZipEntrySource(source)
  if (!zipSource) {
    return readFromFile(source)
  }

  const info = await getZipEntryInfo(zipSource.zipPath, zipSource.entryName)
  if (!info || info.encrypted) {
    return undefined
  }
  if (info.compressionMethod === ZIP_STORED) {
    return readFromReader(new StoredZipReader(zipSource.zipPath, zipSource.entryName))
  }

  const materializedPath = await materializeZipEntrySourceForViewing(source, cacheRoot)
  return materializedPath === source ? undefined : readFromFile(materializedPath)
}
