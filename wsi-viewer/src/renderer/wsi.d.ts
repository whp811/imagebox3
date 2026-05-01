import type { PickSlidesFolderResult, ScannedSlide, SlidesInfo } from '../shared/types'

export {}

declare global {
  interface Window {
    wsiApi: {
      platform: string
      invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>
      getInfo: () => Promise<SlidesInfo>
      rescan: () => Promise<ScannedSlide[]>
      pickSlidesFolder?: () => Promise<PickSlidesFolderResult>
      pathToWsiUrl: (absolutePath: string) => Promise<string>
      embeddedLabelThumbnail: (absolutePath: string) => Promise<string | null>
    }
  }
}
