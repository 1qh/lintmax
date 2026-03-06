import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { cacheDir, sync } from './index.js'

const cwd = process.cwd()
const dir = join(cwd, cacheDir)
mkdirSync(dir, { recursive: true })

const lintmaxNm = join(import.meta.dirname, '..', 'node_modules')
const resolveBin = (pkg: string, bin: string): string => {
  const candidates = [join(lintmaxNm, pkg), join(cwd, 'node_modules', pkg)]
  let pkgDir = ''
  for (const candidate of candidates)
    if (existsSync(join(candidate, 'package.json'))) {
      pkgDir = candidate
      break
    }
  if (!pkgDir) throw new Error(`Cannot find package: ${pkg}`)
  const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8')) as { bin?: Record<string, string> | string }
  const binPath = typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin?.[bin] ?? ''
  return join(pkgDir, binPath)
}

const pkgBinDir = join(import.meta.dirname, '..', 'node_modules', '.bin')
const cwdBinDir = join(cwd, 'node_modules', '.bin')
/** biome-ignore lint/style/noProcessEnv: cli reads environment */
const env = { ...process.env, PATH: `${pkgBinDir}:${cwdBinDir}:${process.env.PATH ?? ''}` }

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
  run('bun', ['-e', `const m = await import('${configPath}'); if (m.default) { const { sync: s } = await import('lintmax'); s(m.default); }`], true)
else
  sync()

const hasEslintConfig = existsSync(join(cwd, 'eslint.config.ts'))
  || existsSync(join(cwd, 'eslint.config.js'))
  || existsSync(join(cwd, 'eslint.config.mjs'))

const eslintArgs: string[] = []
if (!hasEslintConfig) {
  const generatedEslintConfig = join(dir, 'eslint.config.mjs')
  writeFileSync(generatedEslintConfig, "export { default } from 'lintmax/eslint'\n")
  eslintArgs.push('--config', generatedEslintConfig)
}

const sortPkgJson = resolveBin('sort-package-json', 'sort-package-json')
const biomeBin = resolveBin('@biomejs/biome', 'biome')
const oxlintBin = resolveBin('oxlint', 'oxlint')
const eslintBin = resolveBin('eslint', 'eslint')
const prettierBin = resolveBin('prettier', 'prettier')

const [, , cmd] = process.argv

const prettierMd = ['--single-quote', '--no-semi', '--trailing-comma', 'none', '--print-width', '80', '--arrow-parens', 'avoid', '--tab-width', '2', '--prose-wrap', 'preserve']
const hasFlowmark = spawnSync('which', ['flowmark'], { stdio: 'pipe', env }).status === 0

if (cmd === 'fix') {
  run('node', [sortPkgJson, '**/package.json'], true)
  run(biomeBin, ['check', '--config-path', dir, '--fix', '--diagnostic-level=error'], true)
  run(oxlintBin, ['-c', join(dir, '.oxlintrc.json'), '--fix', '--fix-suggestions', '--quiet'], true)
  run('node', [eslintBin, ...eslintArgs, '--fix', '--cache', '--cache-location', join(cwd, '.cache', '.eslintcache')], true)
  run(biomeBin, ['check', '--config-path', dir, '--fix', '--diagnostic-level=error'], true)
  run('node', [prettierBin, ...prettierMd, '--write', '**/*.md'], true)
  if (hasFlowmark) run('flowmark', ['--auto', '.'], true)
} else if (cmd === 'check') {
  run('node', [sortPkgJson, '--check', '**/package.json'])
  run(biomeBin, ['ci', '--config-path', dir, '--diagnostic-level=error'])
  run(oxlintBin, ['-c', join(dir, '.oxlintrc.json'), '--quiet'])
  run('node', [eslintBin, ...eslintArgs, '--cache', '--cache-location', join(cwd, '.cache', '.eslintcache')])
  run('node', [prettierBin, ...prettierMd, '--check', '**/*.md'])
}
