import type { Linter } from 'eslint'
import { $, file, write } from 'bun'
import { lstat } from 'node:fs/promises'
import { join as joinFs, relative as relativePath } from 'node:path'
import type {
  BiomeOptions,
  EslintImportAppendEntry,
  EslintOptions,
  OxlintOptions,
  SyncOptions,
  TailwindOption
} from './lintmax-types.js'
import {
  BIOME_IGNORE_PATTERNS,
  BIOME_PATTERN_RULE_OVERRIDES,
  BIOME_RULES_OFF,
  DEFAULT_SHARED_IGNORE_PATTERNS,
  OXLINT_PATTERN_RULE_OVERRIDES,
  SHARED_OVERRIDE_SYMBOL_KEY
} from './constants.js'
import { cacheDir, ensureDirectory, readRequiredJson } from './core.js'
import {
  assertJsonSerializable,
  assertObject,
  assertOptionalString,
  findUnknownRules,
  normalizeIgnorePattern,
  normalizeObjectListInput,
  normalizePathListInput,
  normalizeRulesOffInput,
  normalizeTailwindOption,
  stripPluginNamespace
} from './normalize.js'
import { dirnamePath, fromFileUrl, joinPath } from './path.js'

const SHARED_OVERRIDE_KEYS = ['biome', 'eslint', 'oxlint'] as const
interface BiomeOverrideConfig {
  css?: { parser: { tailwindDirectives: boolean } }
  includes: string[]
  linter?: {
    rules?: Record<string, Record<string, 'off'>>
  }
}
interface ParsedBiomeSyncConfig {
  ignores?: readonly string[]
  off?: readonly string[]
  overrides?: {
    includes: readonly string[]
    off: readonly string[]
  }[]
}
interface ParsedEslintSyncConfig {
  append?: readonly ParsedSyncEslintAppendEntry[]
  ignores?: readonly string[]
  off?: readonly string[]
}
interface ParsedLinterSyncCommon {
  ignores?: readonly string[]
  off?: readonly string[]
}
interface ParsedOxlintSyncConfig {
  ignores?: readonly string[]
  off?: readonly string[]
  overrides?: {
    files: readonly string[]
    off: readonly string[]
  }[]
}
type ParsedSyncEslintAppendEntry = ParsedSyncEslintAppendImportEntry | ParsedSyncEslintAppendInlineEntry
interface ParsedSyncEslintAppendImportEntry {
  files?: readonly string[]
  from: string
  ignores?: readonly string[]
  name: string
}
interface ParsedSyncEslintAppendInlineEntry {
  config: Record<string, unknown>
}
interface ParsedSyncOptions extends ParsedTopLevelSyncScalars {
  biome?: ParsedBiomeSyncConfig
  eslint?: ParsedEslintSyncConfig
  oxlint?: ParsedOxlintSyncConfig
}
interface ParsedTopLevelSyncScalars {
  sharedOverrides: SharedOverrideEntry[]
  tailwind?: TailwindOption
  topLevelIgnores: string[]
  tsconfigRootDir?: string
}
interface SharedOverrideEntry {
  biomeRules?: Record<string, 'off'>
  eslintRules?: Record<string, 'off'>
  files: string[]
  oxlintRules?: Record<string, 'off'>
}
interface SyncEslintImportRef {
  exportName: string
  files?: readonly string[]
  ignores?: readonly string[]
  source: string
}
const ESLINT_IMPORT_MARKER_KEY = '__lintmaxImportRef'
const ESLINT_IMPORT_SENTINEL = 'eslint-import'
const pkgRoot = dirnamePath(fromFileUrl(import.meta.resolve('../package.json')))
const normalizeBiomeIgnorePattern = ({ pattern }: { pattern: string }): string => {
  if (pattern.startsWith('!!')) return pattern
  const trimmed = normalizeIgnorePattern({ pattern })
  return trimmed.startsWith('**/') ? `!!${trimmed}` : `!!**/${trimmed}`
}
const resolveSchemaPath = async ({ cwd }: { cwd: string }) => {
  try {
    return fromFileUrl(import.meta.resolve('@biomejs/biome/configuration_schema.json'))
  } catch (error) {
    if (!(error instanceof Error)) throw error
  }
  const consumerCandidate = joinPath(cwd, 'node_modules', '@biomejs', 'biome', 'configuration_schema.json')
  if (await file(consumerCandidate).exists()) return consumerCandidate
  throw new Error('Cannot find module @biomejs/biome/configuration_schema.json')
}
const resolveBiomeSchema = async ({
  cwd
}: {
  cwd: string
}): Promise<{ categories: string[]; ruleMap: Map<string, string> }> => {
  const schemaPath = await resolveSchemaPath({ cwd })
  const schema = readRequiredJson<{
    $defs: Record<string, { properties?: Record<string, unknown> }>
  }>(await file(schemaPath).text())
  const rulesProps = schema.$defs.Rules?.properties ?? {}
  const categories = Object.keys(rulesProps).filter(k => {
    const groupDef = schema.$defs[k.charAt(0).toUpperCase() + k.slice(1)]
    return groupDef?.properties !== undefined
  })
  const ruleMap = new Map<string, string>()
  for (const cat of categories) {
    const key = cat.charAt(0).toUpperCase() + cat.slice(1)
    const props = schema.$defs[key]?.properties
    if (props) for (const rule of Object.keys(props)) if (rule !== 'recommended' && rule !== 'all') ruleMap.set(rule, cat)
  }
  return { categories, ruleMap }
}
const extractRuleNames = (rules: Record<string, 'off'>): string[] => {
  const names: string[] = []
  for (const key of Object.keys(rules)) names.push(stripPluginNamespace({ rule: key }))
  return names
}
const assertKnownBiomeRuleNames = ({
  categoryMap,
  label,
  rules
}: {
  categoryMap: Map<string, string>
  label: string
  rules: Record<string, 'off'>
}) => {
  const unknown = findUnknownRules({
    knownRules: new Set(categoryMap.keys()),
    normalizeRule: (rule: string) => stripPluginNamespace({ rule }),
    rules
  })
  if (unknown.length > 0) throw new Error(`${label} contains unknown biome rules: ${unknown.join(', ')}`)
}
const assertKnownOxlintRuleNames = ({
  label,
  rules,
  knownRules
}: {
  knownRules: Set<string>
  label: string
  rules: Record<string, 'off'>
}) => {
  const unknown = findUnknownRules({
    knownRules,
    rules
  })
  if (unknown.length > 0) throw new Error(`${label} contains unknown oxlint rules: ${unknown.join(', ')}`)
}
const groupByCategory = ({
  categoryMap,
  ruleNames
}: {
  categoryMap: Map<string, string>
  ruleNames: readonly string[]
}): Record<string, Record<string, 'off'>> => {
  const result: Record<string, Record<string, 'off'>> = {}
  for (const rule of ruleNames) {
    const cat = categoryMap.get(rule)
    if (cat) {
      result[cat] ??= {}
      result[cat][rule] = 'off'
    }
  }
  return result
}
const normalizeSharedOverrideItem = ({
  index,
  item,
  label
}: {
  index: number
  item: Record<string, unknown>
  label: string
}): SharedOverrideEntry => {
  const files = normalizePathListInput({
    label: `${label}[${index}].files`,
    value: item.files
  })
  const biomeRules = normalizeRulesOffInput({ label: `${label}[${index}].biome`, value: item.biome })
  const eslintRules = normalizeRulesOffInput({ label: `${label}[${index}].eslint`, value: item.eslint })
  const oxlintRules = normalizeRulesOffInput({ label: `${label}[${index}].oxlint`, value: item.oxlint })
  if (!(biomeRules || eslintRules || oxlintRules))
    throw new Error(`${label}[${index}] must define at least one action: biome, eslint, or oxlint`)
  return {
    biomeRules,
    eslintRules,
    files,
    oxlintRules
  }
}
const normalizeSharedOverrides = ({
  label,
  value
}: {
  label: string
  value: SyncOptions['overrides']
}): SharedOverrideEntry[] => {
  const out: SharedOverrideEntry[] = []
  if (value === undefined) return out
  const obj = assertObject({ label, value })
  const entries: Record<string, unknown>[] = []
  for (const [pattern, rawOverride] of Object.entries(obj)) {
    const override = assertObject({
      label: `${label}.${pattern}`,
      value: rawOverride
    })
    for (const key of Object.keys(override))
      if (!SHARED_OVERRIDE_KEYS.some(k => k === key))
        throw new Error(`${label}.${pattern}.${key} is not supported. Use biome, eslint, or oxlint.`)
    entries.push({
      ...override,
      files: [pattern]
    })
  }
  for (const [i, item] of entries.entries())
    out.push(
      normalizeSharedOverrideItem({
        index: i,
        item,
        label
      })
    )
  return out
}
const collectSharedRuleOverrides = ({
  ruleKey,
  sharedOverrides
}: {
  ruleKey: 'biomeRules' | 'eslintRules' | 'oxlintRules'
  sharedOverrides: SharedOverrideEntry[]
}): { files: string[]; rules: Record<string, 'off'> }[] => {
  const out: { files: string[]; rules: Record<string, 'off'> }[] = []
  for (const override of sharedOverrides) {
    const rules = override[ruleKey]
    if (rules) out.push({ files: override.files, rules })
  }
  return out
}
const parseLinterOffOverrides = ({
  assertKnownRules,
  fileKey,
  label,
  requireOff = false,
  value
}: {
  assertKnownRules?: (rules: Record<string, 'off'>) => void
  fileKey: 'files' | 'includes'
  label: string
  requireOff?: boolean
  value: unknown
}): { files: string[]; rules: Record<string, 'off'> }[] => {
  const out: { files: string[]; rules: Record<string, 'off'> }[] = []
  for (const [i, override] of normalizeObjectListInput({
    label,
    value
  }).entries()) {
    const itemLabel = requireOff ? `${label}[${i}]` : label
    if (requireOff && override[fileKey] === undefined) throw new Error(`${label}[${i}].${fileKey} is required`)
    if (requireOff && override.off === undefined) throw new Error(`${label}[${i}].off is required`)
    const normalizedOverrideRules = normalizeRulesOffInput({
      label: `${itemLabel}.off`,
      value: override.off
    })
    if (normalizedOverrideRules) {
      assertKnownRules?.(normalizedOverrideRules)
      out.push({
        files: normalizePathListInput({
          label: `${itemLabel}.${fileKey}`,
          value: override[fileKey]
        }),
        rules: normalizedOverrideRules
      })
    }
  }
  return out
}
const parseTopLevelSyncScalars = ({ options }: { options: SyncOptions }): ParsedTopLevelSyncScalars => {
  if (options.compact !== undefined && typeof options.compact !== 'boolean') throw new Error('compact must be a boolean')
  const tailwind = normalizeTailwindOption({
    label: 'tailwind',
    value: options.tailwind
  })
  assertOptionalString({
    label: 'tsconfigRootDir',
    value: options.tsconfigRootDir
  })
  const sharedOverrides =
    options.overrides === undefined
      ? []
      : normalizeSharedOverrides({
          label: 'overrides',
          value: options.overrides
        })
  const topLevelIgnores =
    options.ignores === undefined
      ? []
      : normalizePathListInput({
          label: 'ignores',
          value: options.ignores
        })
  return {
    sharedOverrides,
    tailwind,
    topLevelIgnores,
    tsconfigRootDir: options.tsconfigRootDir
  }
}
const parseLinterSyncCommon = ({
  linter,
  value
}: {
  linter: 'biome' | 'eslint' | 'oxlint'
  value: Record<string, unknown>
}): ParsedLinterSyncCommon => {
  const parsed: ParsedLinterSyncCommon = {}
  if (value.ignores !== undefined)
    parsed.ignores = normalizePathListInput({
      label: `${linter}.ignores`,
      value: value.ignores
    })
  const normalizedOffRules = normalizeRulesOffInput({
    label: `${linter}.off`,
    value: value.off
  })
  if (normalizedOffRules) parsed.off = Object.keys(normalizedOffRules)
  return parsed
}
const validateBiomeSyncConfig = ({ biome }: { biome: unknown }): ParsedBiomeSyncConfig => {
  const biomeValue = assertObject({ label: 'biome config', value: biome })
  const parsedCommon = parseLinterSyncCommon({
    linter: 'biome',
    value: biomeValue
  })
  const parsedOverrides = parseLinterOffOverrides({
    fileKey: 'includes',
    label: 'biome.overrides',
    requireOff: true,
    value: biomeValue.overrides
  }).map(override => ({
    includes: override.files,
    off: Object.keys(override.rules)
  }))
  const parsed: ParsedBiomeSyncConfig = {
    ...parsedCommon
  }
  if (parsedOverrides.length > 0) parsed.overrides = parsedOverrides
  return parsed
}
const parseEslintImportEntry = ({
  index,
  item
}: {
  index: number
  item: Record<string, unknown>
}): ParsedSyncEslintAppendEntry => {
  const allowedKeys = new Set(['$lintmax', 'files', 'from', 'ignores', 'name'])
  for (const key of Object.keys(item))
    if (!allowedKeys.has(key))
      throw new Error(
        `eslint.append[${index}].${key} is not supported for eslint-import entries. Use from, name, files, ignores.`
      )
  assertOptionalString({
    label: `eslint.append[${index}].from`,
    value: item.from
  })
  const { from } = item
  if (typeof from !== 'string' || from.trim().length === 0)
    throw new Error(`eslint.append[${index}].from must be a non-empty string`)
  assertOptionalString({
    label: `eslint.append[${index}].name`,
    value: item.name
  })
  const files =
    item.files === undefined
      ? undefined
      : normalizePathListInput({
          label: `eslint.append[${index}].files`,
          value: item.files
        })
  const ignores =
    item.ignores === undefined
      ? undefined
      : normalizePathListInput({
          label: `eslint.append[${index}].ignores`,
          value: item.ignores
        })
  return {
    files,
    from,
    ignores,
    name: typeof item.name === 'string' && item.name.trim().length > 0 ? item.name : 'default'
  }
}
const parseEslintAppendEntry = ({
  index,
  item
}: {
  index: number
  item: Record<string, unknown>
}): ParsedSyncEslintAppendEntry => {
  const { $lintmax: marker } = item
  if (marker === ESLINT_IMPORT_SENTINEL) return parseEslintImportEntry({ index, item })
  if ('$lintmax' in item)
    throw new Error(
      `eslint.append[${index}].$lintmax has unsupported value. Use eslintImport(...) or remove the $lintmax key.`
    )
  assertJsonSerializable({
    label: `eslint.append[${index}]`,
    value: item
  })
  return { config: item }
}
const validateEslintSyncConfig = ({ eslint }: { eslint: unknown }): ParsedEslintSyncConfig => {
  const eslintValue = assertObject({ label: 'eslint config', value: eslint })
  const parsedCommon = parseLinterSyncCommon({
    linter: 'eslint',
    value: eslintValue
  })
  const parsed: ParsedEslintSyncConfig = {
    ...parsedCommon
  }
  if (eslintValue.tailwind !== undefined)
    throw new Error('eslint.tailwind is not supported in sync config. Use top-level tailwind.')
  if (eslintValue.tsconfigRootDir !== undefined)
    throw new Error('eslint.tsconfigRootDir is not supported in sync config. Use top-level tsconfigRootDir.')
  if (eslintValue.append !== undefined) {
    const appendEntries = normalizeObjectListInput({
      label: 'eslint.append',
      value: eslintValue.append
    })
    parsed.append = appendEntries.map((item, i) =>
      parseEslintAppendEntry({
        index: i,
        item
      })
    )
  }
  return parsed
}
const validateOxlintSyncConfig = ({ oxlint }: { oxlint: unknown }): ParsedOxlintSyncConfig => {
  const oxlintValue = assertObject({ label: 'oxlint config', value: oxlint })
  const parsedCommon = parseLinterSyncCommon({
    linter: 'oxlint',
    value: oxlintValue
  })
  const parsedOverrides = parseLinterOffOverrides({
    fileKey: 'files',
    label: 'oxlint.overrides',
    requireOff: true,
    value: oxlintValue.overrides
  }).map(override => ({
    files: override.files,
    off: Object.keys(override.rules)
  }))
  const parsed: ParsedOxlintSyncConfig = {
    ...parsedCommon
  }
  if (parsedOverrides.length > 0) parsed.overrides = parsedOverrides
  return parsed
}
const validateSyncOptions = ({ options }: { options?: SyncOptions }): ParsedSyncOptions => {
  if (!options)
    return {
      sharedOverrides: [],
      topLevelIgnores: []
    }
  const parsedTopLevelScalars = parseTopLevelSyncScalars({ options })
  const parsed: ParsedSyncOptions = {
    ...parsedTopLevelScalars
  }
  if (options.biome) parsed.biome = validateBiomeSyncConfig({ biome: options.biome })
  if (options.eslint) parsed.eslint = validateEslintSyncConfig({ eslint: options.eslint })
  if (options.oxlint) parsed.oxlint = validateOxlintSyncConfig({ oxlint: options.oxlint })
  return parsed
}
const mergeUniquePatterns = ({ into, patterns }: { into: string[]; patterns: readonly string[] | undefined }) => {
  if (!patterns) return
  for (const raw of patterns) {
    const pattern = normalizeIgnorePattern({ pattern: raw })
    if (pattern.length > 0 && !into.includes(pattern)) into.push(pattern)
  }
}
const mergeIgnorePatternGroups = ({ groups }: { groups: (readonly string[] | undefined)[] }): string[] => {
  const merged: string[] = []
  for (const group of groups) mergeUniquePatterns({ into: merged, patterns: group })
  return merged
}
const buildUserIgnorePatterns = ({ topLevelIgnores }: { topLevelIgnores: readonly string[] }): string[] =>
  mergeIgnorePatternGroups({
    groups: [topLevelIgnores]
  })
