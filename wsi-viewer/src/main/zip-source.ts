import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { mkdir, open as openFile, rename, stat, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, posix as pathPosix } from 'node:path'
import * as yauzl from 'yauzl'
import type { Entry, ZipFile } from 'yauzl'

export const ZIP_STORED = 0
export const ZIP_DEFLATED = 8

const ZIP_SOURCE_PREFIX = 'zip-entry:'
const enc = {
  encode: (p: string) => Buffer.from(p, 'utf8').toString('base64url'),
  decode: (b: string) => Buffer.from(b, 'base64url').toString('utf8'),
}

export type ZipEntryInfo = {
  fileName: string
  compressedSize: number
  uncompressedSize: number
  compressionMethod: number
  encrypted: boolean
  localHeaderOffset: number
}

type ZipEntryCache = {
  size: number
  mtimeMs: number
  entries: ZipEntryInfo[]
}

const zipEntryCache = new Map<string, ZipEntryCache>()
const extractionRequests = new Map<string, Promise<string>>()

export function makeZipEntrySource(zipPath: string, entryName: string): string {
  return `${ZIP_SOURCE_PREFIX}${enc.encode(zipPath)}:${enc.encode(entryName)}`
}

export function parseZipEntrySource(source: string): { zipPath: string, entryName: string } | null {
  if (!source.startsWith(ZIP_SOURCE_PREFIX)) {
    return null
  }
  const parts = source.slice(ZIP_SOURCE_PREFIX.length).split(':')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null
  }
  return {
    zipPath: enc.decode(parts[0]),
    entryName: enc.decode(parts[1]),
  }
}

function openZip(zipPath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: false }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err || new Error(`Could not open ZIP: ${zipPath}`))
        return
      }
      resolve(zipfile)
    })
  })
}

export async function listZipEntries(zipPath: string): Promise<ZipEntryInfo[]> {
  const zipStat = await stat(zipPath)
  const cached = zipEntryCache.get(zipPath)
  if (cached && cached.size === zipStat.size && cached.mtimeMs === zipStat.mtimeMs) {
    return cached.entries
  }

  const zipfile = await openZip(zipPath)
  const entries = await new Promise<ZipEntryInfo[]>((resolve, reject) => {
    const out: ZipEntryInfo[] = []
    zipfile.on('entry', (entry: Entry) => {
      if (!entry.fileName.endsWith('/')) {
        out.push({
          fileName: entry.fileName,
          compressedSize: entry.compressedSize,
          uncompressedSize: entry.uncompressedSize,
          compressionMethod: entry.compressionMethod,
          encrypted: entry.isEncrypted(),
          localHeaderOffset: entry.relativeOffsetOfLocalHeader,
        })
      }
      zipfile.readEntry()
    })
    zipfile.once('end', () => {
      resolve(out)
    })
    zipfile.once('error', reject)
    zipfile.readEntry()
  }).finally(() => {
    zipfile.close()
  })

  zipEntryCache.set(zipPath, {
    size: zipStat.size,
    mtimeMs: zipStat.mtimeMs,
    entries,
  })
  return entries
}

export async function getZipEntryInfo(zipPath: string, entryName: string): Promise<ZipEntryInfo | undefined> {
  const entries = await listZipEntries(zipPath)
  return entries.find((entry) => entry.fileName === entryName)
}

function openZipEntryReadStream(
  zipPath: string,
  entryName: string,
  options?: { start?: number, end?: number, decompress?: boolean },
): Promise<{ zipfile: ZipFile, stream: Readable }> {
  return new Promise((resolve, reject) => {
    let settled = false
    openZip(zipPath)
      .then((zipfile) => {
        function fail(err: Error) {
          if (settled) {
            return
          }
          settled = true
          zipfile.close()
          reject(err)
        }

        zipfile.on('entry', (entry: Entry) => {
          if (entry.fileName !== entryName) {
            zipfile.readEntry()
            return
          }
          const streamOptions: { start?: number, end?: number, decompress?: boolean } = {}
          if (options?.start !== undefined) {
            streamOptions.start = options.start
          }
          if (options?.end !== undefined) {
            streamOptions.end = options.end
          }
          if (options?.decompress !== undefined) {
            streamOptions.decompress = options.decompress
          }
          const onStream = (err: Error | null, stream: Readable) => {
            if (err || !stream) {
              fail(err || new Error(`Could not read ZIP entry: ${entryName}`))
              return
            }
            settled = true
            resolve({ zipfile, stream })
          }
          if (Object.keys(streamOptions).length > 0) {
            zipfile.openReadStream(entry, streamOptions as any, onStream)
          } else {
            zipfile.openReadStream(entry, onStream)
          }
        })
        zipfile.once('end', () => {
          fail(new Error(`ZIP entry not found: ${entryName}`))
        })
        zipfile.once('error', fail)
        zipfile.readEntry()
      })
      .catch(reject)
  })
}

async function streamToBuffer(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > maxBytes) {
      throw new Error('ZIP entry is larger than allowed')
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks, total)
}

