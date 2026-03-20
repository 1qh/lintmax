import type { Linter } from 'eslint'

import type { TailwindOption } from './lintmax-types.js'
const normalizeIgnorePattern = ({ pattern }: { pattern: string }): string => {
    const trimmed = pattern.trim()
    if (trimmed.length === 0) return ''
    return trimmed.startsWith('./') ? trimmed.slice(2) : trimmed
  },
  normalizePathListInput = ({
    allowUndefined = false,
    label,
    value
  }: {
    allowUndefined?: boolean
    label: string
    value: unknown
  }): string[] => {
    if (value === undefined && allowUndefined) return []
    if (!Array.isArray(value)) throw new Error(`${label} must be an array of strings`)
    const out: string[] = [],
      arr: unknown[] = value
    for (let i = 0; i < arr.length; i += 1) {
      const item = arr[i]
      if (typeof item !== 'string') throw new Error(`${label}[${i}] must be a string`)
      const normalized = normalizeIgnorePattern({ pattern: item })
      if (normalized.length === 0) throw new Error(`${label}[${i}] must not be empty`)
      if (!out.includes(normalized)) out.push(normalized)
    }
    return out
  },
  hasPlainObjectPrototype = ({ value }: { value: object }): boolean => {
    const prototype: null | object = Object.getPrototypeOf(value) as null | object
    return prototype === null || prototype === Object.prototype
  },
  isObjectLike = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
  isRecord = (value: unknown): value is Record<string, unknown> =>
    isObjectLike(value) && hasPlainObjectPrototype({ value }),
  assertObject = ({ label, value }: { label: string; value: unknown }): Record<string, unknown> => {
    if (!isRecord(value)) throw new Error(`${label} must be an object`)
    return value
  },
  assertOptionalString = ({ label, value }: { label: string; value: unknown }) => {
    if (value !== undefined && typeof value !== 'string') throw new Error(`${label} must be a string`)
  },
  stripPluginNamespace = ({ rule }: { rule: string }): string =>
    rule.includes('/') ? rule.slice(rule.indexOf('/') + 1) : rule,
  toUnique = ({ values }: { values: string[] }): string[] => [...new Set(values)],
  findUnknownRules = ({
    knownRules,
    normalizeRule,
    rules
  }: {
    knownRules: Set<string>
    normalizeRule?: (rule: string) => string
    rules: Record<string, unknown>
  }): string[] => {
    const unknown: string[] = []
    for (const rule of Object.keys(rules)) {
      const normalized = normalizeRule ? normalizeRule(rule) : rule
      if (!knownRules.has(normalized)) unknown.push(rule)
    }
    return unknown
  },
  assertJsonSerializable = ({ label, seen, value }: { label: string; seen?: WeakSet<object>; value: unknown }) => {
    if (value === null) return
    if (typeof value === 'string' || typeof value === 'boolean') return
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`${label} must be JSON-serializable`)
      return
    }
    if (typeof value !== 'object') throw new Error(`${label} must be JSON-serializable`)
    const objectValue = value,
      objectSeen = seen ?? new WeakSet<object>()
    if (objectSeen.has(objectValue)) throw new Error(`${label} must be JSON-serializable`)
    objectSeen.add(objectValue)
    try {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1)
          assertJsonSerializable({
            label: `${label}[${i}]`,
            seen: objectSeen,
            value: value[i]
          })
        return
      }
      if (!isRecord(value)) throw new Error(`${label} must be JSON-serializable`)
      for (const [key, nested] of Object.entries(value))
        assertJsonSerializable({
          label: `${label}.${key}`,
          seen: objectSeen,
          value: nested
        })
    } finally {
      objectSeen.delete(objectValue)
    }
  },
  normalizeObjectListInput = ({
    allowNonPlain = false,
    label,
    value
  }: {
    allowNonPlain?: boolean
    label: string
    value: unknown
  }): Record<string, unknown>[] => {
    if (value === undefined) return []
    if (!Array.isArray(value)) throw new Error(`${label} must be an array of objects`)
    const out: Record<string, unknown>[] = [],
      arr: unknown[] = value
    for (let i = 0; i < arr.length; i += 1) {
      const item = arr[i]
      let normalizedItem: Record<string, unknown> | undefined
      if (allowNonPlain) {
        if (isObjectLike(item)) normalizedItem = item
      } else if (isRecord(item)) normalizedItem = item
      if (!normalizedItem) throw new Error(`${label}[${i}] must be an object`)
      out.push(normalizedItem)
    }
    return out
  },
  normalizeRulesOffInput = ({ label, value }: { label: string; value: unknown }): Record<string, 'off'> | undefined => {
    if (value === undefined) return
    if (!Array.isArray(value)) throw new Error(`${label} must be an array of rule names`)
    const out: Record<string, 'off'> = {},
      arr: unknown[] = value
    for (let i = 0; i < arr.length; i += 1) {
      const item = arr[i]
      if (typeof item !== 'string') throw new Error(`${label}[${i}] must be a string rule name`)
      const ruleName = item.trim()
      if (ruleName.length === 0) throw new Error(`${label}[${i}] must not be empty`)
      out[ruleName] = 'off'
    }
    const sorted: Record<string, 'off'> = {}
    for (const key of Object.keys(out).toSorted((a, b) => a.localeCompare(b))) sorted[key] = 'off'
    return sorted
  },
  normalizeTailwindOption = ({ label, value }: { label: string; value: unknown }): TailwindOption | undefined => {
    if (value === undefined) return
    if (typeof value === 'boolean' || typeof value === 'string') return value
    throw new Error(`${label} must be a string, true, or false`)
  },
  warnToError = (rules: Partial<Linter.RulesRecord>): Linter.RulesRecord => {
    const result: Linter.RulesRecord = {}
    for (const [key, value] of Object.entries(rules))
      if (value === undefined) result[key] = 'error'
      else if (value === 'warn' || value === 1) result[key] = 'error'
      else if (Array.isArray(value) && (value[0] === 'warn' || value[0] === 1)) result[key] = ['error', ...value.slice(1)]
      else result[key] = value
    return result
  }
export {
  assertJsonSerializable,
  assertObject,
  assertOptionalString,
  findUnknownRules,
  isRecord,
  normalizeIgnorePattern,
  normalizeObjectListInput,
  normalizePathListInput,
  normalizeRulesOffInput,
  normalizeTailwindOption,
  stripPluginNamespace,
  toUnique,
  warnToError
}
