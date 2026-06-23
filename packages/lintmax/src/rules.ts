import { file, spawnSync, write } from 'bun'
import { cwd, decodeText, resolveBin } from './core.js'
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
const OXLINT_FIX_MARKERS = new Set(['⚠️🛠️️', '💡', '🛠️', '🛠️💡'])
const extractOxlintRules = (): RuleEntry[] => {
  const configPath = joinPath(cwd, 'node_modules/.cache/lintmax/.oxlintrc.json')
  // oxlint-disable-next-line node/no-sync
  const result = spawnSync({
    cmd: ['bun', 'node_modules/.bin/oxlint', '-c', configPath, '--rules'],
    cwd,
    stderr: 'pipe',
    stdout: 'pipe'
  })
  const output = decodeText(result.stdout)
  const results: RuleEntry[] = []
  const lines = output.split('\n')
  for (const line of lines)
    if (line.startsWith('|') && !line.includes('Rule name')) {
      const cols = line.split('|').map(c => c.trim())
      const ruleName = cols[1]
      const source = cols[2]
      const fixCol = cols[5] ?? ''
      const enabledCol = cols[4] ?? ''
      if (ruleName && source && !ruleName.startsWith('---') && enabledCol.includes('✅'))
        results.push({
          fixable: OXLINT_FIX_MARKERS.has(fixCol.trim()),
          linter: 'oxlint',
          rule: source === 'oxc' ? ruleName : `${source}(${ruleName})`
        })
    }
  return results
}
const extractEslintRules = async (): Promise<RuleEntry[]> => {
  const eslintBin = await resolveBin({ bin: 'eslint', pkg: 'eslint' })
  const configPath = joinPath(cwd, 'node_modules/.cache/lintmax/eslint.generated.mjs')
  const dummyFile = joinPath(cwd, '_lintmax_dummy.ts')
  await write(dummyFile, 'export {}\n')
  // oxlint-disable-next-line node/no-sync
  const result = spawnSync({
    cmd: ['bun', eslintBin, '--config', configPath, '--print-config', dummyFile],
    cwd,
    stderr: 'pipe',
    stdout: 'pipe'
  })
  // oxlint-disable-next-line node/no-sync
  spawnSync({ cmd: ['rm', '-f', dummyFile], stderr: 'pipe', stdout: 'pipe' })
  if (result.exitCode !== 0) return []
  let parsed: { rules?: Record<string, unknown> }
  try {
    parsed = JSON.parse(decodeText(result.stdout)) as typeof parsed
  } catch {
    return []
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
  const oxlint = extractOxlintRules()
  const [biome, eslint] = await Promise.all([extractBiomeRules(), extractEslintRules()])
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
