import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeUnusedSuppressions } from './unused-suppressions.js'
// oxlint-disable-next-line node/no-sync
const root = mkdtempSync(join(tmpdir(), 'unused-suppressions-test-'))
const cacheConfigDir = join(root, 'node_modules/.cache/lintmax')
const writeFile = (name: string, content: string): string => {
  const path = join(root, name)
  // oxlint-disable-next-line node/no-sync
  writeFileSync(path, content)
  return path
}
// oxlint-disable-next-line node/no-sync
const readFile = (path: string): string => readFileSync(path, 'utf8')
beforeAll(() => {
  // oxlint-disable-next-line node/no-sync
  mkdirSync(cacheConfigDir, { recursive: true })
  // oxlint-disable-next-line node/no-sync
  writeFileSync(
    join(cacheConfigDir, '.oxlintrc.json'),
    JSON.stringify({ categories: { correctness: 'error' }, rules: { 'no-console': 'error', 'no-debugger': 'error' } })
  )
  // oxlint-disable-next-line node/no-sync
  writeFileSync(
    join(cacheConfigDir, 'biome.json'),
    JSON.stringify({
      $schema: 'https://biomejs.dev/schemas/2.0.0/schema.json',
      linter: { enabled: true, rules: { recommended: true } }
    })
  )
})
afterAll(() => {
  // oxlint-disable-next-line node/no-sync
  rmSync(root, { force: true, recursive: true })
})
describe('removeUnusedSuppressions', () => {
  test('removes unused single-rule oxlint-disable', async () => {
    const path = writeFile('ox-single.ts', '/* oxlint-disable no-debugger */\nconst x = 1\nexport { x }\n')
    const result = await removeUnusedSuppressions({ filePaths: [path], root })
    expect(result.removed).toBeGreaterThan(0)
    expect(result.files).toContain(path)
    expect(readFile(path)).not.toContain('oxlint-disable')
  })
  test('keeps used rules in partially-unused multi-rule oxlint-disable', async () => {
    const path = writeFile('ox-multi.ts', '/* oxlint-disable no-debugger, no-console */\ndebugger\nexport {}\n')
    await removeUnusedSuppressions({ filePaths: [path], root })
    const after = readFile(path)
    expect(after).toContain('oxlint-disable')
    expect(after).toContain('no-debugger')
    expect(after).not.toContain('no-console')
  })
  test('keeps a used oxlint-disable', async () => {
    const path = writeFile('ox-used.ts', '/* oxlint-disable no-debugger */\ndebugger\nexport {}\n')
    const result = await removeUnusedSuppressions({ filePaths: [path], root })
    expect(readFile(path)).toContain('oxlint-disable no-debugger')
    expect(result.diagnostics.filter(d => d.file === path)).toHaveLength(0)
  })
  test('removes unused biome-ignore-all', async () => {
    const path = writeFile(
      'biome-unused.ts',
      '/** biome-ignore-all lint/suspicious/noDoubleEquals: x */\nconst b = 1\nexport { b }\n'
    )
    const result = await removeUnusedSuppressions({ filePaths: [path], root })
    expect(result.removed).toBeGreaterThan(0)
    expect(readFile(path)).not.toContain('biome-ignore-all')
  })
  test('keeps a used biome-ignore-all', async () => {
    const path = writeFile(
      'biome-used.ts',
      '/** biome-ignore-all lint/suspicious/noDoubleEquals: x */\nconst a = 1 == 1\nexport { a }\n'
    )
    await removeUnusedSuppressions({ filePaths: [path], root })
    expect(readFile(path)).toContain('biome-ignore-all lint/suspicious/noDoubleEquals')
  })
  test('removes unused // biome-ignore-all line-comment form', async () => {
    const path = writeFile(
      'biome-line-unused.ts',
      '// biome-ignore-all lint/suspicious/noDoubleEquals: x\nconst c = 1\nexport { c }\n'
    )
    const result = await removeUnusedSuppressions({ filePaths: [path], root })
    expect(result.removed).toBeGreaterThan(0)
    expect(readFile(path)).not.toContain('biome-ignore-all')
  })
})
