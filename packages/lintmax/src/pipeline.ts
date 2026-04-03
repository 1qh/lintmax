import { env as bunEnv, spawnSync } from 'bun'
import type { Diagnostic } from './aggregate.js'
import type { FailureRecord, RunOpts, StepSpec } from './core.js'
import {
  aggregate,
  parseBiomeDiagnostics,
  parseEslintDiagnostics,
  parseOxlintDiagnostics,
  parsePrettierOutput,
  parseSortPackageJsonOutput
} from './aggregate.js'
import { checkComments, fixComments } from './comments.js'
import { listCompactFiles, runCompact } from './compact.js'
import { DEFAULT_SHARED_IGNORE_PATTERNS } from './constants.js'
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
import { formatGrouped } from './format.js'
import { sync } from './index.js'
import { dirnamePath, joinPath } from './path.js'
const createStepExecutor = ({
  env,
  failures,
  root
}: {
  env: Record<string, string | undefined>
  failures: FailureRecord[]
  root: string
}) => {
  const runContinue = (opts: RunOpts): void => {
    try {
      run(opts)
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
  const runSteps = ({ steps }: { steps: StepSpec[] }) => {
    for (const step of steps)
      runContinue({
        args: step.args,
        command: step.command ?? 'bun',
        env,
        label: step.label,
        silent: step.silent
      })
  }
  const runStepsSilent = ({ steps }: { steps: StepSpec[] }) => {
    for (const step of steps) {
      const result = runCapture({
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
  prettierBin,
  sortPkgJson
}: {
  biomeBin: string
  dir: string
  eslintArgs: string[]
  eslintBin: string
  oxlintBin: string
  prettierBin: string
  sortPkgJson: string
}): StepSpec[] => [
  {
    args: [sortPkgJson, '--check', '**/package.json', '--ignore', '**/node_modules/**'],
    label: 'sort-package-json'
  },
  {
    args: [biomeBin, 'ci', '--config-path', dir, '--diagnostic-level=error'],
    label: 'biome'
  },
  {
    args: [oxlintBin, '-c', joinPath(dir, '.oxlintrc.json'), '--quiet'],
    label: 'oxlint'
  },
  {
    args: [eslintBin, '--no-error-on-unmatched-pattern', ...eslintArgs],
    label: 'eslint'
  },
  {
    args: [prettierBin, ...PRETTIER_MD_ARGS, '--check', '--no-error-on-unmatched-pattern', '**/*.md'],
    label: 'prettier'
  }
]
const createFixSteps = ({
  biomeBin,
  dir,
  eslintArgs,
  eslintBin,
  hasFlowmark,
  oxlintBin,
  prettierBin,
  sortPkgJson
}: {
  biomeBin: string
  dir: string
  eslintArgs: string[]
  eslintBin: string
  hasFlowmark: boolean
  oxlintBin: string
  prettierBin: string
  sortPkgJson: string
}): StepSpec[] => {
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
      args: [oxlintBin, '-c', joinPath(dir, '.oxlintrc.json'), '--fix', '--fix-suggestions', '--quiet'],
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
  steps.push({
    args: [prettierBin, ...PRETTIER_MD_ARGS, '--write', '--no-error-on-unmatched-pattern', '**/*.md'],
    label: 'prettier',
    silent: true
  })
  return steps
}
const captureAndParse = ({
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
}): Diagnostic[] => {
  const result = runCapture({
    args: opts.args,
    command: opts.command,
    env,
    label
  })
  if (result.exitCode === 0) return []
  const diagnostics = parser(result)
  if (diagnostics.length > 0) return diagnostics
  failures.push({
    code: result.exitCode,
    label,
    message: result.stderr.length > 0 ? result.stderr.trim() : undefined
  })
  return []
}
const runAgentCheck = ({
  biomeBin,
  dir,
  env,
  eslintArgs,
  eslintBin,
  failures,
  oxlintBin,
  prettierBin,
  sortPkgJson
}: {
  biomeBin: string
  dir: string
  env: Record<string, string | undefined>
  eslintArgs: string[]
  eslintBin: string
  failures: FailureRecord[]
  oxlintBin: string
  prettierBin: string
  sortPkgJson: string
}): Diagnostic[] => {
  const allDiagnostics: Diagnostic[] = []
  const push = (d: Diagnostic[]) => {
    if (d.length > 0) allDiagnostics.push(...d)
  }
  push(
    captureAndParse({
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
    captureAndParse({
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
    captureAndParse({
      env,
      failures,
      label: 'oxlint',
      opts: {
        args: [oxlintBin, '-c', joinPath(dir, '.oxlintrc.json'), '--quiet', '-f', 'json'],
        command: 'bun'
      },
      parser: ({ stdout }) => parseOxlintDiagnostics({ stdout })
    })
  )
  push(
    captureAndParse({
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
  push(
    captureAndParse({
      env,
      failures,
      label: 'prettier',
      opts: {
        args: [prettierBin, ...PRETTIER_MD_ARGS, '--list-different', '--no-error-on-unmatched-pattern', '**/*.md'],
        command: 'bun'
      },
      parser: ({ stdout }) => parsePrettierOutput({ stdout })
    })
  )
  return allDiagnostics
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
const runLint = async ({ command, human = false }: { command: 'check' | 'fix'; human?: boolean }) => {
  const dir = joinPath(cwd, cacheDir)
  ensureDirectory({ directory: dir })
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
  if (hasConfig)
    run({
      args: [
        '-e',
        `const m = await import('${configPath}'); const { sync: s } = await import('lintmax'); await s(m.default);`
      ],
      command: 'bun',
      env,
      label: 'config',
      silent: true
    })
  else await sync()
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
  const [sortPkgJson, biomeBin, oxlintBin, eslintBin, prettierBin] = await Promise.all([
    resolveBin({ bin: 'sort-package-json', pkg: 'sort-package-json' }),
    resolveBin({ bin: 'biome', pkg: '@biomejs/biome' }),
    resolveBin({ bin: 'oxlint', pkg: 'oxlint' }),
    resolveBin({ bin: 'eslint', pkg: 'eslint' }),
    resolveBin({ bin: 'prettier', pkg: 'prettier' })
  ])
  const hasFlowmark =
    spawnSync({
      cmd: ['which', 'flowmark'],
      env,
      stderr: 'pipe',
      stdout: 'pipe'
    }).exitCode === 0
  const checkSteps = createCheckSteps({
    biomeBin,
    dir,
    eslintArgs,
    eslintBin,
    oxlintBin,
    prettierBin,
    sortPkgJson
  })
  const shouldComments = runtime.comments !== false
  const isIgnored = (filePath: string): boolean =>
    DEFAULT_SHARED_IGNORE_PATTERNS.some(pattern => {
      const regex = new RegExp(`^${pattern.replaceAll('**/', '(.*/)?').replaceAll('*', '[^/]*')}$`, 'u')
      return regex.test(filePath)
    })
  const gitFiles = shouldComments ? listCompactFiles({ env, root: cwd }).filter(f => !isIgnored(f)) : []
  if (command === 'fix') {
    if (shouldComments) await fixComments({ files: gitFiles })
    const fixSteps = createFixSteps({
      biomeBin,
      dir,
      eslintArgs,
      eslintBin,
      hasFlowmark,
      oxlintBin,
      prettierBin,
      sortPkgJson
    })
    if (human) runSteps({ steps: fixSteps })
    else runStepsSilent({ steps: fixSteps })
    clearFailures()
    if (human) {
      runSteps({ steps: checkSteps })
      throwIfFailures()
      return
    }
    const allDiagnostics = runAgentCheck({
      biomeBin,
      dir,
      env,
      eslintArgs,
      eslintBin,
      failures,
      oxlintBin,
      prettierBin,
      sortPkgJson
    })
    if (shouldComments) {
      const commentDiags = await checkComments({ files: gitFiles })
      allDiagnostics.push(...commentDiags)
    }
    throwAgentResults({ diagnostics: allDiagnostics, failures })
    return
  }
  if (human) {
    runSteps({ steps: checkSteps })
    throwIfFailures()
    return
  }
  const allDiagnostics = runAgentCheck({
    biomeBin,
    dir,
    env,
    eslintArgs,
    eslintBin,
    failures,
    oxlintBin,
    prettierBin,
    sortPkgJson
  })
  if (shouldComments) {
    const commentDiags = await checkComments({ files: gitFiles })
    allDiagnostics.push(...commentDiags)
  }
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
