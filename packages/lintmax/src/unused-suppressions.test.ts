import { file as bunFile, write as bunWrite } from 'bun'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OXLINT_CLI_ALLOW } from './constants.js'
import { oxlintUnusedArgs, removeUnusedSuppressions } from './unused-suppressions.js'

const root = await mkdtemp(join(tmpdir(), 'unused-suppressions-test-'))
const cacheConfigDir = join(root, 'node_modules/.cache/lintmax')
const writeFile = async (name: string, content: string): Promise<string> => {
  const path = join(root, name)
  await bunWrite(path, content)
  return path
}
const readFile = async (path: string): Promise<string> => bunFile(path).text()
beforeAll(async () => {
  await mkdir(cacheConfigDir, { recursive: true })
  await bunWrite(
    join(cacheConfigDir, '.oxlintrc.json'),
    JSON.stringify({ categories: { correctness: 'error' }, rules: { 'no-console': 'error', 'no-debugger': 'error' } })
  )
  await bunWrite(
    join(cacheConfigDir, 'biome.json'),
    JSON.stringify({
      $schema: 'https://biomejs.dev/schemas/2.0.0/schema.json',
      linter: { enabled: true, rules: { recommended: true } }
    })
  )
})
afterAll(async () => rm(root, { force: true, recursive: true }))
describe('removeUnusedSuppressions', () => {
  test('judges every file when several are passed, keeping a used directive and removing an unused one', async () => {
    const used = await writeFile('multi-used.ts', '/* oxlint-disable no-debugger */\ndebugger\nexport {}\n')
    const unused = await writeFile('multi-unused.ts', '/* oxlint-disable no-debugger */\nconst x = 1\nexport { x }\n')
    await removeUnusedSuppressions({ filePaths: [used, unused], root })
    expect(await readFile(used)).toContain('oxlint-disable no-debugger')
    expect(await readFile(unused)).not.toContain('oxlint-disable')
  })
  test('refuses when the generated config is absent, naming the stage that did not run', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'unused-suppressions-noconfig-'))
    await mkdir(join(bare, 'node_modules/.cache/lintmax'), { recursive: true })
    const path = join(bare, 'ox-noconfig.ts')
    await bunWrite(path, '/* oxlint-disable no-debugger */\ndebugger\nexport {}\n')
    await expect(removeUnusedSuppressions({ filePaths: [path], root: bare })).rejects.toThrow(
      /generated config is absent/u
    )
    expect(await bunFile(path).text()).toContain('oxlint-disable no-debugger')
    await rm(bare, { force: true, recursive: true })
  })
  test('refuses when the lint cannot answer, rather than reporting every directive unused', async () => {
    const broken = await mkdtemp(join(tmpdir(), 'unused-suppressions-broken-'))
    const brokenCache = join(broken, 'node_modules/.cache/lintmax')
    await mkdir(brokenCache, { recursive: true })
    await bunWrite(join(brokenCache, '.oxlintrc.json'), '{ this is not json')
    const path = join(broken, 'ox-broken.ts')
    await bunWrite(path, '/* oxlint-disable no-debugger */\ndebugger\nexport {}\n')
    await expect(removeUnusedSuppressions({ filePaths: [path], root: broken })).rejects.toThrow(/Refusing/u)
    expect(await bunFile(path).text()).toContain('oxlint-disable no-debugger')
    await rm(broken, { force: true, recursive: true })
  })
  test('removes unused single-rule oxlint-disable', async () => {
    const path = await writeFile('ox-single.ts', '/* oxlint-disable no-debugger */\nconst x = 1\nexport { x }\n')
    const result = await removeUnusedSuppressions({ filePaths: [path], root })
    expect(result.removed).toBeGreaterThan(0)
    expect(result.files).toContain(path)
    expect(await readFile(path)).not.toContain('oxlint-disable')
  })
  test('keeps used rules in partially-unused multi-rule oxlint-disable', async () => {
    const path = await writeFile('ox-multi.ts', '/* oxlint-disable no-debugger, no-console */\ndebugger\nexport {}\n')
    await removeUnusedSuppressions({ filePaths: [path], root })
    const after = await readFile(path)
    expect(after).toContain('oxlint-disable')
    expect(after).toContain('no-debugger')
    expect(after).not.toContain('no-console')
  })
  test('keeps a used oxlint-disable', async () => {
    const path = await writeFile('ox-used.ts', '/* oxlint-disable no-debugger */\ndebugger\nexport {}\n')
    const result = await removeUnusedSuppressions({ filePaths: [path], root })
    expect(await readFile(path)).toContain('oxlint-disable no-debugger')
    expect(result.diagnostics.filter(d => d.file === path)).toHaveLength(0)
  })
  test('removes unused biome-ignore-all', async () => {
    const path = await writeFile(
      'biome-unused.ts',
      '/** biome-ignore-all lint/suspicious/noDoubleEquals: x */\nconst b = 1\nexport { b }\n'
    )
    const result = await removeUnusedSuppressions({ filePaths: [path], root })
    expect(result.removed).toBeGreaterThan(0)
    expect(await readFile(path)).not.toContain('biome-ignore-all')
  })
  test('keeps a used biome-ignore-all', async () => {
    const path = await writeFile(
      'biome-used.ts',
      '/** biome-ignore-all lint/suspicious/noDoubleEquals: x */\nconst a = 1 == 1\nexport { a }\n'
    )
    await removeUnusedSuppressions({ filePaths: [path], root })
    expect(await readFile(path)).toContain('biome-ignore-all lint/suspicious/noDoubleEquals')
  })
  test('removes unused // biome-ignore-all line-comment form', async () => {
    const path = await writeFile(
      'biome-line-unused.ts',
      '// biome-ignore-all lint/suspicious/noDoubleEquals: x\nconst c = 1\nexport { c }\n'
    )
    const result = await removeUnusedSuppressions({ filePaths: [path], root })
    expect(result.removed).toBeGreaterThan(0)
    expect(await readFile(path)).not.toContain('biome-ignore-all')
  })
})
describe('oxlintUnusedArgs', () => {
  test('carries every CLI-allowed rule, so the stage judges the rule set the gate enforces', () => {
    const args = oxlintUnusedArgs({ configPath: join(root, '.oxlintrc.json'), files: ['a.ts'], oxlintBin: 'oxlint' })
    expect(OXLINT_CLI_ALLOW.length).toBeGreaterThan(0)
    for (const rule of OXLINT_CLI_ALLOW) {
      const at = args.indexOf(rule)
      expect(at).toBeGreaterThan(-1)
      expect(args[at - 1]).toBe('--allow')
    }
  })
  test('puts the files last so a rule name is never read as a path', () => {
    const args = oxlintUnusedArgs({
      configPath: join(root, '.oxlintrc.json'),
      files: ['a.ts', 'b.ts'],
      oxlintBin: 'oxlint'
    })
    expect(args.slice(-2)).toEqual(['a.ts', 'b.ts'])
  })
})
