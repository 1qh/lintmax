import { env as bunEnv, file, spawnSync, write } from 'bun'

import { cacheDir, sync } from './index.js'
import { dirnamePath, fromFileUrl, joinPath } from './path.js'
interface Pkg {
  [key: string]: unknown
  scripts?: Record<string, string>
  workspaces?: string[]
}
interface RunOpts {
  args: string[]
  command: string
  env: Record<string, string | undefined>
  label: string
  silent?: boolean
}
class CliExitError extends Error {
  code: number
  constructor({ code, message }: { code: number; message?: string }) {
    super(message ?? '')
    this.code = code
  }
}
const decoder = new TextDecoder(),
  cwd = process.cwd(),
  cmd = process.argv[2],
  ignoreEntries = ['.cache/', '.eslintcache'],
  lintmaxRoot = dirnamePath(dirnamePath(fromFileUrl(import.meta.url))),
  decodeText = (bytes: Uint8Array | undefined) => decoder.decode(bytes ?? new Uint8Array()),
  pathExists = async ({ path }: { path: string }) => file(path).exists(),
  readJson = async ({ path }: { path: string }): Promise<Record<string, unknown>> => {
    if (!(await pathExists({ path }))) return {}
    try {
      const text = await file(path).text()
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      return {}
    }
  },
  readRequiredJson = async <T>({ path }: { path: string }): Promise<T> => {
    const text = await file(path).text()
    return JSON.parse(text) as T
  },
  writeJson = async ({ data, path }: { data: Record<string, unknown>; path: string }) =>
    write(path, `${JSON.stringify(data, null, 2)}\n`),
  ensureDirectory = ({ directory }: { directory: string }) => {
    const result = spawnSync({ cmd: ['mkdir', '-p', directory], stderr: 'pipe', stdout: 'pipe' })
    if (result.exitCode === 0) return
    const stderr = decodeText(result.stderr).trim()
    throw new CliExitError({
      code: result.exitCode,
      message: stderr.length > 0 ? stderr : `Failed to create directory: ${directory}`
    })
  },
  sortKeys = (obj: Record<string, unknown>): Record<string, unknown> => {
    const sorted: Record<string, unknown> = {},
      keys = Object.keys(obj).toSorted()
    for (const key of keys) sorted[key] = obj[key]
    return sorted
  },
  initScripts = async ({ pkg, pkgPath }: { pkg: Pkg; pkgPath: string }) => {
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
    if (!changed) return
    pkg.scripts = scripts
    await writeJson({ data: pkg, path: pkgPath })
  },
  initTsconfig = async ({ configFiles }: { configFiles: string[] }) => {
    const tsconfigPath = joinPath(cwd, 'tsconfig.json')
    if (!(await pathExists({ path: tsconfigPath }))) {
      const tsconfig: Record<string, unknown> = { extends: 'lintmax/tsconfig' }
      if (configFiles.length > 0) tsconfig.include = configFiles
      await writeJson({ data: tsconfig, path: tsconfigPath })
      return
    }
    try {
      const tsconfig = await readRequiredJson<{
        [key: string]: unknown
        extends?: string
        include?: string[]
      }>({ path: tsconfigPath })
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
      if (changed) await writeJson({ data: tsconfig, path: tsconfigPath })
    } catch {
      process.stderr.write('tsconfig.json: could not parse, add "extends": "lintmax/tsconfig" manually\n')
    }
  },
  initGitignore = async () => {
    const gitignorePath = joinPath(cwd, '.gitignore')
    if (await pathExists({ path: gitignorePath })) {
      const content = await file(gitignorePath).text(),
        toAdd: string[] = []
      for (const entry of ignoreEntries) if (!content.includes(entry)) toAdd.push(entry)
      if (toAdd.length > 0) await write(gitignorePath, `${content.trimEnd()}\n${toAdd.join('\n')}\n`)
      return
    }
    await write(gitignorePath, `${ignoreEntries.join('\n')}\n`)
  },
  initVscodeSettings = async ({ pkg }: { pkg: Pkg }) => {
    const vscodePath = joinPath(cwd, '.vscode')
    ensureDirectory({ directory: vscodePath })
    const settingsPath = joinPath(vscodePath, 'settings.json'),
      settings = await readJson({ path: settingsPath })
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
    if (pkg.workspaces && !settings['eslint.workingDirectories']) {
      const dirs: { pattern: string }[] = []
      for (const ws of pkg.workspaces) {
        const pattern = ws.endsWith('/') ? ws : `${ws}/`
        dirs.push({ pattern })
      }
      if (dirs.length > 0) settings['eslint.workingDirectories'] = dirs
    }
    await writeJson({ data: sortKeys(settings), path: settingsPath })
  },
  initVscodeExtensions = async () => {
    const extensionsPath = joinPath(cwd, '.vscode', 'extensions.json'),
      extJson = (await readJson({ path: extensionsPath })) as { [key: string]: unknown; recommendations?: string[] },
      recommendations = ['biomejs.biome', 'dbaeumer.vscode-eslint'],
      currentRecs = extJson.recommendations ?? [],
      recsToAdd: string[] = []
    for (const rec of recommendations) if (!currentRecs.includes(rec)) recsToAdd.push(rec)
    if (recsToAdd.length > 0 || !extJson.recommendations) {
      extJson.recommendations = [...currentRecs, ...recsToAdd]
      await writeJson({ data: extJson, path: extensionsPath })
    }
  },
  findLegacyConfigs = async (): Promise<string[]> => {
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
      checks = legacyConfigs.map(async configFile => ({
        configFile,
        exists: await pathExists({ path: joinPath(cwd, configFile) })
      })),
      resolved = await Promise.all(checks),
      found: string[] = []
    for (const item of resolved) if (item.exists) found.push(item.configFile)
    return found
  },
  readVersion = async () => {
    const pkg = await readRequiredJson<{ version: string }>({ path: joinPath(lintmaxRoot, 'package.json') })
    return pkg.version
  },
  usage = ({ version }: { version: string }) => {
    process.stdout.write(`lintmax v${version}\n\n`)
    process.stdout.write('Usage: lintmax <command>\n\n')
    process.stdout.write('Commands:\n')
    process.stdout.write('  init     Scaffold config files for a new project\n')
    process.stdout.write('  fix      Auto-fix and format all files\n')
    process.stdout.write('  check    Check all files without modifying\n')
    process.stdout.write('  --version  Show version\n')
  },
  resolvePackageJsonPath = async ({ pkg }: { pkg: string }): Promise<null | string> => {
    try {
      return fromFileUrl(import.meta.resolve(`${pkg}/package.json`))
    } catch {
      const consumerCandidate = joinPath(cwd, 'node_modules', pkg, 'package.json')
      if (await pathExists({ path: consumerCandidate })) return consumerCandidate
      return null
    }
  },
  resolveBin = async ({ bin, pkg }: { bin: string; pkg: string }): Promise<string> => {
    const packageJsonPath = await resolvePackageJsonPath({ pkg })
    if (!packageJsonPath) throw new CliExitError({ code: 1, message: `Cannot find ${pkg} — run: bun add -d lintmax` })
    const pkgJson = await readRequiredJson<{ bin?: Record<string, string> | string }>({ path: packageJsonPath }),
      pkgDir = dirnamePath(packageJsonPath),
      binPath = typeof pkgJson.bin === 'string' ? pkgJson.bin : (pkgJson.bin?.[bin] ?? '')
    return joinPath(pkgDir, binPath)
  },
  run = ({ args, command, env, label, silent = false }: RunOpts): void => {
    const result = spawnSync({
      cmd: [command, ...args],
      cwd,
      env,
      stderr: silent ? 'pipe' : 'inherit',
      stdout: silent ? 'pipe' : 'inherit'
    })
    if (result.exitCode === 0) return
    if (silent) {
      process.stderr.write(`[${label}]\n`)
      const stdout = decodeText(result.stdout)
      if (stdout.length > 0) process.stderr.write(stdout)
      const stderr = decodeText(result.stderr)
      if (stderr.length > 0) process.stderr.write(stderr)
    }
    throw new CliExitError({ code: result.exitCode })
  },
  runInit = async () => {
    const pkgPath = joinPath(cwd, 'package.json')
    if (!(await pathExists({ path: pkgPath }))) throw new CliExitError({ code: 1, message: 'No package.json found' })
    const pkg = await readRequiredJson<Pkg>({ path: pkgPath }),
      configFiles: string[] = []
    if (await pathExists({ path: joinPath(cwd, 'eslint.config.ts') })) configFiles.push('eslint.config.ts')
    if (await pathExists({ path: joinPath(cwd, 'lintmax.config.ts') })) configFiles.push('lintmax.config.ts')
    await initScripts({ pkg, pkgPath })
    await initTsconfig({ configFiles })
    await initGitignore()
    await initVscodeSettings({ pkg })
    await initVscodeExtensions()
    const foundLegacy = await findLegacyConfigs()
    process.stdout.write('tsconfig.json    extends lintmax/tsconfig')
    if (configFiles.length > 0) process.stdout.write(`, include: ${configFiles.join(', ')}`)
    process.stdout.write('\n')
    process.stdout.write('package.json     "fix": "lintmax fix", "check": "lintmax check"\n')
    process.stdout.write(`.gitignore       ${ignoreEntries.join(', ')}\n`)
    process.stdout.write('.vscode/settings biome formatter, codeActionsOnSave, eslint\n')
    process.stdout.write('.vscode/ext      biomejs.biome, dbaeumer.vscode-eslint\n')
    if (foundLegacy.length > 0)
      process.stdout.write(`\nLegacy configs found (can be removed): ${foundLegacy.join(', ')}\n`)
    process.stdout.write('\nRun: bun fix\n')
  },
  runLint = async () => {
    const dir = joinPath(cwd, cacheDir)
    ensureDirectory({ directory: dir })
    const configPath = joinPath(cwd, 'lintmax.config.ts'),
      hasConfig = await pathExists({ path: configPath }),
      bundledBinA = joinPath(lintmaxRoot, 'node_modules', '.bin'),
      bundledBinB = joinPath(dirnamePath(lintmaxRoot), '.bin'),
      cwdBinDir = joinPath(cwd, 'node_modules', '.bin'),
      env = { ...bunEnv, PATH: `${bundledBinA}:${bundledBinB}:${cwdBinDir}:${bunEnv.PATH ?? ''}` }
    if (hasConfig)
      run({
        args: [
          '-e',
          `const m = await import('${configPath}'); if (m.default) { const { sync: s } = await import('lintmax'); await s(m.default); }`
        ],
        command: 'bun',
        env,
        label: 'config',
        silent: true
      })
    else await sync()
    const hasEslintConfig =
        (await pathExists({ path: joinPath(cwd, 'eslint.config.ts') })) ||
        (await pathExists({ path: joinPath(cwd, 'eslint.config.js') })) ||
        (await pathExists({ path: joinPath(cwd, 'eslint.config.mjs') })),
      eslintArgs = hasEslintConfig ? [] : ['--config', joinPath(dir, 'eslint.config.mjs')],
      [sortPkgJson, biomeBin, oxlintBin, eslintBin, prettierBin] = await Promise.all([
        resolveBin({ bin: 'sort-package-json', pkg: 'sort-package-json' }),
        resolveBin({ bin: 'biome', pkg: '@biomejs/biome' }),
        resolveBin({ bin: 'oxlint', pkg: 'oxlint' }),
        resolveBin({ bin: 'eslint', pkg: 'eslint' }),
        resolveBin({ bin: 'prettier', pkg: 'prettier' })
      ]),
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
      hasFlowmark = spawnSync({ cmd: ['which', 'flowmark'], env, stderr: 'pipe', stdout: 'pipe' }).exitCode === 0
    if (cmd === 'fix') {
      run({
        args: [sortPkgJson, '**/package.json', '--ignore', '**/node_modules/**'],
        command: 'bun',
        env,
        label: 'sort-package-json',
        silent: true
      })
      run({
        args: ['check', '--config-path', dir, '--fix', '--diagnostic-level=error'],
        command: biomeBin,
        env,
        label: 'biome',
        silent: true
      })
      run({
        args: ['-c', joinPath(dir, '.oxlintrc.json'), '--fix', '--fix-suggestions', '--quiet'],
        command: oxlintBin,
        env,
        label: 'oxlint',
        silent: true
      })
      run({
        args: [eslintBin, ...eslintArgs, '--fix', '--cache', '--cache-location', joinPath(cwd, '.cache', '.eslintcache')],
        command: 'bun',
        env,
        label: 'eslint',
        silent: true
      })
      run({
        args: ['check', '--config-path', dir, '--fix', '--diagnostic-level=error'],
        command: biomeBin,
        env,
        label: 'biome',
        silent: true
      })
      if (hasFlowmark) run({ args: ['--auto', '.'], command: 'flowmark', env, label: 'flowmark', silent: true })
      run({
        args: [prettierBin, ...prettierMd, '--write', '--no-error-on-unmatched-pattern', '**/*.md'],
        command: 'bun',
        env,
        label: 'prettier',
        silent: true
      })
      return
    }
    run({
      args: [sortPkgJson, '--check', '**/package.json', '--ignore', '**/node_modules/**'],
      command: 'bun',
      env,
      label: 'sort-package-json'
    })
    run({ args: ['ci', '--config-path', dir, '--diagnostic-level=error'], command: biomeBin, env, label: 'biome' })
    run({ args: ['-c', joinPath(dir, '.oxlintrc.json'), '--quiet'], command: oxlintBin, env, label: 'oxlint' })
    run({
      args: [eslintBin, ...eslintArgs, '--cache', '--cache-location', joinPath(cwd, '.cache', '.eslintcache')],
      command: 'bun',
      env,
      label: 'eslint'
    })
    run({
      args: [prettierBin, ...prettierMd, '--check', '--no-error-on-unmatched-pattern', '**/*.md'],
      command: 'bun',
      env,
      label: 'prettier'
    })
  },
  main = async () => {
    const version = await readVersion()
    if (cmd === 'init') {
      await runInit()
      return
    }
    if (cmd === '--version' || cmd === '-v') {
      process.stdout.write(`${version}\n`)
      return
    }
    if (cmd !== 'fix' && cmd !== 'check') {
      usage({ version })
      if (cmd === '--help' || cmd === '-h') return
      throw new CliExitError({ code: 1 })
    }
    await runLint()
  }
try {
  await main()
} catch (error) {
  if (error instanceof CliExitError) {
    if (error.message.length > 0) process.stderr.write(`${error.message}\n`)
    process.exitCode = error.code
  } else throw error
}
