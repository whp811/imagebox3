/**
 * Electrobun loads views://renderer/index.html from the copied dist bundle.
 * Running `electrobun dev` without a prior Vite build leaves that tree empty → blank window.
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const root = path.join(__dirname, '..')
const indexHtml = path.join(root, 'dist-electrobun', 'index.html')

let needBuild = false
try {
  fs.accessSync(indexHtml, fs.constants.R_OK)
} catch {
  needBuild = true
}

function electobunCspNeedsRebuild() {
  try {
    const html = fs.readFileSync(indexHtml, 'utf8')
    // Electrobun RPC uses ws://localhost; WKWebView connect-src must allow ws: explicitly.
    return !html.includes('ws://localhost:*')
  } catch {
    return true
  }
}

function electobunHtmlCrossoriginStale() {
  try {
    const html = fs.readFileSync(indexHtml, 'utf8')
    // views:// + crossorigin module tags often yields a blank WKWebView (no CORS on custom scheme).
    return /\scrossorigin/i.test(html)
  } catch {
    return true
  }
}

if (!needBuild && electobunHtmlCrossoriginStale()) {
  needBuild = true
}

if (!needBuild && electobunCspNeedsRebuild()) {
  needBuild = true
}

if (needBuild) {
  console.warn(
    '[wsi-hive] Electrobun renderer missing or outdated (dist-electrobun/index.html); running npm run electrobun:renderer…',
  )
  execSync('npm run electrobun:renderer', { cwd: root, stdio: 'inherit' })
}

try {
  fs.accessSync(indexHtml, fs.constants.R_OK)
} catch {
  console.error('[wsi-hive] Electrobun renderer build did not produce dist-electrobun/index.html.')
  process.exit(1)
}
