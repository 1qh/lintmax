import { describe, expect, test } from 'bun:test'
import type { Diagnostic } from './aggregate.js'
import { parseOxlintDiagnostics } from './aggregate.js'

describe('parseOxlintDiagnostics', () => {
  test('parses normal diagnostic with filename and line', () => {
    const stdout = JSON.stringify({
      diagnostics: [
        {
          code: 'no-console',
          filename: 'src/app.ts',
          labels: [{ span: { line: 5 } }],
          message: 'Unexpected console statement',
          severity: 'error'
        }
      ]
    })
    const result: Diagnostic[] = parseOxlintDiagnostics({ stdout })
    expect(result).toHaveLength(1)
    expect(result[0]?.file).toBe('src/app.ts')
    expect(result[0]?.line).toBe(5)
    expect(result[0]?.rule).toBe('no-console')
    expect(result[0]?.linter).toBe('oxlint')
  })
  test('parses file-level diagnostic with empty filename', () => {
    const stdout = JSON.stringify({
      diagnostics: [
        {
          code: 'eslint-plugin-vitest(consistent-test-filename)',
          filename: '',
          labels: [],
          message: 'The app.spec.ts is a test file but his name is not allowed',
          severity: 'error'
        }
      ]
    })
    const result: Diagnostic[] = parseOxlintDiagnostics({ stdout })
    expect(result).toHaveLength(1)
    expect(result[0]?.rule).toBe('eslint-plugin-vitest(consistent-test-filename)')
    expect(result[0]?.line).toBe(0)
  })
  test('parses diagnostic with missing filename field', () => {
    const stdout = JSON.stringify({
      diagnostics: [
        {
          code: 'some-rule',
          labels: [],
          message: 'some error',
          severity: 'error'
        }
      ]
    })
    const result: Diagnostic[] = parseOxlintDiagnostics({ stdout })
    expect(result).toHaveLength(1)
    expect(result[0]?.rule).toBe('some-rule')
  })
  test('skips diagnostic with no code', () => {
    const stdout = JSON.stringify({
      diagnostics: [
        {
          filename: 'src/app.ts',
          labels: [],
          message: 'some error',
          severity: 'error'
        }
      ]
    })
    const result: Diagnostic[] = parseOxlintDiagnostics({ stdout })
    expect(result).toHaveLength(0)
  })
  test('returns empty for invalid JSON', () => {
    const result: Diagnostic[] = parseOxlintDiagnostics({ stdout: 'not json' })
    expect(result).toHaveLength(0)
  })
  test('returns empty for missing diagnostics array', () => {
    const result: Diagnostic[] = parseOxlintDiagnostics({ stdout: '{}' })
    expect(result).toHaveLength(0)
  })
})
