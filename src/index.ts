import type { Linter } from 'eslint'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const warnToError = (rules: Partial<Linter.RulesRecord>): Linter.RulesRecord => {
  const result: Linter.RulesRecord = {}
  for (const [key, value] of Object.entries(rules))
    if (value === undefined) result[key] = 'error'
    else if (value === 'warn' || value === 1) result[key] = 'error'
    else if (Array.isArray(value) && (value[0] === 'warn' || value[0] === 1)) result[key] = ['error', ...value.slice(1)]
    else result[key] = value

  return result
}

interface OxlintOverrides {
  ignorePatterns?: string[]
  overrides?: Array<{
    files: string[]
    rules: Record<string, unknown>
  }>
  rules?: Record<string, 'off'>
}

interface OxlintConfig {
  ignorePatterns?: string[]
  overrides?: Array<{
    files: string[]
    rules: Record<string, unknown>
  }>
  rules: Record<string, unknown>
  [key: string]: unknown
}

const createOxlintConfig = (overrides?: OxlintOverrides): OxlintConfig => {
  const basePath = join(import.meta.dirname, '..', 'oxlintrc.json')
  const base = JSON.parse(readFileSync(basePath, 'utf-8')) as OxlintConfig

  if (!overrides)
    return base

  if (overrides.ignorePatterns)
    base.ignorePatterns = overrides.ignorePatterns

  if (overrides.overrides)
    base.overrides = overrides.overrides

  if (overrides.rules)
    for (const [key, value] of Object.entries(overrides.rules))
      base.rules[key] = value

  return base
}

export type { OxlintOverrides }
export { createOxlintConfig, warnToError }
