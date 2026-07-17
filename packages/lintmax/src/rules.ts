import { $, file, write } from 'bun'
import { unlink } from 'node:fs/promises'
import { cwd, resolveBin } from './core.js'
import { isRecord } from './normalize.js'
import { fromFileUrl, joinPath } from './path.js'

interface RuleEntry {
  fixable: boolean
  linter: string
  rule: string
}
const extractBiomeRules = async (): Promise<RuleEntry[]> => {
  const pkgPath = fromFileUrl(import.meta.resolve('@biomejs/biome/configuration_schema.json'))
  const schema = JSON.parse(await file(pkgPath).text()) as {
    $defs?: Record<string, { properties?: Record<string, unknown> }>
  }
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
/** Reads oxlint's own resolved config. `--rules` prints nothing on current oxlint while still exiting 0 and still being listed in its help, so parsing that table yielded an empty oxlint section — and an empty section renders exactly like a linter that contributes nothing. It contributes 726 of the roughly 1738 rules this gate runs, so the command answering "what is enforced?" was wrong by more than a third while looking complete. */
const extractOxlintRules = async (): Promise<RuleEntry[]> => {
  const configPath = joinPath(cwd, 'node_modules/.cache/lintmax/.oxlintrc.json')
  const bin = await resolveBin({ bin: 'oxlint', pkg: 'oxlint' })
  const result = await $`bun ${bin} -c ${configPath} --print-config`.cwd(cwd).quiet().nothrow()
  if (result.exitCode !== 0)
    throw new Error(`oxlint --print-config failed, so its rule set is unknown: ${result.stderr.toString().trim()}`)
  const parsed: unknown = JSON.parse(result.stdout.toString())
  if (!isRecord(parsed)) throw new Error('oxlint --print-config returned no document')
  const { rules } = parsed
  if (!isRecord(rules)) throw new Error('oxlint --print-config returned no rules map')
  const results: RuleEntry[] = []
  for (const [rule, value] of Object.entries(rules)) {
    const severity: unknown = Array.isArray(value) ? (value as unknown[])[0] : value
    if (severity === 'deny') results.push({ fixable: false, linter: 'oxlint', rule })
  }
  if (results.length === 0)
    throw new Error('oxlint reports zero enabled rules — the gate runs it, so that cannot be right')
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
  let parsed: { rules?: Record<string, unknown> }
  try {
    parsed = JSON.parse(result.stdout.toString()) as typeof parsed
  } catch (error) {
    throw new Error(`eslint --print-config returned unreadable JSON: ${error instanceof Error ? error.message : ''}`, {
      cause: error
    })
  }
  const allRules = parsed.rules ?? {}
  const results: RuleEntry[] = []
  for (const [rule, config] of Object.entries(allRules)) {
    const level = Array.isArray(config) ? (config as unknown[])[0] : config
    if (level !== 0 && level !== 'off')
      results.push({
        fixable: false,
        linter: 'eslint',
        rule
      })
  }
  return results
}
const extractAllRules = async (): Promise<RuleEntry[]> => {
  const [oxlint, biome, eslint] = await Promise.all([extractOxlintRules(), extractBiomeRules(), extractEslintRules()])
  return [...biome, ...oxlint, ...eslint].toSorted((a, b) => {
    const linterCmp = a.linter.localeCompare(b.linter)
    if (linterCmp !== 0) return linterCmp
    return a.rule.localeCompare(b.rule)
  })
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
  const parts: string[] = []
  for (const [linter, ruleList] of byLinter) {
    parts.push(`${linter} (${ruleList.length})`)
    for (const rule of ruleList) parts.push(` ${rule}`)
  }
  return parts.join('\n')
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
