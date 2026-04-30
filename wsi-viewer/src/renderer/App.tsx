import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, FolderOpen } from 'lucide-react'
import type { ScannedSlide, SlidesInfo } from '../shared/types'
import { WsiOsdView } from './components/WsiOsdView'
import { cn } from './lib/utils'
import uhnLeafUrl from './assets/uhn-leaf.png'

const THUMBNAIL_WORKERS = 1

type Imagebox3Instance = {
  init: () => Promise<void>
  getEmbeddedLabel?: (width: number, height: number) => Promise<Blob | undefined>
  destroyWorkerPool?: () => void
}

function slideLabelLines(slide: ScannedSlide) {
  const pathText = `${slide.relativeToSlides} ${slide.fileName || slide.label}`
  const pathSpecimen = pathText
    .match(/([A-Z]\d{2}-\d{4,6})[_-]([A-Z])[_-]?(\d+)(?:[_-](\d+))?/i)
  const specimenFromPath = pathSpecimen
    ? `${pathSpecimen[1]}-${pathSpecimen[2].toUpperCase()}${pathSpecimen[3]}${pathSpecimen[4] ? `-${pathSpecimen[4]}` : ''}`
    : undefined
  const stainFromPath = /H\s*(?:&|and|\+|-)\s*E/i.test(pathText) ? 'H&E' : undefined
  return [
    slide.specimenId || specimenFromPath || slide.label,
    slide.stain || stainFromPath,
  ].filter(Boolean) as string[]
}

