import type { Linter } from 'eslint'

import { readFileSync, writeFileSync } from 'node:fs'
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

const warnToError = (rules: Partial<Linter.RulesRecord>): Linter.RulesRecord => {
  const result: Linter.RulesRecord = {}
  for (const [key, value] of Object.entries(rules))
    if (value === undefined) result[key] = 'error'
    else if (value === 'warn' || value === 1) result[key] = 'error'
    else if (Array.isArray(value) && (value[0] === 'warn' || value[0] === 1)) result[key] = ['error', ...value.slice(1)]
    else result[key] = value

  return result
}

const mergeBiomeRules = (
  target: Record<string, Record<string, string>>,
  rules: Record<string, 'off'>
) => {
  for (const [key, value] of Object.entries(rules)) {
    const slash = key.indexOf('/')
    if (slash !== -1) {
      const category = key.slice(0, slash)
      const rule = key.slice(slash + 1)
      if (!target[category]) target[category] = {}
      target[category][rule] = value
    }
  }
}

const createBiomeConfig = (options?: BiomeOptions): Record<string, unknown> => {
  const base = JSON.parse(readFileSync(join(pkgRoot, 'biome.json'), 'utf-8')) as {
    files: { includes: string[] }
    overrides: Array<{ includes?: string[]; linter: { enabled?: boolean; rules?: Record<string, Record<string, string>> } }>
    [key: string]: unknown
  }

  if (!options) return base

  if (options.ignorePatterns)
    for (const pattern of options.ignorePatterns) {
      const negated = pattern.startsWith('!!') ? pattern : `!!**/${pattern}`
      if (!base.files.includes.includes(negated))
        base.files.includes.push(negated)
    }

  if (options.rules) {
    const catchAllRules = base.overrides[0]?.linter.rules
    if (catchAllRules)
      mergeBiomeRules(catchAllRules, options.rules)
  }

  if (options.overrides)
    for (const override of options.overrides)
      if (override.disableLinter)
        base.overrides.push({ includes: override.includes, linter: { enabled: false } })
      else if (override.rules) {
        const rulesObj: Record<string, Record<string, string>> = {}
        mergeBiomeRules(rulesObj, override.rules)
        base.overrides.push({ includes: override.includes, linter: { rules: rulesObj } })
      }

  return base
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

const sync = (options?: SyncOptions) => {
  const cwd = process.cwd()
  writeFileSync(join(cwd, 'biome.json'), `${JSON.stringify(createBiomeConfig(options?.biome), null, 2)}\n`)
  writeFileSync(join(cwd, '.oxlintrc.json'), `${JSON.stringify(createOxlintConfig(options?.oxlint), null, 2)}\n`)
}

export type { BiomeOptions, OxlintOptions, SyncOptions }
export { createBiomeConfig, createOxlintConfig, sync, warnToError }
