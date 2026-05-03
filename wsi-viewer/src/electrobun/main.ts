import { BrowserView, BrowserWindow, Utils } from 'electrobun/bun'
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

const win = new BrowserWindow({
  title: 'WSI Hive',
  frame: {
    x: 80,
    y: 60,
    width: 1280,
    height: 860,
  },
  url: 'views://renderer/index.html',
  titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
  trafficLightOffset: process.platform === 'darwin' ? { x: 16, y: 16 } : undefined,
  rpc,
})

win.on('close', () => {
  setSlidesRootSessionOverride(null)
  wsiServer.close()
})
