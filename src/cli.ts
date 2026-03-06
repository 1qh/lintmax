// oxlint-disable unicorn/no-process-exit

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { cacheDir, sync } from './index.js'

const cwd = process.cwd(),
  cmd = process.argv[2],
  sortKeys = (obj: Record<string, unknown>): Record<string, unknown> => {
    const sorted: Record<string, unknown> = {},
      keys = Object.keys(obj).toSorted()
    for (const key of keys) sorted[key] = obj[key]
    return sorted
  },
  readJson = (path: string): Record<string, unknown> => {
    if (!existsSync(path)) return {}
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    } catch {
      return {}
    }
  },
  writeJson = (path: string, data: Record<string, unknown>) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)

interface Pkg {
  [key: string]: unknown
  scripts?: Record<string, string>
  workspaces?: string[]
}

const initScripts = (pkg: Pkg, pkgPath: string) => {
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
      writeJson(pkgPath, pkg)
    }
  },
  initTsconfig = (configFiles: string[]) => {
    const tsconfigPath = join(cwd, 'tsconfig.json')
    if (!existsSync(tsconfigPath)) {
      const tsconfig: Record<string, unknown> = { extends: 'lintmax/tsconfig' }
      if (configFiles.length > 0) tsconfig.include = configFiles
      writeJson(tsconfigPath, tsconfig)
      return
    }
    try {
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as {
        [key: string]: unknown
        extends?: string
        include?: string[]
      }
      let changed = false
      if (tsconfig.extends !== 'lintmax/tsconfig') {
        tsconfig.extends = 'lintmax/tsconfig'
        changed = true
      }
      const toAdd = configFiles.filter(f => !(tsconfig.include ?? []).includes(f))
      if (toAdd.length > 0) {
        tsconfig.include = [...(tsconfig.include ?? []), ...toAdd]
        changed = true
      }
      if (changed) writeJson(tsconfigPath, tsconfig)
    } catch {
      process.stderr.write('tsconfig.json: could not parse, add "extends": "lintmax/tsconfig" manually\n')
    }
  },
  ignoreEntries = ['.cache/', '.eslintcache'],
  initGitignore = () => {
    const gitignorePath = join(cwd, '.gitignore')
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf8'),
        toAdd: string[] = []
      for (const entry of ignoreEntries) if (!content.includes(entry)) toAdd.push(entry)
      if (toAdd.length > 0) writeFileSync(gitignorePath, `${content.trimEnd()}\n${toAdd.join('\n')}\n`)
    } else writeFileSync(gitignorePath, `${ignoreEntries.join('\n')}\n`)
  },
  initVscodeSettings = (pkg: Pkg) => {
    const vscodePath = join(cwd, '.vscode')
    mkdirSync(vscodePath, { recursive: true })

    const settingsPath = join(vscodePath, 'settings.json'),
      settings = readJson(settingsPath)

    settings['biome.configPath'] = 'node_modules/.cache/lintmax/biome.json'
    const formatterLangs = [
      'css',
      'graphql',
      'javascript',
      'javascriptreact',
      'json',
      'jsonc',
      'typescript',
      'typescriptreact'
    ]
    for (const lang of formatterLangs) {
      const key = `[${lang}]`,
        existing = (settings[key] ?? {}) as Record<string, unknown>
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
      const dirs: { pattern: string }[] = []
      for (const ws of pkg.workspaces) {
        const pattern = ws.endsWith('/') ? ws : `${ws}/`
        dirs.push({ pattern })
      }
      if (dirs.length > 0) settings['eslint.workingDirectories'] = dirs
    }

    writeJson(settingsPath, sortKeys(settings))
  },
  initVscodeExtensions = () => {
    const extensionsPath = join(cwd, '.vscode', 'extensions.json'),
      extJson = readJson(extensionsPath) as { [key: string]: unknown; recommendations?: string[] },
      recommendations = ['biomejs.biome', 'dbaeumer.vscode-eslint'],
      currentRecs = extJson.recommendations ?? [],
      recsToAdd: string[] = []
    for (const rec of recommendations) if (!currentRecs.includes(rec)) recsToAdd.push(rec)
    if (recsToAdd.length > 0 || !extJson.recommendations) {
      extJson.recommendations = [...currentRecs, ...recsToAdd]
      writeJson(extensionsPath, extJson)
    }
  },
  findLegacyConfigs = (): string[] => {
    const legacyConfigs = [
        '.eslintrc',
        '.eslintrc.json',
        '.eslintrc.js',
        '.eslintrc.cjs',
        '.eslintrc.yml',
        '.eslintrc.yaml',
        '.prettierrc',
        '.prettierrc.json',
        '.prettierrc.js',
        '.prettierrc.yml',
        '.prettierrc.yaml',
        '.prettierrc.toml',
        'biome.json',
        'biome.jsonc',
        '.oxlintrc.json'
      ],
      found: string[] = []
    for (const f of legacyConfigs) if (existsSync(join(cwd, f))) found.push(f)
    return found
  },
  init = () => {
    const pkgPath = join(cwd, 'package.json')
    if (!existsSync(pkgPath)) {
      process.stderr.write('No package.json found\n')
      process.exit(1)
    }

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Pkg,
      configFiles: string[] = []
    if (existsSync(join(cwd, 'eslint.config.ts'))) configFiles.push('eslint.config.ts')
    if (existsSync(join(cwd, 'lintmax.config.ts'))) configFiles.push('lintmax.config.ts')

    initScripts(pkg, pkgPath)
    initTsconfig(configFiles)
    initGitignore()
    initVscodeSettings(pkg)
    initVscodeExtensions()

    const foundLegacy = findLegacyConfigs()

    process.stdout.write('tsconfig.json    extends lintmax/tsconfig')
    if (configFiles.length > 0) process.stdout.write(`, include: ${configFiles.join(', ')}`)
    process.stdout.write('\n')
    process.stdout.write('package.json     "fix": "lintmax fix", "check": "lintmax check"\n')
    process.stdout.write(`.gitignore       ${ignoreEntries.join(', ')}\n`)
    process.stdout.write('.vscode/settings biome formatter, codeActionsOnSave, eslint, typescript\n')
    process.stdout.write('.vscode/ext      biomejs.biome, dbaeumer.vscode-eslint\n')
    if (foundLegacy.length > 0)
      process.stdout.write(`\nLegacy configs found (can be removed): ${foundLegacy.join(', ')}\n`)
    process.stdout.write('\nRun: bun fix\n')
  },
  version = '0.0.1',
  usage = () => {
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

const lintmaxNm = join(import.meta.dirname, '..', 'node_modules'),
  resolveBin = (pkg: string, bin: string): string => {
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
    const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
        bin?: Record<string, string> | string
      },
      binPath = typeof pkgJson.bin === 'string' ? pkgJson.bin : (pkgJson.bin?.[bin] ?? '')
    return join(pkgDir, binPath)
  },
  pkgBinDir = join(import.meta.dirname, '..', 'node_modules', '.bin'),
  cwdBinDir = join(cwd, 'node_modules', '.bin'),
  /** biome-ignore lint/style/noProcessEnv: cli reads environment */
  env = { ...process.env, PATH: `${pkgBinDir}:${cwdBinDir}:${process.env.PATH ?? ''}` }