const buildLinterOptionsWithSharedOverrides = <
  TOption extends {
    off?: readonly string[]
    overrides?: readonly TOverride[]
  },
  TOverride
>({
  createEmpty,
  ruleKey,
  sharedOverrides,
  source,
  mapSharedOverride
}: {
  createEmpty: () => TOption
  mapSharedOverride: (override: { files: string[]; rules: Record<string, 'off'> }) => TOverride
  ruleKey: 'biomeRules' | 'oxlintRules'
  sharedOverrides: SharedOverrideEntry[]
  source?: TOption
}): TOption | undefined => {
  if (!source && sharedOverrides.length <= 0) return source
  const next: TOption = source ? { ...source } : createEmpty()
  next.off = source?.off
  const sharedRuleOverrides = collectSharedRuleOverrides({
    ruleKey,
    sharedOverrides
  }).map(mapSharedOverride)
  const localOverrides = source?.overrides ?? []
  const mergedOverrides = [...sharedRuleOverrides, ...localOverrides]
  if (mergedOverrides.length > 0) next.overrides = mergedOverrides
  return next
}
const buildBiomeOptions = ({
  biomeSource,
  sharedOverrides
}: {
  biomeSource?: BiomeOptions
  sharedOverrides: SharedOverrideEntry[]
}): BiomeOptions | undefined =>
  buildLinterOptionsWithSharedOverrides({
    createEmpty: () => ({}),
    mapSharedOverride: override => ({
      includes: override.files,
      off: Object.keys(override.rules)
    }),
    ruleKey: 'biomeRules',
    sharedOverrides,
    source: biomeSource
  })
