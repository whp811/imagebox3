import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, Microscope, FolderOpen } from 'lucide-react'
import type { ScannedSlide, SlidesInfo } from '../shared/types'
import { WsiOsdView } from './components/WsiOsdView'
import { cn } from './lib/utils'

function fmtSize(n: number) {
  if (n < 1024) {
    return `${n} B`
  }
  if (n < 1024 ** 2) {
    return `${(n / 1024).toFixed(1)} KB`
  }
  if (n < 1024 ** 3) {
    return `${(n / 1024 ** 2).toFixed(1)} MB`
  }
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export default function App() {
  const [info, setInfo] = useState<SlidesInfo | null>(null)
  const [slides, setSlides] = useState<ScannedSlide[]>([])
  const [loading, setLoading] = useState(true)
  const [sidebar, setSidebar] = useState(true)
  const [active, setActive] = useState<ScannedSlide | null>(null)
  const [wsiUrl, setWsiUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
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

  /** Thumbnail: decode first slide region (lazy, 1 at a time) */
  useEffect(() => {
    let cancelled = false
    const q = slides.filter((s) => !thumbDone.current.has(s.id))
    async function run() {
      for (const sl of q) {
        if (cancelled) {
          return
        }
        thumbDone.current.add(sl.id)
        try {
          const u = await window.wsiApi.pathToWsiUrl(sl.absolutePath)
          const { default: Imagebox3 } = await import('../wsi/imagebox3.mjs')
          const ib = new Imagebox3(u, 0)
          await ib.init()
          const b = await ib.getThumbnail(128, 128)
          ib.destroyWorkerPool?.()
          if (cancelled) {
            return
          }
          const o = URL.createObjectURL(b)
          setThumbs((m) => ({ ...m, [sl.id]: o }))
        } catch {
          /* ignore */
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
        <Microscope className="mr-2 h-5 w-5" />
        <h1 className="text-sm font-semibold">WSI Hive</h1>
        <span className="ml-2 text-xs text-muted-foreground">local · portable</span>
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
              <p className="mb-2 break-all text-[10px] text-muted-foreground" title={info.slidesRoot}>
                <FolderOpen className="mb-0.5 inline h-3 w-3" /> {info.slidesRoot}
              </p>
            )}
            {loading && <p className="text-xs text-muted-foreground">Scanning…</p>}
            <ul className="flex flex-col gap-2">
              {slides.map((s) => (
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
                    <div className="mb-1 flex items-start gap-2">
                      <div className="size-14 shrink-0 overflow-hidden rounded bg-background">
                        {thumbs[s.id] ? (
                          <img src={thumbs[s.id]} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[9px] text-muted-foreground">
                            …
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{s.label}</div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">{s.ext}</div>
                        <div className="text-[10px] text-muted-foreground">{fmtSize(s.sizeBytes)}</div>
                      </div>
                    </div>
                    <p className="line-clamp-2 text-[10px] text-muted-foreground" title={s.relativeToSlides}>
                      {s.relativeToSlides}
                    </p>
                  </button>
                </li>
              ))}
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
        <main className="relative min-h-0 min-w-0 flex-1 bg-black">
          {err && <div className="absolute left-2 top-2 z-10 max-w-[90%] rounded bg-red-900/90 p-2 text-xs text-white">{err}</div>}
          {wsiUrl ? (
            <WsiOsdView
              wsiUrl={wsiUrl}
              className="h-full w-full"
              onError={(e) => {
                setErr(e)
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-400">Select a slide in the sidebar</div>
          )}
        </main>
      </div>
    </div>
  )
}
