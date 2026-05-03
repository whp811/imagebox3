import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import type { PickSlidesFolderResult, ScannedSlide, SlidesInfo } from '../shared/types'

function mapPlatform(p: string): string {
  if (p === 'windows') return 'win32'
  return p
}

/** Maps Electron preload surface — loaded before React when VITE_TAURI=1 */
export async function installTauriWsiApi(): Promise<void> {
  const plat = mapPlatform(await platform())
  window.wsiApi = {
    platform: plat,
    getInfo: () => invoke<SlidesInfo>('slides_get_info'),
    rescan: () => invoke<ScannedSlide[]>('slides_rescan'),
    pickSlidesFolder: async (): Promise<PickSlidesFolderResult> => {
      const picked = await open({
        directory: true,
        multiple: false,
        title: 'Select folder to scan for slides',
      })
      if (picked == null) {
        return { cancelled: true }
      }
      const path = Array.isArray(picked) ? picked[0] : picked
      if (path == null || path === '') {
        return { cancelled: true }
      }
      await invoke('slides_set_session_root', { path })
      const info = await invoke<SlidesInfo>('slides_get_info')
      return { cancelled: false, info }
    },
    pathToWsiUrl: (absolutePath: string) => invoke<string>('wsi_path_to_url', { absolutePath }),
    embeddedLabelThumbnail: (absolutePath: string) =>
      invoke<string | null>('wsi_embedded_label_thumbnail', { absolutePath }),
  }
}