export async function readZipTextEntry(zipPath: string, entryName: string, maxBytes: number): Promise<string> {
  const info = await getZipEntryInfo(zipPath, entryName)
  if (!info || info.encrypted || info.uncompressedSize > maxBytes) {
    return ''
  }
  const { zipfile, stream } = await openZipEntryReadStream(zipPath, entryName)
  try {
    return (await streamToBuffer(stream, maxBytes)).toString('utf8')
  } finally {
    zipfile.close()
  }
}

export async function readZipEntryBuffer(zipPath: string, entryName: string, maxBytes: number): Promise<Buffer> {
  const info = await getZipEntryInfo(zipPath, entryName)
  if (!info || info.encrypted || info.uncompressedSize > maxBytes) {
    return Buffer.alloc(0)
  }
  const { zipfile, stream } = await openZipEntryReadStream(zipPath, entryName)
  try {
    return await streamToBuffer(stream, maxBytes)
  } finally {
    zipfile.close()
  }
}

export async function readStoredZipEntryRange(
  zipPath: string,
  entryName: string,
  start: number,
  endInclusive: number,
): Promise<Buffer> {
  const info = await getZipEntryInfo(zipPath, entryName)
  if (!info) {
    throw new Error(`ZIP entry not found: ${entryName}`)
  }
  if (info.encrypted) {
    throw new Error(`ZIP entry is encrypted: ${entryName}`)
  }
  if (info.compressionMethod !== ZIP_STORED) {
    throw new Error('ZIP slide entries must be stored without compression for WSI range reads')
  }
  const handle = await openFile(zipPath, 'r')
  try {
    const localHeader = Buffer.alloc(30)
    const headerRead = await handle.read(localHeader, 0, localHeader.length, info.localHeaderOffset)
    if (headerRead.bytesRead !== localHeader.length || localHeader.readUInt32LE(0) !== 0x04034b50) {
      throw new Error(`Invalid ZIP local header for ${entryName}`)
    }
    const fileNameLength = localHeader.readUInt16LE(26)
    const extraFieldLength = localHeader.readUInt16LE(28)
    const dataOffset = info.localHeaderOffset + localHeader.length + fileNameLength + extraFieldLength
    const length = endInclusive - start + 1
    const buf = Buffer.alloc(length)
    const result = await handle.read(buf, 0, length, dataOffset + start)
    return buf.subarray(0, result.bytesRead)
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function zipCachePath(cacheRoot: string, zipPath: string, entryName: string, info: ZipEntryInfo, zipFingerprint: string) {
  const digest = createHash('sha256')
    .update(JSON.stringify([
      zipPath,
      zipFingerprint,
      entryName,
      info.compressedSize,
      info.uncompressedSize,
      info.compressionMethod,
    ]))
    .digest('hex')
    .slice(0, 24)
  const ext = pathPosix.extname(entryName) || '.wsi'
  return join(cacheRoot, 'zip-cache', `${digest}${ext}`)
}

async function extractZipEntryToCache(zipPath: string, entryName: string, cacheRoot: string, info: ZipEntryInfo) {
  const zipStat = await stat(zipPath)
  const target = zipCachePath(cacheRoot, zipPath, entryName, info, `${zipStat.size}:${zipStat.mtimeMs}`)
  const existing = await stat(target).catch(() => null)
  if (existing?.isFile() && existing.size === info.uncompressedSize) {
    return target
  }

  const inFlight = extractionRequests.get(target)
  if (inFlight) {
    return inFlight
  }

  const request = (async () => {
    const dir = join(cacheRoot, 'zip-cache')
    await mkdir(dir, { recursive: true })
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
    const { zipfile, stream } = await openZipEntryReadStream(zipPath, entryName)
    try {
      await pipeline(stream, createWriteStream(tmp))
      const extracted = await stat(tmp)
      if (extracted.size !== info.uncompressedSize) {
        throw new Error(`Extracted ZIP entry size mismatch: ${entryName}`)
      }
      await unlink(target).catch(() => undefined)
      await rename(tmp, target)
      return target
    } catch (err) {
      await unlink(tmp).catch(() => undefined)
      throw err
    } finally {
      zipfile.close()
    }
  })()

  extractionRequests.set(target, request)
  try {
    return await request
  } finally {
    extractionRequests.delete(target)
  }
}

export async function materializeZipEntrySourceForViewing(source: string, cacheRoot: string): Promise<string> {
  const zipSource = parseZipEntrySource(source)
  if (!zipSource) {
    return source
  }
  const info = await getZipEntryInfo(zipSource.zipPath, zipSource.entryName)
  if (!info) {
    throw new Error(`ZIP entry not found: ${zipSource.entryName}`)
  }
  if (info.encrypted) {
    throw new Error('ZIP slide entry is encrypted')
  }
  if (info.compressionMethod === ZIP_STORED) {
    return source
  }
  if (info.compressionMethod !== ZIP_DEFLATED) {
    throw new Error(`Unsupported ZIP compression method: ${info.compressionMethod}`)
  }
  return extractZipEntryToCache(zipSource.zipPath, zipSource.entryName, cacheRoot, info)
}
