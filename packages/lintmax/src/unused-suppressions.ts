/* eslint-disable no-await-in-loop */
/** biome-ignore-all lint/performance/noAwaitInLoops: sequential file io */
/** biome-ignore-all lint/style/noProcessEnv: linter env passthrough */
import { file, write } from 'bun'
import { parseBiomeDiagnostics, parseOxlintDiagnostics } from './aggregate.js'
import { normalizeRule } from './clean-ignores.js'
import { OXLINT_CLI_ALLOW } from './constants.js'
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
const buildFileData = (
  filePath: string,
  orig: string,
  parseDirectives: (lines: string[]) => FileData['directiveLines']
): FileData | undefined => {
  const lines = orig.split('\n')
  const directiveLines = parseDirectives(lines)
  if (directiveLines.length === 0) return
  const directiveIndexes = new Set(directiveLines.map(d => d.index))
  const stripped = lines.filter((_, index) => !directiveIndexes.has(index)).join('\n')
  return { directiveLines, filePath, lines, orig, stripped }
}
const collectFileData = async (
  files: string[],
  parseDirectives: (lines: string[]) => FileData['directiveLines']
): Promise<FileData[]> => {
  const results = await Promise.all(
    files.map(async filePath => {
      const source = file(filePath)
      if (!(await source.exists())) return
      return buildFileData(filePath, await source.text(), parseDirectives)
    })
  )
  return results.filter((result): result is FileData => result !== undefined)
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
const oxlintUnusedArgs = ({
  configPath,
  files,
  oxlintBin
}: {
  configPath: string
  files: readonly string[]
  oxlintBin: string
}): string[] => [
  oxlintBin,
  '-c',
  configPath,
  '-f',
  'json',
  ...OXLINT_CLI_ALLOW.flatMap(rule => ['--allow', rule]),
  ...files
]
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
    const out = stdout.trim()
    const shape = `[${String(out.length)} bytes]`
    const head = out.slice(0, 400)
    const tail = out.length > 400 ? ` … TAIL ${out.slice(-200)}` : ''
    const said = [stderr.trim(), `${shape} ${head}${tail}`].filter(part => part !== '').join(' | ')
    throw new Error(
      `${label}: ${why} (exit ${exitCode}). Refusing rather than reading it as "nothing fired", which would report every directive unused. ${said}`
    )
  }
  let parsed: { diagnostics?: unknown }
  try {
    parsed = readRequiredJson<typeof parsed>(json)
  } catch {
    refuse('produced no parseable JSON')
  }
  if (!Array.isArray(parsed.diagnostics)) refuse('returned JSON carrying no diagnostics array')
  if (exitCode !== 0 && parsed.diagnostics.length === 0) refuse('failed with zero diagnostics')
  return json
}
const groupOxlintDiagnostics = (diagnostics: ReturnType<typeof parseOxlintDiagnostics>) => {
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
    args: oxlintUnusedArgs({ configPath, files, oxlintBin }),
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
  return groupOxlintDiagnostics(diagnostics)
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
interface RebuildFileInput {
  data: FileData
  dryRun: boolean
  fired: Set<string>
}
interface RebuildLineInput {
  directive: { index: number; rules: string[] }
  filePath: string
  fired: Set<string>
  index: number
  line: string
}
const rebuildFile = async (
  { data, dryRun, fired }: RebuildFileInput,
  rebuildLine: (input: RebuildLineInput) => RebuiltDirective
): Promise<{ diagnostics: UnusedDirective[]; removed: number }> => {
  const outcomes = data.lines.map((line, index) => {
    const directive = data.directiveLines.find(d => d.index === index)
    return directive
      ? rebuildLine({ directive, filePath: data.filePath, fired, index, line })
      : { diagnostics: [], emitted: [line] }
  })
  const diagnostics = outcomes.flatMap(outcome => outcome.diagnostics)
  if (diagnostics.length > 0 && !dryRun)
    await write(data.filePath, outcomes.flatMap(outcome => outcome.emitted).join('\n'))
  return { diagnostics, removed: diagnostics.length }
}
const rebuildOxlintFile = async (input: RebuildFileInput) => rebuildFile(input, rebuildOxlintDirectiveLine)
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
const matchBiomeDirective = (line: string) => {
  biomeIgnoreAllRe.lastIndex = 0
  biomeIgnoreAllLineRe.lastIndex = 0
  return biomeIgnoreAllRe.exec(line) ?? biomeIgnoreAllLineRe.exec(line)
}
const parseBiomeDirectiveLines = (lines: string[]): { index: number; rules: string[] }[] => {
  const directiveLines: { index: number; rules: string[] }[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = matchBiomeDirective(lines[index] ?? '')
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
const rebuildBiomeFile = async (input: RebuildFileInput) => rebuildFile(input, rebuildBiomeDirectiveLine)
const rebuildBatch = async ({
  dryRun,
  files,
  firedByFile,
  rebuild
}: {
  dryRun: boolean
  files: FileData[]
  firedByFile: Map<string, Set<string>>
  rebuild: (input: RebuildFileInput) => Promise<{ diagnostics: UnusedDirective[]; removed: number }>
}): Promise<RemoveResult> => {
  const outcomes = await Promise.all(
    files.map(async data => ({
      filePath: data.filePath,
      outcome: await rebuild({ data, dryRun, fired: firedByFile.get(absFile(data.filePath)) ?? new Set() })
    }))
  )
  const diagnostics = outcomes.flatMap(result => result.outcome.diagnostics)
  return {
    diagnostics,
    files: outcomes.filter(result => result.outcome.removed > 0).map(result => result.filePath),
    removed: diagnostics.length
  }
}
const removeOxlintSuppressions = async ({
  dryRun,
  oxlintBin,
  oxlintConfigPath,
  targets
}: {
  dryRun: boolean
  oxlintBin: string
  oxlintConfigPath: string
  targets: string[]
}): Promise<RemoveResult> => {
  const oxlintData = await collectFileData(await findOxlintDisableFiles(targets), parseOxlintDirectiveLines)
  if (oxlintData.length > 0) {
    const firedByFile = await batchStripRestore({
      data: oxlintData,
      lint: async () =>
        firedOxlintByFile({ configPath: oxlintConfigPath, files: oxlintData.map(d => d.filePath), oxlintBin })
    })
    return rebuildBatch({ dryRun, files: oxlintData, firedByFile, rebuild: rebuildOxlintFile })
  }
  return { diagnostics: [], files: [], removed: 0 }
}
const removeBiomeSuppressions = async ({
  biomeBin,
  configDir,
  dryRun,
  targets
}: {
  biomeBin: string
  configDir: string
  dryRun: boolean
  targets: string[]
}): Promise<RemoveResult> => {
  const biomeData = await collectFileData(await findBiomeIgnoreAllFiles(targets), parseBiomeDirectiveLines)
  if (biomeData.length > 0) {
    const firedByFile = await batchStripRestore({
      data: biomeData,
      lint: async () => firedBiomeByFile({ biomeBin, configDir, files: biomeData.map(d => d.filePath) })
    })
    return rebuildBatch({ dryRun, files: biomeData, firedByFile, rebuild: rebuildBiomeFile })
  }
  return { diagnostics: [], files: [], removed: 0 }
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
  const oxlint = await removeOxlintSuppressions({ dryRun, oxlintBin, oxlintConfigPath, targets })
  const biome = await removeBiomeSuppressions({ biomeBin, configDir, dryRun, targets })
  return {
    diagnostics: [...oxlint.diagnostics, ...biome.diagnostics],
    files: [...new Set([...oxlint.files, ...biome.files])],
    removed: oxlint.removed + biome.removed
  }
}
export type { RemoveResult, UnusedDirective }
export { oxlintUnusedArgs, removeUnusedSuppressions, requireLintAnswer }
