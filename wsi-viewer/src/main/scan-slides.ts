import { readdir, readFile } from 'node:fs/promises'
import { join, extname, relative, basename, dirname, posix as pathPosix } from 'node:path'
import { stat } from 'node:fs/promises'
import { parseSlidePackageName } from '../shared/slide-package-meta'
import type { ScannedSlide } from '../shared/types'
import { ZIP_DEFLATED, ZIP_STORED, listZipEntries, makeZipEntrySource, readZipEntryBuffer, readZipTextEntry } from './zip-source'

const TIFF_WSI_EXTS = new Set([
  '.svs', '.tif', '.tiff', '.gtiff', '.ndpi',
])
const WSI_EXTS = TIFF_WSI_EXTS

const ZIP_EXT = '.zip'
const TEXT_META_EXTS = new Set([
  '.csv', '.ini', '.json', '.txt', '.tsv', '.xml', '.yaml', '.yml',
])
const LABEL_IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp',
])
const MAX_TEXT_META_BYTES = 512 * 1024
const MAX_LABEL_IMAGE_BYTES = 3 * 1024 * 1024

function isWsiFile(name: string) {
  return WSI_EXTS.has(extname(name).toLowerCase())
}

function isZipFile(name: string) {
  return extname(name).toLowerCase() === ZIP_EXT
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
  if (/^movat$/i.test(cleaned)) {
    return 'Movat'
  }
  if (/^red\s*(?:heart|hrt)$/i.test(cleaned)) {
    return 'REDheart'
  }
  return cleaned.replace(/\s+/g, ' ')
}

function parseKnownStainToken(text: string) {
  const clean = text.replace(/\0/g, '')
  if (/(^|[_\-\s/\\])H\s*(?:&|and|\+|-)\s*E(?=($|[_\-\s/\\]))/i.test(clean)) {
    return 'H&E'
  }
  if (/(^|[_\-\s/\\])movat(?=($|[_\-\s/\\]))/i.test(clean)) {
    return 'Movat'
  }
  if (/(^|[_\-\s/\\])red\s*(?:heart|hrt)(?=($|[_\-\s/\\]))/i.test(clean)) {
    return 'REDheart'
  }
  return undefined
}

function parseSpecimenId(text: string) {
  return normalizeSpecimenId(firstMatch(text, [
    /"?(?:Barcode|SpecimenId|Specimen_ID|Specimen ID|Specimen|SlideId|Slide_ID|Slide ID|Accession|CaseId|Case_ID|Case ID)"?\s*:\s*"?([A-Z0-9][A-Z0-9_-]*(?:-[A-Z0-9]+)+)"?/i,
    /<Barcode[^>]*>([^<]+)<\/Barcode>/i,
    /<(?:SpecimenId|Specimen_ID|Specimen|SlideId|Slide_ID|Slide|Accession|CaseId|Case_ID|Case)[^>]*>([^<]+)<\/(?:SpecimenId|Specimen_ID|Specimen|SlideId|Slide_ID|Slide|Accession|CaseId|Case_ID|Case)>/i,
    /\bBarcode\s*[:=]\s*([A-Z0-9][A-Z0-9_-]*(?:-[A-Z0-9]+)+)/i,
    /\b(?:Slide|Case|Accession)(?:\s*Id|\s*ID)?\s*[:=]\s*([A-Z0-9][A-Z0-9_-]*(?:-[A-Z0-9]+)+)/i,
    /\bSpecimen(?:\s*Id|\s*ID)?\s*[:=]\s*([A-Z0-9][A-Z0-9_-]*(?:-[A-Z0-9]+)+)/i,
    /\b([A-Z]\d{2}-\d{4,6}[_-][A-Z][_-]?\d+(?:[_-]\d+)?)\b/i,
  ]))
}

