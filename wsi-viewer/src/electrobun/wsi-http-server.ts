import { open, readFile, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename, posix as pathPosix } from 'node:path'
import { ZIP_STORED, getZipEntryInfo, parseZipEntrySource, readStoredZipEntryRange } from '../main/zip-source'

const MAX_OPEN_FILES = 16
const MAX_FULL_FILE_BYTES = 16 * 1024 * 1024

type CachedFile = {
  handle: FileHandle
  size: number
  mtimeMs: number
  inUse: number
  closeAfterUse: boolean
}

const openFiles = new Map<string, CachedFile>()

const enc = {
  encode: (p: string) =>
    Buffer.from(p, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''),
  decode: (b: string) => {
    const padded = b.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b.length / 4) * 4, '=')
    return Buffer.from(padded, 'base64').toString('utf8')
  },
}

function displayNameFromSource(source: string): string {
  const zipSource = parseZipEntrySource(source)
  return zipSource ? pathPosix.basename(zipSource.entryName) : basename(source)
}

function parseRange(rangeHeader: string | undefined, size: number): { start: number, end: number } | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null
  const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
  if (!match) return null
  let start = match[1] ? parseInt(match[1], 10) : 0
  let end = match[2] ? parseInt(match[2], 10) : size - 1
  if (match[1] === '' && match[2] !== '') {
    const suffix = parseInt(match[2], 10)
    start = Math.max(0, size - suffix)
    end = size - 1
  }
  if (end >= size) end = size - 1
  if (start < 0 || start > end) return null
  return { start, end }
}

function closeCachedFile(entry: CachedFile) {
  if (entry.inUse > 0) {
    entry.closeAfterUse = true
    return
  }
  void entry.handle.close().catch(() => {})
}

function evictOpenFiles() {
  while (openFiles.size > MAX_OPEN_FILES) {
    const oldest = openFiles.entries().next().value as [string, CachedFile] | undefined
    if (!oldest) return
    openFiles.delete(oldest[0])
    closeCachedFile(oldest[1])
  }
}

async function acquireCachedFile(abs: string, st: Stats): Promise<CachedFile> {
  const cached = openFiles.get(abs)
  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
    openFiles.delete(abs)
    openFiles.set(abs, cached)
    cached.inUse += 1
    return cached
  }

  if (cached) {
    openFiles.delete(abs)
    closeCachedFile(cached)
  }

  const entry: CachedFile = {
    handle: await open(abs, 'r'),
    size: st.size,
    mtimeMs: st.mtimeMs,
    inUse: 1,
    closeAfterUse: false,
  }
  openFiles.set(abs, entry)
  evictOpenFiles()
  return entry
}

function releaseCachedFile(entry: CachedFile) {
  entry.inUse -= 1
  if (entry.inUse <= 0 && entry.closeAfterUse) {
    void entry.handle.close().catch(() => {})
  }
}

function send(res: ServerResponse, status: number, headers: Record<string, string>, body?: Buffer | string) {
  res.writeHead(status, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'range, content-type',
    'cache-control': 'no-store',
    ...headers,
  })
  if (body === undefined) {
    res.end()
    return
  }
  res.end(body)
}

function sourceFromRequest(req: IncomingMessage): string | null {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const prefix = '/wsi/'
  if (!url.pathname.startsWith(prefix)) {
    return null
  }
  const id = url.pathname.slice(prefix.length)
  return id ? enc.decode(id) : null
}

