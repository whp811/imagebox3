/**
 * Crash-recovery / session persistence.
 *
 * In Electrobun (WKWebView) a renderer OOM crash causes the WebContent process
 * to die and the page to auto-reload. To the user that looks like a full app
 * restart: legal notice reappears, active slide disappears. We persist enough
 * state in localStorage to (a) auto-skip the legal notice when we recently
 * accepted, and (b) re-open the previously active slide. A periodic heartbeat
 * lets the bootstrap gate detect a recent crash and show a "Reconnecting…"
 * splash instead of the cold-start UI.
 */

const STORAGE_PREFIX = 'wsi-hive:'
const HEARTBEAT_KEY = `${STORAGE_PREFIX}heartbeat`
const LEGAL_KEY = `${STORAGE_PREFIX}legal-accepted-at`
const ACTIVE_SLIDE_KEY = `${STORAGE_PREFIX}active-slide-id`
const SLIDES_FOLDER_KEY = `${STORAGE_PREFIX}slides-folder`
const SIDEBAR_KEY = `${STORAGE_PREFIX}sidebar-open`

const HEARTBEAT_INTERVAL_MS = 4_000
// If the last heartbeat is fresher than this, we treat the page load as a
// crash recovery rather than a cold start. Sized to span a typical WKWebView
// auto-recovery window (the page reloads almost immediately).
const RECOVERY_WINDOW_MS = 60_000
// Legal-notice acceptance is sticky for this long. Long enough to span the
// portable thumb-drive viewing session, short enough to be re-prompted in a
// truly new session a few days later.
const LEGAL_ACK_TTL_MS = 24 * 60 * 60 * 1000

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* private mode / quota */
  }
}

function safeDel(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* */
  }
}

export function startHeartbeat(): () => void {
  const tick = () => safeSet(HEARTBEAT_KEY, String(Date.now()))
  tick()
  const id = window.setInterval(tick, HEARTBEAT_INTERVAL_MS)
  // Clear the marker on graceful page teardown so a clean app quit followed
  // by a quick relaunch does not look like a crash recovery. WebContent
  // process *crashes* skip pagehide/beforeunload, so this only fires on
  // intentional close.
  const onTeardown = () => {
    safeDel(HEARTBEAT_KEY)
  }
  window.addEventListener('pagehide', onTeardown)
  window.addEventListener('beforeunload', onTeardown)
  return () => {
    window.clearInterval(id)
    window.removeEventListener('pagehide', onTeardown)
    window.removeEventListener('beforeunload', onTeardown)
  }
}

/** True iff a heartbeat was written very recently — i.e. the previous page
 *  instance died unexpectedly and the WebView reloaded us. */
export function detectCrashRecovery(): boolean {
  const raw = safeGet(HEARTBEAT_KEY)
  if (!raw) return false
  const last = Number.parseInt(raw, 10)
  if (!Number.isFinite(last)) return false
  return Date.now() - last <= RECOVERY_WINDOW_MS
}

export function clearCrashRecoveryMarker(): void {
  safeDel(HEARTBEAT_KEY)
}

export function rememberLegalAcceptance(): void {
  safeSet(LEGAL_KEY, String(Date.now()))
}

export function legalAcceptanceFresh(): boolean {
  const raw = safeGet(LEGAL_KEY)
  if (!raw) return false
  const at = Number.parseInt(raw, 10)
  if (!Number.isFinite(at)) return false
  return Date.now() - at <= LEGAL_ACK_TTL_MS
}

export function rememberActiveSlide(id: string | null): void {
  if (id) safeSet(ACTIVE_SLIDE_KEY, id)
  else safeDel(ACTIVE_SLIDE_KEY)
}

export function readActiveSlide(): string | null {
  return safeGet(ACTIVE_SLIDE_KEY)
}

export function rememberSlidesFolder(path: string | null): void {
  if (path) safeSet(SLIDES_FOLDER_KEY, path)
  else safeDel(SLIDES_FOLDER_KEY)
}

export function readSlidesFolder(): string | null {
  return safeGet(SLIDES_FOLDER_KEY)
}

export function rememberSidebar(open: boolean): void {
  safeSet(SIDEBAR_KEY, open ? '1' : '0')
}

export function readSidebar(): boolean {
  const raw = safeGet(SIDEBAR_KEY)
  if (raw == null) return true
  return raw !== '0'
}
