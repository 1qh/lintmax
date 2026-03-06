import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { cacheDir, sync } from './index.js'

const cwd = process.cwd()
const dir = join(cwd, cacheDir)
const binDir = join(cwd, 'node_modules', '.bin')
/** biome-ignore lint/style/noProcessEnv: cli reads environment */
const env = { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` }

const run = (command: string, args: string[], silent = false): void => {
  const result = spawnSync(command, args, { stdio: silent ? 'pipe' : 'inherit', cwd, env })
  if (result.status !== 0) {
    if (silent) {
      if (result.stdout.length > 0) process.stderr.write(result.stdout)
      if (result.stderr.length > 0) process.stderr.write(result.stderr)
    }
    process.exit(result.status ?? 1)
  }
}

const configPath = join(cwd, 'lintmax.config.ts')
if (existsSync(configPath))
  run('bun', [configPath], true)
else
  sync()

const [, , cmd] = process.argv

const prettierMd = ['--single-quote', '--no-semi', '--trailing-comma', 'none', '--print-width', '80', '--arrow-parens', 'avoid', '--tab-width', '2', '--prose-wrap', 'preserve']
const hasFlowmark = spawnSync('which', ['flowmark'], { stdio: 'pipe', env }).status === 0

if (cmd === 'fix') {
  run('biome', ['check', '--config-path', dir, '--fix', '--diagnostic-level=error'], true)
  run('oxlint', ['-c', join(dir, '.oxlintrc.json'), '--fix', '--fix-suggestions', '--quiet'], true)
  run('eslint', ['--fix', '--cache', '--cache-location', join(cwd, '.cache', '.eslintcache')], true)
  run('biome', ['check', '--config-path', dir, '--fix', '--diagnostic-level=error'], true)
  run('prettier', [...prettierMd, '--write', '**/*.md'], true)
  if (hasFlowmark) run('flowmark', ['--auto', '.'], true)
} else if (cmd === 'check') {
  run('biome', ['ci', '--config-path', dir, '--diagnostic-level=error'])
  run('oxlint', ['-c', join(dir, '.oxlintrc.json'), '--quiet'])
  run('eslint', ['--cache', '--cache-location', join(cwd, '.cache', '.eslintcache')])
  run('prettier', [...prettierMd, '--check', '**/*.md'])
}
