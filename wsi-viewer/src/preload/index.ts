import { contextBridge, ipcRenderer } from 'electron'
import type { ScannedSlide, SlidesInfo } from '../shared/types'

contextBridge.exposeInMainWorld('wsiApi', {
  getInfo: () => ipcRenderer.invoke('slides:getInfo') as Promise<SlidesInfo>,
  rescan: () => ipcRenderer.invoke('slides:rescan') as Promise<ScannedSlide[]>,
  pathToWsiUrl: (absolutePath: string) => ipcRenderer.invoke('wsi:pathToUrl', { absolutePath }) as Promise<string>,
})
