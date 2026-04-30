import { readdir, readFile } from 'node:fs/promises'
import { join, extname, relative, basename, dirname } from 'node:path'
import { stat } from 'node:fs/promises'
import type { ScannedSlide } from '../shared/types'

const WSI_EXTS = new Set([
  '.svs', '.tif', '.tiff', '.gtiff',
])

function isWsiFile(name: string) {
  return WSI_EXTS.has(extname(name).toLowerCase())
}

type SlideLabelMeta = {
  specimenId?: string
  stain?: string
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const value = match?.[1]?.trim()
    if (value) {
      return value
    }
  }
  return undefined
}

function normalizeSpecimenId(value?: string) {
  if (!value) {
    return undefined
  }
  const cleaned = value
    .replace(/\0/g, '')
    .replace(/_/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase()
  return cleaned
    .replace(/^([A-Z]\d+-\d+)-([A-Z])-(\d+)-(\d+)$/, '$1-$2$3-$4')
    .replace(/^([A-Z]\d+-\d+)-([A-Z])-(\d+)$/, '$1-$2$3')
}

function normalizeStain(value?: string) {
  if (!value) {
    return undefined
  }
  const cleaned = value.replace(/\0/g, '').replace(/[_-]+$/g, '').trim()
  if (/^h\s*(?:&|and|\+|-)\s*e$/i.test(cleaned)) {
    return 'H&E'
  }
  return cleaned.replace(/\s+/g, ' ')
}

function parseSpecimenId(text: string) {
  return normalizeSpecimenId(firstMatch(text, [
    /<Barcode[^>]*>([^<]+)<\/Barcode>/i,
    /\bBarcode\s*[:=]\s*([A-Z0-9][A-Z0-9_-]*(?:-[A-Z0-9]+)+)/i,
    /\bSpecimen(?:\s*Id|\s*ID)?\s*[:=]\s*([A-Z0-9][A-Z0-9_-]*(?:-[A-Z0-9]+)+)/i,
    /\b([A-Z]\d{2}-\d{4,6}[_-][A-Z][_-]?\d+(?:[_-]\d+)?)\b/i,
  ]))
}

function parseStain(text: string) {
  const explicit = firstMatch(text, [
    /<Stain[^>]*>([^<]+)<\/Stain>/i,
    /\bStain(?:ing)?\s*[:=]\s*([^|<>\r\n,_]+(?:\s*&\s*[^|<>\r\n,_]+)?)/i,
    /Protocol\s+Add\s+([^_/\\|<>\r\n]+)/i,
  ])
  const normalized = normalizeStain(explicit)
  if (normalized) {
    return normalized
  }
  if (/\bH\s*(?:&|and|\+|-)\s*E\b/i.test(text)) {
    return 'H&E'
  }
  return undefined
}

function mergeMeta(primary: SlideLabelMeta, fallback: SlideLabelMeta): SlideLabelMeta {
  return {
    specimenId: primary.specimenId || fallback.specimenId,
    stain: primary.stain || fallback.stain,
  }
}

async function readWsiLabelMeta(path: string): Promise<SlideLabelMeta> {
  try {
    const { fromFile } = await import('geotiff')
    const tiff = await fromFile(path)
    const image = await tiff.getImage(0)
    const fileDirectory = image.fileDirectory
    const description = String(fileDirectory.ImageDescription ?? fileDirectory.imageDescription ?? '')
    return {
      specimenId: parseSpecimenId(description),
      stain: parseStain(description),
    }
  } catch {
    return {}
  }
}

async function readEvidenceLabelMeta(slidePath: string): Promise<SlideLabelMeta> {
  const evidenceDir = join(dirname(slidePath), 'Evidence')
  let entries: { name: string, isFile: () => boolean }[] = []
  try {
    entries = await readdir(evidenceDir, { withFileTypes: true })
  } catch {
    return {}
  }

  let meta: SlideLabelMeta = {}
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }
    const path = join(evidenceDir, entry.name)
    const fileStat = await stat(path).catch(() => null)
    if (!fileStat || fileStat.size > 512 * 1024) {
      continue
    }
    const text = await readFile(path, 'utf8').catch(() => '')
    if (!text) {
      continue
    }
    meta = mergeMeta(meta, {
      specimenId: parseSpecimenId(text),
      stain: parseStain(text),
    })
    if (meta.specimenId && meta.stain) {
      break
    }
  }
  return meta
}

function readPathLabelMeta(slidePath: string): SlideLabelMeta {
  const pathText = `${dirname(slidePath)} ${basename(slidePath)}`
  return {
    specimenId: parseSpecimenId(pathText),
    stain: parseStain(pathText),
  }
}

async function readSlideLabelMeta(path: string): Promise<SlideLabelMeta> {
  return mergeMeta(
    mergeMeta(await readWsiLabelMeta(path), await readEvidenceLabelMeta(path)),
    readPathLabelMeta(path),
  )
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
        const meta = await readSlideLabelMeta(p)
        const fileName = basename(p)
        out.push({
          id: Buffer.from(p, 'utf8').toString('base64url'),
          label: meta.specimenId || fileName,
          specimenId: meta.specimenId,
          stain: meta.stain,
          fileName,
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
