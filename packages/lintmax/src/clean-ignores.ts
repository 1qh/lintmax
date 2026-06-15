/* eslint-disable no-await-in-loop, prefer-named-capture-group */
/** biome-ignore-all lint/performance/noAwaitInLoops: sequential file writes */
/** biome-ignore-all lint/nursery/useNamedCaptureGroup: not needed */
import { file, write } from 'bun'
import { OXLINT_CLI_ALLOW } from './constants.js'
import { cacheDir, readRequiredJson } from './core.js'
import { joinPath } from './path.js'
import { extractAllRules } from './rules.js'

const eslintLineRe = /^(\s*(?:\/\/|\/\*)\s*(?:eslint-disable(?:-next-line)?)\s+)(.+?)(\s*\*\/)?$/u
const oxlintLineRe = /^(\s*(?:\/\/|\/\*)\s*(?:oxlint-disable(?:-next-line)?)\s+)(.+?)(\s*\*\/)?$/u
const biomeLineRe = /^(\s*(?:\/\/|\/\*\*)\s*biome-ignore(?:-all)?\s+)([\w/]+)(.*?)$/u
const trailingCommentRe = /\s*--.*$/u
const trailingCloseRe = /\s*\*\/$/u
const oxlintPrefixRe =
  /^(?:oxc|eslint|typescript-eslint|typescript_eslint|react|react-hooks|react_hooks|jsx-a11y|jsx_a11y|import|nextjs|next|jsdoc|promise|unicorn|vitest|jest|eslint-plugin-react-perf|eslint-plugin-jsx-a11y|eslint-plugin-react|eslint-plugin-promise|eslint-plugin-unicorn|react-perf|react_perf|@next\/next|@typescript-eslint|@eslint-react)[\\/(/]/u
const trailingParenRe = /\)$/u
const trailingSepRe = /[\\/(/]$/u
const eslintPluginPrefixRe = /^eslint-plugin-/u
const normalizeRule = (rule: string): string[] => {
  const variants = [rule]
  const oxMatch = oxlintPrefixRe.exec(rule)
  if (oxMatch) {
    const bare = rule.slice(oxMatch[0].length).replace(trailingParenRe, '')
    variants.push(bare)
    const prefix = oxMatch[0].replace(trailingSepRe, '')
    variants.push(`${prefix}/${bare}`, `${prefix}(${bare})`)
    if (prefix === 'eslint') variants.push(bare)
    if (prefix === 'typescript-eslint') variants.push(`@typescript-eslint/${bare}`)
    if (prefix.startsWith('eslint-plugin-')) {
      const short = prefix.replace(eslintPluginPrefixRe, '')
      variants.push(`${short}/${bare}`, `${short}(${bare})`)
    }
  }
  if (rule.startsWith('@typescript-eslint/')) variants.push(`typescript-eslint(${rule.slice(19)})`)
  if (rule.startsWith('@next/next/')) variants.push(`nextjs(${rule.slice(11)})`)
  if (rule.startsWith('@eslint-react/')) variants.push(`react(${rule.slice(14)})`)
  const extra: string[] = []
  for (const v of variants) {
    if (v.includes('_')) extra.push(v.replaceAll('_', '-'))
    if (v.includes('-')) extra.push(v.replaceAll('-', '_'))
  }
  for (const e of extra) variants.push(e)
  return variants
}
const loadOxlintOffRules = async (): Promise<Set<string>> => {
  const configPath = joinPath(process.cwd(), cacheDir, '.oxlintrc.json')
  const config = await readRequiredJson<{
    rules?: Record<string, unknown>
  }>({ path: configPath }).catch(() => null)
  if (!config) return new Set()
  const off = new Set<string>()
  for (const [rule, val] of Object.entries(config.rules ?? {})) {
    const severity = Array.isArray(val) ? String(val[0]) : val
    if (severity === 'off') {
      off.add(rule)
      for (const v of normalizeRule(rule)) off.add(v)
    }
  }
  for (const rule of OXLINT_CLI_ALLOW) {
    off.add(rule)
    for (const v of normalizeRule(rule)) off.add(v)
  }
  return off
}
const buildActiveRuleSet = async (): Promise<Set<string>> => {
  const rules = await extractAllRules()
  const active = new Set<string>()
  for (const r of rules) {
    active.add(r.rule)
    for (const v of normalizeRule(r.rule)) active.add(v)
  }
  return active
}
const isRuleActive = (rule: string, active: Set<string>, oxlintOff?: Set<string>): boolean => {
  if (oxlintOff?.has(rule)) return false
  if (oxlintOff) for (const v of normalizeRule(rule)) if (oxlintOff.has(v)) return false
  if (active.has(rule)) return true
  for (const v of normalizeRule(rule)) if (active.has(v)) return true
  if (!oxlintOff) return false
  return true
}
const splitRules = (str: string): string[] =>
  str
    .split(',')
    .map(r => r.trim().replace(trailingCommentRe, '').replace(trailingCloseRe, ''))
    .filter(Boolean)
const processMultiRuleLine = ({
  active,
  isOxlint,
  line,
  match,
  oxlintOff,
  result
}: {
  active: Set<string>
  isOxlint?: boolean
  line: string
  match: RegExpExecArray
  oxlintOff?: Set<string>
  result: string[]
}): number => {
  const prefix = match[1] ?? ''
  const rulesStr = match[2] ?? ''
  const suffix = match[3] ?? ''
  const rules = splitRules(rulesStr)
  const kept = rules.filter(r => isRuleActive(r, active, isOxlint ? oxlintOff : undefined))
  if (kept.length === 0) return rules.length
  if (kept.length < rules.length) {
    result.push(`${prefix}${kept.join(', ')}${suffix}`)
    return rules.length - kept.length
  }
  result.push(line)
  return 0
}
interface CleanResult {
  cleaned: number
  files: string[]
}
const cleanFileIgnores = async (filePath: string, active: Set<string>, oxlintOff?: Set<string>): Promise<number> => {
  const f = file(filePath)
  if (!(await f.exists())) return 0
  const content = await f.text()
  const lines = content.split('\n')
  const result: string[] = []
  let removed = 0
  for (const line of lines) {
    eslintLineRe.lastIndex = 0
    oxlintLineRe.lastIndex = 0
    biomeLineRe.lastIndex = 0
    const eslintMatch = eslintLineRe.exec(line)
    if (eslintMatch) removed += processMultiRuleLine({ active, line, match: eslintMatch, result })
    else {
      const oxlintMatch = oxlintLineRe.exec(line)
      if (oxlintMatch)
        removed += processMultiRuleLine({ active, isOxlint: true, line, match: oxlintMatch, oxlintOff, result })
      else {
        const biomeMatch = biomeLineRe.exec(line)
        if (biomeMatch && !isRuleActive(biomeMatch[2] ?? '', active)) removed += 1
        else result.push(line)
      }
    }
  }
  if (removed > 0) await write(filePath, result.join('\n'))
  return removed
}
const cleanIgnores = async (filePaths: string[]): Promise<CleanResult> => {
  const active = await buildActiveRuleSet()
  const oxlintOff = await loadOxlintOffRules()
  let cleaned = 0
  const files: string[] = []
  for (const fp of filePaths) {
    const count = await cleanFileIgnores(fp, active, oxlintOff)
    if (count > 0) {
      cleaned += count
      files.push(fp)
    }
  }
  return { cleaned, files }
}
export { buildActiveRuleSet, cleanFileIgnores, cleanIgnores, isRuleActive, normalizeRule, splitRules }
