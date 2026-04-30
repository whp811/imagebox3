import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, ChevronLeft, ChevronRight, FolderOpen, RefreshCw, ShieldCheck } from 'lucide-react'
import { parseSlidePackageName } from '../shared/slide-package-meta'
import type { ScannedSlide, SlidesInfo } from '../shared/types'
import { WsiOsdView } from './components/WsiOsdView'
import { cn } from './lib/utils'

const uhnLabsLogoUrl = `${import.meta.env.BASE_URL || './'}logo-Labs.svg`

const noticeSections = [
  {
    title: 'Personal Records Only',
    body: 'These digital images are provided to you as a courtesy for your personal records under the Personal Health Information Protection Act (PHIPA). They are not intended for independent diagnostic use.',
  },
  {
    title: 'Professional Interpretation Required',
    body: 'Pathology images are highly complex. A definitive diagnosis requires a qualified Pathologist to review the slides in the context of your full clinical history, using medically validated workstations. We strongly advise against attempting to self-diagnose.',
  },
  {
    title: 'Research Use Software',
    body: 'The OpenSlide™ and OpenSeadragon™ software provided on this drive are open-source tools intended for research and educational viewing. It is not a Health Canada-approved medical device for primary diagnosis.',
  },
  {
    title: 'Privacy Warning',
    body: 'This thumb drive contains sensitive Personal Health Information (PHI). Please store it in a secure location. If lost or stolen, UHN is not responsible for unauthorized access to the data on this physical media.',
  },
]

function slideLabelLines(slide: ScannedSlide) {
  const pathText = `${slide.relativeToSlides} ${slide.fileName || slide.label}`
  const packageMeta = parseSlidePackageName(pathText)
  const pathSpecimen = pathText
    .match(/([A-Z]\d{2}-\d{4,6})[_-]([A-Z])[_-]?(\d+)(?:[_-](\d+))?/i)
  const specimenFromPath = pathSpecimen
    ? `${pathSpecimen[1]}-${pathSpecimen[2].toUpperCase()}${pathSpecimen[3]}${pathSpecimen[4] ? `-${pathSpecimen[4]}` : ''}`
    : undefined
  return [
    slide.specimenId || packageMeta.specimenId || specimenFromPath || slide.label,
    packageMeta.stain || slide.stain,
  ].filter(Boolean) as string[]
}

