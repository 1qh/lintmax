/* eslint-disable no-await-in-loop, no-continue */
/** biome-ignore-all lint/nursery/noContinue: control-flow filtering */
/** biome-ignore-all lint/performance/noAwaitInLoops: sequential file io */
/** biome-ignore-all lint/style/noProcessEnv: linter env passthrough */
import { file, write } from 'bun'
import { parseBiomeDiagnostics, parseOxlintDiagnostics } from './aggregate.js'
import { normalizeRule } from './clean-ignores.js'
import { cacheDir, resolveBin, runCapture } from './core.js'
import { dirnamePath, joinPath } from './path.js'

interface RemoveResult {
  diagnostics: UnusedDirective[]
  files: string[]
  removed: number
}
interface UnusedDirective {
  col: number
  file: string
  line: number
  rule?: string
}
const oxlintDisableRe = /^(?<prefix>\s*\/\*\s*oxlint-disable\s+)(?<rules>.+?)(?<close>\s*\*\/)?$/u
const oxlintDisablePresentRe = /\/\*\s*oxlint-disable\s/u
const biomeIgnoreAllRe = /^\s*\/\*\*\s*biome-ignore-all\s+(?<first>[\w/]+)(?<rest>.*?)\*\/\s*$/u
const trailingCommentRe = /\s*--.*$/u
const biomeReasonRe = /:(?<reason>.*?)\*\//u
const leadingWhitespaceRe = /^\s*/u
const buildEnv = (): Record<string, string | undefined> => ({ ...process.env })
const extractJson = (stdout: string): string => {
  const start = stdout.indexOf('{')
  if (start === -1) return stdout
  return stdout.slice(start)
}
const extOf = (filePath: string): string => {
  const base = filePath.slice(filePath.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot)
}
const splitOxlintRules = (str: string): string[] =>
  str
    .split(',')
    .map(r => r.trim().replace(trailingCommentRe, ''))
    .filter(Boolean)
