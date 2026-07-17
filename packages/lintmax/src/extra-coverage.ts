import { $ } from 'bun'
import type { Diagnostic } from './aggregate.js'
import { runCapture } from './core.js'

interface ExtraTargets {
  dockerfiles: string[]
  shell: string[]
  toml: string[]
}
const DOCKERFILE_RE = /(?:^|\/)Dockerfile(?:\.[\w.-]+)?$/u
const SHELLCHECK_LINE_RE = /^(?<file>.+?):(?<line>\d+):\d+:\s+(?:warning|error|note|style):\s+.*\[(?<rule>\S+)\]/u
const isShell = (filePath: string): boolean => filePath.endsWith('.sh') || filePath.endsWith('.bash')
const isToml = (filePath: string): boolean => filePath.endsWith('.toml')
const isDockerfile = (filePath: string): boolean => DOCKERFILE_RE.test(filePath)
const collectExtraTargets = (gitFiles: readonly string[]): ExtraTargets => ({
  dockerfiles: gitFiles.filter(isDockerfile),
  shell: gitFiles.filter(isShell),
  toml: gitFiles.filter(isToml)
})
const resolveDprintPluginPath = (): null | string => {
  try {
    return import.meta.resolve('@dprint/dockerfile/plugin.wasm').replace('file://', '')
  } catch {
    return null
  }
}
const whichTool = async (env: Record<string, string | undefined>, tool: string): Promise<null | string> => {
  const result = await $`which ${tool}`.env(env).quiet().nothrow()
  if (result.exitCode !== 0) return null
  const path = result.stdout.toString().trim()
  return path.length > 0 ? path : null
}
interface StepResult {
  diagnostics: Diagnostic[]
  notes: string[]
}
const failureDiagnostic = (linter: string, files: readonly string[]): Diagnostic => ({
  file: files[0] ?? '',
  line: 0,
  linter,
  rule: linter
})
interface ExtraBins {
  dprint: string
  tombi: string
}
const runShell = async ({
  command,
  env,
  files
}: {
  command: 'check' | 'fix'
  env: Record<string, string | undefined>
  files: readonly string[]
}): Promise<StepResult> => {
  if (files.length === 0) return { diagnostics: [], notes: [] }
  const shellcheck = await whichTool(env, 'shellcheck')
  const shfmt = await whichTool(env, 'shfmt')
  const notes: string[] = []
  if (shellcheck === null || shfmt === null)
    notes.push('shellcheck/shfmt not on PATH — shell files unchecked (install: brew install shellcheck shfmt)')
  const diagnostics: Diagnostic[] = []
  if (shfmt !== null) {
    if (command === 'fix') await runCapture({ args: ['-w', ...files], command: shfmt, env, label: 'shfmt' })
    const fmtCheck = await runCapture({ args: ['-d', ...files], command: shfmt, env, label: 'shfmt' })
    if (fmtCheck.exitCode !== 0 || fmtCheck.stdout.trim().length > 0) diagnostics.push(failureDiagnostic('shfmt', files))
  }
  if (shellcheck !== null) {
    const result = await runCapture({ args: ['-f', 'gcc', ...files], command: shellcheck, env, label: 'shellcheck' })
    let parsed = false
    for (const line of result.stdout.split('\n')) {
      const groups = SHELLCHECK_LINE_RE.exec(line)?.groups
      if (groups?.file && groups.line && groups.rule) {
        diagnostics.push({ file: groups.file, line: Number(groups.line), linter: 'shellcheck', rule: groups.rule })
        parsed = true
      }
    }
    if (result.exitCode !== 0 && !parsed) diagnostics.push(failureDiagnostic('shellcheck', files))
  }
  return { diagnostics, notes }
}
const runTombi = async ({
  bin,
  command,
  env,
  files
}: {
  bin: string
  command: 'check' | 'fix'
  env: Record<string, string | undefined>
  files: readonly string[]
}): Promise<Diagnostic[]> => {
  if (files.length === 0) return []
  if (command === 'fix') await runCapture({ args: [bin, 'format', ...files], command: 'bun', env, label: 'tombi' })
  const lint = await runCapture({ args: [bin, 'lint', ...files], command: 'bun', env, label: 'tombi' })
  const fmtCheck = await runCapture({ args: [bin, 'format', '--check', ...files], command: 'bun', env, label: 'tombi' })
  if (lint.exitCode === 0 && fmtCheck.exitCode === 0) return []
  return [failureDiagnostic('tombi', files)]
}
const runDprintDockerfile = async ({
  bin,
  command,
  env,
  files,
  pluginPath
}: {
  bin: string
  command: 'check' | 'fix'
  env: Record<string, string | undefined>
  files: readonly string[]
  pluginPath: null | string
}): Promise<Diagnostic[]> => {
  if (files.length === 0 || pluginPath === null) return []
  const configArgs = ['--plugins', pluginPath, '--config', '/dev/null']
  if (command === 'fix') await runCapture({ args: ['fmt', ...configArgs, ...files], command: bin, env, label: 'dprint' })
  const check = await runCapture({ args: ['check', ...configArgs, ...files], command: bin, env, label: 'dprint' })
  if (check.exitCode === 0) return []
  return [failureDiagnostic('dprint', files)]
}
const runExtraCoverage = async ({
  bins,
  command,
  env,
  gitFiles
}: {
  bins: ExtraBins
  command: 'check' | 'fix'
  env: Record<string, string | undefined>
  gitFiles: readonly string[]
}): Promise<StepResult> => {
  const targets = collectExtraTargets(gitFiles)
  const pluginPath = resolveDprintPluginPath()
  const [shell, tombi, dprint] = await Promise.all([
    runShell({ command, env, files: targets.shell }),
    runTombi({ bin: bins.tombi, command, env, files: targets.toml }),
    runDprintDockerfile({ bin: bins.dprint, command, env, files: targets.dockerfiles, pluginPath })
  ])
  const diagnostics: Diagnostic[] = [...tombi, ...dprint, ...shell.diagnostics]
  return { diagnostics, notes: shell.notes }
}
export type { ExtraBins }
export { collectExtraTargets, runExtraCoverage }
