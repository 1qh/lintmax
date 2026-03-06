import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { cacheDir, sync } from './index.js'

const cwd = process.cwd()
const [, , cmd] = process.argv

const init = () => {
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) {
    process.stderr.write('No package.json found\n')
    process.exit(1)
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
    scripts?: Record<string, string>
    [key: string]: unknown
  }
  const scripts = pkg.scripts ?? {}
  let changed = false

  if (!scripts.fix) {
    scripts.fix = 'lintmax fix'
    changed = true
  }
  if (!scripts.check) {
    scripts.check = 'lintmax check'
    changed = true
  }
  if (changed) {
    pkg.scripts = scripts
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  }

  const tsconfigPath = join(cwd, 'tsconfig.json')
  if (existsSync(tsconfigPath)) {
    try {
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8')) as { extends?: string; [key: string]: unknown }
      if (tsconfig.extends !== 'lintmax/tsconfig') {
        tsconfig.extends = 'lintmax/tsconfig'
        writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`)
      }
    } catch {
      process.stderr.write('tsconfig.json: could not parse, add "extends": "lintmax/tsconfig" manually\n')
    }
  } else
    writeFileSync(tsconfigPath, `${JSON.stringify({ extends: 'lintmax/tsconfig' }, null, 2)}\n`)

  const gitignorePath = join(cwd, '.gitignore')
  const ignoreEntries = ['.cache/', '.eslintcache']
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8')
    const toAdd: string[] = []
    for (const entry of ignoreEntries)
      if (!content.includes(entry))
        toAdd.push(entry)
    if (toAdd.length > 0)
      writeFileSync(gitignorePath, `${content.trimEnd()}\n${toAdd.join('\n')}\n`)
  } else
    writeFileSync(gitignorePath, `${ignoreEntries.join('\n')}\n`)

  process.stdout.write('tsconfig.json  extends lintmax/tsconfig\n')
  process.stdout.write('package.json   "fix": "lintmax fix", "check": "lintmax check"\n')
  process.stdout.write(`.gitignore     ${ignoreEntries.join(', ')}\n`)
  process.stdout.write('\nRun: bun fix\n')
}

if (cmd === 'init') {
  init()
  process.exit(0)
}

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

const eslintArgs = hasEslintConfig ? [] : ['--config', join(dir, 'eslint.config.mjs')]

const sortPkgJson = resolveBin('sort-package-json', 'sort-package-json')
const biomeBin = resolveBin('@biomejs/biome', 'biome')
const oxlintBin = resolveBin('oxlint', 'oxlint')
const eslintBin = resolveBin('eslint', 'eslint')
const prettierBin = resolveBin('prettier', 'prettier')

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
