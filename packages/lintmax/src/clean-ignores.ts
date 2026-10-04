import { file, write } from 'bun'
import { ESLint } from 'eslint'
import { OXLINT_CLI_ALLOW } from './constants.js'
import { cacheDir, readRequiredJson } from './core.js'
import { joinPath } from './path.js'
import { extractAllRules } from './rules.js'
const eslintLineRe =
  /^(?<prefix>\s*(?:\/\/|\/\*)\s*eslint-disable(?:-next-line)?\s+)(?<rules>\S(?:[^*]*[^\s*])?)(?<suffix>\s*\*\/)?$/v
const oxlintLineRe =
  /^(?<prefix>\s*(?:\/\/|\/\*)\s*oxlint-disable(?:-next-line)?\s+)(?<rules>\S(?:[^*]*[^\s*])?)(?<suffix>\s*\*\/)?$/v
const biomeLineRe = /^\s*(?:\/\/|\/\*\*)\s*biome-ignore(?:-all)?\s+(?<rule>[\w\/]+)/v
const OXLINT_PREFIXES = [
  'eslint',
  'eslint-plugin-jsx-a11y',
  'eslint-plugin-promise',
  'eslint-plugin-react',
  'eslint-plugin-react-perf',
  'eslint-plugin-unicorn',
  'import',
  'jest',
  'jsdoc',
  'jsx-a11y',
  'jsx_a11y',
  'next',
  'nextjs',
  'oxc',
  'promise',
  'react',
  'react-hooks',
  'react-perf',
  'react_hooks',
  'react_perf',
  'typescript-eslint',
  'typescript_eslint',
  'unicorn',
  'vitest',
  '@next/next',
  '@typescript-eslint',
  '@eslint-react'
]
const OXLINT_SEPARATORS = ['(', '/', '\\']
/** The prefix+separator a rule id starts with, or undefined — a plain-string scan replacing a 27-branch alternation. Order-independent: the separator requirement disambiguates a short prefix from a longer one (`react-hooks/x` never matches `react` because `-` is not a separator). */
const oxlintPrefixMatch = (rule: string): string | undefined => {
  for (const prefix of OXLINT_PREFIXES)
    for (const sep of OXLINT_SEPARATORS) if (rule.startsWith(`${prefix}${sep}`)) return `${prefix}${sep}`
}
const trailingParenRe = /\)$/v
const trailingSepRe = /[(/\\]$/u
const eslintPluginPrefixRe = /^eslint-plugin-/v
/** The oxlint-prefixed variants for a rule whose id starts with `oxMatch` (prefix+separator) — bare id plus canonical/short-plugin spellings. */
const buildOxlintVariants = (rule: string, oxMatch: string): string[] => {
  const variants: string[] = []
  const bare = rule.slice(oxMatch.length).replace(trailingParenRe, '')
  variants.push(bare)
  const prefix = oxMatch.replace(trailingSepRe, '')
  variants.push(`${prefix}/${bare}`, `${prefix}(${bare})`)
  if (prefix === 'eslint') variants.push(bare)
  if (prefix === 'typescript-eslint') variants.push(`@typescript-eslint/${bare}`)
  if (prefix.startsWith('eslint-plugin-')) {
    const short = prefix.replace(eslintPluginPrefixRe, '')
    variants.push(`${short}/${bare}`, `${short}(${bare})`)
  }
  return variants
}
/** The underscore↔dash spelling twins of each variant — a `_` id also spelled with `-` and vice versa. */
const expandUnderscoreDash = (variants: string[]): string[] => {
  const extra: string[] = []
  for (const v of variants) {
    if (v.includes('_')) extra.push(v.replaceAll('_', '-'))
    if (v.includes('-')) extra.push(v.replaceAll('-', '_'))
  }
  return extra
}
const normalizeRule = (rule: string): string[] => {
  const variants = [rule]
  const oxMatch = oxlintPrefixMatch(rule)
  if (oxMatch !== undefined) variants.push(...buildOxlintVariants(rule, oxMatch))
  if (rule.startsWith('@typescript-eslint/')) variants.push(`typescript-eslint(${rule.slice(19)})`)
  if (rule.startsWith('@next/next/')) variants.push(`nextjs(${rule.slice(11)})`)
  if (rule.startsWith('@eslint-react/')) variants.push(`react(${rule.slice(14)})`)
  for (const e of expandUnderscoreDash(variants)) variants.push(e)
  return variants
}
const loadOxlintOffRules = async (): Promise<Set<string>> => {
  const configPath = joinPath(process.cwd(), cacheDir, '.oxlintrc.json')
  if (!(await file(configPath).exists()))
    throw new Error(
      `clean-ignores: the generated config is absent at ${configPath}, so no rule reads as off and every directive for an off rule would be kept. The stage that writes it did not run.`
    )
  let config: { rules?: Record<string, unknown> }
  try {
    config = readRequiredJson<{ rules?: Record<string, unknown> }>(await file(configPath).text())
  } catch (error) {
    throw new Error(
      `clean-ignores: the generated config at ${configPath} carries no parseable JSON. Refusing rather than reading it as "no rule is off", which would silently keep every directive.`,
      { cause: error }
    )
  }
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
const buildActiveRuleSet = async ({ excludeEslint = false }: { excludeEslint?: boolean } = {}): Promise<Set<string>> => {
  const rules = await extractAllRules()
  const active = new Set<string>()
  for (const r of rules.filter(rule => !excludeEslint || rule.linter !== 'eslint')) {
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
const splitCsvRules = (ruleList: string): string[] =>
  ruleList
    .split(',')
    .map(r => r.trim())
    .filter(Boolean)
const splitDirective = (str: string): { reason: string; rules: string[] } => {
  const closeAt = str.lastIndexOf('*/')
  const body = closeAt === -1 ? str : str.slice(0, closeAt).trimEnd()
  const dashAt = body.indexOf('--')
  if (dashAt === -1) return { reason: '', rules: splitCsvRules(body) }
  let reasonAt = dashAt
  while (reasonAt > 0 && (body[reasonAt - 1] === ' ' || body[reasonAt - 1] === '\t')) reasonAt -= 1
  return {
    reason: body.slice(reasonAt),
    rules: splitCsvRules(body.slice(0, reasonAt))
  }
}
const splitRules = (str: string): string[] => splitDirective(str).rules
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
  match: { prefix?: string; rules?: string; suffix?: string }
  oxlintOff?: Set<string>
  result: string[]
}): number => {
  const prefix = match.prefix ?? ''
  const rulesStr = match.rules ?? ''
  const suffix = match.suffix ?? ''
  const { reason, rules } = splitDirective(rulesStr)
  const kept = rules.filter(r => isRuleActive(r, active, isOxlint ? oxlintOff : undefined))
  if (kept.length === 0) return rules.length
  if (kept.length < rules.length) {
    result.push(`${prefix}${kept.join(', ')}${reason}${suffix}`)
    return rules.length - kept.length
  }
  result.push(line)
  return 0
}
interface CleanResult {
  cleaned: number
  files: string[]
}
/** Process one source line: keep-or-rewrite it into `result` and return how many disabled rules were removed. */
const processIgnoreLine = ({
  active,
  eslintActive,
  line,
  oxlintOff,
  result
}: {
  active: Set<string>
  eslintActive?: Set<string>
  line: string
  oxlintOff?: Set<string>
  result: string[]
}): number => {
  eslintLineRe.lastIndex = 0
  oxlintLineRe.lastIndex = 0
  biomeLineRe.lastIndex = 0
  const eslintMatch = eslintLineRe.exec(line)
  if (eslintMatch)
    return processMultiRuleLine({
      active: eslintActive ?? active,
      line,
      match: {
        prefix: eslintMatch.groups?.prefix,
        rules: eslintMatch.groups?.rules,
        suffix: eslintMatch.groups?.suffix
      },
      result
    })
  const oxlintMatch = oxlintLineRe.exec(line)
  if (oxlintMatch)
    return processMultiRuleLine({
      active,
      isOxlint: true,
      line,
      match: {
        prefix: oxlintMatch.groups?.prefix,
        rules: oxlintMatch.groups?.rules,
        suffix: oxlintMatch.groups?.suffix
      },
      oxlintOff,
      result
    })
  const biomeMatch = biomeLineRe.exec(line)
  if (biomeMatch && !isRuleActive(biomeMatch.groups?.rule ?? '', active)) return 1
  result.push(line)
  return 0
}
interface CleanFileOptions {
  eslintActive?: Set<string>
  oxlintOff?: Set<string>
}
const cleanFileIgnores = async (
  filePath: string,
  active: Set<string>,
  { eslintActive, oxlintOff }: CleanFileOptions = {}
): Promise<number> => {
  const f = file(filePath)
  if (!(await f.exists())) return 0
  const content = await f.text()
  const lines = content.split('\n')
  const result: string[] = []
  let removed = 0
  for (const line of lines)
    removed += processIgnoreLine({
      active,
      eslintActive,
      line,
      oxlintOff,
      result
    })
  if (removed > 0) await write(filePath, result.join('\n'))
  return removed
}
const buildEslintActiveRuleSet = (config: unknown, active: Set<string>): Set<string> => {
  // Oxlint also honors eslint-disable, so retain its active rules alongside this file's ESLint rules.
  const eslintActive = new Set(active)
  if (typeof config !== 'object' || config === null || !('rules' in config)) return eslintActive
  const rules: unknown = config.rules
  if (typeof rules !== 'object' || rules === null) return eslintActive
  for (const [rule, value] of Object.entries(rules)) {
    const severity: unknown = Array.isArray(value) ? value[0] : value
    if (severity !== 0 && severity !== 'off') for (const variant of normalizeRule(rule)) eslintActive.add(variant)
  }
  return eslintActive
}
interface CleanConfiguredFileOptions {
  active: Set<string>
  eslint: ESLint
  filePath: string
  oxlintOff: Set<string>
}
const cleanConfiguredFile = async ({
  active,
  eslint,
  filePath,
  oxlintOff
}: CleanConfiguredFileOptions): Promise<number> => {
  const config: unknown = await eslint.calculateConfigForFile(filePath)
  if (!config) return 0
  const eslintActive = buildEslintActiveRuleSet(config, active)
  return cleanFileIgnores(filePath, active, { eslintActive, oxlintOff })
}
const cleanIgnores = async (filePaths: string[]): Promise<CleanResult> => {
  const active = await buildActiveRuleSet({ excludeEslint: true })
  const oxlintOff = await loadOxlintOffRules()
  const eslint = new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: joinPath(process.cwd(), cacheDir, 'eslint.generated.mjs')
  })
  const counts = await Promise.all(
    filePaths.map(async filePath => cleanConfiguredFile({ active, eslint, filePath, oxlintOff }))
  )
  const cleaned = counts.reduce((total, count) => total + count, 0)
  const files = filePaths.filter((_, index) => (counts[index] ?? 0) > 0)
  return { cleaned, files }
}
export {
  buildActiveRuleSet,
  cleanFileIgnores,
  cleanIgnores,
  isRuleActive,
  loadOxlintOffRules,
  normalizeRule,
  splitDirective,
  splitRules
}