function LegalClinicalNotice({
  logoUrl,
  onConfirm,
  onCancel,
}: {
  logoUrl: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const [acknowledged, setAcknowledged] = useState(false)

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-[#f6f8fd] px-4 py-6 text-[#111827]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-clinical-notice-title"
    >
      <div className="mx-auto h-[calc(100vh-48px)] w-full max-w-[600px]">
        <section className="flex h-full w-full flex-col overflow-y-auto border border-[#c5ccd9] bg-white px-6 py-5 shadow-[0_8px_28px_rgba(15,23,42,0.14)] sm:px-8">
          <div className="flex flex-col items-center text-center">
            <img
              src={logoUrl}
              alt="UHN Laboratory Medicine"
              className="h-auto w-[180px] max-w-full select-none"
              draggable={false}
            />
            <p className="mt-3 text-xs font-bold text-[#050a17]">UHN Laboratory Medicine</p>
            <h1 id="legal-clinical-notice-title" className="mt-2 text-xs uppercase text-[#7b8caf]">
              Legal & Clinical Notice
            </h1>
          </div>

          <div className="mt-7 flex items-center gap-2 border-b border-[#f2c8c8] pb-3 text-[#c60014]">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <h2 className="text-sm font-bold uppercase">Clinical Access Warning</h2>
          </div>

          <div className="mt-4 border-l-4 border-[#d5001c] bg-[#eef4ff] px-5 py-5">
            <div className="space-y-4 text-[13px] leading-5 text-[#252a34]">
              {noticeSections.map((section) => (
                <section key={section.title}>
                  <h3 className="font-bold text-[#080d18]">{section.title}</h3>
                  <p className="mt-1">{section.body}</p>
                </section>
              ))}
            </div>
          </div>

          <label className="mt-5 flex cursor-pointer items-start gap-3 text-[13px] leading-5 text-[#1f2937]">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#1d335c]"
              checked={acknowledged}
              onChange={(event) => {
                setAcknowledged(event.currentTarget.checked)
              }}
            />
            <span>I have read and understand the terms of use and professional interpretation requirements for these medical records.</span>
          </label>

          <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_120px]">
            <button
              type="button"
              className={cn(
                'inline-flex min-h-11 items-center justify-center gap-3 bg-[#1d335c] px-4 py-2 text-xs font-semibold uppercase text-white transition-colors hover:bg-[#12264b] focus:outline-none focus:ring-2 focus:ring-[#1d335c] focus:ring-offset-2',
                !acknowledged && 'cursor-not-allowed opacity-50 hover:bg-[#1d335c]',
              )}
              disabled={!acknowledged}
              onClick={onConfirm}
            >
              <span>Confirm and Continue to Viewer</span>
              <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center justify-center border border-[#c5ccd9] bg-white px-4 py-2 text-xs font-semibold uppercase text-[#111827] transition-colors hover:bg-[#f6f8fd] focus:outline-none focus:ring-2 focus:ring-[#1d335c] focus:ring-offset-2"
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>

          <footer className="mt-auto flex items-center justify-between border-t border-[#e7ebf2] pt-5 text-xs text-[#8393b0]">
            <ShieldCheck className="h-4 w-4" aria-label="Privacy protected" />
            <span>Privacy Policy</span>
          </footer>
        </section>
      </div>
    </div>
  )
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
  const [showLegalNotice, setShowLegalNotice] = useState(true)
  const fallbackThumbDone = useRef<Set<string>>(new Set())
  const embeddedThumbDone = useRef<Set<string>>(new Set())
  const openRequestId = useRef(0)

  const rescan = useCallback(async () => {
    if (!window.wsiApi) {
      return
    }
    setLoading(true)
    setErr(null)
    try {
      const s = await window.wsiApi.rescan()
      setSlides(s)
      fallbackThumbDone.current = new Set()
      embeddedThumbDone.current = new Set()
      setThumbs({})
    } catch (e) {
      setErr(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (showLegalNotice) {
      return
    }
    if (!window.wsiApi) {
      setErr('wsiApi missing (not running in Electron shell)')
      return
    }
    window.wsiApi
      .getInfo()
      .then(setInfo)
      .catch((e) => setErr(String(e)))
    rescan()
  }, [rescan, showLegalNotice])

  const openSlide = useCallback(async (sl: ScannedSlide) => {
    const requestId = openRequestId.current + 1
    openRequestId.current = requestId
    setErr(null)
    if (sl.unsupportedReason) {
      setActive(sl)
      setWsiUrl(null)
      setErr(sl.unsupportedReason)
      return
    }
    setActive(sl)
    try {
      const u = await window.wsiApi.pathToWsiUrl(sl.absolutePath)
      if (openRequestId.current !== requestId) {
        return
      }
      setWsiUrl(u)
    } catch (e) {
      if (openRequestId.current !== requestId) {
        return
      }
      setWsiUrl(null)
      setErr(String(e))
    }
  }, [])

  const handleViewerError = useCallback((e: string) => {
    setErr(e)
  }, [])

  /** Thumbnail: use Evidence sidecar label until selected WSI embedded label is available. */
  useEffect(() => {
    const q = slides.filter((s) => !fallbackThumbDone.current.has(s.id))
    if (!q.length) {
      return
    }
    for (const sl of q) {
      fallbackThumbDone.current.add(sl.id)
    }
    setThumbs((m) => {
      const next = { ...m }
      for (const sl of q) {
        if (!sl.thumbnailDataUrl) {
          next[sl.id] = null
        }
      }
      return next
    })
  }, [slides])

  useEffect(() => {
    if (!active || active.unsupportedReason || embeddedThumbDone.current.has(active.id)) {
      return
    }
    embeddedThumbDone.current.add(active.id)
    void window.wsiApi
      .embeddedLabelThumbnail(active.absolutePath)
      .then((thumbnailDataUrl) => {
        setThumbs((m) => ({
          ...m,
          [active.id]: thumbnailDataUrl || m[active.id] || null,
        }))
      })
      .catch(() => {
        setThumbs((m) => ({
          ...m,
          [active.id]: m[active.id] || null,
        }))
      })
  }, [active])

  return (
    <div className="flex h-screen w-screen min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex h-12 shrink-0 items-center border-b border-border px-3">
        <img
          src={uhnLabsLogoUrl}
          alt="UHN Laboratory Medicine"
          className="h-8 w-auto shrink-0"
          draggable={false}
        />
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
                const rawThumb = thumbs[s.id]
                const evidenceThumb = s.thumbnailDataUrl
                const activeThumb = active?.id === s.id && typeof rawThumb === 'string' ? rawThumb : undefined
                const thumb = activeThumb || evidenceThumb || (rawThumb === null ? null : undefined)
                const isNdpiEmbeddedThumb = Boolean(activeThumb) && s.ext.toLowerCase() === '.ndpi'
                const thumbClassName = activeThumb
                  ? cn('h-full w-full object-cover object-left', isNdpiEmbeddedThumb && 'rotate-90')
                  : 'h-full w-full object-contain'
                const labelLines = slideLabelLines(s)
                const canOpen = !s.unsupportedReason
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        void openSlide(s)
                      }}
                      title={s.unsupportedReason || labelLines.join('\n')}
                      className={cn(
                        'flex w-full flex-col overflow-hidden rounded-lg border p-2 text-left text-xs transition-colors',
                        active?.id === s.id
                          ? 'border-amber-500/80 bg-background'
                          : 'border-border hover:bg-background/80',
                        !canOpen && 'opacity-60',
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="size-14 shrink-0 overflow-hidden rounded bg-background">
                          {typeof thumb === 'string' ? (
                            <img src={thumb} alt="" className={thumbClassName} />
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
            <div className="flex h-full flex-col items-center justify-center gap-6 px-8 text-sm">
              <img
                src={uhnLabsLogoUrl}
                alt=""
                className="w-[min(560px,70vw)] max-w-full select-none opacity-[0.12] grayscale brightness-0"
                draggable={false}
                aria-hidden="true"
              />
              <div className="text-[rgb(0_0_0_/_0.12)]">Select a slide in the sidebar</div>
            </div>
          )}
        </main>
      </div>
      {showLegalNotice && (
        <LegalClinicalNotice
          logoUrl={uhnLabsLogoUrl}
          onConfirm={() => {
            setShowLegalNotice(false)
          }}
          onCancel={() => {
            window.close()
          }}
        />
      )}
    </div>
  )
}
