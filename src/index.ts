import type { Linter } from 'eslint'

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

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

const pkgRoot = join(import.meta.dirname, '..'),
  biomeCategories = [
    'a11y',
    'complexity',
    'correctness',
    'nursery',
    'performance',
    'security',
    'style',
    'suspicious'
  ] as const,
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
  resolveBiomeRuleCategories = (cwd: string): Map<string, string> => {
    const req = createRequire(join(cwd, 'package.json')),
      schemaPath = req.resolve('@biomejs/biome/configuration_schema.json'),
      schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
        $defs: Record<string, { properties?: Record<string, unknown> }>
      },
      map = new Map<string, string>()
    for (const cat of biomeCategories) {
      const key = cat.charAt(0).toUpperCase() + cat.slice(1),
        props = schema.$defs[key]?.properties
      if (props) for (const rule of Object.keys(props)) if (rule !== 'recommended' && rule !== 'all') map.set(rule, cat)
    }
    return map
  },
  extractRuleNames = (rules: Record<string, 'off'>): string[] => {
    const names: string[] = []
    for (const key of Object.keys(rules)) names.push(key.includes('/') ? key.slice(key.indexOf('/') + 1) : key)
    return names
  },
  groupByCategory = (ruleNames: string[], categoryMap: Map<string, string>): Record<string, Record<string, string>> => {
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
  createBiomeConfig = (cwd: string, options?: BiomeOptions): Record<string, unknown> => {
    const categoryMap = resolveBiomeRuleCategories(cwd),
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
        linter: { rules: groupByCategory(allRulesOff, categoryMap) }
      }
    ]

    if (options?.overrides)
      for (const override of options.overrides)
        if (override.disableLinter) overrides.push({ includes: override.includes, linter: { enabled: false } })
        else if (override.rules)
          overrides.push({
            includes: override.includes,
            linter: { rules: groupByCategory(extractRuleNames(override.rules), categoryMap) }
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
        rules: {
          a11y: 'error',
          complexity: 'error',
          correctness: 'error',
          nursery: 'error',
          performance: 'error',
          security: 'error',
          style: 'error',
          suspicious: 'error'
        }
      },
      overrides
    }
  },
  createOxlintConfig = (options?: OxlintOptions): Record<string, unknown> => {
    const base = JSON.parse(readFileSync(join(pkgRoot, 'oxlintrc.json'), 'utf8')) as {
      [key: string]: unknown
      ignorePatterns?: string[]
      overrides?: { files: string[]; rules: Record<string, unknown> }[]
      rules: Record<string, unknown>
    }

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
  cacheDir = join('node_modules', '.cache', 'lintmax'),
  sync = (options?: SyncOptions) => {
    const cwd = process.cwd(),
      dir = join(cwd, cacheDir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'biome.json'), `${JSON.stringify(createBiomeConfig(cwd, options?.biome), null, 2)}\n`)
    writeFileSync(join(dir, '.oxlintrc.json'), `${JSON.stringify(createOxlintConfig(options?.oxlint), null, 2)}\n`)
    const eslintConfig = options?.eslint
      ? `import { eslint } from 'lintmax/eslint'\nexport default eslint(${JSON.stringify(options.eslint)})\n`
      : "export { default } from 'lintmax/eslint'\n"
    writeFileSync(join(dir, 'eslint.config.mjs'), eslintConfig)
  },
  defineConfig = (options: SyncOptions): SyncOptions => options

export type { EslintOptions, SyncOptions }
export { cacheDir, defineConfig, sync, warnToError }
