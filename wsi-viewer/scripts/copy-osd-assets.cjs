const { cpSync, existsSync, mkdirSync } = require('node:fs')
const { join, dirname } = require('node:path')

const root = join(__dirname, '..')
const src = join(root, 'node_modules/openseadragon/build/openseadragon/images')
const dest = join(root, 'public/osd/images')
if (existsSync(src)) {
  mkdirSync(dirname(dest), { recursive: true })
  try {
    cpSync(src, dest, { recursive: true })
  } catch (e) {
    console.warn('copy-osd-assets', e)
  }
}
