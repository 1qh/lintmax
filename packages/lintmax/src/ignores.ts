/* eslint-disable prefer-named-capture-group */
/** biome-ignore-all lint/nursery/useNamedCaptureGroup: not needed */
import { file, Glob } from 'bun'
import { DEFAULT_SHARED_IGNORE_PATTERNS, ESLINT_TEST_FILE_PATTERNS } from './constants.js'
import { joinPath } from './path.js'
import { listProjectFiles } from './project-files.js'
const eslintDisableRe = /eslint-disable(?:-next-line)?\s+([^\n]*)/gv
const oxlintDisableRe = /oxlint-disable(?:-next-line)?\s+([^\n]*)/gv
const biomeIgnoreRe = /biome-ignore(?:-all)?\s+([\w/]+)/gu
const tsIgnoreRe = /@ts-(?:expect-error|ignore|nocheck)/gv
const stripRuleTail = (rule: string): string => {
  const dash = rule.indexOf('--')
  const noComment = dash === -1 ? rule : rule.slice(0, dash)
  const close = noComment.indexOf('*/')
  return (close === -1 ? noComment : noComment.slice(0, close)).trim()
}
const tsInlineRe = /@ts-(?:expect-error|ignore|nocheck)/v
const suppressionLineRe =
  /^\s*(?:\/\/\s*(?:eslint-disable|oxlint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck)|\/\*\s*(?:eslint-disable|oxlint-disable|@ts-nocheck)|\/\*\*\s*biome-ignore)/v
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
const isDangerousRule = (rule: string, filePath: string): boolean => {
  if (DANGEROUS_PATTERNS.some(p => rule.includes(p))) return true
  if (DANGEROUS_NON_TEST_PATTERNS.some(p => rule.includes(p))) return !isTestFile(filePath)
  return false
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
  const ignoreGlobs = DEFAULT_SHARED_IGNORE_PATTERNS.map(p => new Glob(p))
  const files = (await listProjectFiles({ root: cwd })).filter(
    p => (p.endsWith('.ts') || p.endsWith('.tsx')) && !p.endsWith('.d.ts') && !ignoreGlobs.some(g => g.match(p))
  )
  const results = await Promise.all(
    files.map(async relativePath => {
      const lines = (await file(joinPath(cwd, relativePath)).text()).split('\n')
      const findings: DangerousSuppression[] = []
      for (const [index, content] of lines.entries())
        if (suppressionLineRe.test(content))
          for (const rule of rulesFromContent(content))
            if (isDangerousRule(rule, relativePath)) findings.push({ file: relativePath, line: index + 1, rule })
      return findings
    })
  )
  const out = results.flat()
  return out
}
export { type DangerousSuppression, findDangerousSuppressions, parseRules }
