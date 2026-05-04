import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserView, BrowserWindow, Utils } from 'electrobun/bun'

console.error('[wsi-hive] Electrobun main starting')
import { clearSessionCacheRoot } from '../main/cache-root'
import { readEmbeddedLabelThumbnailDataUrl } from '../main/embedded-label-thumbnail'
import { scanForSlides } from '../main/scan-slides'
import { materializeZipEntrySourceForViewing } from '../main/zip-source'
import type { WsiHiveElectrobunRPC } from '../shared/electrobun-rpc'
import {
  ensureSlidesDir,
  getApplicationRootDir,
  getPortableDataRoot,
  getSlidesRootPath,
  setSlidesRootSessionOverride,
} from './portable-paths'
import { startWsiHttpServer, toWsiHttpUrl } from './wsi-http-server'

const wsiServer = await startWsiHttpServer()
console.error('[wsi-hive] WSI HTTP server listening at', wsiServer.baseUrl)
getPortableDataRoot()
ensureSlidesDir()

function slidesInfo() {
  return {
    applicationRoot: getApplicationRootDir(),
    slidesRoot: getSlidesRootPath(),
  }
}

const rpc = BrowserView.defineRPC<WsiHiveElectrobunRPC>({
  maxRequestTime: Infinity,
  handlers: {
    requests: {
      platform: () => process.platform,
      getInfo: () => slidesInfo(),
      rescan: () => scanForSlides(ensureSlidesDir(), { labelThumbnailCacheRoot: getPortableDataRoot() }),
      pickSlidesFolder: async () => {
        const paths = await Utils.openFileDialog({
          startingFolder: getSlidesRootPath(),
          allowedFileTypes: '*',
          canChooseFiles: false,
          canChooseDirectory: true,
          allowsMultipleSelection: false,
        })
        const picked = paths.find((path) => path && path.trim() !== '')
        if (!picked) {
          return { cancelled: true as const }
        }
        setSlidesRootSessionOverride(picked)
        return { cancelled: false as const, info: slidesInfo() }
      },
      pathToWsiUrl: async ({ absolutePath }) => {
        const source = await materializeZipEntrySourceForViewing(absolutePath, getPortableDataRoot())
        return toWsiHttpUrl(source, wsiServer.baseUrl)
      },
      embeddedLabelThumbnail: async ({ absolutePath }) => {
        return (await readEmbeddedLabelThumbnailDataUrl(absolutePath, getPortableDataRoot())) || null
      },
    },
    messages: {},
  },
})

function electorobunViewsRoot(): string {
  const marker = join('renderer', 'index.html')
  const metaDir = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    // Electrobun bundles this file to Resources/app/bun/index.js.
    join(metaDir, '..', 'views'),
    join(metaDir, 'app', 'views'),
  ]
  const entry = process.argv[1]
  if (entry) {
    const entryDir = dirname(entry)
    candidates.push(join(entryDir, '..', 'views'), join(entryDir, 'app', 'views'))
  }
  candidates.push(join(process.cwd(), '..', 'Resources', 'app', 'views'))

  for (const candidate of candidates) {
    if (existsSync(join(candidate, marker))) {
      return candidate
    }
  }

  console.error('[wsi-hive] Electrobun renderer not found; tried:', candidates)
  return candidates[0]
}

const viewsRoot = electorobunViewsRoot()

const win = new BrowserWindow({
  title: 'WSI Hive',
  frame: {
    x: 80,
    y: 60,
    width: 1280,
    height: 860,
  },
  url: 'views://renderer/index.html',
  viewsRoot,
  // hiddenInset + FullSizeContentView can leave WKWebView with no visible content area in Electrobun dev.
  titleBarStyle: 'default',
  rpc,
})

win.on('close', () => {
  setSlidesRootSessionOverride(null)
  wsiServer.close()
  clearSessionCacheRoot()
})
