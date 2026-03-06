import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { cacheDir, sync } from './index.js'

const cwd = process.cwd()
const [, , cmd] = process.argv

const sortKeys = (obj: Record<string, unknown>): Record<string, unknown> => {
  const sorted: Record<string, unknown> = {}
  const keys = Object.keys(obj).sort()
  for (const key of keys)
    sorted[key] = obj[key]
  return sorted
}

const readJson = (path: string): Record<string, unknown> => {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

const writeJson = (path: string, data: Record<string, unknown>) =>
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)

const init = () => {
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) {
    process.stderr.write('No package.json found\n')
    process.exit(1)
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
    scripts?: Record<string, string>
    workspaces?: string[]
    [key: string]: unknown
  }

  const scripts = pkg.scripts ?? {}
  let pkgChanged = false
  if (!scripts.fix) {
    scripts.fix = 'lintmax fix'
    pkgChanged = true
  }
  if (!scripts.check) {
    scripts.check = 'lintmax check'
    pkgChanged = true
  }
  if (pkgChanged) {
    pkg.scripts = scripts
    writeJson(pkgPath, pkg)
  }

  const tsconfigPath = join(cwd, 'tsconfig.json')
  const configFiles: string[] = []
  if (existsSync(join(cwd, 'eslint.config.ts'))) configFiles.push('eslint.config.ts')
  if (existsSync(join(cwd, 'lintmax.config.ts'))) configFiles.push('lintmax.config.ts')

  if (existsSync(tsconfigPath)) {
    try {
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8')) as {
        extends?: string
        include?: string[]
        [key: string]: unknown
      }
      let tsconfigChanged = false
      if (tsconfig.extends !== 'lintmax/tsconfig') {
        tsconfig.extends = 'lintmax/tsconfig'
        tsconfigChanged = true
      }
      if (configFiles.length > 0) {
        const current = tsconfig.include ?? []
        const toAdd: string[] = []
        for (const f of configFiles)
          if (!current.includes(f))
            toAdd.push(f)
        if (toAdd.length > 0) {
          tsconfig.include = [...current, ...toAdd]
          tsconfigChanged = true
        }
      }
      if (tsconfigChanged)
        writeJson(tsconfigPath, tsconfig)
    } catch {
      process.stderr.write('tsconfig.json: could not parse, add "extends": "lintmax/tsconfig" manually\n')
    }
  } else {
    const tsconfig: Record<string, unknown> = { extends: 'lintmax/tsconfig' }
    if (configFiles.length > 0) tsconfig.include = configFiles
    writeJson(tsconfigPath, tsconfig)
  }

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

  const vscodePath = join(cwd, '.vscode')
  mkdirSync(vscodePath, { recursive: true })

  const settingsPath = join(vscodePath, 'settings.json')
  const settings = readJson(settingsPath)

  settings['biome.configPath'] = 'node_modules/.cache/lintmax/biome.json'
  const formatterLangs = ['css', 'graphql', 'javascript', 'javascriptreact', 'json', 'jsonc', 'typescript', 'typescriptreact']
  for (const lang of formatterLangs) {
    const key = `[${lang}]`
    const existing = (settings[key] ?? {}) as Record<string, unknown>
    settings[key] = { ...existing, 'editor.defaultFormatter': 'biomejs.biome' }
  }
  const existingActions = (settings['editor.codeActionsOnSave'] ?? {}) as Record<string, unknown>
  settings['editor.codeActionsOnSave'] = {
    ...existingActions,
    'source.fixAll.biome': 'always',
    'source.fixAll.eslint': 'always',
    'source.organizeImports.biome': 'always'
  }
  settings['editor.formatOnSave'] = true
  settings['eslint.rules.customizations'] = [{ rule: '*', severity: 'warn' }]
  settings['typescript.tsdk'] = 'node_modules/typescript/lib'

  if (pkg.workspaces && !settings['eslint.workingDirectories']) {
    const dirs: Array<{ pattern: string }> = []
    for (const ws of pkg.workspaces) {
      const pattern = ws.endsWith('/') ? ws : `${ws}/`
      dirs.push({ pattern })
    }
    if (dirs.length > 0)
      settings['eslint.workingDirectories'] = dirs
  }

  writeJson(settingsPath, sortKeys(settings))

  const extensionsPath = join(vscodePath, 'extensions.json')
  const extJson = readJson(extensionsPath) as { recommendations?: string[]; [key: string]: unknown }
  const recommendations = ['biomejs.biome', 'dbaeumer.vscode-eslint']
  const currentRecs = extJson.recommendations ?? []
  const recsToAdd: string[] = []
  for (const rec of recommendations)
    if (!currentRecs.includes(rec))
      recsToAdd.push(rec)
  if (recsToAdd.length > 0 || !extJson.recommendations) {
    extJson.recommendations = [...currentRecs, ...recsToAdd]
    writeJson(extensionsPath, extJson)
  }

  const legacyConfigs = ['.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yml', '.eslintrc.yaml', '.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.yml', '.prettierrc.yaml', '.prettierrc.toml', 'biome.json', 'biome.jsonc', '.oxlintrc.json']
  const foundLegacy: string[] = []
  for (const f of legacyConfigs)
    if (existsSync(join(cwd, f)))
      foundLegacy.push(f)

  process.stdout.write('tsconfig.json    extends lintmax/tsconfig')
  if (configFiles.length > 0)
    process.stdout.write(`, include: ${configFiles.join(', ')}`)
  process.stdout.write('\n')
  process.stdout.write('package.json     "fix": "lintmax fix", "check": "lintmax check"\n')
  process.stdout.write(`.gitignore       ${ignoreEntries.join(', ')}\n`)
  process.stdout.write('.vscode/settings biome formatter, codeActionsOnSave, eslint, typescript\n')
  process.stdout.write('.vscode/ext      biomejs.biome, dbaeumer.vscode-eslint\n')
  if (foundLegacy.length > 0)
    process.stdout.write(`\nLegacy configs found (can be removed): ${foundLegacy.join(', ')}\n`)
  process.stdout.write('\nRun: bun fix\n')
}