const buildOxlintOptions = ({
  oxlintSource,
  sharedOverrides
}: {
  oxlintSource?: OxlintOptions
  sharedOverrides: SharedOverrideEntry[]
}): OxlintOptions | undefined =>
  buildLinterOptionsWithSharedOverrides({
    createEmpty: () => ({}),
    mapSharedOverride: override => ({
      files: override.files,
      off: Object.keys(override.rules)
    }),
    ruleKey: 'oxlintRules',
    sharedOverrides,
    source: oxlintSource
  })
const buildEslintIgnorePatterns = ({
  eslintSource,
  userIgnorePatterns
}: {
  eslintSource?: ParsedEslintSyncConfig
  userIgnorePatterns: string[]
}): string[] =>
  mergeIgnorePatternGroups({
    groups: [
      userIgnorePatterns,
      eslintSource?.ignores === undefined
        ? undefined
        : normalizePathListInput({
            label: 'eslint.ignores',
            value: eslintSource.ignores
          })
    ]
  })
const buildEslintOptions = ({
  eslintSource,
  sharedOverrides,
  tailwind,
  tsconfigRootDir,
  userIgnorePatterns
}: {
  eslintSource?: ParsedEslintSyncConfig
  sharedOverrides: SharedOverrideEntry[]
  tailwind?: TailwindOption
  tsconfigRootDir?: string
  userIgnorePatterns: string[]
}): {
  eslintImportRefs: SyncEslintImportRef[]
  eslintOptions: EslintOptions | undefined
  sharedOverrideAppendIndexes: number[]
} => {
  const eslintIgnores = buildEslintIgnorePatterns({
    eslintSource,
    userIgnorePatterns
  })
  const sharedRuleOverrides = collectSharedRuleOverrides({
    ruleKey: 'eslintRules',
    sharedOverrides
  }).map(override => ({
    files: override.files,
    rules: override.rules
  }))
  const sharedOverrideAppendIndexes = sharedRuleOverrides.map((_, index) => index)
  const eslintImportRefs: SyncEslintImportRef[] = []
  if (eslintSource || sharedOverrides.length > 0 || tailwind !== undefined || tsconfigRootDir !== undefined) {
    const eslintOptions: EslintOptions = {
      off: eslintSource?.off
    }
    if (eslintIgnores.length > 0) eslintOptions.ignores = eslintIgnores
    const appendEntries: Linter.Config[] = []
    for (const entry of eslintSource?.append ?? [])
      if ('config' in entry) appendEntries.push(entry.config)
      else {
        const importRefIndex = eslintImportRefs.push({
          exportName: entry.name,
          files: entry.files,
          ignores: entry.ignores,
          source: entry.from
        })
        appendEntries.push({
          [ESLINT_IMPORT_MARKER_KEY]: importRefIndex - 1
          /** biome-ignore lint/nursery/noUnsafeTypeAssertion: marker object is intentionally promoted to the external ESLint config type */
        } as Linter.Config)
      }
    const mergedAppend: Linter.Config[] = [...sharedRuleOverrides, ...appendEntries]
    if (mergedAppend.length > 0) eslintOptions.append = mergedAppend
    const mergedTailwind = normalizeTailwindOption({
      label: 'tailwind',
      value: tailwind
    })
    eslintOptions.tailwind = mergedTailwind ?? true
    eslintOptions.tsconfigRootDir = tsconfigRootDir
    return {
      eslintImportRefs,
      eslintOptions,
      sharedOverrideAppendIndexes
    }
  }
  if (eslintIgnores.length === 0)
    return {
      eslintImportRefs,
      eslintOptions: undefined,
      sharedOverrideAppendIndexes
    }
  return {
    eslintImportRefs,
    eslintOptions: {
      ignores: eslintIgnores,
      tailwind: true
    },
    sharedOverrideAppendIndexes
  }
}
const normalizeLinterOffOverrides = ({
  assertKnownRules,
  fileKey,
  label,
  value
}: {
  assertKnownRules?: (rules: Record<string, 'off'>) => void
  fileKey: 'files' | 'includes'
  label: string
  value: unknown
}): { files: string[]; rules: Record<string, 'off'> }[] =>
  parseLinterOffOverrides({
    assertKnownRules,
    fileKey,
    label,
    value
  })