function parseStain(text: string) {
  const explicit = firstMatch(text, [
    /"?(?:Stain|Staining|SpecialStain|Special_Stain|Special Stain|StainName|Stain_Name|Procedure|Protocol)"?\s*:\s*"?([^",}|<>\r\n_]+(?:\s*&\s*[^",}|<>\r\n_]+)?)"?/i,
    /<Stain[^>]*>([^<]+)<\/Stain>/i,
    /<SpecialStain[^>]*>([^<]+)<\/SpecialStain>/i,
    /\b(?:Special\s*)?Stain(?:ing|Name)?\s*[:=]\s*([^|<>\r\n,_]+(?:\s*&\s*[^|<>\r\n,_]+)?)/i,
    /Protocol\s+Add\s+([^_/\\|<>\r\n]+)/i,
  ])
  const normalized = normalizeStain(explicit)
  if (normalized) {
    return normalized
  }
  return parseKnownStainToken(text)
}

function mergeMeta(primary: SlideLabelMeta, fallback: SlideLabelMeta): SlideLabelMeta {
  return {
    specimenId: primary.specimenId || fallback.specimenId,
    stain: primary.stain || fallback.stain,
  }
}

async function readEvidenceLabelMeta(slidePath: string): Promise<SlideLabelMeta> {
  const evidenceDir = await findLocalEvidenceDir(dirname(slidePath))
  if (!evidenceDir) {
    return {}
  }

  let files: string[] = []
  try {
    files = await listLocalEvidenceFiles(evidenceDir)
  } catch {
    return {}
  }

  let meta: SlideLabelMeta = {}
  for (const path of files) {
    if (!isTextMetaEntry(path)) {
      continue
    }
    const fileStat = await stat(path).catch(() => null)
    if (!fileStat || fileStat.size > MAX_TEXT_META_BYTES) {
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

async function readEvidenceThumbnailDataUrl(slidePath: string): Promise<string | undefined> {
  const evidenceDir = await findLocalEvidenceDir(dirname(slidePath))
  if (!evidenceDir) {
    return undefined
  }
  const files = await listLocalEvidenceFiles(evidenceDir).catch(() => [])
  for (const path of sortLabelImageCandidates(files.filter(isLabelImageEntry), evidenceDir)) {
    const mime = imageMimeForEntry(path)
    if (!mime) {
      continue
    }
    const fileStat = await stat(path).catch(() => null)
    if (!fileStat || fileStat.size > MAX_LABEL_IMAGE_BYTES) {
      continue
    }
    const data = await readFile(path).catch(() => Buffer.alloc(0))
    if (data.length > 0) {
      return `data:${mime};base64,${data.toString('base64')}`
    }
  }
  return undefined
}

function readPathLabelMeta(slidePath: string): SlideLabelMeta {
  const pathText = `${dirname(slidePath)} ${basename(slidePath)}`
  return mergeMeta(parseSlidePackageName(pathText), {
    specimenId: parseSpecimenId(pathText),
    stain: parseStain(pathText),
  })
}

async function readSlideLabelMeta(path: string): Promise<SlideLabelMeta> {
  const pathMeta = readPathLabelMeta(path)
  const evidenceMeta = await readEvidenceLabelMeta(path)
  return mergeMeta(evidenceMeta, pathMeta)
}

function isTextMetaEntry(name: string) {
  return TEXT_META_EXTS.has(pathPosix.extname(name).toLowerCase())
}

function isLabelImageEntry(name: string) {
  return LABEL_IMAGE_EXTS.has(pathPosix.extname(name).toLowerCase())
}

function isPreferredLabelImageName(name: string) {
  if (!LABEL_IMAGE_EXTS.has(pathPosix.extname(name).toLowerCase())) {
    return false
  }
  return /(^|[-_\s])(label|thumb|thumbnail)([-_\s.]|$)/i.test(zipBasename(name))
}

function imageMimeForEntry(name: string) {
  switch (pathPosix.extname(name).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    default:
      return undefined
  }
}

async function findLocalEvidenceDir(slideDir: string) {
  const entries = await readdir(slideDir, { withFileTypes: true }).catch(() => [])
  const evidence = entries.find((entry) => entry.isDirectory() && isEvidenceDirName(entry.name))
  return evidence ? join(slideDir, evidence.name) : undefined
}

async function listLocalEvidenceFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
      } else if (entry.isFile()) {
        out.push(path)
      }
    }
  }
  await walk(root)
  return out
}