const splitBiomeRest = (rest: string): string[] => {
  const cleaned = rest.split(':')[0] ?? ''
  return cleaned
    .split(',')
    .map(r => r.trim())
    .filter(r => r.startsWith('lint/'))
}
const rebuildBiomeLine = ({ line, rules }: { line: string; rules: string[] }): string => {
  const reasonMatch = biomeReasonRe.exec(line)
  const reason = reasonMatch?.groups?.reason?.trim() ?? 'suppressed'
  const indentMatch = leadingWhitespaceRe.exec(line)
  const indent = indentMatch?.[0] ?? ''
  return `${indent}/** biome-ignore-all ${rules.join(', ')}: ${reason} */`
}
const firedOxlintRules = ({
  configPath,
  oxlintBin,
  tempPath
}: {
  configPath: string
  oxlintBin: string
  tempPath: string
}): Set<string> => {
  const result = runCapture({
    args: [oxlintBin, '-c', configPath, '-f', 'json', tempPath],
    command: 'bun',
    env: buildEnv(),
    label: 'oxlint-unused'
  })
  const diagnostics = parseOxlintDiagnostics({ stdout: extractJson(result.stdout) })
  const fired = new Set<string>()
  for (const d of diagnostics) {
    fired.add(d.rule)
    for (const v of normalizeRule(d.rule)) fired.add(v)
  }
  return fired
}
const isOxlintRuleFired = (rule: string, fired: Set<string>): boolean => {
  if (fired.has(rule)) return true
  for (const v of normalizeRule(rule)) if (fired.has(v)) return true
  return false
}
const parseOxlintDirectiveLines = (lines: string[]): { index: number; rules: string[] }[] => {
  const directiveLines: { index: number; rules: string[] }[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    oxlintDisableRe.lastIndex = 0
    const match = oxlintDisableRe.exec(line)
    if (!match) continue
    directiveLines.push({ index, rules: splitOxlintRules(match.groups?.rules ?? '') })
  }
  return directiveLines
}
const processOxlintFile = async ({
  configPath,
  dryRun,
  filePath,
  oxlintBin
}: {
  configPath: string
  dryRun: boolean
  filePath: string
  oxlintBin: string
}): Promise<{ diagnostics: UnusedDirective[]; removed: number }> => {
  const f = file(filePath)
  if (!(await f.exists())) return { diagnostics: [], removed: 0 }
  const content = await f.text()
  const lines = content.split('\n')
  const directiveLines = parseOxlintDirectiveLines(lines)
  if (directiveLines.length === 0) return { diagnostics: [], removed: 0 }
  const directiveIndexes = new Set(directiveLines.map(d => d.index))
  const stripped = lines.filter((_, index) => !directiveIndexes.has(index))
  const tempPath = joinPath(
    dirnamePath(filePath),
    `.lintmax-unused-${Date.now()}-${Math.random().toString(36).slice(2)}${extOf(filePath)}`
  )
  await write(tempPath, stripped.join('\n'))
  let fired: Set<string>
  try {
    fired = firedOxlintRules({ configPath, oxlintBin, tempPath })
  } finally {
    await file(tempPath).delete()
  }
  const result: string[] = []
  const diagnostics: UnusedDirective[] = []
  let removed = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const directive = directiveLines.find(d => d.index === index)
    if (!directive) {
      result.push(line)
      continue
    }
    oxlintDisableRe.lastIndex = 0
    const match = oxlintDisableRe.exec(line)
    const prefix = match?.groups?.prefix ?? '/* oxlint-disable '
    const suffix = match?.groups?.close ?? ' */'
    const kept: string[] = []
    for (const rule of directive.rules)
      if (isOxlintRuleFired(rule, fired)) kept.push(rule)
      else {
        removed += 1
        diagnostics.push({ col: 1, file: filePath, line: index + 1, rule })
      }
    if (kept.length === 0) continue
    if (kept.length === directive.rules.length) {
      result.push(line)
      continue
    }
    result.push(`${prefix}${kept.join(', ')}${suffix}`)
  }
  if (removed > 0 && !dryRun) await write(filePath, result.join('\n'))
  return { diagnostics, removed }
}
const findOxlintDisableFiles = async (filePaths: string[]): Promise<string[]> => {
  const out: string[] = []
  for (const fp of filePaths) {
    const f = file(fp)
    if (!(await f.exists())) continue
    const content = await f.text()
    if (oxlintDisablePresentRe.test(content)) out.push(fp)
  }
  return out
}
const findBiomeIgnoreAllFiles = async (filePaths: string[]): Promise<string[]> => {
  const out: string[] = []
  for (const fp of filePaths) {
    const f = file(fp)
    if (!(await f.exists())) continue
    const content = await f.text()
    if (content.includes('biome-ignore-all')) out.push(fp)
  }
  return out
}
const firedBiomeCategories = ({
  biomeBin,
  configDir,
  tempPath
}: {
  biomeBin: string
  configDir: string
  tempPath: string
}): Set<string> => {
  const result = runCapture({
    args: [biomeBin, 'lint', '--reporter=json', '--config-path', configDir, tempPath],
    command: 'bun',
    env: buildEnv(),
    label: 'biome-unused'
  })
  const diagnostics = parseBiomeDiagnostics({ stdout: extractJson(result.stdout) })
  const fired = new Set<string>()
  for (const d of diagnostics) fired.add(d.rule)
  return fired
}
const parseBiomeDirectiveLines = (lines: string[]): { index: number; rules: string[] }[] => {
  const directiveLines: { index: number; rules: string[] }[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    biomeIgnoreAllRe.lastIndex = 0
    const match = biomeIgnoreAllRe.exec(line)
    if (!match) continue
    const first = match.groups?.first ?? ''
    const rest = match.groups?.rest ?? ''
    directiveLines.push({ index, rules: [first, ...splitBiomeRest(rest)] })
  }
  return directiveLines
}
const processBiomeFile = async ({
  biomeBin,
  configDir,
  dryRun,
  filePath
}: {
  biomeBin: string
  configDir: string
  dryRun: boolean
  filePath: string
}): Promise<{ diagnostics: UnusedDirective[]; removed: number }> => {
  const f = file(filePath)
  if (!(await f.exists())) return { diagnostics: [], removed: 0 }
  const content = await f.text()
  const lines = content.split('\n')
  const directiveLines = parseBiomeDirectiveLines(lines)
  if (directiveLines.length === 0) return { diagnostics: [], removed: 0 }
  const directiveIndexes = new Set(directiveLines.map(d => d.index))
  const stripped = lines.filter((_, index) => !directiveIndexes.has(index))
  const tempPath = joinPath(
    dirnamePath(filePath),
    `.lintmax-unused-${Date.now()}-${Math.random().toString(36).slice(2)}${extOf(filePath)}`
  )
  await write(tempPath, stripped.join('\n'))
  let fired: Set<string>
  try {
    fired = firedBiomeCategories({ biomeBin, configDir, tempPath })
  } finally {
    await file(tempPath).delete()
  }
  const result: string[] = []
  const diagnostics: UnusedDirective[] = []
  let removed = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const directive = directiveLines.find(d => d.index === index)
    if (!directive) {
      result.push(line)
      continue
    }
    const kept: string[] = []
    for (const rule of directive.rules)
      if (fired.has(rule)) kept.push(rule)
      else {
        removed += 1
        diagnostics.push({ col: 1, file: filePath, line: index + 1, rule })
      }
    if (kept.length === 0) continue
    if (kept.length === directive.rules.length) {
      result.push(line)
      continue
    }
    result.push(rebuildBiomeLine({ line, rules: kept }))
  }
  if (removed > 0 && !dryRun) await write(filePath, result.join('\n'))
  return { diagnostics, removed }
}
const removeUnusedSuppressions = async ({
  dryRun = false,
  filePaths,
  root
}: {
  dryRun?: boolean
  filePaths?: string[]
  root: string
}): Promise<RemoveResult> => {
  const targets = filePaths ?? []
  if (targets.length === 0) return { diagnostics: [], files: [], removed: 0 }
  const configDir = joinPath(root, cacheDir)
  const oxlintConfigPath = joinPath(configDir, '.oxlintrc.json')
  const [oxlintBin, biomeBin] = await Promise.all([
    resolveBin({ bin: 'oxlint', pkg: 'oxlint' }),
    resolveBin({ bin: 'biome', pkg: '@biomejs/biome' })
  ])
  const changedFiles = new Set<string>()
  const diagnostics: UnusedDirective[] = []
  let removed = 0
  const oxlintFiles = await findOxlintDisableFiles(targets)
  for (const filePath of oxlintFiles) {
    const outcome = await processOxlintFile({ configPath: oxlintConfigPath, dryRun, filePath, oxlintBin })
    if (outcome.removed > 0) {
      removed += outcome.removed
      changedFiles.add(filePath)
    }
    diagnostics.push(...outcome.diagnostics)
  }
  const biomeFiles = await findBiomeIgnoreAllFiles(targets)
  for (const filePath of biomeFiles) {
    const outcome = await processBiomeFile({ biomeBin, configDir, dryRun, filePath })
    if (outcome.removed > 0) {
      removed += outcome.removed
      changedFiles.add(filePath)
    }
    diagnostics.push(...outcome.diagnostics)
  }
  return { diagnostics, files: [...changedFiles], removed }
}
export type { RemoveResult, UnusedDirective }
export { removeUnusedSuppressions }
