import { contextBridge, ipcRenderer } from 'electron'
import type { PickSlidesFolderResult, ScannedSlide, SlidesInfo } from '../shared/types'

contextBridge.exposeInMainWorld('wsiApi', {
  platform: process.platform,
  /** Fallback when an older preload bundle is still loaded — prefer named methods. */
  invoke: (channel: string, ...args: unknown[]) =>
    (ipcRenderer.invoke as (channel: string, ...args: unknown[]) => Promise<unknown>)(
      channel,
      ...args,
    ),
  getInfo: () => ipcRenderer.invoke('slides:getInfo') as Promise<SlidesInfo>,
  rescan: () => ipcRenderer.invoke('slides:rescan') as Promise<ScannedSlide[]>,
  pickSlidesFolder: () =>
    ipcRenderer.invoke('slides:pickSlidesFolder') as Promise<PickSlidesFolderResult>,
  pathToWsiUrl: (absolutePath: string) => ipcRenderer.invoke('wsi:pathToUrl', { absolutePath }) as Promise<string>,
  embeddedLabelThumbnail: (absolutePath: string) => ipcRenderer.invoke('wsi:embeddedLabelThumbnail', { absolutePath }) as Promise<string | null>,
})
