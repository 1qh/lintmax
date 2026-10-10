import { write } from 'bun'
import { describe, expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { Diagnostic } from './aggregate.js'
import type { FailureRecord } from './core.js'
import { parseBiomeDiagnostics, parseEslintDiagnostics, parseOxlintDiagnostics } from './aggregate.js'
import { bunEnv, readRequiredJson, resolveBin, runCapture } from './core.js'
import { joinPath } from './path.js'
import { captureAndParse, formatFailureDetails } from './pipeline.js'
import { requireLintAnswer } from './unused-suppressions.js'
const emitOutput = `
const input = await Bun.file(process.argv[2]).json()
const outputIndex = process.argv.indexOf('--output-file')
if (process.argv.some(arg => arg.startsWith('--reporter-file='))) throw new Error('Unsupported reporter file flag')
const outputPath = outputIndex < 0 ? undefined : process.argv[outputIndex + 1]
if (input.nativeOutput && !outputPath) throw new Error('Missing native output flag')
await Bun.write(outputPath ?? Bun.stdout, input.stdout)
await Bun.write(Bun.stderr, input.stderr)
process.exit(input.exitCode)
`
interface OutputInput {
  exitCode?: number
  label: string
  stderr?: string
  stdout: string
}
const withOutput = async <T>(input: OutputInput, action: (args: string[]) => Promise<T>): Promise<T> => {
  const directory = await mkdtemp(joinPath(tmpdir(), 'lintmax-capture-test-'))
  try {
    const inputPath = joinPath(directory, 'input.json')
    const scriptPath = joinPath(directory, 'emit.ts')
    await write(scriptPath, emitOutput)
    await write(
      inputPath,
      JSON.stringify({
        exitCode: 1,
        nativeOutput: input.label === 'eslint',
        stderr: '',
        ...input
      })
    )
    const result = await action([scriptPath, inputPath])
    return result
  } finally {
    await rm(directory, { recursive: true })
  }
}
const captureOutput = async (input: OutputInput): Promise<{ diagnostics: Diagnostic[]; failures: FailureRecord[] }> => {
  const result = await withOutput(input, async args => {
    const failures: FailureRecord[] = []
    const parser = input.label === 'biome' ? parseBiomeDiagnostics : parseEslintDiagnostics
    const diagnostics = await captureAndParse({
      env: bunEnv,
      failures,
      label: input.label,
      opts: { args, command: process.execPath },
      parser: input.label === 'oxlint' ? parseOxlintDiagnostics : parser
    })
    return { diagnostics, failures }
  })
  return result
}
describe('file-backed linter output', () => {
  test('refuses malformed and empty failed suppression scans while accepting clean JSON', () => {
    for (const label of ['biome-unused', 'oxlint-unused']) {
      const malformed = () => requireLintAnswer({ exitCode: 1, label, stderr: 'tool failed', stdout: '{' })
      const emptyFailure = () => requireLintAnswer({ exitCode: 1, label, stderr: '', stdout: '{"diagnostics":[]}' })
      const clean = requireLintAnswer({ exitCode: 0, label, stderr: '', stdout: '{"diagnostics":[]}' })
      expect(malformed).toThrow('produced no parseable JSON')
      expect(emptyFailure).toThrow('failed with zero diagnostics')
      expect(clean).toBe('{"diagnostics":[]}')
    }
  })
  test('captures installed Biome JSON for check and unused suppression scans', async () => {
    const directory = await mkdtemp(joinPath(tmpdir(), 'lintmax-biome-test-'))
    try {
      const configPath = joinPath(directory, 'biome.json')
      const sourcePath = joinPath(directory, 'debug.ts')
      await write(configPath, JSON.stringify({ linter: { rules: { recommended: true } }, root: true }))
      await write(sourcePath, 'debugger\n')
      const biomeBin = await resolveBin({ bin: 'biome', pkg: '@biomejs/biome' })
      for (const label of ['biome', 'biome-unused']) {
        const operation = label === 'biome' ? 'check' : 'lint'
        const result = await runCapture({
          args: [biomeBin, operation, '--reporter=json', '--config-path', configPath, sourcePath],
          command: process.execPath,
          env: bunEnv,
          label
        })
        const parsed = readRequiredJson<{ diagnostics: { category: string }[] }>(result.stdout)
        expect(result.exitCode).toBe(1)
        expect(parsed.diagnostics.some(d => d.category === 'lint/suspicious/noDebugger')).toBe(true)
        expect(parseBiomeDiagnostics(result).some(d => d.rule === 'lint/suspicious/noDebugger')).toBe(true)
      }
    } finally {
      await rm(directory, { recursive: true })
    }
  }, 15_000)
  test('parses every diagnostic from eslint JSON larger than 2 MB using its output file', async () => {
    const count = 12_000
    const stdout = JSON.stringify([
      {
        filePath: 'src/large.ts',
        messages: Array.from({ length: count }, (_, i) => ({
          line: i + 1,
          message: 'é'.repeat(128),
          ruleId: 'no-console',
          severity: 2
        }))
      }
    ])
    expect(Buffer.byteLength(stdout)).toBeGreaterThan(2 * 1024 * 1024)
    const result = await captureOutput({ label: 'eslint', stdout })
    expect(result.diagnostics).toHaveLength(count)
    expect(result.diagnostics.at(-1)).toEqual({ file: 'src/large.ts', line: count, linter: 'eslint', rule: 'no-console' })
    expect(result.failures).toEqual([])
  })
  test('reports truncated JSON with its parse error, byte count and stderr', async () => {
    const stdout = '[{"filePath":"é.ts","messages":[{"message":"unfinished'
    const result = await captureOutput({ label: 'eslint', stderr: 'tool failed', stdout })
    expect(result.diagnostics).toEqual([])
    expect(result.failures).toHaveLength(1)
    const report = formatFailureDetails(result.failures)
    expect(report).toContain('- eslint (exit 1)')
    expect(report).toContain(`Output parse error (${Buffer.byteLength(stdout)} bytes):`)
    expect(report).toContain('JSON')
    expect(report).toContain('tool failed')
  })
  test('reports exit 1 with valid JSON containing zero diagnostics', async () => {
    const result = await captureOutput({ label: 'eslint', stdout: '[]' })
    expect(result.diagnostics).toEqual([])
    expect(result.failures).toEqual([{ code: 1, label: 'eslint', message: 'Output parsed to zero diagnostics (2 bytes)' }])
    expect(formatFailureDetails(result.failures)).toContain('Output parsed to zero diagnostics')
  })
  test('reports malformed and empty failed output for every JSON reporter', async () => {
    for (const label of ['biome', 'oxlint']) {
      for (const stdout of ['{"diagnostics":[', '']) {
        const result = await captureOutput({ label, stdout })
        expect(result.diagnostics).toEqual([])
        expect(formatFailureDetails(result.failures)).toContain(`Output parse error (${Buffer.byteLength(stdout)} bytes)`)
      }
      const result = await captureOutput({ label, stdout: '{"diagnostics":[]}' })
      expect(formatFailureDetails(result.failures)).toContain('Output parsed to zero diagnostics')
    }
  })
  test('streams complete stdout and stderr to files for other captured steps', async () => {
    const stdout = 'é'.repeat(1_100_000)
    const stderr = 'failure\n'.repeat(300_000)
    for (const label of [
      'oxlint',
      'oxlint-unused',
      'biome',
      'biome-unused',
      'sort-package-json',
      'tombi',
      'dprint',
      'prettier',
      'shellcheck',
      'shfmt'
    ]) {
      const result = await withOutput({ label, stderr, stdout }, async args => {
        const captured = await runCapture({ args, command: process.execPath, env: bunEnv, label })
        return captured
      })
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe(stdout)
      expect(result.stderr).toBe(stderr)
    }
  })
  test('keeps a successful exit free of failures', async () => {
    const result = await captureOutput({ exitCode: 0, label: 'eslint', stdout: '[]' })
    expect(result).toEqual({ diagnostics: [], failures: [] })
  })
  test('reports exceptions raised by a text parser', async () => {
    const failures: FailureRecord[] = []
    await withOutput({ label: 'prettier', stdout: 'bad output' }, async args => {
      const diagnostics = await captureAndParse({
        env: bunEnv,
        failures,
        label: 'prettier',
        opts: { args, command: process.execPath },
        parser: () => {
          throw new Error('Invalid text report')
        }
      })
      expect(diagnostics).toEqual([])
    })
    expect(formatFailureDetails(failures)).toContain('Output parse error (10 bytes): Invalid text report')
  })
})
