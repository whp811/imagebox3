import { useCallback, useEffect, useRef, useState } from 'react'
import OpenSeadragon from 'openseadragon'
import { buildOpenSlideOpenSeadragonTileSource } from '../lib/openslide-tilesource'
import { cn } from '../lib/utils'

type Props = {
  wsiUrl: string | null
  className?: string
  onError?: (e: string) => void
}

const osdImagePrefixUrl = `${import.meta.env.BASE_URL || './'}osd/images/`
const isElectrobun = import.meta.env.VITE_ELECTROBUN === '1'
const animationTime = isElectrobun ? 0.08 : 0.15
const blendTime = isElectrobun ? 0 : 0.05
const imageLoaderLimit = isElectrobun ? 2 : 5
// Smaller cache in WKWebView. Each entry is a 256² ARGB canvas (~256KB) +
// IOSurface backing; aggregate cache across many slides was a contributor to
// WebContent OOM crashes during long sessions.
const maxImageCacheCount = isElectrobun ? 40 : 300
const maxTilesPerFrame = isElectrobun ? 2 : 1
const maxZoomPixelRatio = isElectrobun ? 1.75 : 4
const minScrollDeltaTime = isElectrobun ? 70 : 50
const smoothTileEdgesMinZoom = isElectrobun ? Infinity : 1.1
const springStiffness = isElectrobun ? 9 : 6.5
const tileTimeout = 1000 * 1000

/**
 * OpenSeadragon + OpenSlide WASM. Destroys previous viewer on URL change.
 */
export function WsiOsdView({ wsiUrl, className, onError }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<ReturnType<typeof OpenSeadragon> | null>(null)
  const tileSourceRef = useRef<{ destroy?: () => void } | null>(null)
  const slideRef = useRef<unknown>(null)
  const teardownRef = useRef<Promise<void>>(Promise.resolve())
  const [ready, setReady] = useState(false)
  const [showLoader, setShowLoader] = useState(false)
  const [loadProgress, setLoadProgress] = useState(0)

  const destroy = useCallback(() => {
    const cleanup: Array<Promise<unknown>> = []
    if (viewerRef.current) {
      const viewer = viewerRef.current as ReturnType<typeof OpenSeadragon> & {
        drawer?: { canvas?: HTMLCanvasElement }
      }
      // Capture the drawer canvas BEFORE destroy so we can null its backing
      // store afterwards. OSD's own drawer.destroy() shrinks it to 1×1; we
      // shrink to 0 for paranoia in WKWebView where IOSurface release lag
      // contributed to long-session OOM crashes.
      const drawerCanvas = viewer.drawer?.canvas
      viewerRef.current = null
      try {
        viewer.destroy()
        if (drawerCanvas) {
          drawerCanvas.width = 0
          drawerCanvas.height = 0
        }
      } catch {
        /* */
      }
    }
    if (tileSourceRef.current && typeof tileSourceRef.current.destroy === 'function') {
      try {
        cleanup.push(Promise.resolve(tileSourceRef.current.destroy()))
      } catch {
        /* */
      }
    }
    tileSourceRef.current = null
    if (slideRef.current && typeof (slideRef.current as { destroy?: () => void }).destroy === 'function') {
      try {
        cleanup.push(Promise.resolve((slideRef.current as { destroy: () => void }).destroy()))
      } catch {
        /* */
      }
    }
    slideRef.current = null
    teardownRef.current = teardownRef.current
      .catch(() => undefined)
      .then(() => Promise.allSettled(cleanup))
      .then(() => undefined)
    return teardownRef.current
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
        await destroy()
        if (!ref.current) {
          return
        }
        ref.current.style.background = '#ffffff'
        const { slide, tileSource } = await buildOpenSlideOpenSeadragonTileSource(wsiUrl)
        if (cancelled) {
          tileSource.destroy?.()
          slide.destroy?.()
          return
        }
        slideRef.current = slide
        tileSourceRef.current = tileSource
        const v = OpenSeadragon({
          element: ref.current!,
          animationTime,
          blendTime,
          constrainDuringPan: true,
          drawer: 'canvas',
          imageLoaderLimit,
          immediateRender: true,
          maxImageCacheCount,
          maxTilesPerFrame,
          minZoomImageRatio: 0.1,
          minScrollDeltaTime,
          maxZoomPixelRatio,
          smoothTileEdgesMinZoom,
          springStiffness,
          timeout: tileTimeout,
          showNavigationControl: false,
          placeholderFillStyle: '#ffffff',
          prefixUrl: osdImagePrefixUrl,
        })
        viewerRef.current = v
        v.container.style.background = '#ffffff'
        v.canvas.style.background = '#ffffff'
        let finished = false
        const finishLoading = () => {
          if (finished) {
            return
          }
          finished = true
          if (!cancelled) {
            setLoadProgress(100)
            finishId = window.setTimeout(() => {
              if (!cancelled) {
                setReady(true)
                setShowLoader(false)
              }
            }, 140)
          }
        }
        v.addOnceHandler('open', finishLoading)
        v.addOnceHandler('tile-drawn', finishLoading)
        v.open(tileSource)
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
      void destroy()
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
