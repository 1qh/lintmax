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
const DANGEROUS_PATTERNS = [
  'no-unsafe-argument',
  'no-unsafe-assignment',
  'no-unsafe-call',
  'no-unsafe-member-access',
  'no-unsafe-return',
  'no-non-null-assertion',
  '@ts-ignore',
  '@ts-nocheck',
  'noNonNullAssertion'
]
const DANGEROUS_NON_TEST_PATTERNS = ['@ts-expect-error', 'no-explicit-any', 'noExplicitAny']
const isTestFile = (f: string): boolean => ESLINT_TEST_FILE_PATTERNS.some(p => new Glob(p).match(f))
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
interface DangerousSuppression {
  file: string
  line: number
  rule: string
}
const isDangerousRule = (rule: string, file: string): boolean => {
  if (DANGEROUS_PATTERNS.some(p => rule.includes(p))) return true
  if (DANGEROUS_NON_TEST_PATTERNS.some(p => rule.includes(p))) return !isTestFile(file)
  return false
}
const findDangerousSuppressions = async (cwd: string): Promise<DangerousSuppression[]> => {
  const excludes = DEFAULT_SHARED_IGNORE_PATTERNS.flatMap(p => ['-g', `!${p}`])
  const result =
    await $`rg -n "^\s*//\s*eslint-disable|^\s*/\*\s*eslint-disable|^\s*//\s*oxlint-disable|^\s*/\*\s*oxlint-disable|^\s*/\*\*\s*biome-ignore|^\s*//\s*@ts-ignore|^\s*//\s*@ts-expect-error|^\s*//\s*@ts-nocheck|^\s*/\*\s*@ts-nocheck" ${cwd} -g '*.ts' -g '*.tsx' -g '!node_modules' -g '!*.d.ts' ${excludes}`
      .quiet()
      .nothrow()
  const out: DangerousSuppression[] = []
  for (const raw of result.stdout.toString().trim().split('\n').filter(Boolean)) {
    const firstColon = raw.indexOf(':')
    const secondColon = raw.indexOf(':', firstColon + 1)
    if (secondColon > firstColon) {
      const file = raw.slice(0, firstColon).replace(`${cwd}/`, '')
      const lineNum = Number(raw.slice(firstColon + 1, secondColon))
      const content = raw.slice(secondColon + 1)
      const rules = [
        ...parseRules(content, eslintDisableRe),
        ...parseRules(content, oxlintDisableRe),
        ...parseRules(content, biomeIgnoreRe)
      ]
      tsIgnoreRe.lastIndex = 0
      if (tsIgnoreRe.test(content)) {
        const tsMatch = tsInlineRe.exec(content)
        if (tsMatch) rules.push(tsMatch[0])
      }
      for (const rule of rules) if (isDangerousRule(rule, file)) out.push({ file, line: lineNum, rule })
    }
  }
  return out
}
export type { DangerousSuppression }
export { findDangerousSuppressions, parseRules }