async function serveSource(req: IncomingMessage, res: ServerResponse, source: string) {
  const sendBody = req.method !== 'HEAD'
  const zipSource = parseZipEntrySource(source)

  if (zipSource) {
    const entry = await getZipEntryInfo(zipSource.zipPath, zipSource.entryName)
    if (!entry) {
      send(res, 404, { 'content-type': 'text/plain' }, sendBody ? 'ZIP entry not found' : undefined)
      return
    }
    if (entry.encrypted || entry.compressionMethod !== ZIP_STORED) {
      send(res, 415, { 'content-type': 'text/plain' }, sendBody ? 'ZIP slide entry is not stored/plain' : undefined)
      return
    }

    const fileSize = entry.uncompressedSize
    if (!sendBody) {
      send(res, 200, {
        'content-length': String(fileSize),
        'content-type': 'application/octet-stream',
        'accept-ranges': 'bytes',
      })
      return
    }
    const range = parseRange(req.headers.range, fileSize)
    if (!range) {
      if (fileSize > MAX_FULL_FILE_BYTES) {
        send(res, 416, {
          'content-type': 'text/plain',
          'content-range': `bytes */${fileSize}`,
          'accept-ranges': 'bytes',
        }, sendBody ? 'Range header required for WSI files' : undefined)
        return
      }
      const data = sendBody
        ? await readStoredZipEntryRange(zipSource.zipPath, zipSource.entryName, 0, fileSize - 1)
        : undefined
      send(res, 200, {
        'content-length': String(fileSize),
        'content-type': 'application/octet-stream',
        'accept-ranges': 'bytes',
      }, data)
      return
    }

    const { start, end } = range
    const data = sendBody
      ? await readStoredZipEntryRange(zipSource.zipPath, zipSource.entryName, start, end)
      : undefined
    send(res, 206, {
      'content-type': 'application/octet-stream',
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${fileSize}`,
      'accept-ranges': 'bytes',
    }, data)
    return
  }

  const fileStat = await stat(source)
  if (!fileStat.isFile()) {
    send(res, 400, { 'content-type': 'text/plain' }, sendBody ? 'Not a file' : undefined)
    return
  }

  const fileSize = fileStat.size
  if (!sendBody) {
    send(res, 200, {
      'content-length': String(fileSize),
      'content-type': 'application/octet-stream',
      'accept-ranges': 'bytes',
    })
    return
  }
  const range = parseRange(req.headers.range, fileSize)
  if (!range) {
    if (fileSize > MAX_FULL_FILE_BYTES) {
      send(res, 416, {
        'content-type': 'text/plain',
        'content-range': `bytes */${fileSize}`,
        'accept-ranges': 'bytes',
      }, sendBody ? 'Range header required for WSI files' : undefined)
      return
    }
    const data = sendBody ? await readFile(source) : undefined
    send(res, 200, {
      'content-length': String(fileSize),
      'content-type': 'application/octet-stream',
      'accept-ranges': 'bytes',
    }, data)
    return
  }

  const { start, end } = range
  const len = end - start + 1
  let data: Buffer | undefined
  if (sendBody) {
    const buf = Buffer.alloc(len)
    const file = await acquireCachedFile(source, fileStat)
    try {
      const result = await file.handle.read(buf, 0, len, start)
      data = buf.subarray(0, result.bytesRead)
    } finally {
      releaseCachedFile(file)
    }
  }
  send(res, 206, {
    'content-type': 'application/octet-stream',
    'content-length': String(data?.length ?? len),
    'content-range': `bytes ${start}-${end}/${fileSize}`,
    'accept-ranges': 'bytes',
  }, data)
}

export async function startWsiHttpServer(): Promise<{ baseUrl: string, close: () => void }> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      if (req.method === 'OPTIONS') {
        send(res, 204, {})
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        send(res, 405, { 'content-type': 'text/plain' }, 'Method not allowed')
        return
      }
      const source = sourceFromRequest(req)
      if (!source) {
        send(res, 404, { 'content-type': 'text/plain' }, 'Not found')
        return
      }
      await serveSource(req, res, source)
    })().catch((error) => {
      const status = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? 404 : 500
      send(res, status, { 'content-type': 'text/plain' }, String(error))
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => {
      server.close()
      for (const entry of openFiles.values()) {
        closeCachedFile(entry)
      }
      openFiles.clear()
    },
  }
}

export function toWsiHttpUrl(absoluteFilePath: string, baseUrl: string): string {
  const name = encodeURIComponent(displayNameFromSource(absoluteFilePath))
  return `${baseUrl}/wsi/${enc.encode(absoluteFilePath)}?name=${name}`
}
