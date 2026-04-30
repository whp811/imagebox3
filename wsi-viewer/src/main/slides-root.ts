import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, normalize, sep } from 'node:path'

/**
 * If the payload lives under a folder named {@code .wsi-usb}/(win|mac|linux|…), treat the
 * drive root (parent of that folder) as the app root so a sibling {@code Slides/} on the
 * drive root is found.
 */
function getBundleRootIfUnderPayloadLayout(exePath: string, fallback: string): string {
  const norm = normalize(exePath)
  const m = norm.match(/^(.+)[/\\]\.wsi-usb[/\\]/i)
  if (m?.[1]) {
    let r = m[1]
    if (process.platform === 'win32' && /^[A-Za-z]:$/.test(r)) {
      r = r + sep
    }
    return r
  }
  return fallback
}

/**
 * App root: directory next to the main executable, used for a sibling @Slides/ folder.
 * - Windows/Linux portable: same folder as the .exe
 * - macOS .app: go up from Contents/MacOS/... to the folder that contains the .app bundle
 */
export function getApplicationRootDir(): string {
  if (process.env.WSI_DEBUG_PORTABLE) {
    return process.env.WSI_DEBUG_PORTABLE
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR
  }
  if (!app.isPackaged) {
    return process.cwd()
  }
  const exe = app.getPath('exe')
  let base: string
  if (process.platform === 'darwin') {
    // .../X.app/Contents/MacOS/executable -> the folder that contains X.app
    base = dirname(dirname(dirname(dirname(exe))))
  } else {
    base = dirname(exe)
  }
  return getBundleRootIfUnderPayloadLayout(exe, base)
}

/**
 * The folder that holds WSI data (sibling to portable bundle / exe folder).
 */
export function getSlidesRootPath(): string {
  return join(getApplicationRootDir(), 'Slides')
}

export function ensureSlidesDir(): string {
  const p = getSlidesRootPath()
  if (!existsSync(p)) {
    try {
      mkdirSync(p, { recursive: true })
    } catch {
      // read-only
    }
  }
  return p
}
