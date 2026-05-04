import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FolderOpen,
  Hand,
  MousePointer2,
  PanelLeft,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  X,
  ZoomIn,
} from 'lucide-react'
import { parseSlidePackageName } from '../shared/slide-package-meta'
import type { PickSlidesFolderResult, ScannedSlide, SlidesInfo } from '../shared/types'
import { WsiOsdView } from './components/WsiOsdView'
import { cn } from './lib/utils'
import {
  legalAcceptanceFresh,
  readActiveSlide,
  readSidebar,
  rememberActiveSlide,
  rememberLegalAcceptance,
  rememberSidebar,
} from './lib/session-persistence'

const uhnLabsLogoUrl = `${import.meta.env.BASE_URL || './'}logo-Labs.svg`
const runtimeThumbnailStringLimit = import.meta.env.VITE_ELECTROBUN === '1' ? 24 : 120

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

function capRuntimeThumbnailStrings(map: Record<string, string | null>) {
  const stringKeys = Object.keys(map).filter((key) => typeof map[key] === 'string')
  if (stringKeys.length <= runtimeThumbnailStringLimit) {
    return map
  }
  const next = { ...map }
  for (const key of stringKeys.slice(0, stringKeys.length - runtimeThumbnailStringLimit)) {
    delete next[key]
  }
  return next
}

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
      className="fixed inset-0 z-50 bg-white text-[#111827]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-clinical-notice-title"
    >
      <div className="mx-auto h-screen w-full max-w-[600px]">
        <section className="flex h-full w-full flex-col overflow-y-auto border-x border-[#c5ccd9] bg-white px-6 pb-5 pt-9 sm:px-8 sm:pt-10">
          <div className="flex flex-col items-center text-center">
            <img
              src={logoUrl}
              alt="UHN Laboratory Medicine"
              className="h-auto w-[220px] max-w-full select-none"
              draggable={false}
            />
            <h1 id="legal-clinical-notice-title" className="mt-2 text-xs uppercase text-[#7b8caf]">
              Legal & Clinical Notice
            </h1>
          </div>

          <div className="mt-7 flex items-center gap-2 border-b border-[#f2c8c8] pb-3 text-[#c60014]">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <h2 className="text-sm font-bold uppercase">LEGAL AND CLINICAL ACCESS WARNING</h2>
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

