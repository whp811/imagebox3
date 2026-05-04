import { Electroview } from 'electrobun/view'
import type { WsiHiveElectrobunRPC } from '../shared/electrobun-rpc'

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let id: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    id = setTimeout(
      () =>
        reject(
          new Error(
            `${label} (${ms}ms). Electrobun uses ws://localhost for RPC — ensure nothing blocks it and rebuild the renderer (npm run electrobun:renderer).`,
          ),
        ),
      ms,
    )
  })
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(id)
  })
}

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
  const platform = await withTimeout(requests.platform(), 25_000, 'Electrobun RPC handshake')

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
