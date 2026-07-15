/** biome-ignore-all lint/performance/noAwaitInLoops: sequential pipeline fix steps mutate files in order */
/* eslint-disable complexity */
import { $, env as bunEnv, file, Glob } from 'bun'
import type { Diagnostic } from './aggregate.js'
import type { FailureRecord, RunOpts, StepSpec } from './core.js'
import type { ExtraBins } from './extra-coverage.js'
import type { DangerousSuppression } from './ignores.js'
import type { UnusedDirective } from './unused-suppressions.js'
import {
  aggregate,
  parseBiomeDiagnostics,
  parseEslintDiagnostics,
  parseOxlintDiagnostics,
  parsePrettierOutput,
  parseSortPackageJsonOutput
} from './aggregate.js'
import { checkClassName } from './class-name.js'
import { cleanIgnores } from './clean-ignores.js'
import { checkComments, fixComments } from './comments.js'
import { listCompactFiles, runCompact } from './compact.js'
import { DEFAULT_SHARED_IGNORE_PATTERNS, OXLINT_CLI_ALLOW } from './constants.js'
import {
  cacheDir,
  CliExitError,
  cwd,
  ensureDirectory,
  lintmaxRoot,
  pathExists,
  PRETTIER_MD_ARGS,
  readJson,
  resolveBin,
  run,
  runCapture
} from './core.js'
import { runExtraCoverage } from './extra-coverage.js'
import { formatGrouped } from './format.js'
import { findDangerousSuppressions } from './ignores.js'
import { sync } from './index.js'
import { checkJsxExtension } from './jsx-extension.js'
import { dirnamePath, joinPath } from './path.js'
import { removeUnusedSuppressions } from './unused-suppressions.js'