const normalizeKnownOffRules = ({
  assertKnownRules,
  label,
  value
}: {
  assertKnownRules?: (rules: Record<string, 'off'>) => void
  label: string
  value: unknown
}): Record<string, 'off'> | undefined => {
  const normalizedRules = normalizeRulesOffInput({
    label,
    value
  })
  if (!normalizedRules) return
  assertKnownRules?.(normalizedRules)
  return normalizedRules
}
const createBiomeConfig = async ({
  cwd,
  options,
  sharedIgnorePatterns
}: {
  cwd: string
  options?: BiomeOptions
  sharedIgnorePatterns?: string[]
}): Promise<Record<string, unknown>> => {
  const { categories, ruleMap } = await resolveBiomeSchema({ cwd })
  const allRulesOff = [...BIOME_RULES_OFF]
  const normalizedRules = normalizeKnownOffRules({
    assertKnownRules: rules =>
      assertKnownBiomeRuleNames({
        categoryMap: ruleMap,
        label: 'biome.off',
        rules
      }),
    label: 'biome.off',
    value: options?.off
  })
  if (normalizedRules)
    for (const key of Object.keys(normalizedRules)) {
      const ruleName = stripPluginNamespace({ rule: key })
      if (!allRulesOff.includes(ruleName)) allRulesOff.push(ruleName)
    }
  const ignorePatterns = [...BIOME_IGNORE_PATTERNS]
  const mergedIgnorePatterns = mergeIgnorePatternGroups({
    groups: [
      sharedIgnorePatterns,
      options?.ignores === undefined
        ? undefined
        : normalizePathListInput({
            label: 'biome.ignores',
            value: options.ignores
          })
    ]
  })
  for (const pattern of mergedIgnorePatterns) {
    const negated = normalizeBiomeIgnorePattern({ pattern })
    if (!ignorePatterns.includes(negated)) ignorePatterns.push(negated)
  }
  const overrides: BiomeOverrideConfig[] = [
    {
      css: { parser: { tailwindDirectives: true } },
      includes: ['**'],
      linter: {
        rules: groupByCategory({
          categoryMap: ruleMap,
          ruleNames: allRulesOff
        })
      }
    },
    {
      includes: ['**'],
      linter: {
        rules: {
          nursery: {
            useReactFunctionComponentDefinition: { level: 'error', options: { namedComponents: 'arrowFunction' } }
          }
        }
      }
    }
  ]
  for (const override of BIOME_PATTERN_RULE_OVERRIDES)
    overrides.push({
      includes: [...override.includes],
      linter: {
        rules: groupByCategory({
          categoryMap: ruleMap,
          ruleNames: override.rules
        })
      }
    })
  for (const override of normalizeLinterOffOverrides({
    assertKnownRules: rules =>
      assertKnownBiomeRuleNames({
        categoryMap: ruleMap,
        label: 'biome.overrides.off',
        rules
      }),
    fileKey: 'includes',
    label: 'biome.overrides',
    value: options?.overrides
  }))
    overrides.push({
      includes: override.files,
      linter: {
        rules: groupByCategory({
          categoryMap: ruleMap,
          ruleNames: extractRuleNames(override.rules)
        })
      }
    })
  return {
    $schema: 'https://biomejs.dev/schemas/latest/schema.json',
    assist: { actions: { source: { organizeImports: 'off' } } },
    css: {
      formatter: { enabled: true, quoteStyle: 'single' },
      parser: { tailwindDirectives: true }
    },
    files: {
      experimentalScannerIgnores: ignorePatterns.map(p => (p.startsWith('!!') ? p.slice(2) : p)),
      includes: ['**', ...ignorePatterns]
    },
    formatter: { indentStyle: 'space', lineWidth: 123 },
    javascript: {
      formatter: {
        arrowParentheses: 'asNeeded',
        bracketSameLine: true,
        jsxQuoteStyle: 'single',
        quoteStyle: 'single',
        semicolons: 'asNeeded',
        trailingCommas: 'none'
      },
      globals: ['Bun']
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
}
const createOxlintConfig = async ({
  options,
  sharedIgnorePatterns
}: {
  options?: OxlintOptions
  sharedIgnorePatterns?: string[]
}): Promise<Record<string, unknown>> => {
  const base = readRequiredJson<{
    [key: string]: unknown
    ignorePatterns?: string[]
    overrides?: { files: string[]; rules: Record<string, unknown> }[]
    rules: Record<string, unknown>
  }>(await file(joinPath(pkgRoot, 'oxlintrc.json')).text())
  const knownRules = new Set<string>([
    ...Object.keys(base.rules),
    ...(base.overrides ?? []).flatMap(override => Object.keys(override.rules)),
    ...OXLINT_PATTERN_RULE_OVERRIDES.flatMap(override => Object.keys(override.rules))
  ])
  const mergedIgnorePatterns = mergeIgnorePatternGroups({
    groups: [
      sharedIgnorePatterns,
      options?.ignores === undefined
        ? undefined
        : normalizePathListInput({
            label: 'oxlint.ignores',
            value: options.ignores
          })
    ]
  })
  base.overrides ??= []
  for (const override of OXLINT_PATTERN_RULE_OVERRIDES)
    base.overrides.push({
      files: [...override.files],
      rules: { ...override.rules }
    })
  if (mergedIgnorePatterns.length > 0) {
    base.ignorePatterns ??= []
    for (const pattern of mergedIgnorePatterns)
      if (!base.ignorePatterns.includes(pattern)) base.ignorePatterns.push(pattern)
  }
  if (!options) return base
  const normalizedRules = normalizeKnownOffRules({
    assertKnownRules: rules =>
      assertKnownOxlintRuleNames({
        knownRules,
        label: 'oxlint.off',
        rules
      }),
    label: 'oxlint.off',
    value: options.off
  })
  if (normalizedRules) for (const [key, value] of Object.entries(normalizedRules)) base.rules[key] = value
  for (const override of normalizeLinterOffOverrides({
    assertKnownRules: rules =>
      assertKnownOxlintRuleNames({
        knownRules,
        label: 'oxlint.overrides.off',
        rules
      }),
    fileKey: 'files',
    label: 'oxlint.overrides',
    value: options.overrides
  }))
    base.overrides.push({
      files: override.files,
      rules: override.rules
    })
  return base
}
const resolveSyncImportSource = ({ cwd, dir, source }: { cwd: string; dir: string; source: string }) => {
  if (!(source.startsWith('.') || source.startsWith('..'))) return source
  const absoluteSource = joinPath(cwd, source)
  const relativeSource = relativePath(dir, absoluteSource).replaceAll('\\', '/')
  return relativeSource.startsWith('.') ? relativeSource : `./${relativeSource}`
}
const discoverSymlinkPatterns = async ({ root }: { root: string }): Promise<readonly string[]> => {
  const result = await $`git -C ${root} ls-files -z --cached --others --exclude-standard`.quiet().nothrow()
  if (result.exitCode !== 0) return []
  const entries = result.stdout
    .toString()
    .split('\0')
    .filter(e => e.length > 0)
  const symlinkFlags = await Promise.all(
    entries.map(async entry => {
      try {
        return (await lstat(joinFs(root, entry))).isSymbolicLink()
      } catch {
        return false
      }
    })
  )
  const out: string[] = []
  for (const [index, entry] of entries.entries()) if (symlinkFlags[index]) out.push(entry)
  return out
}
const sync = async (options?: SyncOptions): Promise<void> => {
  const { biome, eslint, oxlint, sharedOverrides, tailwind, topLevelIgnores, tsconfigRootDir } = validateSyncOptions({
    options
  })
  const cwd = process.cwd()
  const dir = joinPath(cwd, cacheDir)
  const userIgnorePatterns = buildUserIgnorePatterns({ topLevelIgnores })
  const symlinkIgnorePatterns = await discoverSymlinkPatterns({ root: cwd })
  const sharedIgnorePatterns = mergeIgnorePatternGroups({
    groups: [DEFAULT_SHARED_IGNORE_PATTERNS, symlinkIgnorePatterns, userIgnorePatterns]
  })
  const biomeOptions = buildBiomeOptions({
    biomeSource: biome,
    sharedOverrides
  })
  const oxlintOptions = buildOxlintOptions({
    oxlintSource: oxlint,
    sharedOverrides
  })
  const { eslintImportRefs, eslintOptions, sharedOverrideAppendIndexes } = buildEslintOptions({
    eslintSource: eslint,
    sharedOverrides,
    tailwind,
    tsconfigRootDir,
    userIgnorePatterns
  })
  await ensureDirectory({ directory: dir })
  const biomeConfig = await createBiomeConfig({
    cwd,
    options: biomeOptions,
    sharedIgnorePatterns
  })
  const oxlintConfig = await createOxlintConfig({
    options: oxlintOptions,
    sharedIgnorePatterns
  })
  const normalizedImportRefs = eslintImportRefs.map(importRef => ({
    exportName: importRef.exportName,
    files: importRef.files,
    ignores: importRef.ignores,
    source: resolveSyncImportSource({
      cwd,
      dir,
      source: importRef.source
    })
  }))
  const importStatements = normalizedImportRefs
    .map((importRef, index) => `import * as __lintmaxAppendImport${index} from ${JSON.stringify(importRef.source)}`)
    .join('\n')
  const importEntries = normalizedImportRefs
    .map(
      (importRef, index) =>
        `  { exportName: ${JSON.stringify(importRef.exportName)}, files: ${JSON.stringify(importRef.files ?? null)}, ignores: ${JSON.stringify(importRef.ignores ?? null)}, module: __lintmaxAppendImport${index} }`
    )
    .join(',\n')
  const importExpansion =
    normalizedImportRefs.length === 0
      ? ''
      : `\nconst appendImports = [\n${importEntries}\n]\nconst normalizedAppend = []\nfor (const entry of options.append ?? []) {\n  if (entry && typeof entry === 'object' && !Array.isArray(entry) && ${JSON.stringify(ESLINT_IMPORT_MARKER_KEY)} in entry) {\n    const importIndex = entry[${JSON.stringify(ESLINT_IMPORT_MARKER_KEY)}]\n    if (typeof importIndex !== 'number' || !Number.isInteger(importIndex))\n      throw new Error('Invalid eslint import marker index in generated config')\n    const importRef = appendImports[importIndex]\n    if (!importRef) throw new Error(\`Missing eslint import ref for index \${importIndex}\`)\n    const imported = importRef.module[importRef.exportName]\n    const importedEntries = Array.isArray(imported) ? imported : [imported]\n    for (const importedEntry of importedEntries) {\n      if (!importedEntry || typeof importedEntry !== 'object' || Array.isArray(importedEntry))\n        throw new Error(\`Imported eslint append from \${importRef.exportName} must resolve to config object(s)\`)\n      normalizedAppend.push({\n        ...importedEntry,\n        ...(Array.isArray(importRef.files) ? { files: [...importRef.files] } : {}),\n        ...(Array.isArray(importRef.ignores) ? { ignores: [...importRef.ignores] } : {})\n      })\n    }\n    continue\n  }\n  normalizedAppend.push(entry)\n}\noptions.append = normalizedAppend\n`
  const importStatementsBlock = importStatements.length > 0 ? `${importStatements}\n` : ''
  const eslintConfig = eslintOptions
    ? `${importStatementsBlock}import { eslint } from 'lintmax/eslint'\nconst options = ${JSON.stringify(eslintOptions)}\nfor (const index of ${JSON.stringify(sharedOverrideAppendIndexes)}) {\n  const entry = options.append?.[index]\n  if (entry && typeof entry === 'object') entry[Symbol.for(${JSON.stringify(SHARED_OVERRIDE_SYMBOL_KEY)})] = true\n}${importExpansion}export default await eslint(options)\n`
    : "export { default } from 'lintmax/eslint'\n"
  const runtimeConfig = { comments: options?.comments !== false, compact: options?.compact !== false }
  await write(joinPath(dir, 'biome.json'), `${JSON.stringify(biomeConfig, null, 2)}\n`)
  await write(joinPath(dir, '.oxlintrc.json'), `${JSON.stringify(oxlintConfig, null, 2)}\n`)
  await write(joinPath(dir, 'eslint.generated.mjs'), eslintConfig)
  await write(joinPath(dir, 'lintmax.json'), `${JSON.stringify(runtimeConfig, null, 2)}\n`)
}
const eslintImport = ({
  files,
  from,
  ignores,
  name
}: Omit<EslintImportAppendEntry, '$lintmax'>): EslintImportAppendEntry => {
  const entry: EslintImportAppendEntry = {
    $lintmax: ESLINT_IMPORT_SENTINEL,
    from
  }
  if (files !== undefined) entry.files = files
  if (ignores !== undefined) entry.ignores = ignores
  if (name !== undefined) entry.name = name
  return entry
}
const defineConfig = <T extends SyncOptions>(options: T): T => {
  validateSyncOptions({ options })
  return options
}
export type { EslintImportAppendEntry, SyncOptions }
export { defineConfig, eslintImport, sync }
