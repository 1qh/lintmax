/* eslint-disable prefer-named-capture-group */
/** biome-ignore-all lint/nursery/useNamedCaptureGroup: not needed */
import { $, Glob } from 'bun'
import { DEFAULT_SHARED_IGNORE_PATTERNS, ESLINT_TEST_FILE_PATTERNS } from './constants.js'
const eslintDisableRe = /eslint-disable(?:-next-line)?\s+(.+?)(?:\s*\*\/|\s*$)/gu
const oxlintDisableRe = /oxlint-disable(?:-next-line)?\s+(.+?)(?:\s*\*\/|\s*$)/gu
const biomeIgnoreRe = /biome-ignore(?:-all)?\s+([\w/]+)/gu
const tsIgnoreRe = /@ts-(?:ignore|expect-error|nocheck)/gu
const trailingCommentRe = /\s*--.*$/u
const trailingCloseRe = /\s*\*\/$/u
const tsInlineRe = /@ts-(?:ignore|expect-error|nocheck)/u
const DANGEROUS_PATTERNS = ['no-unsafe-', 'no-non-null-assertion', '@ts-ignore', '@ts-nocheck', 'noNonNullAssertion']
const DANGEROUS_NON_TEST_PATTERNS = ['@ts-expect-error', 'no-explicit-any', 'noExplicitAny']
const isTestFile = (f: string): boolean => ESLINT_TEST_FILE_PATTERNS.some(p => new Glob(p).match(f))
const isDangerousEntry = (rule: string, files: string[]): boolean => {
  if (DANGEROUS_PATTERNS.some(p => rule.includes(p))) return true
  if (DANGEROUS_NON_TEST_PATTERNS.some(p => rule.includes(p))) return files.some(f => !isTestFile(f))
  return false
}
interface IgnoreEntry {
  count: number
  files: string[]
  rule: string
}
const parseRules = (line: string, re: RegExp): string[] => {
  const rules: string[] = []
  re.lastIndex = 0
  let match = re.exec(line)
  while (match) {
    const raw = match[1]
    if (raw)
      for (const r of raw.split(',')) {
        const trimmed = r.trim().replace(trailingCommentRe, '').replace(trailingCloseRe, '')
        if (trimmed) rules.push(trimmed)
      }
    match = re.exec(line)
  }
  return rules
}
const scanIgnores = async (cwd: string): Promise<Map<string, Set<string>>> => {
  const ruleFiles = new Map<string, Set<string>>()
  const add = (rule: string, file: string) => {
    const existing = ruleFiles.get(rule)
    if (existing) existing.add(file)
    else ruleFiles.set(rule, new Set([file]))
  }
  const excludes = DEFAULT_SHARED_IGNORE_PATTERNS.flatMap(p => ['-g', `!${p}`])
  const result =
    await $`rg -n "^\s*//\s*eslint-disable|^\s*/\*\s*eslint-disable|^\s*//\s*oxlint-disable|^\s*/\*\s*oxlint-disable|^\s*/\*\*\s*biome-ignore|^\s*//\s*@ts-ignore|^\s*//\s*@ts-expect-error|^\s*//\s*@ts-nocheck|^\s*/\*\s*@ts-nocheck" ${cwd} -g '*.ts' -g '*.tsx' -g '!node_modules' -g '!*.d.ts' ${excludes}`
      .quiet()
      .nothrow()
  const lines = result.stdout.toString().trim().split('\n').filter(Boolean)
  for (const line of lines) {
    const firstColon = line.indexOf(':')
    const secondColon = line.indexOf(':', firstColon + 1)
    const file = line.slice(0, firstColon).replace(`${cwd}/`, '')
    const content = secondColon > firstColon ? line.slice(secondColon + 1) : line.slice(firstColon + 1)
    for (const rule of parseRules(content, eslintDisableRe)) add(rule, file)
    for (const rule of parseRules(content, oxlintDisableRe)) add(rule, file)
    for (const rule of parseRules(content, biomeIgnoreRe)) add(rule, file)
    tsIgnoreRe.lastIndex = 0
    if (tsIgnoreRe.test(content)) {
      const tsMatch = tsInlineRe.exec(content)
      if (tsMatch) add(tsMatch[0], file)
    }
  }
  return ruleFiles
}
const formatIgnores = (ruleFiles: Map<string, Set<string>>, verbose: boolean): string => {
  if (ruleFiles.size === 0) return 'no suppressions'
  const entries: IgnoreEntry[] = [...ruleFiles.entries()]
    .map(([rule, files]) => ({ count: files.size, files: [...files], rule }))
    .toSorted((a, b) => b.count - a.count)
  const dangerous = entries.filter(e => isDangerousEntry(e.rule, e.files))
  const safe = entries.filter(e => !isDangerousEntry(e.rule, e.files))
  const total = entries.reduce((sum, e) => sum + e.count, 0)
  const lines: string[] = []
  if (dangerous.length > 0) {
    const dangerousCount = dangerous.reduce((sum, e) => sum + e.count, 0)
    lines.push(`!! ${dangerousCount} dangerous suppressions — fix these:`, '')
    const maxRule = Math.max(...dangerous.map(e => e.rule.length))
    for (const e of dangerous) {
      lines.push(`  ${e.rule.padEnd(maxRule)}  ${String(e.count).padStart(3)}`)
      if (verbose) for (const f of e.files) lines.push(`    ${f}`)
    }
    lines.push('')
  }
  lines.push(`${total} suppressions across ${entries.length} rules`, '')
  const maxRule = Math.max(...entries.map(e => e.rule.length))
  for (const e of safe) {
    lines.push(`  ${e.rule.padEnd(maxRule)}  ${String(e.count).padStart(3)}`)
    if (verbose) for (const f of e.files) lines.push(`    ${f}`)
  }
  return lines.join('\n')
}
const runIgnores = async (verbose: boolean) => {
  const ruleFiles = await scanIgnores(process.cwd())
  process.stdout.write(`${formatIgnores(ruleFiles, verbose)}\n`)
}
export { formatIgnores, parseRules, runIgnores, scanIgnores }