interface RunOpts {
  args: string[]
  command: string
  label: string
  silent?: boolean
}

const run = ({ args, command, label, silent = false }: RunOpts): void => {
    const result = spawnSync(command, args, { cwd, env, stdio: silent ? 'pipe' : 'inherit' })
    if (result.status !== 0) {
      if (silent) {
        process.stderr.write(`[${label}]\n`)
        if (result.stdout.length > 0) process.stderr.write(result.stdout)
        if (result.stderr.length > 0) process.stderr.write(result.stderr)
      }
      process.exit(result.status ?? 1)
    }
  },
  configPath = join(cwd, 'lintmax.config.ts')
if (existsSync(configPath))
  run({
    args: [
      '-e',
      `const m = await import('${configPath}'); if (m.default) { const { sync: s } = await import('lintmax'); s(m.default); }`
    ],
    command: 'bun',
    label: 'config',
    silent: true
  })
else sync()

const hasEslintConfig =
    existsSync(join(cwd, 'eslint.config.ts')) ||
    existsSync(join(cwd, 'eslint.config.js')) ||
    existsSync(join(cwd, 'eslint.config.mjs')),
  eslintArgs = hasEslintConfig ? [] : ['--config', join(dir, 'eslint.config.mjs')],
  sortPkgJson = resolveBin('sort-package-json', 'sort-package-json'),
  biomeBin = resolveBin('@biomejs/biome', 'biome'),
  oxlintBin = resolveBin('oxlint', 'oxlint'),
  eslintBin = resolveBin('eslint', 'eslint'),
  prettierBin = resolveBin('prettier', 'prettier'),
  prettierMd = [
    '--single-quote',
    '--no-semi',
    '--trailing-comma',
    'none',
    '--print-width',
    '80',
    '--arrow-parens',
    'avoid',
    '--tab-width',
    '2',
    '--prose-wrap',
    'preserve'
  ],
  hasFlowmark = spawnSync('which', ['flowmark'], { env, stdio: 'pipe' }).status === 0

if (cmd === 'fix') {
  run({ args: [sortPkgJson, '**/package.json'], command: 'bun', label: 'sort-package-json', silent: true })
  run({
    args: ['check', '--config-path', dir, '--fix', '--diagnostic-level=error'],
    command: biomeBin,
    label: 'biome',
    silent: true
  })
  run({
    args: ['-c', join(dir, '.oxlintrc.json'), '--fix', '--fix-suggestions', '--quiet'],
    command: oxlintBin,
    label: 'oxlint',
    silent: true
  })
  run({
    args: [eslintBin, ...eslintArgs, '--fix', '--cache', '--cache-location', join(cwd, '.cache', '.eslintcache')],
    command: 'bun',
    label: 'eslint',
    silent: true
  })
  run({
    args: ['check', '--config-path', dir, '--fix', '--diagnostic-level=error'],
    command: biomeBin,
    label: 'biome',
    silent: true
  })
  if (hasFlowmark) run({ args: ['--auto', '.'], command: 'flowmark', label: 'flowmark', silent: true })
  run({ args: [prettierBin, ...prettierMd, '--write', '**/*.md'], command: 'bun', label: 'prettier', silent: true })
} else {
  run({ args: [sortPkgJson, '--check', '**/package.json'], command: 'bun', label: 'sort-package-json' })
  run({ args: ['ci', '--config-path', dir, '--diagnostic-level=error'], command: biomeBin, label: 'biome' })
  run({ args: ['-c', join(dir, '.oxlintrc.json'), '--quiet'], command: oxlintBin, label: 'oxlint' })
  run({
    args: [eslintBin, ...eslintArgs, '--cache', '--cache-location', join(cwd, '.cache', '.eslintcache')],
    command: 'bun',
    label: 'eslint'
  })
  run({ args: [prettierBin, ...prettierMd, '--check', '**/*.md'], command: 'bun', label: 'prettier' })
}