const emitExtra = (result: { diagnostics: Diagnostic[]; notes: string[] }): Diagnostic[] => {
  for (const note of result.notes) process.stderr.write(`lintmax: ${note}\n`)
  return result.diagnostics
}
const createStepExecutor = ({
  env,
  failures,
  root
}: {
  env: Record<string, string | undefined>
  failures: FailureRecord[]
  root: string
}) => {
  const runContinue = async (opts: RunOpts): Promise<void> => {
    try {
      await run(opts)
    } catch (error) {
      if (error instanceof CliExitError) {
        failures.push({
          code: error.code,
          label: opts.label,
          message: error.message.length > 0 ? error.message : undefined
        })
        return
      }
      throw error
    }
  }
  const runCompactContinue = async ({ human = false, mode }: { human?: boolean; mode: 'check' | 'fix' }) => {
    try {
      await runCompact({
        env,
        human,
        mode,
        root
      })
    } catch (error) {
      if (error instanceof CliExitError) {
        failures.push({
          code: error.code,
          label: 'compact',
          message: error.message.length > 0 ? error.message : undefined
        })
        return
      }
      throw error
    }
  }
  const runSteps = async ({ steps }: { steps: StepSpec[] }) => {
    for (const step of steps) {
      const opts = {
        args: step.args,
        command: step.command ?? 'bun',
        env,
        label: step.label,
        silent: step.silent
      }
      // eslint-disable-next-line no-await-in-loop
      await runContinue(opts)
    }
  }
  const runStepsSilent = async ({ steps }: { steps: StepSpec[] }) => {
    for (const step of steps) {
      // eslint-disable-next-line no-await-in-loop
      const result = await runCapture({
        args: step.args,
        command: step.command ?? 'bun',
        env,
        label: step.label
      })
      if (result.exitCode !== 0)
        failures.push({
          code: result.exitCode,
          label: step.label,
          message: result.stderr.length > 0 ? result.stderr.trim() : undefined
        })
    }
  }
  const clearFailures = () => {
    failures.length = 0
  }
  const throwIfFailures = () => {
    if (failures.length === 0) return
    const details = failures
      .map(item => `- ${item.label} (exit ${item.code})${item.message ? `\n${item.message}` : ''}`)
      .join('\n')
    const code = failures[0]?.code ?? 1
    throw new CliExitError({
      code,
      message: `One or more steps failed:\n${details}`
    })
  }
  return {
    clearFailures,
    runCompactContinue,
    runSteps,
    runStepsSilent,
    throwIfFailures
  }
}
const createCheckSteps = ({
  biomeBin,
  dir,
  eslintArgs,
  eslintBin,
  oxlintBin,
  oxlintIgnorePatterns,
  prettierBin,
  prettierMarkdownTargets,
  sortPkgJson
}: {
  biomeBin: string
  dir: string
  eslintArgs: string[]
  eslintBin: string
  oxlintBin: string
  oxlintIgnorePatterns: readonly string[]
  prettierBin: string
  prettierMarkdownTargets: string[]
  sortPkgJson: string
}): StepSpec[] => {
  const oxlintCliAllow = [
    ...OXLINT_CLI_ALLOW.flatMap(r => ['--allow', r]),
    ...oxlintIgnorePatterns.flatMap(p => ['--ignore-pattern', p])
  ]
  const steps: StepSpec[] = [
    {
      args: [sortPkgJson, '--check', '**/package.json', '--ignore', '**/node_modules/**'],
      label: 'sort-package-json'
    },
    {
      args: [biomeBin, 'ci', '--config-path', dir, '--diagnostic-level=error'],
      label: 'biome'
    },
    {
      args: [
        oxlintBin,
        '-c',
        joinPath(dir, '.oxlintrc.json'),
        '--quiet',
        '--no-error-on-unmatched-pattern',
        ...oxlintCliAllow
      ],
      label: 'oxlint'
    },
    {
      args: [eslintBin, '--no-error-on-unmatched-pattern', ...eslintArgs],
      label: 'eslint'
    }
  ]
  if (prettierMarkdownTargets.length > 0)
    steps.push({
      args: [prettierBin, ...PRETTIER_MD_ARGS, '--check', '--no-error-on-unmatched-pattern', ...prettierMarkdownTargets],
      label: 'prettier'
    })
  return steps
}
const createFixSteps = ({
  biomeBin,
  dir,
  eslintArgs,
  eslintBin,
  hasFlowmark,
  oxlintBin,
  oxlintIgnorePatterns,
  prettierBin,
  prettierMarkdownTargets,
  sortPkgJson
}: {
  biomeBin: string
  dir: string
  eslintArgs: string[]
  eslintBin: string
  hasFlowmark: boolean
  oxlintBin: string
  oxlintIgnorePatterns: readonly string[]
  prettierBin: string
  prettierMarkdownTargets: string[]
  sortPkgJson: string
}): StepSpec[] => {
  const oxlintCliAllow = [
    ...OXLINT_CLI_ALLOW.flatMap(r => ['--allow', r]),
    ...oxlintIgnorePatterns.flatMap(p => ['--ignore-pattern', p])
  ]
  const steps: StepSpec[] = [
    {
      args: [sortPkgJson, '**/package.json', '--ignore', '**/node_modules/**'],
      label: 'sort-package-json',
      silent: true
    },
    {
      args: [biomeBin, 'check', '--config-path', dir, '--fix', '--diagnostic-level=error'],
      label: 'biome',
      silent: true
    },
    {
      args: [
        oxlintBin,
        '-c',
        joinPath(dir, '.oxlintrc.json'),
        '--fix',
        '--fix-suggestions',
        '--quiet',
        '--no-error-on-unmatched-pattern',
        ...oxlintCliAllow
      ],
      label: 'oxlint',
      silent: true
    },
    {
      args: [eslintBin, ...eslintArgs, '--fix'],
      label: 'eslint',
      silent: true
    },
    {
      args: [biomeBin, 'check', '--config-path', dir, '--fix', '--diagnostic-level=error'],
      label: 'biome',
      silent: true
    }
  ]
  if (hasFlowmark)
    steps.push({
      args: ['-w', '0', '--auto', '.'],
      command: 'flowmark',
      label: 'flowmark',
      silent: true
    })
  if (prettierMarkdownTargets.length > 0)
    steps.push({
      args: [prettierBin, ...PRETTIER_MD_ARGS, '--write', '--no-error-on-unmatched-pattern', ...prettierMarkdownTargets],
      label: 'prettier',
      silent: true
    })
  return steps
}
const captureAndParse = async ({
  env,
  failures,
  label,
  opts,
  parser
}: {
  env: Record<string, string | undefined>
  failures: FailureRecord[]
  label: string
  opts: { args: string[]; command: string }
  parser: (result: { exitCode: number; stdout: string }) => Diagnostic[]
}): Promise<Diagnostic[]> => {
  const result = await runCapture({
    args: opts.args,
    command: opts.command,
    env,
    label
  })
  if (result.exitCode === 0) return []
  const diagnostics = parser(result)
  if (diagnostics.length > 0) return diagnostics
  const stderr = result.stderr.trim()
  const stdout = result.stdout.trim()
  const stdoutFirst = stdout.split('\n', 1)[0]?.trimStart() ?? ''
  const stdoutIsJson = stdoutFirst.startsWith('[') || stdoutFirst.startsWith('{')
  const message = stderr.length > 0 ? stderr : stdoutIsJson ? undefined : stdout || undefined
  failures.push({ code: result.exitCode, label, message })
  return []
}
const runAgentCheck = async ({
  biomeBin,
  dir,
  env,
  eslintArgs,
  eslintBin,
  failures,
  oxlintBin,
  oxlintIgnorePatterns,
  prettierBin,
  prettierMarkdownTargets,
  sortPkgJson
}: {
  biomeBin: string
  dir: string
  env: Record<string, string | undefined>
  eslintArgs: string[]
  eslintBin: string
  failures: FailureRecord[]
  oxlintBin: string
  oxlintIgnorePatterns: readonly string[]
  prettierBin: string
  prettierMarkdownTargets: string[]
  sortPkgJson: string
}): Promise<Diagnostic[]> => {
  const oxlintCliAllow = [
    ...OXLINT_CLI_ALLOW.flatMap(r => ['--allow', r]),
    ...oxlintIgnorePatterns.flatMap(p => ['--ignore-pattern', p])
  ]
  const allDiagnostics: Diagnostic[] = []
  const push = (d: Diagnostic[]) => {
    if (d.length > 0) allDiagnostics.push(...d)
  }
  push(
    await captureAndParse({
      env,
      failures,
      label: 'sort-package-json',
      opts: {
        args: [sortPkgJson, '--check', '**/package.json', '--ignore', '**/node_modules/**'],
        command: 'bun'
      },
      parser: parseSortPackageJsonOutput
    })
  )
  push(
    await captureAndParse({
      env,
      failures,
      label: 'biome',
      opts: {
        args: [biomeBin, 'check', '--config-path', dir, '--reporter=json'],
        command: 'bun'
      },
      parser: ({ stdout }) => parseBiomeDiagnostics({ stdout })
    })
  )
  push(
    await captureAndParse({
      env,
      failures,
      label: 'oxlint',
      opts: {
        args: [
          oxlintBin,
          '-c',
          joinPath(dir, '.oxlintrc.json'),
          '--quiet',
          '--no-error-on-unmatched-pattern',
          '-f',
          'json',
          ...oxlintCliAllow
        ],
        command: 'bun'
      },
      parser: ({ stdout }) => parseOxlintDiagnostics({ stdout })
    })
  )
  push(
    await captureAndParse({
      env,
      failures,
      label: 'eslint',
      opts: {
        args: [eslintBin, '--no-error-on-unmatched-pattern', ...eslintArgs, '-f', 'json'],
        command: 'bun'
      },
      parser: ({ stdout }) => parseEslintDiagnostics({ stdout })
    })
  )
  if (prettierMarkdownTargets.length > 0)
    push(
      await captureAndParse({
        env,
        failures,
        label: 'prettier',
        opts: {
          args: [
            prettierBin,
            ...PRETTIER_MD_ARGS,
            '--list-different',
            '--no-error-on-unmatched-pattern',
            ...prettierMarkdownTargets
          ],
          command: 'bun'
        },
        parser: ({ stdout }) => parsePrettierOutput({ stdout })
      })
    )
  return allDiagnostics
}
const unusedToDiagnostics = ({ root, unused }: { root: string; unused: UnusedDirective[] }): Diagnostic[] => {
  const prefix = `${root}/`
  const out: Diagnostic[] = []
  for (const u of unused)
    out.push({
      file: u.file.startsWith(prefix) ? u.file.slice(prefix.length) : u.file,
      line: u.line,
      linter: 'unused-suppression',
      rule: u.rule ?? 'unused-disable-directive'
    })
  return out
}
const dangerousToDiagnostics = (items: DangerousSuppression[]): Diagnostic[] =>
  items.map(d => ({ file: d.file, line: d.line, linter: 'forbidden-suppression', rule: d.rule }))
