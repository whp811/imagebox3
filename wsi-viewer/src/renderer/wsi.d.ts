import type { ScannedSlide, SlidesInfo } from '../shared/types'

export {}

declare global {
  interface Window {
    wsiApi: {
      getInfo: () => Promise<SlidesInfo>
      rescan: () => Promise<ScannedSlide[]>
      pathToWsiUrl: (absolutePath: string) => Promise<string>
      embeddedLabelThumbnail: (absolutePath: string) => Promise<string | null>
    }
  }
}