function sortLabelImageCandidates(names: string[], evidenceRoot?: string) {
  return [...names].sort((a, b) => {
    const aIsLabel = isPreferredLabelImageName(a)
    const bIsLabel = isPreferredLabelImageName(b)
    const aInEvidence = evidenceRoot ? a.startsWith(evidenceRoot) : isUnderAnyEvidenceDir(a)
    const bInEvidence = evidenceRoot ? b.startsWith(evidenceRoot) : isUnderAnyEvidenceDir(b)
    return Number(bIsLabel) - Number(aIsLabel)
      || Number(bInEvidence) - Number(aInEvidence)
      || a.localeCompare(b, undefined, { sensitivity: 'base' })
  })
}

function splitZipPath(name: string) {
  return name.split(/[\\/]+/).filter(Boolean)
}

function zipDirname(name: string) {
  const normalized = name.replace(/\\/g, '/')
  return pathPosix.dirname(normalized)
}

function zipBasename(name: string) {
  const normalized = name.replace(/\\/g, '/')
  return pathPosix.basename(normalized)
}

function isEvidenceDirName(name?: string) {
  return /^(evidence|evidance)$/i.test(name || '')
}

function hasPrefix(parts: string[], prefix: string[]) {
  return prefix.every((part, index) => parts[index] === part)
}

function isUnderEvidenceDirForSlide(entryName: string, slideDir: string) {
  const entryParts = splitZipPath(entryName)
  const slideDirParts = slideDir === '.' ? [] : splitZipPath(slideDir)
  return entryParts.length > slideDirParts.length + 1
    && hasPrefix(entryParts, slideDirParts)
    && isEvidenceDirName(entryParts[slideDirParts.length])
}

function isUnderAnyEvidenceDir(entryName: string) {
  const dirParts = splitZipPath(zipDirname(entryName))
  return dirParts.some(isEvidenceDirName)
}

function candidateZipSidecarEntries(slideEntryName: string, zipEntryNames: string[], singleSlideInZip: boolean) {
  const slideDir = zipDirname(slideEntryName)
  return zipEntryNames.filter((name) => {
    if (name === slideEntryName) {
      return false
    }
    const entryDir = zipDirname(name)
    return entryDir === slideDir
      || isUnderEvidenceDirForSlide(name, slideDir)
      || (singleSlideInZip && (entryDir === '.' || isUnderAnyEvidenceDir(name)))
  })
}

function candidateZipMetaEntries(slideEntryName: string, zipEntryNames: string[], singleSlideInZip: boolean) {
  return candidateZipSidecarEntries(slideEntryName, zipEntryNames, singleSlideInZip).filter(isTextMetaEntry)
}

function candidateZipLabelImageEntries(slideEntryName: string, zipEntryNames: string[], singleSlideInZip: boolean) {
  const slideDir = zipDirname(slideEntryName)
  return sortLabelImageCandidates(candidateZipSidecarEntries(slideEntryName, zipEntryNames, singleSlideInZip)
    .filter(isLabelImageEntry)
    .filter((name) => isPreferredLabelImageName(name) || isUnderEvidenceDirForSlide(name, slideDir) || (singleSlideInZip && isUnderAnyEvidenceDir(name))))
}

function readZipPathLabelMeta(zipPath: string, entryName: string): SlideLabelMeta {
  const pathText = `${basename(zipPath)} ${entryName}`
  return mergeMeta(parseSlidePackageName(pathText), {
    specimenId: parseSpecimenId(pathText),
    stain: parseStain(pathText),
  })
}

