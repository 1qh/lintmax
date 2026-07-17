import { getCanonicalRule } from './rule-equivalence.js'

interface Diagnostic {
  file: string
  line: number
  linter: string
  rule: string
}
const LINTER_PRIORITY: Record<string, number> = { biome: 0, eslint: 2, oxlint: 1, prettier: 3, 'sort-package-json': 4 }
const cwdPrefix = `${process.cwd()}/`
const normalizePath = (filePath: string): string => {
  if (filePath.startsWith(cwdPrefix)) return filePath.slice(cwdPrefix.length)
  return filePath
}
interface GroupedFile {
  file: string
  linters: GroupedLinter[]
}
interface GroupedLinter {
  linter: string
  rules: GroupedRule[]
}
interface GroupedRule {
  lines: number[]
  rule: string
}
const parseBiomeDiagnostics = ({ stdout }: { stdout: string }): Diagnostic[] => {
  let parsed: {
    diagnostics?: {
      category?: string
      location?: { path?: string; start?: { line?: number } }
      severity?: string
    }[]
  }
  try {
    parsed = JSON.parse(stdout) as typeof parsed
  } catch {
    return []
  }
  if (!Array.isArray(parsed.diagnostics)) return []
  const results: Diagnostic[] = []
  for (const d of parsed.diagnostics) {
    const filePath = d.location?.path
    const { category } = d
    if (filePath && category) {
      const line = d.location?.start?.line ?? 0
      results.push({
        file: normalizePath(filePath),
        line,
        linter: 'biome',
        rule: category
      })
    }
  }
  return results
}
const parseOxlintDiagnostics = ({ stdout }: { stdout: string }): Diagnostic[] => {
  let parsed: {
    diagnostics?: {
      code?: string
      filename?: string
      labels?: { span?: { line?: number } }[]
    }[]
  }
  try {
    parsed = JSON.parse(stdout) as typeof parsed
  } catch {
    return []
  }
  if (!Array.isArray(parsed.diagnostics)) return []
  const results: Diagnostic[] = []
  for (const d of parsed.diagnostics) {
    const filePath = d.filename ?? ''
    const rule = d.code
    if (rule) {
      const line = d.labels?.[0]?.span?.line ?? 0
      results.push({
        file: filePath.length > 0 ? normalizePath(filePath) : '<unknown>',
        line,
        linter: 'oxlint',
        rule
      })
    }
  }
  return results
}
interface EslintFileEntry {
  filePath?: string
  messages?: EslintMessage[]
}
interface EslintMessage {
  fatal?: boolean
  line?: number
  message?: string
  ruleId?: null | string
  severity?: number
}
const eslintRuleOf = (msg: EslintMessage): null | string =>
  msg.ruleId ?? (msg.severity === 2 || msg.fatal ? `parse-error: ${msg.message?.slice(0, 80) ?? 'unknown'}` : null)
const eslintDiagnosticsForFile = (fileEntry: EslintFileEntry): Diagnostic[] => {
  const { filePath } = fileEntry
  if (!(filePath && Array.isArray(fileEntry.messages))) return []
  const results: Diagnostic[] = []
  for (const msg of fileEntry.messages) {
    const rule = eslintRuleOf(msg)
    if (rule)
      results.push({
        file: normalizePath(filePath),
        line: msg.line ?? 0,
        linter: 'eslint',
        rule
      })
  }
  return results
}
const parseEslintDiagnostics = ({ stdout }: { stdout: string }): Diagnostic[] => {
  let parsed: EslintFileEntry[]
  try {
    parsed = JSON.parse(stdout) as typeof parsed
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const results: Diagnostic[] = []
  for (const fileEntry of parsed) results.push(...eslintDiagnosticsForFile(fileEntry))
  return results
}
const parsePrettierOutput = ({ stdout }: { stdout: string }): Diagnostic[] => {
  const results: Diagnostic[] = []
  const lines = stdout.trim().split('\n')
  for (const line of lines) {
    const filePath = line.trim()
    if (filePath.length > 0)
      results.push({
        file: normalizePath(filePath),
        line: 0,
        linter: 'prettier',
        rule: 'unformatted'
      })
  }
  return results
}
const parseSortPackageJsonOutput = ({ exitCode, stdout }: { exitCode: number; stdout: string }): Diagnostic[] => {
  if (exitCode === 0) return []
  const results: Diagnostic[] = []
  const lines = stdout.trim().split('\n')
  for (const line of lines) {
    const filePath = line.trim()
    if (filePath.length > 0 && filePath.endsWith('.json'))
      results.push({
        file: normalizePath(filePath),
        line: 0,
        linter: 'sort-package-json',
        rule: 'unsorted'
      })
  }
  return results
}
const dedup = (diagnostics: Diagnostic[]): Diagnostic[] => {
  const seen = new Map<string, Diagnostic>()
  for (const d of diagnostics)
    if (d.line === 0) {
      const key = `${d.file}\0${d.linter}\0${d.rule}`
      seen.set(key, d)
    } else {
      const canonical = getCanonicalRule(d.rule)
      const key = `${d.file}\0${d.line}\0${canonical}`
      const existing = seen.get(key)
      if (!existing || (LINTER_PRIORITY[d.linter] ?? 99) < (LINTER_PRIORITY[existing.linter] ?? 99)) seen.set(key, d)
    }
  return [...seen.values()]
}
const linterSort = (a: string, b: string): number => (LINTER_PRIORITY[a] ?? 99) - (LINTER_PRIORITY[b] ?? 99)
const aggregate = ({ diagnostics }: { diagnostics: Diagnostic[] }): GroupedFile[] => {
  const deduped = dedup(diagnostics)
  const fileMap = new Map<string, Map<string, Map<string, number[]>>>()
  for (const d of deduped) {
    let linterMap = fileMap.get(d.file)
    if (!linterMap) {
      linterMap = new Map()
      fileMap.set(d.file, linterMap)
    }
    let ruleMap = linterMap.get(d.linter)
    if (!ruleMap) {
      ruleMap = new Map()
      linterMap.set(d.linter, ruleMap)
    }
    let lines = ruleMap.get(d.rule)
    if (!lines) {
      lines = []
      ruleMap.set(d.rule, lines)
    }
    if (d.line > 0) lines.push(d.line)
  }
  const files: GroupedFile[] = []
  const sortedFiles = [...fileMap.keys()].toSorted((a, b) => a.localeCompare(b))
  for (const filePath of sortedFiles) {
    const linterMap = fileMap.get(filePath) ?? new Map<string, Map<string, number[]>>()
    const linters: GroupedLinter[] = []
    const sortedLinters = [...linterMap.keys()].toSorted(linterSort)
    for (const linterName of sortedLinters) {
      const ruleMap = linterMap.get(linterName) ?? new Map<string, number[]>()
      const rules: GroupedRule[] = []
      const sortedRules = [...ruleMap.keys()].toSorted((a, b) => a.localeCompare(b))
      for (const ruleName of sortedRules) {
        const lines = ruleMap.get(ruleName) ?? []
        const uniqueLines = [...new Set(lines)].toSorted((a, b) => a - b)
        rules.push({ lines: uniqueLines, rule: ruleName })
      }
      linters.push({ linter: linterName, rules })
    }
    files.push({ file: filePath, linters })
  }
  return files
}
export type { Diagnostic, GroupedFile }
export {
  aggregate,
  parseBiomeDiagnostics,
  parseEslintDiagnostics,
  parseOxlintDiagnostics,
  parsePrettierOutput,
  parseSortPackageJsonOutput
}
