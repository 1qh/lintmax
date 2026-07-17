/* eslint-disable prefer-named-capture-group */
/** biome-ignore-all lint/nursery/useNamedCaptureGroup: not needed */
import { $, Glob } from 'bun'
import { DEFAULT_SHARED_IGNORE_PATTERNS, ESLINT_TEST_FILE_PATTERNS } from './constants.js'

const eslintDisableRe = /eslint-disable(?:-next-line)?\s+([^\n]*)/gv
const oxlintDisableRe = /oxlint-disable(?:-next-line)?\s+([^\n]*)/gv
const biomeIgnoreRe = /biome-ignore(?:-all)?\s+([\w/]+)/gu
const tsIgnoreRe = /@ts-(?:expect-error|ignore|nocheck)/gv
/** Strip a trailing `-- reason` and a trailing block-comment close from one split rule. indexOf is linear where the leading-whitespace regexes backtrack. */
const stripRuleTail = (rule: string): string => {
  const dash = rule.indexOf('--')
  const noComment = dash === -1 ? rule : rule.slice(0, dash)
  const close = noComment.indexOf('*/')
  return (close === -1 ? noComment : noComment.slice(0, close)).trim()
}
const tsInlineRe = /@ts-(?:expect-error|ignore|nocheck)/v
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
        const trimmed = stripRuleTail(r)
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
interface ParsedLine {
  content: string
  file: string
  lineNum: number
}
const parseRipgrepLine = (raw: string, cwd: string): ParsedLine | undefined => {
  const firstColon = raw.indexOf(':')
  const secondColon = raw.indexOf(':', firstColon + 1)
  if (secondColon <= firstColon) return
  return {
    content: raw.slice(secondColon + 1),
    file: raw.slice(0, firstColon).replace(`${cwd}/`, ''),
    lineNum: Number(raw.slice(firstColon + 1, secondColon))
  }
}
const rulesFromContent = (content: string): string[] => {
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
  return rules
}
const findDangerousSuppressions = async (cwd: string): Promise<DangerousSuppression[]> => {
  const excludes = DEFAULT_SHARED_IGNORE_PATTERNS.flatMap(p => ['-g', `!${p}`])
  const result =
    await $`rg -n "^\s*//\s*eslint-disable|^\s*/\*\s*eslint-disable|^\s*//\s*oxlint-disable|^\s*/\*\s*oxlint-disable|^\s*/\*\*\s*biome-ignore|^\s*//\s*@ts-ignore|^\s*//\s*@ts-expect-error|^\s*//\s*@ts-nocheck|^\s*/\*\s*@ts-nocheck" ${cwd} -g '*.ts' -g '*.tsx' -g '!node_modules' -g '!*.d.ts' ${excludes}`
      .quiet()
      .nothrow()
  const out: DangerousSuppression[] = []
  for (const raw of result.stdout.toString().trim().split('\n').filter(Boolean)) {
    const parsed = parseRipgrepLine(raw, cwd)
    if (parsed) {
      const { content, file, lineNum } = parsed
      for (const rule of rulesFromContent(content))
        if (isDangerousRule(rule, file)) out.push({ file, line: lineNum, rule })
    }
  }
  return out
}
export type { DangerousSuppression }
export { findDangerousSuppressions, parseRules }
