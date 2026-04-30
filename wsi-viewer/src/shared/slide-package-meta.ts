export type SlidePackageNameMeta = {
  specimenId?: string
  stain?: string
}

export function normalizePackageStain(value?: string) {
  if (!value) {
    return undefined
  }
  const cleaned = value
    .replace(/\0/g, '')
    .replace(/^Protocol\s+Add\s+/i, '')
    .replace(/[_-]+$/g, '')
    .trim()
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

export function parseSlidePackageName(text: string): SlidePackageNameMeta {
  const packageNamePattern = /(^|[/\\\s])([A-Z]\d{2}-\d{4,6})_([A-Z])_(\d+)_([^/\\]+?)_t[A-Z0-9]+(?:\.[A-Z0-9]+)?(?=$|[/\\\s])/gi
  let meta: SlidePackageNameMeta = {}
  for (const match of text.matchAll(packageNamePattern)) {
    const specimenId = `${match[2].toUpperCase()}-${match[3].toUpperCase()}${match[4]}`
    const stain = normalizePackageStain(match[5])
    meta = {
      specimenId,
      stain,
    }
  }
  return meta
}
