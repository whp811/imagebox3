import { open, readFile, stat } from 'node:fs/promises'
import { protocol } from 'electron'

const SCHEME = 'wsi'
const PRIVILEGED = [
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]

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

export function registerWsiSchemesEarly() {
  protocol.registerSchemesAsPrivileged(PRIVILEGED)
}

/**
 * Serves file bytes; GeoTIFF / OpenSlide-WASM use fetch+Range on wsi:// URL.
 * Call in app.whenReady().
 */
export function registerWsiFileHandler() {
  protocol.handle(SCHEME, async (request) => {
    if (request.method === 'HEAD') {
      const abs = pathFromRequestUrl(request.url)
      if (!abs) return new Response(null, { status: 400 })
      const st = await stat(abs)
      if (!st.isFile()) return new Response(null, { status: 400 })
      return new Response(null, {
        status: 200,
        headers: {
          'content-length': String(st.size),
          'content-type': 'application/octet-stream',
          'accept-ranges': 'bytes',
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
    const st = await stat(abs)
    if (!st.isFile()) {
      return new Response('Not a file', { status: 400 })
    }
    const fileSize = st.size
    const r = request.headers.get('range')
    const pr = parseRange(r, fileSize)
    if (!pr) {
      const data = await readFile(abs)
      return new Response(data, {
        status: 200,
        headers: {
          'content-length': String(data.length),
          'content-type': 'application/octet-stream',
          'access-control-allow-origin': '*',
        },
      })
    }
    const { start, end } = pr
    const len = end - start + 1
    const fh = await open(abs, 'r')
    const buf = Buffer.alloc(len)
    const { bytesRead } = await fh.read(buf, 0, len, start)
    await fh.close()
    const out = buf.subarray(0, bytesRead)
    return new Response(out, {
      status: 206,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(out.length),
        'content-range': `bytes ${start}-${end}/${fileSize}`,
        'access-control-allow-origin': '*',
      },
    })
  })
}

export function toWsiUrl(absoluteFilePath: string): string {
  return `${SCHEME}://local/${enc.encode(absoluteFilePath)}`
}
