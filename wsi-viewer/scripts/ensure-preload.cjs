/**
 * Fresh renderer + stale out/preload causes "pickSlidesFolder is not a function".
 * Predev: rebuild when preload bundle is missing or predates the folder-picker API.
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const root = path.join(__dirname, '..')
const preloadPath = path.join(root, 'out/preload/index.mjs')
const marker = 'pickSlidesFolder'

let needBuild = false
try {
  const src = fs.readFileSync(preloadPath, 'utf8')
  if (!src.includes(marker)) {
    needBuild = true
  }
} catch {
  needBuild = true
}

if (needBuild) {
  console.warn('[wsi-hive] Preload bundle missing or outdated; running npm run build…')
  execSync('npm run build', { cwd: root, stdio: 'inherit' })
}
