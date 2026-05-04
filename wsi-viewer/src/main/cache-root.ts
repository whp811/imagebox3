import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const APP_CACHE_DIR_NAME = 'WSI Hive'
let sessionCacheRoot: string | null = null

function canUseCacheRoot(path: string): boolean {
  try {
    mkdirSync(path, { recursive: true })
    const probe = join(path, '.write-test')
    writeFileSync(probe, 'ok')
    unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

function hostCacheRoot(): string | null {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Caches', APP_CACHE_DIR_NAME)
  }
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    return join(base, APP_CACHE_DIR_NAME, 'Cache')
  }
  const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
  return join(base, 'wsi-hive')
}

function hideOnWindows(path: string) {
  if (process.platform === 'win32' && existsSync(path)) {
    execFile('attrib', ['+h', path], { windowsHide: true }, () => undefined)
  }
}

export function getCacheRootDir(applicationRoot: string): string {
  const override = process.env.WSI_HIVE_CACHE_ROOT
  if (override && canUseCacheRoot(override)) {
    sessionCacheRoot = override
    return override
  }

  const portableRoot = join(applicationRoot, '.wsi-hive-data')
  if (process.env.WSI_HIVE_FORCE_PORTABLE_CACHE !== '1') {
    const hostRoot = hostCacheRoot()
    if (hostRoot && canUseCacheRoot(hostRoot)) {
      sessionCacheRoot = hostRoot
      return hostRoot
    }
  }

  mkdirSync(portableRoot, { recursive: true })
  hideOnWindows(portableRoot)
  sessionCacheRoot = portableRoot
  return portableRoot
}

export function clearSessionCacheRoot(): void {
  if (!sessionCacheRoot) {
    return
  }
  const target = sessionCacheRoot
  sessionCacheRoot = null
  rmSync(target, { recursive: true, force: true })
}