async function readZipSidecarLabelMeta(
  zipPath: string,
  slideEntryName: string,
  zipEntryNames: string[],
  singleSlideInZip: boolean,
): Promise<SlideLabelMeta> {
  let meta: SlideLabelMeta = {}
  for (const entryName of candidateZipMetaEntries(slideEntryName, zipEntryNames, singleSlideInZip)) {
    const text = await readZipTextEntry(zipPath, entryName, MAX_TEXT_META_BYTES).catch(() => '')
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

async function readZipSlideLabelMeta(
  zipPath: string,
  slideEntryName: string,
  zipEntryNames: string[],
  singleSlideInZip: boolean,
): Promise<SlideLabelMeta> {
  const pathMeta = readZipPathLabelMeta(zipPath, slideEntryName)
  return mergeMeta(await readZipSidecarLabelMeta(zipPath, slideEntryName, zipEntryNames, singleSlideInZip), pathMeta)
}

async function readZipLabelImageDataUrl(
  zipPath: string,
  slideEntryName: string,
  zipEntryNames: string[],
  singleSlideInZip: boolean,
) {
  for (const entryName of candidateZipLabelImageEntries(slideEntryName, zipEntryNames, singleSlideInZip)) {
    const mime = imageMimeForEntry(entryName)
    if (!mime) {
      continue
    }
    const data = await readZipEntryBuffer(zipPath, entryName, MAX_LABEL_IMAGE_BYTES).catch(() => Buffer.alloc(0))
    if (data.length > 0) {
      return `data:${mime};base64,${data.toString('base64')}`
    }
  }
  return undefined
}

/**
 * Recursively list all WSI files under @param root
 */
export async function scanForSlides(root: string): Promise<ScannedSlide[]> {
  const out: ScannedSlide[] = []
  async function addZipSlides(zipPath: string) {
    const zipStat = await stat(zipPath).catch(() => null)
    if (!zipStat?.isFile()) {
      return
    }
    const entries = await listZipEntries(zipPath).catch(() => [])
    const zipEntryNames = entries.map((entry) => entry.fileName)
    const wsiEntries = entries.filter((entry) => isWsiFile(entry.fileName))
    for (const entry of wsiEntries) {
      const fileName = zipBasename(entry.fileName)
      const source = makeZipEntrySource(zipPath, entry.fileName)
      const meta = await readZipSlideLabelMeta(zipPath, entry.fileName, zipEntryNames, wsiEntries.length === 1)
      const thumbnailDataUrl = await readZipLabelImageDataUrl(zipPath, entry.fileName, zipEntryNames, wsiEntries.length === 1)
      const unsupportedReason = entry.encrypted
        ? 'ZIP slide entry is encrypted. Use an unencrypted ZIP.'
        : entry.compressionMethod === ZIP_STORED || entry.compressionMethod === ZIP_DEFLATED
          ? undefined
          : `Unsupported ZIP compression method: ${entry.compressionMethod}`
      out.push({
        id: Buffer.from(source, 'utf8').toString('base64url'),
        label: meta.specimenId || fileName,
        specimenId: meta.specimenId,
        stain: meta.stain,
        fileName,
        absolutePath: source,
        relativeToSlides: `${relative(root, zipPath)}!/${entry.fileName}`,
        ext: pathPosix.extname(entry.fileName).toLowerCase(),
        sizeBytes: entry.uncompressedSize,
        sourceType: 'zip',
        zipPath,
        zipEntry: entry.fileName,
        zipCompressionMethod: entry.compressionMethod,
        requiresExtraction: entry.compressionMethod === ZIP_DEFLATED,
        thumbnailDataUrl,
        unsupportedReason,
      })
    }
  }

  async function walk(dir: string) {
    let entries: { name: string, isFile: () => boolean, isDirectory: () => boolean }[] = []
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        await walk(p)
      } else if (e.isFile() && isZipFile(e.name)) {
        await addZipSlides(p)
      } else if (e.isFile() && isWsiFile(e.name)) {
        const s = await stat(p).catch(() => null)
        if (!s?.isFile()) {
          continue
        }
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
          thumbnailDataUrl: await readEvidenceThumbnailDataUrl(p),
        })
      }
    }
  }
  await walk(root)
  out.sort((a, b) => a.relativeToSlides.localeCompare(b.relativeToSlides, undefined, { sensitivity: 'base' }))
  return out
}
