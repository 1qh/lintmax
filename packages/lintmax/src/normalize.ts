import type { Linter } from 'eslint'
import type { TailwindOption } from './lintmax-types.js'
const normalizeIgnorePattern = ({ pattern }: { pattern: string }): string => {
  const trimmed = pattern.trim()
  if (trimmed.length === 0) return ''
  return trimmed.startsWith('./') ? trimmed.slice(2) : trimmed
}
const normalizePathItem = (item: unknown, label: string): string => {
  if (typeof item !== 'string') throw new TypeError(`${label} must be a string`)
  const normalized = normalizeIgnorePattern({ pattern: item })
  if (normalized.length === 0) throw new Error(`${label} must not be empty`)
  return normalized
}
const appendNormalizedPath = (out: string[], item: unknown, label: string) => {
  const normalized = normalizePathItem(item, label)
  if (!out.includes(normalized)) out.push(normalized)
}
const normalizePathListInput = ({
  allowUndefined = false,
  label,
  value
}: {
  allowUndefined?: boolean
  label: string
  value: unknown
}): string[] => {
  if (value === undefined && allowUndefined) return []
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array of strings`)
  const out: string[] = []
  const arr: unknown[] = value
  for (let i = 0; i < arr.length; i += 1) appendNormalizedPath(out, arr[i], `${label}[${i}]`)
  return out
}
const hasPlainObjectPrototype = ({ value }: { value: object }): boolean => {
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === null || prototype === Object.prototype
}
const isObjectLike = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isRecord = (value: unknown): value is Record<string, unknown> =>
  isObjectLike(value) && hasPlainObjectPrototype({ value })
const assertObject = ({ label, value }: { label: string; value: unknown }): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}
const assertOptionalString = ({ label, value }: { label: string; value: unknown }) => {
  if (value !== undefined && typeof value !== 'string') throw new Error(`${label} must be a string`)
}
const stripPluginNamespace = ({ rule }: { rule: string }): string =>
  rule.includes('/') ? rule.slice(rule.indexOf('/') + 1) : rule
const toUnique = ({ values }: { values: string[] }): string[] => [...new Set(values)]
const findUnknownRules = ({
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
}
interface JsonObjectInput extends JsonValueInput {
  value: object
  visit: (input: JsonValueInput) => void
}
interface JsonValueInput {
  label: string
  seen?: WeakSet<object>
  value: unknown
}
const assertJsonChildren = ({ label, seen, value, visit }: JsonObjectInput) => {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) visit({ label: `${label}[${i}]`, seen, value: value[i] })
    return
  }
  if (!isRecord(value)) throw new Error(`${label} must be JSON-serializable`)
  for (const [key, nested] of Object.entries(value)) visit({ label: `${label}.${key}`, seen, value: nested })
}
const assertJsonObject = ({ label, seen, value, visit }: JsonObjectInput) => {
  const objectSeen = seen ?? new WeakSet<object>()
  if (objectSeen.has(value)) throw new Error(`${label} must be JSON-serializable`)
  objectSeen.add(value)
  try {
    assertJsonChildren({ label, seen: objectSeen, value, visit })
  } finally {
    objectSeen.delete(value)
  }
}
const assertJsonSerializable = ({ label, seen, value }: JsonValueInput) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be JSON-serializable`)
    return
  }
  if (typeof value !== 'object') throw new TypeError(`${label} must be JSON-serializable`)
  assertJsonObject({ label, seen, value, visit: assertJsonSerializable })
}
const normalizeObjectItem = ({
  allowNonPlain,
  label,
  value
}: {
  allowNonPlain: boolean
  label: string
  value: unknown
}): Record<string, unknown> => {
  if (isObjectLike(value) && (allowNonPlain || hasPlainObjectPrototype({ value }))) return value
  throw new Error(`${label} must be an object`)
}
const normalizeObjectListInput = ({
  allowNonPlain = false,
  label,
  value
}: {
  allowNonPlain?: boolean
  label: string
  value: unknown
}): Record<string, unknown>[] => {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array of objects`)
  const out: Record<string, unknown>[] = []
  const arr: unknown[] = value
  for (let i = 0; i < arr.length; i += 1) {
    const normalizedItem = normalizeObjectItem({ allowNonPlain, label: `${label}[${i}]`, value: arr[i] })
    out.push(normalizedItem)
  }
  return out
}
const normalizeRuleName = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string rule name`)
  const ruleName = value.trim()
  if (ruleName.length === 0) throw new Error(`${label} must not be empty`)
  return ruleName
}
const sortOffRules = (rules: Record<string, 'off'>): Record<string, 'off'> => {
  const sorted: Record<string, 'off'> = {}
  const keys = Object.keys(rules).toSorted((a, b) => a.localeCompare(b))
  for (const key of keys) sorted[key] = 'off'
  return sorted
}
const normalizeRulesOffInput = ({
  label,
  value
}: {
  label: string
  value: unknown
}): Record<string, 'off'> | undefined => {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array of rule names`)
  const out: Record<string, 'off'> = {}
  const arr: unknown[] = value
  for (let i = 0; i < arr.length; i += 1) {
    const ruleName = normalizeRuleName(arr[i], `${label}[${i}]`)
    out[ruleName] = 'off'
  }
  return sortOffRules(out)
}
const normalizeTailwindOption = ({ label, value }: { label: string; value: unknown }): TailwindOption | undefined => {
  if (value === undefined) return
  if (typeof value === 'boolean' || typeof value === 'string') return value
  throw new Error(`${label} must be a string, true, or false`)
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
