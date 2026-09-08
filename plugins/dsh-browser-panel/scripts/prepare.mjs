// Best-effort prepare for git/local installs.
// This repo commits prebuilt lib/, so a missing local tsdown is not fatal;
// when tsdown is available (after a dev install), rebuild from source.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const binName = process.platform === 'win32' ? 'tsdown.cmd' : 'tsdown'
const tsdown = join(root, 'node_modules', '.bin', binName)

if (!existsSync(tsdown)) {
  console.warn('prepare: tsdown not found; keeping committed lib/ (run `npm install` then `npm run build` to rebuild).')
  process.exit(0)
}

const result = spawnSync(tsdown, ['-c', join(root, 'tsdown.config.mjs')], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
process.exit(result.status ?? 1)
