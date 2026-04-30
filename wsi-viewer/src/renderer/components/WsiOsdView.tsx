import { useCallback, useEffect, useRef, useState } from 'react'
import OpenSeadragon from 'openseadragon'
import { buildOpenSlideOpenSeadragonTileSource } from '../lib/openslide-tilesource'
import { cn } from '../lib/utils'

type Props = {
  wsiUrl: string | null
  className?: string
  onError?: (e: string) => void
}

/**
 * OpenSeadragon + OpenSlide WASM. Destroys previous viewer on URL change.
 */
export function WsiOsdView({ wsiUrl, className, onError }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<ReturnType<typeof OpenSeadragon> | null>(null)
  const slideRef = useRef<unknown>(null)
  const [ready, setReady] = useState(false)
  const [showLoader, setShowLoader] = useState(false)
  const [loadProgress, setLoadProgress] = useState(0)

  const destroy = useCallback(() => {
    if (viewerRef.current) {
      try {
        viewerRef.current.destroy()
      } catch {
        /* */
      }
      viewerRef.current = null
    }
    if (slideRef.current && typeof (slideRef.current as { destroy?: () => void }).destroy === 'function') {
      try {
        ;(slideRef.current as { destroy: () => void }).destroy()
      } catch {
        /* */
      }
    }
    slideRef.current = null
  }, [])

  useEffect(() => {
    if (!wsiUrl || !ref.current) {
      destroy()
      setReady(false)
      setShowLoader(false)
      setLoadProgress(0)
      return
    }
    let cancelled = false
    let finishId: number | undefined
    setReady(false)
    setShowLoader(true)
    setLoadProgress(0)
    ;(async () => {
      try {
        destroy()
        if (!ref.current) {
          return
        }
        ref.current.style.background = '#ffffff'
        const { slide, tileSource } = await buildOpenSlideOpenSeadragonTileSource(wsiUrl)
        if (cancelled) {
          slide.destroy?.()
          return
        }
        slideRef.current = slide
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
          showNavigationControl: false,
          placeholderFillStyle: '#ffffff',
          prefixUrl: '/osd/images/',
        })
        viewerRef.current = v
        v.container.style.background = '#ffffff'
        v.canvas.style.background = '#ffffff'
        v.addOnceHandler('open', () => {
          if (!cancelled) {
            setLoadProgress(100)
            finishId = window.setTimeout(() => {
              if (!cancelled) {
                setReady(true)
                setShowLoader(false)
              }
            }, 140)
          }
        })
      } catch (e) {
        if (!cancelled) {
          setReady(false)
          setShowLoader(false)
          onError?.(String(e))
        }
      }
    })()
    return () => {
      cancelled = true
      if (finishId) {
        window.clearTimeout(finishId)
      }
      destroy()
    }
  }, [wsiUrl, destroy, onError])

  useEffect(() => {
    if (!showLoader || ready) {
      return
    }
    const id = window.setInterval(() => {
      setLoadProgress((progress) => {
        if (progress < 75) {
          return Math.min(progress + 15, 75)
        }
        return Math.min(progress + 1, 96)
      })
    }, 100)
    return () => {
      window.clearInterval(id)
    }
  }, [showLoader, ready])

  return (
    <div className={cn('relative h-full w-full min-h-0 bg-white', className)} data-osd-ready={ready}>
      <div ref={ref} className="absolute inset-0 bg-white" />
      {showLoader && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <div
            className="h-1 w-64 overflow-hidden rounded-full bg-zinc-200"
            role="progressbar"
            aria-label="Slide loading progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(loadProgress)}
          >
            <div className="h-full rounded-full bg-zinc-400 transition-[width] duration-150" style={{ width: `${loadProgress}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}