const version = '0.1.0'

const usage = () => {
  process.stdout.write(`lintmax v${version}\n\n`)
  process.stdout.write('Usage: lintmax <command>\n\n')
  process.stdout.write('Commands:\n')
  process.stdout.write('  init     Scaffold config files for a new project\n')
  process.stdout.write('  fix      Auto-fix and format all files\n')
  process.stdout.write('  check    Check all files without modifying\n')
  process.stdout.write('  --version  Show version\n')
}

if (cmd === 'init') {
  init()
  process.exit(0)
}

if (cmd === '--version' || cmd === '-v') {
  process.stdout.write(`${version}\n`)
  process.exit(0)
}

if (cmd !== 'fix' && cmd !== 'check') {
  usage()
  process.exit(cmd === '--help' || cmd === '-h' ? 0 : 1)
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
  if (!pkgDir) {
    process.stderr.write(`Cannot find ${pkg} — run: bun add -d lintmax\n`)
    process.exit(1)
  }
  const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8')) as { bin?: Record<string, string> | string }
  const binPath = typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin?.[bin] ?? ''
  return join(pkgDir, binPath)
}

const pkgBinDir = join(import.meta.dirname, '..', 'node_modules', '.bin')
const cwdBinDir = join(cwd, 'node_modules', '.bin')
/** biome-ignore lint/style/noProcessEnv: cli reads environment */
const env = { ...process.env, PATH: `${pkgBinDir}:${cwdBinDir}:${process.env.PATH ?? ''}` }

const run = (label: string, command: string, args: string[], silent = false): void => {
  const result = spawnSync(command, args, { stdio: silent ? 'pipe' : 'inherit', cwd, env })
  if (result.status !== 0) {
    if (silent) {
      process.stderr.write(`[${label}]\n`)
      if (result.stdout.length > 0) process.stderr.write(result.stdout)
      if (result.stderr.length > 0) process.stderr.write(result.stderr)
    }
    process.exit(result.status ?? 1)
  }
}

const configPath = join(cwd, 'lintmax.config.ts')
if (existsSync(configPath))
  run('config', 'bun', ['-e', `const m = await import('${configPath}'); if (m.default) { const { sync: s } = await import('lintmax'); s(m.default); }`], true)
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
  run('sort-package-json', 'node', [sortPkgJson, '**/package.json'], true)
  run('biome', biomeBin, ['check', '--config-path', dir, '--fix', '--diagnostic-level=error'], true)
  run('oxlint', oxlintBin, ['-c', join(dir, '.oxlintrc.json'), '--fix', '--fix-suggestions', '--quiet'], true)
  run('eslint', 'node', [eslintBin, ...eslintArgs, '--fix', '--cache', '--cache-location', join(cwd, '.cache', '.eslintcache')], true)
  run('biome', biomeBin, ['check', '--config-path', dir, '--fix', '--diagnostic-level=error'], true)
  run('prettier', 'node', [prettierBin, ...prettierMd, '--write', '**/*.md'], true)
  if (hasFlowmark) run('flowmark', 'flowmark', ['--auto', '.'], true)
} else if (cmd === 'check') {
  run('sort-package-json', 'node', [sortPkgJson, '--check', '**/package.json'])
  run('biome', biomeBin, ['ci', '--config-path', dir, '--diagnostic-level=error'])
  run('oxlint', oxlintBin, ['-c', join(dir, '.oxlintrc.json'), '--quiet'])
  run('eslint', 'node', [eslintBin, ...eslintArgs, '--cache', '--cache-location', join(cwd, '.cache', '.eslintcache')])
  run('prettier', 'node', [prettierBin, ...prettierMd, '--check', '**/*.md'])
}
