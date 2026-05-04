import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { detectCrashRecovery, startHeartbeat } from './lib/session-persistence'

async function bootstrap() {
  if (import.meta.env.VITE_TAURI === '1') {
    const { installTauriWsiApi } = await import('./install-tauri-wsi')
    await installTauriWsiApi()
  }
}

function ElectrobunBootstrapGate() {
  const [phase, setPhase] = useState<'boot' | 'ok' | 'fail'>('boot')
  const [failMessage, setFailMessage] = useState('')
  // Detect once, synchronously: was there a fresh heartbeat from a previous
  // page instance? If yes, the WebContent process likely crashed and reloaded
  // us — present this as a brief "Reconnecting…" freeze rather than a cold
  // start so the user does not perceive an app restart.
  const [recovering] = useState(() => detectCrashRecovery())

  useEffect(() => {
    const stopHeartbeat = startHeartbeat()
    let cancelled = false
    void import('./install-electrobun-wsi')
      .then((m) => m.installElectrobunWsiApi())
      .then(() => {
        if (!cancelled) {
          setPhase('ok')
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setFailMessage(err instanceof Error ? err.message : String(err))
        setPhase('fail')
      })
    return () => {
      cancelled = true
      stopHeartbeat()
    }
  }, [])

  if (phase === 'boot') {
    if (recovering) {
      return (
        <div
          className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white px-6 text-center text-sm text-slate-700"
          role="status"
          aria-live="polite"
          aria-label="Reconnecting"
        >
          <div className="h-1 w-64 overflow-hidden rounded-full bg-zinc-200">
            <div className="h-full w-2/5 animate-pulse rounded-full bg-zinc-400" />
          </div>
          <p className="text-xs text-slate-500">Reconnecting…</p>
        </div>
      )
    }
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-white px-6 text-center text-sm text-slate-700">
        <p className="font-medium text-slate-900">Starting WSI Hive…</p>
        <p className="max-w-sm text-xs text-slate-500">Connecting to the Electrobun native shell.</p>
      </div>
    )
  }

  if (phase === 'fail') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white px-6 text-center">
        <p className="text-sm font-medium text-red-900">Could not connect to the app shell</p>
        <pre className="max-w-xl whitespace-pre-wrap text-left font-mono text-xs text-slate-800">{failMessage}</pre>
      </div>
    )
  }

  return <App />
}

void bootstrap()
  .then(() => {
    const el = document.getElementById('root')!
    createRoot(el).render(
      <StrictMode>
        {import.meta.env.VITE_ELECTROBUN === '1' ? <ElectrobunBootstrapGate /> : <App />}
      </StrictMode>,
    )
  })
  .catch((err) => {
    console.error('[wsi-hive] bootstrap failed', err)
    const el = document.getElementById('root')
    if (!el) return
    el.textContent = ''
    const pre = document.createElement('pre')
    pre.style.cssText =
      'padding:16px;font:13px/1.45 system-ui;white-space:pre-wrap;word-break:break-word'
    pre.textContent = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err)
    el.appendChild(pre)
  })
