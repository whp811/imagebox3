/**
 * Electrobun macOS builds read PNGs from an .iconset folder (see electrobun.config.ts).
 * Electron uses build/icon.icns — keep one source: generate the iconset from that .icns on macOS.
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const root = path.join(__dirname, '..')
const icns = path.join(root, 'build', 'icon.icns')
const iconset = path.join(root, 'build', 'icon.iconset')

if (process.platform === 'darwin') {
  if (!fs.existsSync(icns)) {
    console.error(`Missing ${icns}; cannot build Electrobun mac iconset.`)
    process.exit(1)
  }
  fs.rmSync(iconset, { recursive: true, force: true })
  execSync(`iconutil -c iconset "${icns}" -o "${iconset}"`, { stdio: 'inherit', cwd: root })
}

// Windows/Linux hosts do not run iconutil; Electrobun only needs this folder when producing a macOS .app.
process.exit(0)
