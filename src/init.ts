import { file, write } from 'bun'
import type { Pkg } from './core.js'
import { CliExitError, cwd, ignoreEntries, pathExists, readRequiredJson, writeJson } from './core.js'
import { joinPath } from './path.js'
const initScripts = async ({ pkg, pkgPath }: { pkg: Pkg; pkgPath: string }) => {
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
  runInit = async () => {
    const pkgPath = joinPath(cwd, 'package.json')
    if (!(await pathExists({ path: pkgPath }))) throw new CliExitError({ code: 1, message: 'No package.json found' })
    const pkg = await readRequiredJson<Pkg>({ path: pkgPath }),
      configFiles: string[] = []
    if (await pathExists({ path: joinPath(cwd, 'lintmax.config.ts') })) configFiles.push('lintmax.config.ts')
    await initScripts({ pkg, pkgPath })
    await initTsconfig({ configFiles })
    await initGitignore()
    const foundLegacy = await findLegacyConfigs()
    process.stdout.write('tsconfig.json    extends lintmax/tsconfig')
    if (configFiles.length > 0) process.stdout.write(`, include: ${configFiles.join(', ')}`)
    process.stdout.write('\n')
    process.stdout.write('package.json     "fix": "lintmax fix", "check": "lintmax check"\n')
    process.stdout.write(`.gitignore       ${ignoreEntries.join(', ')}\n`)
    if (foundLegacy.length > 0)
      process.stdout.write(`\nLegacy configs found (can be removed): ${foundLegacy.join(', ')}\n`)
    process.stdout.write('\nRun: bun fix\n')
  }
export { runInit }
