import { env as bunEnv, spawnSync } from 'bun'
import type { FailureRecord, RunOpts, StepSpec } from './core.js'
import { runCompact } from './compact.js'
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
  run
} from './core.js'
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
      },
      runCompactContinue = async ({ mode }: { mode: 'check' | 'fix' }) => {
        try {
          await runCompact({
            env,
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
      },
      runSteps = ({ steps }: { steps: StepSpec[] }) => {
        for (const step of steps)
          runContinue({
            args: step.args,
            command: step.command ?? 'bun',
            env,
            label: step.label,
            silent: step.silent
          })
      },
      clearFailures = () => {
        failures.length = 0
      },
      throwIfFailures = () => {
        if (failures.length === 0) return
        const details = failures
            .map(item => `- ${item.label} (exit ${item.code})${item.message ? `\n${item.message}` : ''}`)
            .join('\n'),
          code = failures[0]?.code ?? 1
        throw new CliExitError({
          code,
          message: `One or more steps failed:\n${details}`
        })
      }
    return {
      clearFailures,
      runCompactContinue,
      runSteps,
      throwIfFailures
    }
  },
  createCheckSteps = ({
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
      args: [eslintBin, ...eslintArgs, '--cache', '--cache-location', joinPath(cwd, '.cache', '.eslintcache')],
      label: 'eslint'
    },
    {
      args: [prettierBin, ...PRETTIER_MD_ARGS, '--check', '--no-error-on-unmatched-pattern', '**/*.md'],
      label: 'prettier'
    }
  ],
  createFixSteps = ({
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
        args: [eslintBin, ...eslintArgs, '--fix', '--cache', '--cache-location', joinPath(cwd, '.cache', '.eslintcache')],
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
  },
  runLint = async ({ command }: { command: 'check' | 'fix' }) => {
    const dir = joinPath(cwd, cacheDir)
    ensureDirectory({ directory: dir })
    const configPath = joinPath(cwd, 'lintmax.config.ts'),
      hasConfig = await pathExists({ path: configPath }),
      bundledBinA = joinPath(lintmaxRoot, 'node_modules', '.bin'),
      bundledBinB = joinPath(dirnamePath(lintmaxRoot), '.bin'),
      cwdBinDir = joinPath(cwd, 'node_modules', '.bin'),
      runtimePath = joinPath(dir, 'lintmax.json'),
      env = {
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
        compact?: boolean
      },
      failures: FailureRecord[] = [],
      { clearFailures, runCompactContinue, runSteps, throwIfFailures } = createStepExecutor({
        env,
        failures,
        root: cwd
      })
    if (command === 'fix' && runtime.compact === true) await runCompactContinue({ mode: 'fix' })
    const eslintArgs = ['--config', joinPath(dir, 'eslint.generated.mjs')],
      [sortPkgJson, biomeBin, oxlintBin, eslintBin, prettierBin] = await Promise.all([
        resolveBin({ bin: 'sort-package-json', pkg: 'sort-package-json' }),
        resolveBin({ bin: 'biome', pkg: '@biomejs/biome' }),
        resolveBin({ bin: 'oxlint', pkg: 'oxlint' }),
        resolveBin({ bin: 'eslint', pkg: 'eslint' }),
        resolveBin({ bin: 'prettier', pkg: 'prettier' })
      ]),
      hasFlowmark =
        spawnSync({
          cmd: ['which', 'flowmark'],
          env,
          stderr: 'pipe',
          stdout: 'pipe'
        }).exitCode === 0,
      checkSteps = createCheckSteps({
        biomeBin,
        dir,
        eslintArgs,
        eslintBin,
        oxlintBin,
        prettierBin,
        sortPkgJson
      })
    if (command === 'fix') {
      runSteps({
        steps: createFixSteps({
          biomeBin,
          dir,
          eslintArgs,
          eslintBin,
          hasFlowmark,
          oxlintBin,
          prettierBin,
          sortPkgJson
        })
      })
      clearFailures()
      runSteps({ steps: checkSteps })
      throwIfFailures()
      return
    }
    runSteps({ steps: checkSteps })
    throwIfFailures()
  }
export { runLint }
