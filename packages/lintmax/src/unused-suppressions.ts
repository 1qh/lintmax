/* eslint-disable no-await-in-loop, no-continue */
/** biome-ignore-all lint/nursery/noContinue: control-flow filtering */
/** biome-ignore-all lint/performance/noAwaitInLoops: sequential file io */
/** biome-ignore-all lint/style/noProcessEnv: linter env passthrough */
import { file, write } from 'bun'
import { parseBiomeDiagnostics } from './aggregate.js'
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
const oxlintDisableRe = /^(?<prefix>\s*(?:\/\/|\/\*)\s*oxlint-disable(?:-next-line)?\s+)(?<rules>.+?)(?<close>\s*\*\/)?$/u
const biomeIgnoreAllRe = /^\s*\/\*\*\s*biome-ignore-all\s+(?<first>[\w/]+)(?<rest>.*?)\*\/\s*$/u
const unusedRuleRe = /no problems were reported from (?<rule>[\w@/-]+)\)/u
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
const collectOxlintUnused = ({
  configPath,
  filePaths,
  oxlintBin,
  root
}: {
  configPath: string
  filePaths: string[]
  oxlintBin: string
  root: string
}): UnusedDirective[] => {
  if (filePaths.length === 0) return []
  const result = runCapture({
    args: [
      oxlintBin,
      '-c',
      configPath,
      '--report-unused-disable-directives-severity=error',
      '--quiet',
      '-f',
      'json',
      ...filePaths
    ],
    command: 'bun',
    env: buildEnv(),
    label: 'oxlint-unused'
  })
  let parsed: {
    diagnostics?: {
      filename?: string
      labels?: { span?: { column?: number; line?: number } }[]
      message?: string
    }[]
  }
  try {
    parsed = JSON.parse(result.stdout) as typeof parsed
  } catch {
    return []
  }
  if (!Array.isArray(parsed.diagnostics)) return []
  const out: UnusedDirective[] = []
  for (const d of parsed.diagnostics) {
    const message = d.message ?? ''
    if (!message.startsWith('Unused oxlint-disable directive')) continue
    const filename = d.filename ?? ''
    if (filename.length === 0) continue
    const span = d.labels?.[0]?.span
    const ruleMatch = unusedRuleRe.exec(message)
    out.push({
      col: span?.column ?? 1,
      file: filename.startsWith('/') ? filename : joinPath(root, filename),
      line: span?.line ?? 1,
      rule: ruleMatch?.groups?.rule
    })
  }
  return out
}
const resolveOxlintLine = ({
  hits,
  line
}: {
  hits: UnusedDirective[]
  line: string
}): null | { removed: number; text?: string } => {
  oxlintDisableRe.lastIndex = 0
  const match = oxlintDisableRe.exec(line)
  if (!match) return null
  const prefix = match.groups?.prefix ?? ''
  const rulesStr = match.groups?.rules ?? ''
  const suffix = match.groups?.close ?? ''
  const rules = splitOxlintRules(rulesStr)
  const namedUnused = new Set<string>()
  let dropWhole = false
  for (const hit of hits)
    if (hit.rule) namedUnused.add(hit.rule)
    else dropWhole = true
  if (dropWhole || namedUnused.size >= rules.length) return { removed: rules.length }
  const kept = rules.filter(r => !namedUnused.has(r))
  if (kept.length === rules.length) return { removed: 0, text: line }
  return { removed: rules.length - kept.length, text: `${prefix}${kept.join(', ')}${suffix}` }
}
const removeOxlintFromFile = async ({
  directives,
  dryRun,
  filePath
}: {
  directives: UnusedDirective[]
  dryRun: boolean
  filePath: string
}): Promise<number> => {
  const f = file(filePath)
  if (!(await f.exists())) return 0
  const content = await f.text()
  const lines = content.split('\n')
  const byLine = new Map<number, UnusedDirective[]>()
  for (const d of directives) {
    const list = byLine.get(d.line) ?? []
    list.push(d)
    byLine.set(d.line, list)
  }
  const result: string[] = []
  let removed = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const hits = byLine.get(index + 1)
    const resolved = hits ? resolveOxlintLine({ hits, line }) : null
    if (!resolved) {
      result.push(line)
      continue
    }
    removed += resolved.removed
    if (typeof resolved.text === 'string') result.push(resolved.text)
  }
  if (removed > 0 && !dryRun) await write(filePath, result.join('\n'))
  return removed
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
  const oxlintUnused = collectOxlintUnused({ configPath: oxlintConfigPath, filePaths: targets, oxlintBin, root })
  const oxlintByFile = new Map<string, UnusedDirective[]>()
  for (const d of oxlintUnused) {
    const list = oxlintByFile.get(d.file) ?? []
    list.push(d)
    oxlintByFile.set(d.file, list)
  }
  const changedFiles = new Set<string>()
  const diagnostics: UnusedDirective[] = [...oxlintUnused]
  let removed = 0
  for (const [filePath, directives] of oxlintByFile) {
    const count = await removeOxlintFromFile({ directives, dryRun, filePath })
    if (count > 0) {
      removed += count
      changedFiles.add(filePath)
    }
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
