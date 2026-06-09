import { spawnSync } from 'bun'
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
const whichTool = (env: Record<string, string | undefined>, tool: string): null | string => {
  const result = spawnSync({ cmd: ['which', tool], env, stderr: 'pipe', stdout: 'pipe' })
  if (result.exitCode !== 0) return null
  const path = new TextDecoder().decode(result.stdout).trim()
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
  taplo: string
}
const runShell = ({
  command,
  env,
  files
}: {
  command: 'check' | 'fix'
  env: Record<string, string | undefined>
  files: readonly string[]
}): StepResult => {
  if (files.length === 0) return { diagnostics: [], notes: [] }
  const shellcheck = whichTool(env, 'shellcheck')
  const shfmt = whichTool(env, 'shfmt')
  const notes: string[] = []
  if (shellcheck === null || shfmt === null)
    notes.push('shellcheck/shfmt not on PATH — shell files unchecked (install: brew install shellcheck shfmt)')
  const diagnostics: Diagnostic[] = []
  if (shfmt !== null) {
    if (command === 'fix') runCapture({ args: ['-w', ...files], command: shfmt, env, label: 'shfmt' })
    const fmtCheck = runCapture({ args: ['-d', ...files], command: shfmt, env, label: 'shfmt' })
    if (fmtCheck.exitCode !== 0 || fmtCheck.stdout.trim().length > 0) diagnostics.push(failureDiagnostic('shfmt', files))
  }
  if (shellcheck !== null) {
    const result = runCapture({ args: ['-f', 'gcc', ...files], command: shellcheck, env, label: 'shellcheck' })
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
const runTaplo = ({
  bin,
  command,
  env,
  files
}: {
  bin: string
  command: 'check' | 'fix'
  env: Record<string, string | undefined>
  files: readonly string[]
}): Diagnostic[] => {
  if (files.length === 0) return []
  if (command === 'fix') runCapture({ args: [bin, 'fmt', ...files], command: 'bun', env, label: 'taplo' })
  const lint = runCapture({ args: [bin, 'lint', ...files], command: 'bun', env, label: 'taplo' })
  const fmtCheck = runCapture({ args: [bin, 'fmt', '--check', ...files], command: 'bun', env, label: 'taplo' })
  if (lint.exitCode === 0 && fmtCheck.exitCode === 0) return []
  return [failureDiagnostic('taplo', files)]
}
const runDprintDockerfile = ({
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
}): Diagnostic[] => {
  if (files.length === 0 || pluginPath === null) return []
  const configArgs = ['--plugins', pluginPath, '--config', '/dev/null']
  if (command === 'fix') runCapture({ args: ['fmt', ...configArgs, ...files], command: bin, env, label: 'dprint' })
  const check = runCapture({ args: ['check', ...configArgs, ...files], command: bin, env, label: 'dprint' })
  if (check.exitCode === 0) return []
  return [failureDiagnostic('dprint', files)]
}
const runExtraCoverage = ({
  bins,
  command,
  env,
  gitFiles
}: {
  bins: ExtraBins
  command: 'check' | 'fix'
  env: Record<string, string | undefined>
  gitFiles: readonly string[]
}): StepResult => {
  const targets = collectExtraTargets(gitFiles)
  const pluginPath = resolveDprintPluginPath()
  const shell = runShell({ command, env, files: targets.shell })
  const diagnostics: Diagnostic[] = [
    ...runTaplo({ bin: bins.taplo, command, env, files: targets.toml }),
    ...runDprintDockerfile({ bin: bins.dprint, command, env, files: targets.dockerfiles, pluginPath }),
    ...shell.diagnostics
  ]
  return { diagnostics, notes: shell.notes }
}
export type { ExtraBins }
export { collectExtraTargets, runExtraCoverage }
