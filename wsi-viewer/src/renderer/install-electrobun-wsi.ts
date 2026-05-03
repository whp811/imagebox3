import { Electroview } from 'electrobun/view'
import type { WsiHiveElectrobunRPC } from '../shared/electrobun-rpc'

export async function installElectrobunWsiApi(): Promise<void> {
  const rpc = Electroview.defineRPC<WsiHiveElectrobunRPC>({
    maxRequestTime: Infinity,
    handlers: {
      requests: {},
      messages: {},
    },
  })
  const electrobun = new Electroview({ rpc })
  const requests = electrobun.rpc?.request
  if (!requests) {
    throw new Error('Electrobun RPC failed to initialize')
  }
  const platform = await requests.platform()

  window.wsiApi = {
    platform,
    getInfo: () => requests.getInfo(),
    rescan: () => requests.rescan(),
    pickSlidesFolder: () => requests.pickSlidesFolder(),
    pathToWsiUrl: (absolutePath: string) => requests.pathToWsiUrl({ absolutePath }),
    embeddedLabelThumbnail: (absolutePath: string) =>
      requests.embeddedLabelThumbnail({ absolutePath }),
  }
}