function UsageGuide({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/45 px-4 py-6 text-[#111827]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="usage-guide-title"
    >
      <section className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[#c5ccd9] bg-white shadow-[0_16px_40px_rgba(15,23,42,0.22)]">
        <header className="flex shrink-0 items-center gap-3 border-b border-[#e4e8f0] px-5 py-4">
          <CircleHelp className="h-5 w-5 shrink-0 text-[#1d335c]" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id="usage-guide-title" className="text-sm font-bold">How to use WSI Hive</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Select, then inspect your whole-slide images.</p>
          </div>
          <button
            type="button"
            className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card transition-colors hover:bg-background focus:outline-none focus:ring-2 focus:ring-[#1d335c] focus:ring-offset-2"
            aria-label="Close how to use guide"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto p-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-[#d9dde2] bg-[#f6f7f8] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase text-[#4f565d]">
                <PanelLeft className="h-4 w-4" aria-hidden="true" />
                Pick a Slide
              </div>
              <div className="mt-4 grid min-h-32 grid-cols-[72px_1fr] overflow-hidden rounded-md border border-[#dfe3e8] bg-white">
                <div className="space-y-2 border-r border-[#e4e7eb] p-2">
                  <div className="rounded border border-[#d0c5ad] bg-[#f2eee5] p-1">
                    <div className="h-8 rounded bg-[#dcdee0]" />
                    <div className="mt-1 h-1.5 rounded bg-[#5f6468]" />
                  </div>
                  <div className="rounded border border-[#dfe3e8] p-1">
                    <div className="h-8 rounded bg-[#e1e4df]" />
                  </div>
                </div>
                <div className="grid place-items-center bg-white">
                  <MousePointer2 className="h-10 w-10 text-[#5f6468]" aria-hidden="true" />
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-[#4b5563]">Choose a slide thumbnail in the sidebar to open it in the viewer.</p>
            </section>

            <section className="rounded-lg border border-[#d9dde2] bg-[#f6f7f8] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase text-[#4f565d]">
                <ScanSearch className="h-4 w-4" aria-hidden="true" />
                Inspect
              </div>
              <div className="mt-4 rounded-md border border-[#dfe3e8] bg-white p-3">
                <div className="relative h-28 overflow-hidden rounded bg-[#f7f7f7]">
                  <div className="absolute left-5 top-4 h-16 w-28 rotate-[-8deg] rounded-full border-4 border-[#dcdee0] bg-[#f2eee5]" />
                  <div className="absolute bottom-4 right-5 h-12 w-20 rotate-[10deg] rounded-full border-4 border-[#e1e4df] bg-[#eadfd3]" />
                  <div className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#5f6468] bg-white/70" />
                </div>
                <div className="mt-3 flex items-center justify-center gap-3 text-[#5f6468]">
                  <ZoomIn className="h-5 w-5" aria-label="Zoom" />
                  <Hand className="h-5 w-5" aria-label="Pan" />
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-[#4b5563]">Scroll to zoom. Drag to pan across the tissue. Use full screen for more room.</p>
            </section>
          </div>
        </div>
      </section>
    </div>
  )
}

export default function App() {
  const platform = window.wsiApi?.platform
  const [info, setInfo] = useState<SlidesInfo | null>(null)
  const [slides, setSlides] = useState<ScannedSlide[]>([])
  const [loading, setLoading] = useState(true)
  const [sidebar, setSidebar] = useState<boolean>(() => readSidebar())
  const [showSlidesRoot, setShowSlidesRoot] = useState(false)
  const [active, setActive] = useState<ScannedSlide | null>(null)
  const [wsiUrl, setWsiUrl] = useState<string | null>(null)
  const [openingSlide, setOpeningSlide] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({})
  // Skip the legal notice if it was already accepted recently (e.g. after a
  // WebContent-process crash auto-reload). Avoids the user perceiving the
  // recovery as a full app restart.
  const [showLegalNotice, setShowLegalNotice] = useState<boolean>(() => !legalAcceptanceFresh())
  const [showUsageGuide, setShowUsageGuide] = useState(false)
  const [showChangeFolderUnlocked, setShowChangeFolderUnlocked] = useState(false)
  const fallbackThumbDone = useRef<Set<string>>(new Set())
  const embeddedThumbDone = useRef<Set<string>>(new Set())
  const openRequestId = useRef(0)
  const folderSecretTapCountRef = useRef(0)
  const folderSecretTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restoreAttemptedRef = useRef(false)

  useEffect(() => {
    return () => {
      if (folderSecretTapTimerRef.current) {
        clearTimeout(folderSecretTapTimerRef.current)
      }
    }
  }, [])

  const registerFolderSecretTap = useCallback(() => {
    if (folderSecretTapTimerRef.current) {
      clearTimeout(folderSecretTapTimerRef.current)
    }
    folderSecretTapCountRef.current += 1
    if (folderSecretTapCountRef.current >= 7) {
      folderSecretTapCountRef.current = 0
      setShowChangeFolderUnlocked(true)
    } else {
      folderSecretTapTimerRef.current = setTimeout(() => {
        folderSecretTapCountRef.current = 0
      }, 2000)
    }
  }, [])

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

  const changeScannedFolderPath = useCallback(async () => {
    const api = window.wsiApi
    if (!api) {
      return
    }
    try {
      let r: PickSlidesFolderResult
      if (typeof api.pickSlidesFolder === 'function') {
        r = await api.pickSlidesFolder()
      } else if (typeof api.invoke === 'function') {
        r = (await api.invoke('slides:pickSlidesFolder')) as PickSlidesFolderResult
      } else {
        setErr(
          `Folder picker unavailable (stale Electron preload). wsiApi: ${Object.keys(api).join(', ')}. Quit the app, then in wsi-viewer run: npm run build, or npm run dev`,
        )
        return
      }
      if (r.cancelled) {
        return
      }
      setInfo(r.info)
      setActive(null)
      setWsiUrl(null)
      setOpeningSlide(false)
      rememberActiveSlide(null)
      restoreAttemptedRef.current = true
      await rescan()
    } catch (e) {
      setErr(String(e))
    }
  }, [rescan])

  useEffect(() => {
    if (showLegalNotice) {
      return
    }
    if (!window.wsiApi) {
      setErr('wsiApi missing (not running in a desktop shell)')
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
      setOpeningSlide(false)
      setErr(sl.unsupportedReason)
      rememberActiveSlide(null)
      return
    }
    setActive(sl)
    setWsiUrl(null)
    setOpeningSlide(true)
    rememberActiveSlide(sl.id)
    try {
      const u = await window.wsiApi.pathToWsiUrl(sl.absolutePath)
      if (openRequestId.current !== requestId) {
        return
      }
      setWsiUrl(u)
      setOpeningSlide(false)
    } catch (e) {
      if (openRequestId.current !== requestId) {
        return
      }
      setWsiUrl(null)
      setOpeningSlide(false)
      setErr(String(e))
    }
  }, [])

  const handleViewerError = useCallback((e: string) => {
    setOpeningSlide(false)
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
    rememberSidebar(sidebar)
  }, [sidebar])

  /** After a crash auto-recovery, re-open the previously active slide so the
   *  user perceives a brief freeze rather than a full app reset. Runs once
   *  per mount, after the first scan completes. */
  useEffect(() => {
    if (restoreAttemptedRef.current) return
    if (loading) return
    if (active) return
    if (showLegalNotice) return
    const lastId = readActiveSlide()
    if (!lastId) {
      restoreAttemptedRef.current = true
      return
    }
    const match = slides.find((s) => s.id === lastId)
    restoreAttemptedRef.current = true
    if (match && !match.unsupportedReason) {
      void openSlide(match)
    } else {
      rememberActiveSlide(null)
    }
  }, [loading, slides, active, showLegalNotice, openSlide])

  useEffect(() => {
    if (!active || active.unsupportedReason || embeddedThumbDone.current.has(active.id)) {
      return
    }
    if (active.thumbnailDataUrl) {
      embeddedThumbDone.current.add(active.id)
      return
    }
    embeddedThumbDone.current.add(active.id)
    void window.wsiApi
      .embeddedLabelThumbnail(active.absolutePath)
      .then((thumbnailDataUrl) => {
        setThumbs((m) => {
          const next = { ...m }
          delete next[active.id]
          next[active.id] = thumbnailDataUrl || m[active.id] || null
          return capRuntimeThumbnailStrings(next)
        })
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
      <header
        className={cn(
          'app-drag flex h-12 shrink-0 items-center border-b border-border px-3',
          platform === 'darwin' && 'pl-[88px]',
          platform === 'win32' && 'pr-[150px]',
        )}
      >
        <img
          src={uhnLabsLogoUrl}
          alt="UHN Laboratory Medicine"
          className="h-8 w-auto shrink-0"
          draggable={false}
        />
        <div className="app-no-drag ml-auto flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-md border border-border bg-card px-2 text-xs transition-colors hover:bg-background focus:outline-none focus:ring-2 focus:ring-[#1d335c] focus:ring-offset-2"
            aria-label="Show how to use WSI Hive"
            onClick={() => {
              setShowUsageGuide(true)
            }}
          >
            <CircleHelp className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            How to use
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-md border border-border bg-card px-2 text-xs transition-colors hover:bg-background focus:outline-none focus:ring-2 focus:ring-[#1d335c] focus:ring-offset-2"
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
                <div className="flex flex-wrap items-center gap-0.5">
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-background"
                    title={showSlidesRoot ? 'Hide slides folder path' : info.slidesRoot}
                    aria-label="Toggle slides folder path"
                    onClick={() => {
                      registerFolderSecretTap()
                      setShowSlidesRoot((show) => !show)
                    }}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </button>
                  {showChangeFolderUnlocked && (
                    <button
                      type="button"
                      className="rounded border border-border/70 bg-background px-1 py-px text-[9px] leading-tight text-muted-foreground hover:bg-background/80"
                      title="Pick a different folder to scan for slides (this session only)"
                      onClick={() => {
                        void changeScannedFolderPath()
                      }}
                    >
                      change folder path
                    </button>
                  )}
                </div>
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
          ) : openingSlide ? (
            <div className="flex h-full items-center justify-center px-8" role="status" aria-live="polite" aria-label="Loading slide">
              <div className="h-1 w-64 overflow-hidden rounded-full bg-[#dfe5ee]">
                <div className="h-full w-2/5 animate-pulse rounded-full bg-[#6b7890]" />
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-6 px-8 text-sm">
              <img
                src={uhnLabsLogoUrl}
                alt=""
                className="w-[min(560px,70vw)] max-w-full select-none opacity-[0.12] grayscale brightness-0"
                draggable={false}
                aria-hidden="true"
              />
              <div className="text-[rgb(0_0_0_/_0.28)]">Select a slide in the sidebar</div>
            </div>
          )}
        </main>
      </div>
      {showUsageGuide && (
        <UsageGuide
          onClose={() => {
            setShowUsageGuide(false)
          }}
        />
      )}
      {showLegalNotice && (
        <LegalClinicalNotice
          logoUrl={uhnLabsLogoUrl}
          onConfirm={() => {
            rememberLegalAcceptance()
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
