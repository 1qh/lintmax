import type { Linter } from 'eslint'

import { file, spawnSync, write } from 'bun'

import { dirnamePath, fromFileUrl, joinPath } from './path.js'
interface BiomeOptions {
  ignorePatterns?: string[]
  overrides?: {
    disableLinter?: boolean
    includes: string[]
    rules?: Record<string, 'off'>
  }[]
  rules?: Record<string, 'off'>
}
interface EslintOptions {
  ignores?: string[]
  rules?: Record<string, 'off'>
  tailwind?: string
  tsconfigRootDir?: string
}
interface OxlintOptions {
  ignorePatterns?: string[]
  overrides?: {
    files: string[]
    rules: Record<string, 'off'>
  }[]
  rules?: Record<string, 'off'>
}
interface SyncOptions {
  biome?: BiomeOptions
  eslint?: EslintOptions
  oxlint?: OxlintOptions
}
const decoder = new TextDecoder(),
  pkgRoot = dirnamePath(fromFileUrl(import.meta.resolve('../package.json'))),
  biomeRulesOff: string[] = [
    'noBarrelFile',
    'noConditionalExpect',
    'noConsole',
    'noDefaultExport',
    'noExcessiveCognitiveComplexity',
    'noExcessiveLinesPerFile',
    'noExcessiveLinesPerFunction',
    'noExportedImports',
    'noImplicitBoolean',
    'noJsxLiterals',
    'noJsxPropsBind',
    'noMagicNumbers',
    'noNestedTernary',
    'noNodejsModules',
    'noProcessGlobal',
    'noReactSpecificProps',
    'noSecrets',
    'noSolidDestructuredProps',
    'noTernary',
    'noUndeclaredDependencies',
    'noUnresolvedImports',
    'useBlockStatements',
    'useComponentExportOnlyModules',
    'useDestructuring',
    'useExplicitType',
    'useImportExtensions',
    'useNamingConvention',
    'useQwikValidLexicalScope',
    'useSingleVarDeclarator',
    'useSolidForComponent',
    'useSortedClasses'
  ],
  biomeIgnorePatterns = [
    '!!**/.build',
    '!!**/.cache',
    '!!**/.next',
    '!!**/.output',
    '!!**/.turbo',
    '!!**/.venv',
    '!!**/.wxt',
    '!!**/_generated',
    '!!**/Android',
    '!!**/Darwin',
    '!!**/dist',
    '!!**/maestro',
    '!!**/module_bindings',
    '!!**/playwright-report',
    '!!**/test-results',
    '!!**/*.xcassets'
  ],
  decodeBytes = (bytes: Uint8Array | undefined) => decoder.decode(bytes ?? new Uint8Array()),
  ensureDirectory = ({ directory }: { directory: string }) => {
    const result = spawnSync({ cmd: ['mkdir', '-p', directory], stderr: 'pipe', stdout: 'pipe' })
    if (result.exitCode === 0) return
    const stderr = decodeBytes(result.stderr).trim()
    throw new Error(stderr.length > 0 ? stderr : `Failed to create directory: ${directory}`)
  },
  resolveBundledModule = ({ specifier }: { specifier: string }): null | string => {
    try {
      return fromFileUrl(import.meta.resolve(specifier))
    } catch {
      return null
    }
  },
  readJsonFile = async <T>({ filePath }: { filePath: string }): Promise<T> => {
    const text = await file(filePath).text()
    return JSON.parse(text) as T
  },
  resolveSchemaPath = async ({ cwd }: { cwd: string }) => {
    const bundled = resolveBundledModule({ specifier: '@biomejs/biome/configuration_schema.json' })
    if (bundled) return bundled
    const consumerCandidate = joinPath(cwd, 'node_modules', '@biomejs', 'biome', 'configuration_schema.json')
    if (await file(consumerCandidate).exists()) return consumerCandidate
    throw new Error('Cannot find module @biomejs/biome/configuration_schema.json')
  },
  resolveBiomeSchema = async ({
    cwd
  }: {
    cwd: string
  }): Promise<{ categories: string[]; ruleMap: Map<string, string> }> => {
    const schemaPath = await resolveSchemaPath({ cwd }),
      schema = await readJsonFile<{
        $defs: Record<string, { properties?: Record<string, unknown> }>
      }>({ filePath: schemaPath }),
      rulesProps = schema.$defs.Rules?.properties ?? {},
      categories = Object.keys(rulesProps).filter(k => k !== 'recommended'),
      ruleMap = new Map<string, string>()
    for (const cat of categories) {
      const key = cat.charAt(0).toUpperCase() + cat.slice(1),
        props = schema.$defs[key]?.properties
      if (props)
        for (const rule of Object.keys(props)) if (rule !== 'recommended' && rule !== 'all') ruleMap.set(rule, cat)
    }
    return { categories, ruleMap }
  },
  extractRuleNames = (rules: Record<string, 'off'>): string[] => {
    const names: string[] = []
    for (const key of Object.keys(rules)) names.push(key.includes('/') ? key.slice(key.indexOf('/') + 1) : key)
    return names
  },
  groupByCategory = ({ categoryMap, ruleNames }: { categoryMap: Map<string, string>; ruleNames: string[] }) => {
    const result: Record<string, Record<string, string>> = {}
    for (const rule of ruleNames) {
      const cat = categoryMap.get(rule)
      if (cat) {
        result[cat] ??= {}
        result[cat][rule] = 'off'
      }
    }
    return result
  },
  createBiomeConfig = async ({
    cwd,
    options
  }: {
    cwd: string
    options?: BiomeOptions
  }): Promise<Record<string, unknown>> => {
    const { categories, ruleMap } = await resolveBiomeSchema({ cwd }),
      allRulesOff = [...biomeRulesOff]
    if (options?.rules)
      for (const key of Object.keys(options.rules)) {
        const ruleName = key.includes('/') ? key.slice(key.indexOf('/') + 1) : key
        if (!allRulesOff.includes(ruleName)) allRulesOff.push(ruleName)
      }
    const ignorePatterns = [...biomeIgnorePatterns]
    if (options?.ignorePatterns)
      for (const pattern of options.ignorePatterns) {
        const negated = pattern.startsWith('!!') ? pattern : `!!**/${pattern}`
        if (!ignorePatterns.includes(negated)) ignorePatterns.push(negated)
      }
    const overrides: unknown[] = [
      {
        css: { parser: { tailwindDirectives: true } },
        includes: ['**'],
        linter: { rules: groupByCategory({ categoryMap: ruleMap, ruleNames: allRulesOff }) }
      }
    ]
    if (options?.overrides)
      for (const override of options.overrides)
        if (override.disableLinter) overrides.push({ includes: override.includes, linter: { enabled: false } })
        else if (override.rules)
          overrides.push({
            includes: override.includes,
            linter: {
              rules: groupByCategory({ categoryMap: ruleMap, ruleNames: extractRuleNames(override.rules) })
            }
          })
    return {
      $schema: 'https://biomejs.dev/schemas/latest/schema.json',
      assist: { actions: { source: { organizeImports: 'off' } } },
      css: { formatter: { enabled: true, quoteStyle: 'single' }, parser: { tailwindDirectives: true } },
      files: { includes: ['**', ...ignorePatterns] },
      formatter: { indentStyle: 'space', lineWidth: 123 },
      javascript: {
        formatter: {
          arrowParentheses: 'asNeeded',
          bracketSameLine: true,
          jsxQuoteStyle: 'single',
          quoteStyle: 'single',
          semicolons: 'asNeeded',
          trailingCommas: 'none'
        }
      },
      json: { formatter: { trailingCommas: 'none' } },
      linter: {
        domains: {
          next: 'all',
          project: 'all',
          qwik: 'all',
          react: 'all',
          solid: 'all',
          tailwind: 'all',
          test: 'all',
          vue: 'all'
        },
        rules: Object.fromEntries(categories.map(c => [c, 'error']))
      },
      overrides
    }
  },
  createOxlintConfig = async ({ options }: { options?: OxlintOptions }): Promise<Record<string, unknown>> => {
    const base = await readJsonFile<{
      [key: string]: unknown
      ignorePatterns?: string[]
      overrides?: { files: string[]; rules: Record<string, unknown> }[]
      rules: Record<string, unknown>
    }>({ filePath: joinPath(pkgRoot, 'oxlintrc.json') })
    if (!options) return base
    if (options.ignorePatterns) base.ignorePatterns = [...(base.ignorePatterns ?? []), ...options.ignorePatterns]
    if (options.rules) for (const [key, value] of Object.entries(options.rules)) base.rules[key] = value
    if (options.overrides) {
      base.overrides ??= []
      for (const override of options.overrides) base.overrides.push({ files: override.files, rules: override.rules })
    }
    return base
  },
  warnToError = (rules: Partial<Linter.RulesRecord>): Linter.RulesRecord => {
    const result: Linter.RulesRecord = {}
    for (const [key, value] of Object.entries(rules))
      if (value === undefined) result[key] = 'error'
      else if (value === 'warn' || value === 1) result[key] = 'error'
      else if (Array.isArray(value) && (value[0] === 'warn' || value[0] === 1)) result[key] = ['error', ...value.slice(1)]
      else result[key] = value
    return result
  },
  cacheDir = joinPath('node_modules', '.cache', 'lintmax'),
  sync = async (options?: SyncOptions): Promise<void> => {
    const cwd = process.cwd(),
      dir = joinPath(cwd, cacheDir)
    ensureDirectory({ directory: dir })
    const biomeConfig = await createBiomeConfig({ cwd, options: options?.biome }),
      oxlintConfig = await createOxlintConfig({ options: options?.oxlint }),
      eslintConfig = options?.eslint
        ? `import { eslint } from 'lintmax/eslint'\nexport default eslint(${JSON.stringify(options.eslint)})\n`
        : "export { default } from 'lintmax/eslint'\n"
    await write(joinPath(dir, 'biome.json'), `${JSON.stringify(biomeConfig, null, 2)}\n`)
    await write(joinPath(dir, '.oxlintrc.json'), `${JSON.stringify(oxlintConfig, null, 2)}\n`)
    await write(joinPath(dir, 'eslint.config.mjs'), eslintConfig)
  },
  defineConfig = (options: SyncOptions): SyncOptions => options
export type { EslintOptions, SyncOptions }
export { cacheDir, defineConfig, sync, warnToError }
