import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanFileIgnores } from './clean-ignores.js'
const tmp = mkdtempSync(join(tmpdir(), 'clean-ignores-test-'))
afterAll(() => rmSync(tmp, { recursive: true }))
const active = new Set([
  '@typescript-eslint/no-unsafe-call',
  'complexity',
  'lint/style/noProcessEnv',
  'no-console',
  'promise/prefer-await-to-then',
  'react-perf/jsx-no-new-object-as-prop'
])
const writeAndClean = async (name: string, content: string) => {
  const path = join(tmp, name)
  writeFileSync(path, content)
  const removed = await cleanFileIgnores(path, active)
  return { content: readFileSync(path, 'utf8'), removed }
}
describe('cleanFileIgnores', () => {
  test('keeps eslint-disable for active rule', async () => {
    const { content, removed } = await writeAndClean('keep-eslint.ts', '/* eslint-disable no-console */\nconst x = 1\n')
    expect(removed).toBe(0)
    expect(content).toContain('eslint-disable no-console')
  })
  test('removes eslint-disable for inactive rule', async () => {
    const { content, removed } = await writeAndClean(
      'remove-eslint.ts',
      '/* eslint-disable some-fake-rule */\nconst x = 1\n'
    )
    expect(removed).toBe(1)
    expect(content).not.toContain('some-fake-rule')
  })
  test('trims inactive rule from multi-rule eslint-disable', async () => {
    const { content, removed } = await writeAndClean(
      'trim-eslint.ts',
      '/* eslint-disable no-console, some-fake-rule */\nconst x = 1\n'
    )
    expect(removed).toBe(1)
    expect(content).toContain('no-console')
    expect(content).not.toContain('some-fake-rule')
  })
  test('removes entire line when all rules inactive', async () => {
    const { content, removed } = await writeAndClean('remove-all.ts', '/* eslint-disable fake-a, fake-b */\nconst x = 1\n')
    expect(removed).toBe(2)
    expect(content).toBe('const x = 1\n')
  })
  test('keeps oxlint-disable for active rule', async () => {
    const { content, removed } = await writeAndClean(
      'keep-oxlint.ts',
      '/* oxlint-disable react-perf/jsx-no-new-object-as-prop */\nconst x = 1\n'
    )
    expect(removed).toBe(0)
    expect(content).toContain('react-perf/jsx-no-new-object-as-prop')
  })
  test('removes biome-ignore for inactive rule', async () => {
    const { content, removed } = await writeAndClean(
      'remove-biome.ts',
      '/** biome-ignore-all lint/fake/rule: reason */\nconst x = 1\n'
    )
    expect(removed).toBe(1)
    expect(content).toBe('const x = 1\n')
  })
  test('keeps biome-ignore for active rule', async () => {
    const { content, removed } = await writeAndClean(
      'keep-biome.ts',
      '/** biome-ignore-all lint/style/noProcessEnv: reason */\nconst x = 1\n'
    )
    expect(removed).toBe(0)
    expect(content).toContain('lint/style/noProcessEnv')
  })
  test('handles eslint-disable-next-line', async () => {
    const { content, removed } = await writeAndClean(
      'next-line.ts',
      '// eslint-disable-next-line fake-rule\nconst x = 1\n'
    )
    expect(removed).toBe(1)
    expect(content).toBe('const x = 1\n')
  })
  test('no changes returns 0', async () => {
    const { removed } = await writeAndClean('clean.ts', 'const x = 1\nconst y = 2\n')
    expect(removed).toBe(0)
  })
})
