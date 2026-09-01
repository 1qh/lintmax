/* eslint-disable no-await-in-loop */
/** biome-ignore-all lint/performance/noAwaitInLoops: sequential file io */
/** biome-ignore-all lint/style/noProcessEnv: linter env passthrough */
import { file, write } from 'bun'
import { parseBiomeDiagnostics, parseOxlintDiagnostics } from './aggregate.js'
import { normalizeRule } from './clean-ignores.js'
import { cacheDir, cwd, readRequiredJson, resolveBin, runCapture } from './core.js'
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
const oxlintDisableRe = /^(?<prefix>\s*\/\*\s*oxlint-disable\s+)(?<rules>\S(?:[^*]*[^\s*])?)(?<close>\s*\*\/)?$/v
const oxlintDisablePresentRe = /\/\*\s*oxlint-disable\s/v
const biomeIgnoreAllRe = /^\s*\/\*\*\s*biome-ignore-all\s+(?<first>[\w\/]+)(?<rest>(?:[^\w\/*][^*]*)?)\*\/\s*$/v
const biomeIgnoreAllLineRe = /^\s*\/\/\s*biome-ignore-all\s+(?<first>[\w\/]+)(?<rest>(?:[^\w\/].*)?)$/v
/** Both scan for a fixed delimiter, which a regex does by retrying at every start position — super-linear on a long line for a job `indexOf` does in one pass. */
const stripTrailingComment = (str: string): string => {
  const at = str.indexOf('--')
  return at === -1 ? str : str.slice(0, at).trimEnd()
}
const biomeReasonOf = (line: string): string | undefined => {
  const colon = line.indexOf(':')
  if (colon === -1) return
  const close = line.indexOf('*/', colon)
  return close === -1 ? undefined : line.slice(colon + 1, close).trim()
}
const leadingWhitespaceRe = /^\s*/v
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
    if (await f.exists()) {
      const orig = await f.text()
      const lines = orig.split('\n')
      const directiveLines = parseDirectives(lines)
      if (directiveLines.length > 0) {
        const directiveIndexes = new Set(directiveLines.map(d => d.index))
        const stripped = lines.filter((_, index) => !directiveIndexes.has(index)).join('\n')
        out.push({ directiveLines, filePath, lines, orig, stripped })
      }
    }
  }
  return out
}
const batchStripRestore = async ({
  data,
  lint
}: {
  data: FileData[]
  lint: () => Promise<Map<string, Set<string>>>
}): Promise<Map<string, Set<string>>> => {
  await Promise.all(data.map(async d => write(d.filePath, d.stripped)))
  try {
    return await lint()
  } finally {
    await Promise.all(data.map(async d => write(d.filePath, d.orig)))
  }
}
const splitOxlintRules = (str: string): string[] =>
  str
    .split(',')
    .map(r => stripTrailingComment(r.trim()))
    .filter(Boolean)
const splitBiomeRest = (rest: string): string[] => {
  const cleaned = rest.split(':')[0] ?? ''
  return cleaned
    .split(',')
    .map(r => r.trim())
    .filter(r => r.startsWith('lint/'))
}
const rebuildBiomeLine = ({ line, rules }: { line: string; rules: string[] }): string => {
  const reason = biomeReasonOf(line) ?? 'suppressed'
  const indentMatch = leadingWhitespaceRe.exec(line)
  const indent = indentMatch?.[0] ?? ''
  return `${indent}/** biome-ignore-all ${rules.join(', ')}: ${reason} */`
}
/**
 * A lint run that could not ANSWER must refuse, never resolve to an empty fired set. An empty map reads as
 * `no rule fired anywhere`, which marks EVERY directive in the tree unused — MEASURED on one CI lane, 35 of 35
 * directives reported while each one was genuinely needed. A clean run is not this shape: both linters emit
 * `{"diagnostics": []}` and exit 0 when they find nothing, so requiring a parsed diagnostics array refuses a
 * crash without ever refusing a clean tree.
 */
const requireLintAnswer = ({
  exitCode,
  label,
  stderr,
  stdout
}: {
  exitCode: number
  label: string
  stderr: string
  stdout: string
}): string => {
  const json = extractJson(stdout)
  const refuse = (why: string): never => {
    const said = [stderr.trim(), stdout.trim()].filter(part => part !== '').join(' | ')
    throw new Error(
      `${label}: ${why} (exit ${exitCode}). Refusing rather than reading it as "nothing fired", which would report every directive unused. ${said.slice(0, 600)}`
    )
  }
  let parsed: { diagnostics?: unknown }
  try {
    parsed = readRequiredJson<typeof parsed>(json)
  } catch {
    refuse('produced no parseable JSON')
  }
  if (!Array.isArray(parsed.diagnostics)) refuse('returned JSON carrying no diagnostics array')
  return json
}
const firedOxlintByFile = async ({
  configPath,
  files,
  oxlintBin
}: {
  configPath: string
  files: string[]
  oxlintBin: string
}): Promise<Map<string, Set<string>>> => {
  if (!(await file(configPath).exists()))
    throw new Error(
      `oxlint-unused: the generated config is absent at ${configPath}, so no rule can fire and every directive would read as unused. The stage that writes it did not run.`
    )
  const result = await runCapture({
    args: [oxlintBin, '-c', configPath, '-f', 'json', ...files],
    command: 'bun',
    env: buildEnv(),
    label: 'oxlint-unused'
  })
  const diagnostics = parseOxlintDiagnostics({
    stdout: requireLintAnswer({
      exitCode: result.exitCode,
      label: 'oxlint-unused',
      stderr: result.stderr,
      stdout: result.stdout
    })
  })
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
    if (match) directiveLines.push({ index, rules: splitOxlintRules(match.groups?.rules ?? '') })
  }
  return directiveLines
}
interface PartitionedRules {
  diagnostics: UnusedDirective[]
  kept: string[]
}
interface RebuiltDirective {
  diagnostics: UnusedDirective[]
  emitted: string[]
}
const partitionOxlintRules = ({
  directive,
  filePath,
  fired,
  index
}: {
  directive: { index: number; rules: string[] }
  filePath: string
  fired: Set<string>
  index: number
}): PartitionedRules => {
  const kept: string[] = []
  const diagnostics: UnusedDirective[] = []
  for (const rule of directive.rules)
    if (isOxlintRuleFired(rule, fired)) kept.push(rule)
    else diagnostics.push({ col: 1, file: filePath, line: index + 1, rule })
  return { diagnostics, kept }
}
const rebuildOxlintDirectiveLine = ({
  directive,
  filePath,
  fired,
  index,
  line
}: {
  directive: { index: number; rules: string[] }
  filePath: string
  fired: Set<string>
  index: number
  line: string
}): RebuiltDirective => {
  oxlintDisableRe.lastIndex = 0
  const match = oxlintDisableRe.exec(line)
  const prefix = match?.groups?.prefix ?? '/* oxlint-disable '
  const suffix = match?.groups?.close ?? ' */'
  const { diagnostics, kept } = partitionOxlintRules({ directive, filePath, fired, index })
  if (kept.length === directive.rules.length) return { diagnostics, emitted: [line] }
  if (kept.length > 0) return { diagnostics, emitted: [`${prefix}${kept.join(', ')}${suffix}`] }
  return { diagnostics, emitted: [] }
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
    if (directive) {
      const outcome = rebuildOxlintDirectiveLine({ directive, filePath: data.filePath, fired, index, line })
      removed += outcome.diagnostics.length
      diagnostics.push(...outcome.diagnostics)
      result.push(...outcome.emitted)
    } else result.push(line)
  }
  if (removed > 0 && !dryRun) await write(data.filePath, result.join('\n'))
  return { diagnostics, removed }
}
const findOxlintDisableFiles = async (filePaths: string[]): Promise<string[]> => {
  const out: string[] = []
  for (const fp of filePaths) {
    const f = file(fp)
    if (await f.exists()) {
      const content = await f.text()
      if (oxlintDisablePresentRe.test(content)) out.push(fp)
    }
  }
  return out
}
const findBiomeIgnoreAllFiles = async (filePaths: string[]): Promise<string[]> => {
  const out: string[] = []
  for (const fp of filePaths) {
    const f = file(fp)
    if (await f.exists()) {
      const content = await f.text()
      if (content.includes('biome-ignore-all')) out.push(fp)
    }
  }
  return out
}
const firedBiomeByFile = async ({
  biomeBin,
  configDir,
  files
}: {
  biomeBin: string
  configDir: string
  files: string[]
}): Promise<Map<string, Set<string>>> => {
  const result = await runCapture({
    args: [biomeBin, 'lint', '--reporter=json', '--config-path', configDir, ...files],
    command: 'bun',
    env: buildEnv(),
    label: 'biome-unused'
  })
  const diagnostics = parseBiomeDiagnostics({
    stdout: requireLintAnswer({
      exitCode: result.exitCode,
      label: 'biome-unused',
      stderr: result.stderr,
      stdout: result.stdout
    })
  })
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
    biomeIgnoreAllLineRe.lastIndex = 0
    const match = biomeIgnoreAllRe.exec(line) ?? biomeIgnoreAllLineRe.exec(line)
    if (match) {
      const first = match.groups?.first ?? ''
      const rest = match.groups?.rest ?? ''
      directiveLines.push({ index, rules: [first, ...splitBiomeRest(rest)] })
    }
  }
  return directiveLines
}
const partitionBiomeRules = ({
  directive,
  filePath,
  fired,
  index
}: {
  directive: { index: number; rules: string[] }
  filePath: string
  fired: Set<string>
  index: number
}): PartitionedRules => {
  const kept: string[] = []
  const diagnostics: UnusedDirective[] = []
  for (const rule of directive.rules)
    if (fired.has(rule)) kept.push(rule)
    else diagnostics.push({ col: 1, file: filePath, line: index + 1, rule })
  return { diagnostics, kept }
}
const rebuildBiomeDirectiveLine = ({
  directive,
  filePath,
  fired,
  index,
  line
}: {
  directive: { index: number; rules: string[] }
  filePath: string
  fired: Set<string>
  index: number
  line: string
}): RebuiltDirective => {
  const { diagnostics, kept } = partitionBiomeRules({ directive, filePath, fired, index })
  if (kept.length === directive.rules.length) return { diagnostics, emitted: [line] }
  if (kept.length > 0) return { diagnostics, emitted: [rebuildBiomeLine({ line, rules: kept })] }
  return { diagnostics, emitted: [] }
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
    if (directive) {
      const outcome = rebuildBiomeDirectiveLine({ directive, filePath: data.filePath, fired, index, line })
      removed += outcome.diagnostics.length
      diagnostics.push(...outcome.diagnostics)
      result.push(...outcome.emitted)
    } else result.push(line)
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
      lint: async () =>
        firedOxlintByFile({ configPath: oxlintConfigPath, files: oxlintData.map(d => d.filePath), oxlintBin })
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
      lint: async () => firedBiomeByFile({ biomeBin, configDir, files: biomeData.map(d => d.filePath) })
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
