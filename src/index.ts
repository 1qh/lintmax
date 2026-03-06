import type { Linter } from 'eslint'

import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface BiomeOptions {
  ignorePatterns?: string[]
  overrides?: Array<{
    disableLinter?: boolean
    includes: string[]
    rules?: Record<string, 'off'>
  }>
  rules?: Record<string, 'off'>
}

interface OxlintOptions {
  ignorePatterns?: string[]
  overrides?: Array<{
    files: string[]
    rules: Record<string, 'off'>
  }>
  rules?: Record<string, 'off'>
}

interface SyncOptions {
  biome?: BiomeOptions
  oxlint?: OxlintOptions
}

const pkgRoot = join(import.meta.dirname, '..')

const biomeCategories = ['a11y', 'complexity', 'correctness', 'nursery', 'performance', 'security', 'style', 'suspicious'] as const

const biomeRulesOff: string[] = [
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
  'useExplicitType',
  'useImportExtensions',
  'useNamingConvention',
  'useQwikValidLexicalScope',
  'useSingleVarDeclarator',
  'useSolidForComponent',
  'useSortedClasses'
]

const biomeIgnorePatterns = [
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
]

const resolveBiomeRuleCategories = (cwd: string): Map<string, string> => {
  const req = createRequire(join(cwd, 'package.json'))
  const schemaPath = req.resolve('@biomejs/biome/configuration_schema.json')
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8')) as {
    $defs: Record<string, { properties?: Record<string, unknown> }>
  }
  const map = new Map<string, string>()
  for (const cat of biomeCategories) {
    const key = cat.charAt(0).toUpperCase() + cat.slice(1)
    const props = schema.$defs[key]?.properties
    if (props)
      for (const rule of Object.keys(props))
        if (rule !== 'recommended' && rule !== 'all')
          map.set(rule, cat)
  }
  return map
}

const groupByCategory = (
  ruleNames: string[],
  categoryMap: Map<string, string>
): Record<string, Record<string, string>> => {
  const result: Record<string, Record<string, string>> = {}
  for (const rule of ruleNames) {
    const cat = categoryMap.get(rule)
    if (cat) {
      if (!result[cat]) result[cat] = {}
      result[cat][rule] = 'off'
    }
  }
  return result
}

const createBiomeConfig = (cwd: string, options?: BiomeOptions): Record<string, unknown> => {
  const categoryMap = resolveBiomeRuleCategories(cwd)

  const allRulesOff = [...biomeRulesOff]
  if (options?.rules)
    for (const [key, value] of Object.entries(options.rules))
      if (value === 'off') {
        const ruleName = key.includes('/') ? key.slice(key.indexOf('/') + 1) : key
        if (!allRulesOff.includes(ruleName))
          allRulesOff.push(ruleName)
      }

  const ignorePatterns = [...biomeIgnorePatterns]
  if (options?.ignorePatterns)
    for (const pattern of options.ignorePatterns) {
      const negated = pattern.startsWith('!!') ? pattern : `!!**/${pattern}`
      if (!ignorePatterns.includes(negated))
        ignorePatterns.push(negated)
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
      if (override.disableLinter)
        overrides.push({ includes: override.includes, linter: { enabled: false } })
      else if (override.rules) {
        const ruleNames: string[] = []
        for (const [key, value] of Object.entries(override.rules))
          if (value === 'off')
            ruleNames.push(key.includes('/') ? key.slice(key.indexOf('/') + 1) : key)
        overrides.push({ includes: override.includes, linter: { rules: groupByCategory(ruleNames, categoryMap) } })
      }

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
      domains: { next: 'all', project: 'all', qwik: 'all', react: 'all', solid: 'all', tailwind: 'all', test: 'all', vue: 'all' },
      rules: { a11y: 'error', complexity: 'error', correctness: 'error', nursery: 'error', performance: 'error', security: 'error', style: 'error', suspicious: 'error' }
    },
    overrides
  }
}

const createOxlintConfig = (options?: OxlintOptions): Record<string, unknown> => {
  const base = JSON.parse(readFileSync(join(pkgRoot, 'oxlintrc.json'), 'utf-8')) as {
    ignorePatterns?: string[]
    overrides?: Array<{ files: string[]; rules: Record<string, unknown> }>
    rules: Record<string, unknown>
    [key: string]: unknown
  }

  if (!options) return base

  if (options.ignorePatterns)
    base.ignorePatterns = [...(base.ignorePatterns ?? []), ...options.ignorePatterns]

  if (options.rules)
    for (const [key, value] of Object.entries(options.rules))
      base.rules[key] = value

  if (options.overrides) {
    if (!base.overrides) base.overrides = []
    for (const override of options.overrides)
      base.overrides.push({ files: override.files, rules: override.rules })
  }

  return base
}

const warnToError = (rules: Partial<Linter.RulesRecord>): Linter.RulesRecord => {
  const result: Linter.RulesRecord = {}
  for (const [key, value] of Object.entries(rules))
    if (value === undefined) result[key] = 'error'
    else if (value === 'warn' || value === 1) result[key] = 'error'
    else if (Array.isArray(value) && (value[0] === 'warn' || value[0] === 1)) result[key] = ['error', ...value.slice(1)]
    else result[key] = value

  return result
}

const cacheDir = join('node_modules', '.cache', 'lintmax')

const sync = (options?: SyncOptions) => {
  const cwd = process.cwd()
  const dir = join(cwd, cacheDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'biome.json'), `${JSON.stringify(createBiomeConfig(cwd, options?.biome), null, 2)}\n`)
  writeFileSync(join(dir, '.oxlintrc.json'), `${JSON.stringify(createOxlintConfig(options?.oxlint), null, 2)}\n`)
}

const defineConfig = (options: SyncOptions): SyncOptions => options

export type { BiomeOptions, OxlintOptions, SyncOptions }
export { cacheDir, createBiomeConfig, createOxlintConfig, defineConfig, sync, warnToError }
