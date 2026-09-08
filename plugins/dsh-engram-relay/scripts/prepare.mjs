// Minimal prepare bridge so git installs do not need a full DSH checkout.
// It invokes tsdown directly; `npm run build` is the full typed build.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const binName = process.platform === 'win32' ? 'tsdown.cmd' : 'tsdown'
const tsdown = join(root, 'node_modules', '.bin', binName)

if (!existsSync(tsdown)) {
  console.warn('prepare: tsdown not found; keeping committed lib/ (run `npm install --legacy-peer-deps` then `npm run build` to rebuild).')
  process.exit(0)
}

const result = spawnSync(tsdown, ['--config', join(root, 'tsdown.config.mjs')], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
process.exit(result.status ?? 1)
