import { open, readFile, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { basename, posix as pathPosix } from 'node:path'
import { protocol } from 'electron'
import { ZIP_STORED, getZipEntryInfo, parseZipEntrySource, readStoredZipEntryRange } from './zip-source'

const SCHEME = 'wsi'
const PRIVILEGED = [
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]
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
  encode: (p: string) => Buffer.from(p, 'utf8').toString('base64url'),
  decode: (b: string) => Buffer.from(b, 'base64url').toString('utf8'),
}

function pathFromRequestUrl(requestUrl: string): string {
  const u = new URL(requestUrl)
  const id = (u.pathname || '').replace(/^\//, '') || u.hostname
  if (!id) return ''
  return enc.decode(id)
}

function displayNameFromSource(source: string): string {
  const zipSource = parseZipEntrySource(source)
  return zipSource ? pathPosix.basename(zipSource.entryName) : basename(source)
}

function parseRange(rangeHeader: string | null, size: number): { start: number, end: number } | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null
  const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
  if (!m) return null
  let start = m[1] ? parseInt(m[1], 10) : 0
  let end = m[2] ? parseInt(m[2], 10) : size - 1
  if (m[1] === '' && m[2] !== '') {
    const suffix = parseInt(m[2], 10)
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

export function registerWsiSchemesEarly() {
  protocol.registerSchemesAsPrivileged(PRIVILEGED)
}

/**
 * Serves file bytes; OpenSlide WASM uses fetch+Range on wsi:// URL.
 * Call in app.whenReady().
 */
export function registerWsiFileHandler() {
  protocol.handle(SCHEME, async (request) => {
    if (request.method === 'HEAD') {
      const abs = pathFromRequestUrl(request.url)
      if (!abs) return new Response(null, { status: 400 })
      const zipSource = parseZipEntrySource(abs)
      if (zipSource) {
        const entry = await getZipEntryInfo(zipSource.zipPath, zipSource.entryName)
        if (!entry) return new Response(null, { status: 404 })
        if (entry.encrypted || entry.compressionMethod !== ZIP_STORED) {
          return new Response(null, {
            status: 415,
            headers: {
              'content-type': 'text/plain',
              'access-control-allow-origin': '*',
            },
          })
        }
        return new Response(null, {
          status: 200,
          headers: {
            'content-length': String(entry.uncompressedSize),
            'content-type': 'application/octet-stream',
            'accept-ranges': 'bytes',
            'access-control-allow-origin': '*',
          },
        })
      }
      const st = await stat(abs)
      if (!st.isFile()) return new Response(null, { status: 400 })
      return new Response(null, {
        status: 200,
        headers: {
          'content-length': String(st.size),
          'content-type': 'application/octet-stream',
          'accept-ranges': 'bytes',
          'access-control-allow-origin': '*',
        },
      })
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 })
    }
    const abs = pathFromRequestUrl(request.url)
    if (!abs) {
      return new Response('Bad wsi:// URL', { status: 400 })
    }
    const zipSource = parseZipEntrySource(abs)
    if (zipSource) {
      const entry = await getZipEntryInfo(zipSource.zipPath, zipSource.entryName)
      if (!entry) {
        return new Response('ZIP entry not found', { status: 404 })
      }
      if (entry.encrypted) {
        return new Response('ZIP slide entry is encrypted', { status: 415 })
      }
      if (entry.compressionMethod !== ZIP_STORED) {
        return new Response('ZIP slide entry is compressed; rebuild the ZIP with store/no-compression mode', { status: 415 })
      }

      const fileSize = entry.uncompressedSize
      const r = request.headers.get('range')
      const pr = parseRange(r, fileSize)
      if (!pr) {
        if (fileSize > MAX_FULL_FILE_BYTES) {
          return new Response('Range header required for WSI files', {
            status: 416,
            headers: {
              'content-type': 'text/plain',
              'content-range': `bytes */${fileSize}`,
              'accept-ranges': 'bytes',
              'access-control-allow-origin': '*',
            },
          })
        }
        const data = await readStoredZipEntryRange(zipSource.zipPath, zipSource.entryName, 0, fileSize - 1)
        return new Response(new Uint8Array(data), {
          status: 200,
          headers: {
            'content-length': String(data.length),
            'content-type': 'application/octet-stream',
            'accept-ranges': 'bytes',
            'access-control-allow-origin': '*',
          },
        })
      }
      const { start, end } = pr
      const data = await readStoredZipEntryRange(zipSource.zipPath, zipSource.entryName, start, end)
      return new Response(new Uint8Array(data), {
        status: 206,
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(data.length),
          'content-range': `bytes ${start}-${end}/${fileSize}`,
          'accept-ranges': 'bytes',
          'access-control-allow-origin': '*',
        },
      })
    }
    const st = await stat(abs)
    if (!st.isFile()) {
      return new Response('Not a file', { status: 400 })
    }
    const fileSize = st.size
    const r = request.headers.get('range')
    const pr = parseRange(r, fileSize)
    if (!pr) {
      if (fileSize > MAX_FULL_FILE_BYTES) {
        return new Response('Range header required for WSI files', {
          status: 416,
          headers: {
            'content-type': 'text/plain',
            'content-range': `bytes */${fileSize}`,
            'accept-ranges': 'bytes',
            'access-control-allow-origin': '*',
          },
        })
      }
      const data = await readFile(abs)
      return new Response(data, {
        status: 200,
        headers: {
          'content-length': String(data.length),
          'content-type': 'application/octet-stream',
          'accept-ranges': 'bytes',
          'access-control-allow-origin': '*',
        },
      })
    }
    const { start, end } = pr
    const len = end - start + 1
    const buf = Buffer.alloc(len)
    const file = await acquireCachedFile(abs, st)
    let bytesRead = 0
    try {
      const result = await file.handle.read(buf, 0, len, start)
      bytesRead = result.bytesRead
    } finally {
      releaseCachedFile(file)
    }
    const out = buf.subarray(0, bytesRead)
    return new Response(out, {
      status: 206,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(out.length),
        'content-range': `bytes ${start}-${end}/${fileSize}`,
        'accept-ranges': 'bytes',
        'access-control-allow-origin': '*',
      },
    })
  })
}

export function toWsiUrl(absoluteFilePath: string): string {
  const name = encodeURIComponent(displayNameFromSource(absoluteFilePath))
  return `${SCHEME}://local/${enc.encode(absoluteFilePath)}?name=${name}`
}