const isGitWorkTree = async ({ env, root }: { env: Record<string, string | undefined>; root: string }): Promise<boolean> =>
  (await $`git -C ${root} rev-parse --is-inside-work-tree`.env(env).quiet().nothrow()).exitCode === 0
const PRETTIER_EXTENSIONS = ['.md', '.yml', '.yaml']
const isPrettierTarget = (filePath: string): boolean => PRETTIER_EXTENSIONS.some(ext => filePath.endsWith(ext))
const createPrettierMarkdownTargets = ({
  gitFiles,
  gitWorkTree
}: {
  gitFiles: string[]
  gitWorkTree: boolean
}): string[] => {
  if (!gitWorkTree) return PRETTIER_EXTENSIONS.map(ext => `**/*${ext}`)
  return gitFiles.filter(isPrettierTarget)
}
const throwAgentResults = ({ diagnostics, failures }: { diagnostics: Diagnostic[]; failures: FailureRecord[] }) => {
  if (diagnostics.length === 0 && failures.length === 0) return
  const grouped = aggregate({ diagnostics })
  const output = formatGrouped({ files: grouped })
  if (output.length > 0) process.stdout.write(`${output}\n`)
  if (failures.length > 0) {
    const details = failures
      .map(item => `- ${item.label} (exit ${item.code})${item.message ? `\n${item.message}` : ''}`)
      .join('\n')
    process.stderr.write(`${details}\n`)
  }
  throw new CliExitError({ code: 1 })
}
const readOxlintIgnorePatterns = async ({ dir }: { dir: string }): Promise<string[]> => {
  const generated = file(joinPath(dir, '.oxlintrc.json'))
  const exists = await generated.exists()
  if (!exists) return [...DEFAULT_SHARED_IGNORE_PATTERNS]
  const parsed = (await generated.json()) as { ignorePatterns?: unknown }
  const patterns = parsed.ignorePatterns
  if (!Array.isArray(patterns)) return [...DEFAULT_SHARED_IGNORE_PATTERNS]
  return patterns.filter((x): x is string => typeof x === 'string')
}
const runLint = async ({ command, human = false }: { command: 'check' | 'fix'; human?: boolean }) => {
  const dir = joinPath(cwd, cacheDir)
  await ensureDirectory({ directory: dir })
  const configPath = joinPath(cwd, 'lintmax.config.ts')
  const hasConfig = await pathExists({ path: configPath })
  const bundledBinA = joinPath(lintmaxRoot, 'node_modules', '.bin')
  const bundledBinB = joinPath(dirnamePath(lintmaxRoot), '.bin')
  const cwdBinDir = joinPath(cwd, 'node_modules', '.bin')
  const runtimePath = joinPath(dir, 'lintmax.json')
  const env = {
    ...bunEnv,
    PATH: `${bundledBinA}:${bundledBinB}:${cwdBinDir}:${bunEnv.PATH ?? ''}`
  }
  await (hasConfig
    ? run({
        args: [
          '-e',
          `const m = await import('${configPath}'); const { sync: s } = await import('lintmax'); await s(m.default);`
        ],
        command: 'bun',
        env,
        label: 'config',
        silent: true
      })
    : sync())
  const runtime = (await readJson({ path: runtimePath })) as {
    comments?: boolean
    compact?: boolean
  }
  const failures: FailureRecord[] = []
  const { clearFailures, runCompactContinue, runSteps, runStepsSilent, throwIfFailures } = createStepExecutor({
    env,
    failures,
    root: cwd
  })
  if (command === 'fix' && runtime.compact === true) await runCompactContinue({ human, mode: 'fix' })
  const eslintArgs = ['--config', joinPath(dir, 'eslint.generated.mjs')]
  const [sortPkgJson, biomeBin, oxlintBin, eslintBin, prettierBin, taploBin, dprintBin] = await Promise.all([
    resolveBin({ bin: 'sort-package-json', pkg: 'sort-package-json' }),
    resolveBin({ bin: 'biome', pkg: '@biomejs/biome' }),
    resolveBin({ bin: 'oxlint', pkg: 'oxlint' }),
    resolveBin({ bin: 'eslint', pkg: 'eslint' }),
    resolveBin({ bin: 'prettier', pkg: 'prettier' }),
    resolveBin({ bin: 'taplo', pkg: '@taplo/cli' }),
    resolveBin({ bin: 'dprint', pkg: 'dprint' })
  ])
  const extraBins: ExtraBins = { dprint: dprintBin, taplo: taploBin }
  const hasFlowmark = (await $`which flowmark`.env(env).quiet().nothrow()).exitCode === 0
  const gitWorkTree = await isGitWorkTree({ env, root: cwd })
  const allGitFiles = gitWorkTree ? await listCompactFiles({ env, root: cwd }) : []
  const prettierMarkdownTargets = createPrettierMarkdownTargets({ gitFiles: allGitFiles, gitWorkTree })
  const oxlintIgnorePatterns = await readOxlintIgnorePatterns({ dir })
  const checkSteps = createCheckSteps({
    biomeBin,
    dir,
    eslintArgs,
    eslintBin,
    oxlintBin,
    oxlintIgnorePatterns,
    prettierBin,
    prettierMarkdownTargets,
    sortPkgJson
  })
  const shouldComments = runtime.comments !== false
  const ignoreGlobs = oxlintIgnorePatterns.map(p => new Glob(p))
  const isIgnored = (filePath: string): boolean => ignoreGlobs.some(g => g.match(filePath))
  const sourceFiles = allGitFiles.filter(f => !isIgnored(f))
  if (command === 'fix') {
    if (shouldComments) await fixComments({ files: sourceFiles })
    if (sourceFiles.length > 0) await cleanIgnores(sourceFiles.map(f => joinPath(cwd, f)))
    const fixSteps = createFixSteps({
      biomeBin,
      dir,
      eslintArgs,
      eslintBin,
      hasFlowmark,
      oxlintBin,
      oxlintIgnorePatterns,
      prettierBin,
      prettierMarkdownTargets,
      sortPkgJson
    })
    await (human ? runSteps({ steps: fixSteps }) : runStepsSilent({ steps: fixSteps }))
    clearFailures()
    if (sourceFiles.length > 0)
      await removeUnusedSuppressions({ filePaths: sourceFiles.map(f => joinPath(cwd, f)), root: cwd })
    if (human) {
      await runSteps({ steps: checkSteps })
      const extraHuman = emitExtra(await runExtraCoverage({ bins: extraBins, command: 'fix', env, gitFiles: allGitFiles }))
      if (extraHuman.length > 0) {
        const output = formatGrouped({ files: aggregate({ diagnostics: extraHuman }) })
        if (output.length > 0) process.stdout.write(`${output}\n`)
        failures.push({ code: 1, label: 'extra-coverage' })
      }
      throwIfFailures()
      return
    }
    const allDiagnostics = await runAgentCheck({
      biomeBin,
      dir,
      env,
      eslintArgs,
      eslintBin,
      failures,
      oxlintBin,
      oxlintIgnorePatterns,
      prettierBin,
      prettierMarkdownTargets,
      sortPkgJson
    })
    if (shouldComments) {
      const commentDiags = await checkComments({ files: sourceFiles })
      allDiagnostics.push(...commentDiags)
    }
    const cnDiags = await checkClassName({ root: cwd })
    const jsxDiags = await checkJsxExtension({ root: cwd })
    allDiagnostics.push(
      ...cnDiags,
      ...jsxDiags,
      ...emitExtra(await runExtraCoverage({ bins: extraBins, command: 'fix', env, gitFiles: allGitFiles }))
    )
    throwAgentResults({ diagnostics: allDiagnostics, failures })
    return
  }
  if (human) {
    await runSteps({ steps: checkSteps })
    const cnDiagsHuman = await checkClassName({ root: cwd })
    const jsxDiagsHuman = await checkJsxExtension({ root: cwd })
    const unusedHuman =
      sourceFiles.length > 0
        ? await removeUnusedSuppressions({ dryRun: true, filePaths: sourceFiles.map(f => joinPath(cwd, f)), root: cwd })
        : { diagnostics: [], files: [], removed: 0 }
    const humanCustomDiags = [
      ...cnDiagsHuman,
      ...jsxDiagsHuman,
      ...unusedToDiagnostics({ root: cwd, unused: unusedHuman.diagnostics }),
      ...dangerousToDiagnostics(await findDangerousSuppressions(cwd)),
      ...emitExtra(await runExtraCoverage({ bins: extraBins, command: 'check', env, gitFiles: allGitFiles }))
    ]
    if (humanCustomDiags.length > 0) {
      const grouped = aggregate({ diagnostics: humanCustomDiags })
      const output = formatGrouped({ files: grouped })
      if (output.length > 0) process.stdout.write(`${output}\n`)
      failures.push({ code: 1, label: 'cn' })
    }
    throwIfFailures()
    return
  }
  const allDiagnostics = await runAgentCheck({
    biomeBin,
    dir,
    env,
    eslintArgs,
    eslintBin,
    failures,
    oxlintBin,
    oxlintIgnorePatterns,
    prettierBin,
    prettierMarkdownTargets,
    sortPkgJson
  })
  if (shouldComments) {
    const commentDiags = await checkComments({ files: sourceFiles })
    allDiagnostics.push(...commentDiags)
  }
  const cnDiags = await checkClassName({ root: cwd })
  const jsxDiags = await checkJsxExtension({ root: cwd })
  allDiagnostics.push(...cnDiags, ...jsxDiags)
  if (sourceFiles.length > 0) {
    const unusedAgent = await removeUnusedSuppressions({
      dryRun: true,
      filePaths: sourceFiles.map(f => joinPath(cwd, f)),
      root: cwd
    })
    allDiagnostics.push(...unusedToDiagnostics({ root: cwd, unused: unusedAgent.diagnostics }))
  }
  allDiagnostics.push(
    ...dangerousToDiagnostics(await findDangerousSuppressions(cwd)),
    ...emitExtra(await runExtraCoverage({ bins: extraBins, command: 'check', env, gitFiles: allGitFiles }))
  )
  if (allDiagnostics.length > 0 || failures.length > 0) {
    const grouped = aggregate({ diagnostics: allDiagnostics })
    const output = formatGrouped({ files: grouped })
    if (output.length > 0) process.stdout.write(`${output}\n`)
    if (failures.length > 0) {
      const details = failures
        .map(item => `- ${item.label} (exit ${item.code})${item.message ? `\n${item.message}` : ''}`)
        .join('\n')
      process.stderr.write(`${details}\n`)
    }
    throw new CliExitError({ code: 1 })
  }
}
export { runLint }
