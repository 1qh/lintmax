import { $, file, write } from 'bun'
import { unlink } from 'node:fs/promises'
import { cwd, readRequiredJson, resolveBin } from './core.js'
import { isRecord } from './normalize.js'
import { fromFileUrl, joinPath } from './path.js'
interface RuleEntry {
  fixable: boolean
  linter: string
  rule: string
}
const extractBiomeRules = async (): Promise<RuleEntry[]> => {
  const pkgPath = fromFileUrl(import.meta.resolve('@biomejs/biome/configuration_schema.json'))
  const schema = readRequiredJson<{
    $defs?: Record<string, { properties?: Record<string, unknown> }>
  }>(await file(pkgPath).text())
  const defs = schema.$defs ?? {}
  const categories = ['a11y', 'complexity', 'correctness', 'nursery', 'performance', 'security', 'style', 'suspicious']
  const results: RuleEntry[] = []
  for (const cat of categories) {
    const key = cat.charAt(0).toUpperCase() + cat.slice(1)
    const rules = Object.keys(defs[key]?.properties ?? {})
    for (const rule of rules)
      results.push({
        fixable: false,
        linter: 'biome',
        rule: `lint/${cat}/${rule}`
      })
  }
  return results
}
const enabledOxlintRules = (rules: Record<string, unknown>): RuleEntry[] => {
  const results: RuleEntry[] = []
  for (const [rule, value] of Object.entries(rules)) {
    const severity: unknown = Array.isArray(value) ? value[0] : value
    if (severity === 'deny') results.push({ fixable: false, linter: 'oxlint', rule })
  }
  return results
}
const parseOxlintRules = (stdout: string): RuleEntry[] => {
  const parsed: unknown = JSON.parse(stdout)
  if (!isRecord(parsed)) throw new Error('oxlint --print-config returned no document')
  const { rules } = parsed
  if (!isRecord(rules)) throw new Error('oxlint --print-config returned no rules map')
  const results = enabledOxlintRules(rules)
  if (results.length === 0)
    throw new Error('oxlint reports zero enabled rules — the gate runs it, so that cannot be right')
  return results
}
const extractOxlintRules = async (): Promise<RuleEntry[]> => {
  const configPath = joinPath(cwd, 'node_modules/.cache/lintmax/.oxlintrc.json')
  const bin = await resolveBin({ bin: 'oxlint', pkg: 'oxlint' })
  const result = await $`bun ${bin} -c ${configPath} --print-config`.cwd(cwd).quiet().nothrow()
  if (result.exitCode !== 0)
    throw new Error(`oxlint --print-config failed, so its rule set is unknown: ${result.stderr.toString().trim()}`)
  return parseOxlintRules(result.stdout.toString())
}
const readEslintDocument = (stdout: string) => {
  let parsed: { rules?: Record<string, unknown> }
  try {
    parsed = readRequiredJson<typeof parsed>(stdout)
  } catch (error) {
    throw new Error(`eslint --print-config returned unreadable JSON: ${error instanceof Error ? error.message : ''}`, {
      cause: error
    })
  }
  return parsed
}
const parseEslintRules = (stdout: string): RuleEntry[] => {
  const parsed = readEslintDocument(stdout)
  const allRules = parsed.rules ?? {}
  const results: RuleEntry[] = []
  for (const [rule, config] of Object.entries(allRules)) {
    const level: unknown = Array.isArray(config) ? config[0] : config
    if (level !== 0 && level !== 'off')
      results.push({
        fixable: false,
        linter: 'eslint',
        rule
      })
  }
  return results
}
const extractEslintRules = async (): Promise<RuleEntry[]> => {
  const eslintBin = await resolveBin({ bin: 'eslint', pkg: 'eslint' })
  const configPath = joinPath(cwd, 'node_modules/.cache/lintmax/eslint.generated.mjs')
  const dummyFile = joinPath(cwd, '_lintmax_dummy.ts')
  await write(dummyFile, 'export {}\n')
  const result = await $`bun ${eslintBin} --config ${configPath} --print-config ${dummyFile}`.cwd(cwd).quiet().nothrow()
  await unlink(dummyFile).catch(() => undefined)
  if (result.exitCode !== 0)
    throw new Error(`eslint --print-config failed, so its rule set is unknown: ${result.stderr.toString().trim()}`)
  return parseEslintRules(result.stdout.toString())
}
const extractAllRules = async (): Promise<RuleEntry[]> => {
  const [oxlint, biome, eslint] = await Promise.all([extractOxlintRules(), extractBiomeRules(), extractEslintRules()])
  return [...biome, ...oxlint, ...eslint].toSorted((a, b) => {
    const linterCmp = a.linter.localeCompare(b.linter)
    if (linterCmp !== 0) return linterCmp
    return a.rule.localeCompare(b.rule)
  })
}
const formatLinterRuleGroups = (byLinter: Map<string, string[]>): string => {
  const parts: string[] = []
  for (const [linter, ruleList] of byLinter) {
    parts.push(`${linter} (${ruleList.length})`)
    for (const rule of ruleList) parts.push(` ${rule}`)
  }
  return parts.join('\n')
}
const formatRulesCompact = (rules: RuleEntry[]): string => {
  const byLinter = new Map<string, string[]>()
  for (const r of rules) {
    let list = byLinter.get(r.linter)
    if (!list) {
      list = []
      byLinter.set(r.linter, list)
    }
    list.push(r.rule)
  }
  return formatLinterRuleGroups(byLinter)
}
const formatRulesHuman = (rules: RuleEntry[]): string => {
  const header = 'Linter          Rule'
  const separator = '─'.repeat(60)
  const lines = [header, separator]
  for (const r of rules) lines.push(`${r.linter.padEnd(16)}${r.rule}`)
  lines.push(separator, `Total: ${rules.length} rules`)
  return lines.join('\n')
}
export { extractAllRules, formatRulesCompact, formatRulesHuman }
