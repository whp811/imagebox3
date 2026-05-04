/**
 * Run `electrobun build` with the right platform targets.
 * macOS cannot produce Windows Electrobun artifacts — default to the host macOS target only.
 * Override with ELECTROBUN_TARGETS (comma-separated), e.g. macos-arm64,macos-x64
 */
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
const cli = path.join(root, 'node_modules/electrobun/bin/electrobun.cjs')

const envName = process.env.ELECTROBUN_ENV || 'stable'
let targets = process.env.ELECTROBUN_TARGETS
if (!targets && process.platform === 'darwin') {
  targets = process.arch === 'arm64' ? 'macos-arm64' : 'macos-x64'
}

const args = [cli, 'build', `--env=${envName}`]
if (targets) {
  args.push(`--targets=${targets}`)
}

const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: root, env: process.env })
if (r.error) {
  console.error(r.error.message)
  process.exit(1)
}
process.exit(r.status ?? 1)
