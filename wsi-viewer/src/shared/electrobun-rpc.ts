import type { RPCSchema } from 'electrobun/view'
import type { PickSlidesFolderResult, ScannedSlide, SlidesInfo } from './types'

export type WsiHiveElectrobunRPC = {
  bun: RPCSchema<{
    requests: {
      platform: { params: undefined, response: string }
      getInfo: { params: undefined, response: SlidesInfo }
      rescan: { params: undefined, response: ScannedSlide[] }
      pickSlidesFolder: { params: undefined, response: PickSlidesFolderResult }
      pathToWsiUrl: { params: { absolutePath: string }, response: string }
      embeddedLabelThumbnail: { params: { absolutePath: string }, response: string | null }
    }
    messages: {}
  }>
  webview: RPCSchema<{
    requests: {}
    messages: {}
  }>
}
