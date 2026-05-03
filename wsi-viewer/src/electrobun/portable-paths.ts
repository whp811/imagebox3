import { execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, normalize, sep } from 'node:path'

let slidesRootSessionOverride: string | null = null
let portableDataRoot: string | null = null

export function setSlidesRootSessionOverride(absolutePath: string | null): void {
  slidesRootSessionOverride = absolutePath
}

function getBundleRootIfUnderPayloadLayout(exePath: string, fallback: string): string {
  const norm = normalize(exePath)
  const match = norm.match(/^(.+)[/\\]\.wsi-usb[/\\]/i)
  if (match?.[1]) {
    let root = match[1]
    if (process.platform === 'win32' && /^[A-Za-z]:$/.test(root)) {
      root += sep
    }
    return root
  }
  return fallback
}

function getMacAppContainerRoot(exePath: string): string | null {
  const marker = `${sep}Contents${sep}MacOS${sep}`
  const markerAt = exePath.indexOf(marker)
  if (markerAt === -1) {
    return null
  }
  const appPath = exePath.slice(0, markerAt)
  if (!appPath.endsWith('.app')) {
    return null
  }
  return dirname(appPath)
}

export function getApplicationRootDir(): string {
  if (process.env.WSI_DEBUG_PORTABLE) {
    return process.env.WSI_DEBUG_PORTABLE
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR
  }
  if (process.env.ELECTROBUN_PORTABLE_ROOT) {
    return process.env.ELECTROBUN_PORTABLE_ROOT
  }

  const exe = process.execPath || process.argv[0] || process.cwd()
  const base = process.platform === 'darwin'
    ? getMacAppContainerRoot(exe) || dirname(exe)
    : dirname(exe)
  return getBundleRootIfUnderPayloadLayout(exe, base)
}

export function getSlidesRootPath(): string {
  return slidesRootSessionOverride || join(getApplicationRootDir(), 'Slides')
}

export function ensureSlidesDir(): string {
  const slidesRoot = getSlidesRootPath()
  if (!existsSync(slidesRoot)) {
    try {
      mkdirSync(slidesRoot, { recursive: true })
    } catch {
      // USB media can be read-only; scanning will simply return no slides.
    }
  }
  return slidesRoot
}

export function getPortableDataRoot(): string {
  if (portableDataRoot) {
    return portableDataRoot
  }
  portableDataRoot = join(getApplicationRootDir(), '.wsi-hive-data')
  mkdirSync(portableDataRoot, { recursive: true })
  if (process.platform === 'win32') {
    execFile('attrib', ['+h', portableDataRoot], { windowsHide: true }, () => undefined)
  }
  return portableDataRoot
}
