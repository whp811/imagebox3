import { useCallback, useEffect, useRef, useState } from 'react'
import OpenSeadragon from 'openseadragon'
import { buildImagebox3OpenSeadragonTileSource } from '../lib/imagebox3-tilesource'
import { cn } from '../lib/utils'

type Props = {
  wsiUrl: string | null
  className?: string
  onError?: (e: string) => void
}

/**
 * OpenSeadragon + Imagebox3. Destroys previous viewer on URL change.
 */
export function WsiOsdView({ wsiUrl, className, onError }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<ReturnType<typeof OpenSeadragon> | null>(null)
  const imageboxRef = useRef<unknown>(null)
  const [ready, setReady] = useState(false)

  const destroy = useCallback(() => {
    if (viewerRef.current) {
      try {
        viewerRef.current.destroy()
      } catch {
        /* */
      }
      viewerRef.current = null
    }
    if (imageboxRef.current && typeof (imageboxRef.current as { destroyWorkerPool?: () => void }).destroyWorkerPool === 'function') {
      try {
        ;(imageboxRef.current as { destroyWorkerPool: () => void }).destroyWorkerPool()
      } catch {
        /* */
      }
    }
    imageboxRef.current = null
  }, [])

  useEffect(() => {
    if (!wsiUrl || !ref.current) {
      destroy()
      setReady(false)
      return
    }
    let cancelled = false
    setReady(false)
    ;(async () => {
      try {
        destroy()
        if (!ref.current) {
          return
        }
        const { imagebox3, tileSource } = await buildImagebox3OpenSeadragonTileSource(wsiUrl)
        if (cancelled) {
          imagebox3.destroyWorkerPool?.()
          return
        }
        imageboxRef.current = imagebox3
        const v = OpenSeadragon({
          element: ref.current!,
          tileSources: tileSource,
          animationTime: 0.15,
          blendTime: 0.05,
          constrainDuringPan: true,
          drawer: 'canvas',
          imageLoaderLimit: 5,
          immediateRender: true,
          maxImageCacheCount: 300,
          minZoomImageRatio: 0.1,
          maxZoomPixelRatio: 4,
          timeout: 1000 * 1000,
          showNavigationControl: true,
          prefixUrl: '/osd/images/',
        })
        viewerRef.current = v
        v.addOnceHandler('open', () => {
          if (!cancelled) {
            setReady(true)
          }
        })
      } catch (e) {
        onError?.(String(e))
      }
    })()
    return () => {
      cancelled = true
      destroy()
    }
  }, [wsiUrl, destroy, onError])

  return <div className={cn('relative h-full w-full min-h-0', className)} ref={ref} data-osd-ready={ready} />
}
