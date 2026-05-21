/* eslint-disable no-await-in-loop, no-continue */
/** biome-ignore-all lint/nursery/noContinue: control-flow filtering */
/** biome-ignore-all lint/performance/noAwaitInLoops: sequential file io */
/** biome-ignore-all lint/style/noProcessEnv: linter env passthrough */
import { file, write } from 'bun'
import { parseBiomeDiagnostics, parseOxlintDiagnostics } from './aggregate.js'
import { normalizeRule } from './clean-ignores.js'
import { cacheDir, cwd, resolveBin, runCapture } from './core.js'
import { joinPath } from './path.js'

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
interface FileData {
  directiveLines: { index: number; rules: string[] }[]
  filePath: string
  lines: string[]
  orig: string
  stripped: string
}
const absFile = (p: string): string => (p.startsWith('/') ? p : joinPath(cwd, p))
const collectFileData = async (
  files: string[],
  parseDirectives: (lines: string[]) => { index: number; rules: string[] }[]
): Promise<FileData[]> => {
  const out: FileData[] = []
  for (const filePath of files) {
    const f = file(filePath)
    if (!(await f.exists())) continue
    const orig = await f.text()
    const lines = orig.split('\n')
    const directiveLines = parseDirectives(lines)
    if (directiveLines.length === 0) continue
    const directiveIndexes = new Set(directiveLines.map(d => d.index))
    const stripped = lines.filter((_, index) => !directiveIndexes.has(index)).join('\n')
    out.push({ directiveLines, filePath, lines, orig, stripped })
  }
  return out
}
const batchStripRestore = async ({
  data,
  lint
}: {
  data: FileData[]
  lint: () => Map<string, Set<string>>
}): Promise<Map<string, Set<string>>> => {
  await Promise.all(data.map(async d => write(d.filePath, d.stripped)))
  try {
    return lint()
  } finally {
    await Promise.all(data.map(async d => write(d.filePath, d.orig)))
  }
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
const firedOxlintByFile = ({
  configPath,
  files,
  oxlintBin
}: {
  configPath: string
  files: string[]
  oxlintBin: string
}): Map<string, Set<string>> => {
  const result = runCapture({
    args: [oxlintBin, '-c', configPath, '-f', 'json', ...files],
    command: 'bun',
    env: buildEnv(),
    label: 'oxlint-unused'
  })
  const diagnostics = parseOxlintDiagnostics({ stdout: extractJson(result.stdout) })
  const byFile = new Map<string, Set<string>>()
  for (const d of diagnostics) {
    const key = absFile(d.file)
    const set = byFile.get(key) ?? new Set<string>()
    set.add(d.rule)
    for (const v of normalizeRule(d.rule)) set.add(v)
    byFile.set(key, set)
  }
  return byFile
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
const rebuildOxlintFile = async ({
  data,
  dryRun,
  fired
}: {
  data: FileData
  dryRun: boolean
  fired: Set<string>
}): Promise<{ diagnostics: UnusedDirective[]; removed: number }> => {
  const result: string[] = []
  const diagnostics: UnusedDirective[] = []
  let removed = 0
  for (let index = 0; index < data.lines.length; index += 1) {
    const line = data.lines[index] ?? ''
    const directive = data.directiveLines.find(d => d.index === index)
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
        diagnostics.push({ col: 1, file: data.filePath, line: index + 1, rule })
      }
    if (kept.length === 0) continue
    if (kept.length === directive.rules.length) {
      result.push(line)
      continue
    }
    result.push(`${prefix}${kept.join(', ')}${suffix}`)
  }
  if (removed > 0 && !dryRun) await write(data.filePath, result.join('\n'))
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
const firedBiomeByFile = ({
  biomeBin,
  configDir,
  files
}: {
  biomeBin: string
  configDir: string
  files: string[]
}): Map<string, Set<string>> => {
  const result = runCapture({
    args: [biomeBin, 'lint', '--reporter=json', '--config-path', configDir, ...files],
    command: 'bun',
    env: buildEnv(),
    label: 'biome-unused'
  })
  const diagnostics = parseBiomeDiagnostics({ stdout: extractJson(result.stdout) })
  const byFile = new Map<string, Set<string>>()
  for (const d of diagnostics) {
    const key = absFile(d.file)
    const set = byFile.get(key) ?? new Set<string>()
    set.add(d.rule)
    byFile.set(key, set)
  }
  return byFile
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
const rebuildBiomeFile = async ({
  data,
  dryRun,
  fired
}: {
  data: FileData
  dryRun: boolean
  fired: Set<string>
}): Promise<{ diagnostics: UnusedDirective[]; removed: number }> => {
  const result: string[] = []
  const diagnostics: UnusedDirective[] = []
  let removed = 0
  for (let index = 0; index < data.lines.length; index += 1) {
    const line = data.lines[index] ?? ''
    const directive = data.directiveLines.find(d => d.index === index)
    if (!directive) {
      result.push(line)
      continue
    }
    const kept: string[] = []
    for (const rule of directive.rules)
      if (fired.has(rule)) kept.push(rule)
      else {
        removed += 1
        diagnostics.push({ col: 1, file: data.filePath, line: index + 1, rule })
      }
    if (kept.length === 0) continue
    if (kept.length === directive.rules.length) {
      result.push(line)
      continue
    }
    result.push(rebuildBiomeLine({ line, rules: kept }))
  }
  if (removed > 0 && !dryRun) await write(data.filePath, result.join('\n'))
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
  const oxlintData = await collectFileData(await findOxlintDisableFiles(targets), parseOxlintDirectiveLines)
  if (oxlintData.length > 0) {
    const firedByFile = await batchStripRestore({
      data: oxlintData,
      lint: () => firedOxlintByFile({ configPath: oxlintConfigPath, files: oxlintData.map(d => d.filePath), oxlintBin })
    })
    for (const data of oxlintData) {
      const outcome = await rebuildOxlintFile({
        data,
        dryRun,
        fired: firedByFile.get(absFile(data.filePath)) ?? new Set()
      })
      if (outcome.removed > 0) {
        removed += outcome.removed
        changedFiles.add(data.filePath)
      }
      diagnostics.push(...outcome.diagnostics)
    }
  }
  const biomeData = await collectFileData(await findBiomeIgnoreAllFiles(targets), parseBiomeDirectiveLines)
  if (biomeData.length > 0) {
    const firedByFile = await batchStripRestore({
      data: biomeData,
      lint: () => firedBiomeByFile({ biomeBin, configDir, files: biomeData.map(d => d.filePath) })
    })
    for (const data of biomeData) {
      const outcome = await rebuildBiomeFile({ data, dryRun, fired: firedByFile.get(absFile(data.filePath)) ?? new Set() })
      if (outcome.removed > 0) {
        removed += outcome.removed
        changedFiles.add(data.filePath)
      }
      diagnostics.push(...outcome.diagnostics)
    }
  }
  return { diagnostics, files: [...changedFiles], removed }
}
export type { RemoveResult, UnusedDirective }
export { removeUnusedSuppressions }