export default function App() {
  const [info, setInfo] = useState<SlidesInfo | null>(null)
  const [slides, setSlides] = useState<ScannedSlide[]>([])
  const [loading, setLoading] = useState(true)
  const [sidebar, setSidebar] = useState(true)
  const [showSlidesRoot, setShowSlidesRoot] = useState(false)
  const [active, setActive] = useState<ScannedSlide | null>(null)
  const [wsiUrl, setWsiUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({})
  const thumbDone = useRef<Set<string>>(new Set())

  const rescan = useCallback(async () => {
    if (!window.wsiApi) {
      return
    }
    setLoading(true)
    setErr(null)
    try {
      const s = await window.wsiApi.rescan()
      setSlides(s)
      thumbDone.current = new Set()
      setThumbs({})
    } catch (e) {
      setErr(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!window.wsiApi) {
      setErr('wsiApi missing (not running in Electron shell)')
      return
    }
    window.wsiApi
      .getInfo()
      .then(setInfo)
      .catch((e) => setErr(String(e)))
    rescan()
  }, [rescan])

  const openSlide = useCallback(async (sl: ScannedSlide) => {
    setErr(null)
    setActive(sl)
    const u = await window.wsiApi.pathToWsiUrl(sl.absolutePath)
    setWsiUrl(u)
  }, [])

  const handleViewerError = useCallback((e: string) => {
    setErr(e)
  }, [])

  /** Thumbnail: use embedded WSI lab label only; null means fallback to slide title. */
  useEffect(() => {
    let cancelled = false
    const q = slides.filter((s) => !thumbDone.current.has(s.id))
    async function run() {
      for (const sl of q) {
        if (cancelled) {
          return
        }
        thumbDone.current.add(sl.id)
        let ib: Imagebox3Instance | null = null
        try {
          const u = await window.wsiApi.pathToWsiUrl(sl.absolutePath)
          const { default: Imagebox3 } = await import('../wsi/imagebox3.mjs')
          const imagebox = new Imagebox3(u, THUMBNAIL_WORKERS) as Imagebox3Instance
          ib = imagebox
          await imagebox.init()
          const b = await imagebox.getEmbeddedLabel?.(128, 128)
          if (cancelled) {
            return
          }
          if (b) {
            const o = URL.createObjectURL(b)
            setThumbs((m) => ({ ...m, [sl.id]: o }))
          } else {
            setThumbs((m) => ({ ...m, [sl.id]: null }))
          }
        } catch {
          if (!cancelled) {
            setThumbs((m) => ({ ...m, [sl.id]: null }))
          }
        } finally {
          ib?.destroyWorkerPool?.()
        }
        await new Promise((r) => {
          setTimeout(r, 200)
        })
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [slides])

  return (
    <div className="flex h-screen w-screen min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex h-12 shrink-0 items-center border-b border-border px-3">
        <div className="flex items-center gap-2" aria-label="UHN Laboratory">
          <img src={uhnLeafUrl} alt="" className="h-8 w-auto shrink-0" draggable={false} />
          <span className="text-xl font-bold leading-none text-[#1c2f63]">UHN Laboratory</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-md border border-border bg-card px-2 text-xs"
            onClick={() => {
              rescan()
            }}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Rescan
          </button>
        </div>
      </header>
      <div className="flex min-h-0 min-w-0 flex-1">
        <aside
          className={cn(
            'flex shrink-0 flex-col border-r border-border bg-card transition-[width]',
            sidebar ? 'w-72' : 'w-0 overflow-hidden',
          )}
        >
          <div className="flex h-9 items-center justify-between border-b border-border px-2">
            <span className="text-xs font-medium">Slides</span>
            <button
              type="button"
              className="rounded p-1 hover:bg-background"
              onClick={() => {
                setSidebar((s) => !s)
              }}
              title="Toggle"
            >
              {sidebar ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {info && (
              <div className="mb-2">
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:bg-background"
                  title={showSlidesRoot ? 'Hide slides folder path' : info.slidesRoot}
                  aria-label="Toggle slides folder path"
                  onClick={() => {
                    setShowSlidesRoot((show) => !show)
                  }}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </button>
                {showSlidesRoot && (
                  <p className="mt-1 break-all text-[10px] text-muted-foreground" title={info.slidesRoot}>
                    {info.slidesRoot}
                  </p>
                )}
              </div>
            )}
            {loading && <p className="text-xs text-muted-foreground">Scanning…</p>}
            <ul className="flex flex-col gap-2">
              {slides.map((s) => {
                const thumb = thumbs[s.id]
                const labelLines = slideLabelLines(s)
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        void openSlide(s)
                      }}
                      className={cn(
                        'flex w-full flex-col overflow-hidden rounded-lg border p-2 text-left text-xs transition-colors',
                        active?.id === s.id
                          ? 'border-foreground/30 bg-background'
                          : 'border-border hover:bg-background/80',
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="size-14 shrink-0 overflow-hidden rounded bg-background">
                          {typeof thumb === 'string' ? (
                            <img src={thumb} alt="" className="h-full w-full object-contain" />
                          ) : thumb === null ? (
                            <div className="grid h-full w-full place-items-center px-1 text-center text-[8px] font-medium leading-tight text-muted-foreground">
                              <span className="line-clamp-4 whitespace-pre-line break-all" title={labelLines.join('\n')}>{labelLines.join('\n')}</span>
                            </div>
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[9px] text-muted-foreground">
                              …
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium" title={labelLines[0]}>{labelLines[0]}</div>
                          {labelLines[1] && <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{labelLines[1]}</div>}
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
            {!loading && slides.length === 0 && (
              <p className="text-xs text-muted-foreground">No WSI in Slides. Add files under the Slides folder and rescan.</p>
            )}
          </div>
        </aside>
        {!sidebar && (
          <button
            type="button"
            className="w-6 shrink-0 border-r border-border bg-card"
            onClick={() => {
              setSidebar(true)
            }}
            title="Show"
          >
            <ChevronRight className="mx-auto h-4 w-4" />
          </button>
        )}
        <main className="relative min-h-0 min-w-0 flex-1 bg-white">
          {err && <div className="absolute left-2 top-2 z-10 max-w-[90%] rounded bg-red-900/90 p-2 text-xs text-white">{err}</div>}
          {wsiUrl ? (
            <WsiOsdView
              wsiUrl={wsiUrl}
              className="h-full w-full"
              onError={handleViewerError}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-400">Select a slide in the sidebar</div>
          )}
        </main>
      </div>
    </div>
  )
}
