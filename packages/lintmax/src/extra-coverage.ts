import { $ } from 'bun'
import type { Diagnostic } from './aggregate.js'
import { runCapture } from './core.js'
interface ExtraTargets {
  dockerfiles: string[]
  shell: string[]
  toml: string[]
}
const DOCKERFILE_RE = /(?:^|\/)Dockerfile(?:\.[\w\-.]+)?$/v
const SHELLCHECK_LINE_RE =
  /^(?<file>.+?):(?<line>\d+):\d+:\s+(?:error|note|style|warning):\s+(?:\S.*)?\[(?<rule>[^\]\[]+)\]$/v
const isShell = (filePath: string): boolean => filePath.endsWith('.sh') || filePath.endsWith('.bash')
const isToml = (filePath: string): boolean => filePath.endsWith('.toml')
const isDockerfile = (filePath: string): boolean => DOCKERFILE_RE.test(filePath)
const collectExtraTargets = (gitFiles: readonly string[]): ExtraTargets => ({
  dockerfiles: gitFiles.filter(isDockerfile),
  shell: gitFiles.filter(isShell),
  toml: gitFiles.filter(isToml)
})
const resolveDprintPluginPath = (): string | undefined => {
  try {
    return import.meta.resolve('@dprint/dockerfile/plugin.wasm').replace('file://', '')
  } catch {
    return undefined
  }
}
const whichTool = async (env: Record<string, string | undefined>, tool: string): Promise<string | undefined> => {
  const result = await $`which ${tool}`.env(env).quiet().nothrow()
  if (result.exitCode !== 0) return
  const path = result.stdout.toString().trim()
  return path.length > 0 ? path : undefined
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
interface ShellcheckStepInput {
  bin: string
  env: Record<string, string | undefined>
  files: readonly string[]
}
interface ShfmtStepInput {
  bin: string
  command: 'check' | 'fix'
  env: Record<string, string | undefined>
  files: readonly string[]
}
const parseShellcheckLine = (line: string): Diagnostic | undefined => {
  const groups = SHELLCHECK_LINE_RE.exec(line)?.groups
  if (groups?.file && groups.line && groups.rule)
    return { file: groups.file, line: Number(groups.line), linter: 'shellcheck', rule: groups.rule }
}
const SHFMT_FLAGS = ['-s', '-ci', '-bn', '-sr', '-i', '2']
const SHELLCHECK_FLAGS = ['--enable=all', '--severity=style', '--external-sources', '--exclude=SC2312']
const runShfmtStep = async ({ bin, command, env, files }: ShfmtStepInput): Promise<Diagnostic[]> => {
  if (command === 'fix') await runCapture({ args: [...SHFMT_FLAGS, '-w', ...files], command: bin, env, label: 'shfmt' })
  const fmtCheck = await runCapture({ args: [...SHFMT_FLAGS, '-d', ...files], command: bin, env, label: 'shfmt' })
  if (fmtCheck.exitCode !== 0 || fmtCheck.stdout.trim().length > 0) return [failureDiagnostic('shfmt', files)]
  return []
}
const runShellcheckStep = async ({ bin, env, files }: ShellcheckStepInput): Promise<Diagnostic[]> => {
  const result = await runCapture({
    args: [...SHELLCHECK_FLAGS, '-f', 'gcc', ...files],
    command: bin,
    env,
    label: 'shellcheck'
  })
  const diagnostics: Diagnostic[] = []
  for (const line of result.stdout.split('\n')) {
    const diagnostic = parseShellcheckLine(line)
    if (diagnostic !== undefined) diagnostics.push(diagnostic)
  }
  if (result.exitCode !== 0 && diagnostics.length === 0) diagnostics.push(failureDiagnostic('shellcheck', files))
  return diagnostics
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
  if (shellcheck === undefined || shfmt === undefined)
    notes.push('shellcheck/shfmt not on PATH — shell files unchecked (install: brew install shellcheck shfmt)')
  const diagnostics: Diagnostic[] = []
  if (shfmt !== undefined) diagnostics.push(...(await runShfmtStep({ bin: shfmt, command, env, files })))
  if (shellcheck !== undefined) diagnostics.push(...(await runShellcheckStep({ bin: shellcheck, env, files })))
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
  pluginPath: string | undefined
}): Promise<Diagnostic[]> => {
  if (files.length === 0 || pluginPath === undefined) return []
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
