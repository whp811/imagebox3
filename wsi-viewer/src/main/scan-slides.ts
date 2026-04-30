import { readdir } from 'node:fs/promises'
import { join, extname, relative, basename } from 'node:path'
import { stat } from 'node:fs/promises'
import type { ScannedSlide } from '../shared/types'

const WSI_EXTS = new Set([
  '.svs', '.tif', '.tiff', '.gtiff',
])

function isWsiFile(name: string) {
  return WSI_EXTS.has(extname(name).toLowerCase())
}

/**
 * Recursively list all WSI files under @param root
 */
export async function scanForSlides(root: string): Promise<ScannedSlide[]> {
  const out: ScannedSlide[] = []
  async function walk(dir: string) {
    let entries: { name: string, isFile: () => boolean, isDirectory: () => boolean }[] = []
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      const s = await stat(p).catch(() => null)
      if (!s) {
        continue
      }
      if (s.isFile() && isWsiFile(e.name)) {
        const rel = relative(root, p)
        out.push({
          id: Buffer.from(p, 'utf8').toString('base64url'),
          label: basename(p),
          absolutePath: p,
          relativeToSlides: rel,
          ext: extname(e.name).toLowerCase(),
          sizeBytes: s.size,
        })
      } else if (s.isDirectory()) {
        await walk(p)
      }
    }
  }
  await walk(root)
  out.sort((a, b) => a.relativeToSlides.localeCompare(b.relativeToSlides, undefined, { sensitivity: 'base' }))
  return out
}
