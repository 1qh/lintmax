import type { ESLint } from 'eslint'
import { file, write } from 'bun'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { readRequiredJson } from './core.js'
const writeSuppressionConfig = async (root: string): Promise<string> => {
  const configDir = join(root, 'node_modules/.cache/lintmax')
  await write(join(configDir, '.oxlintrc.json'), JSON.stringify({ rules: { 'no-debugger': 'error', 'no-undef': 'off' } }))
  await write(
    join(configDir, 'eslint.generated.mjs'),
    `export default [
    { files: ['**/*.js'], languageOptions: { sourceType: 'script' }, rules: { 'no-undef': 'error' } },
    { files: ['**/*.ts'], rules: { 'no-undef': 'off' } },
    { linterOptions: { reportUnusedDisableDirectives: 'error' } }
  ]\n`
  )
  return configDir
}
const setupSuppressionFixture = async (root: string) => {
  const configDir = await writeSuppressionConfig(root)
  const used = join(root, 'browser.js')
  const bare = join(root, 'unsuppressed.js')
  const unused = join(root, 'unused.js')
  const original = '// eslint-disable-next-line no-undef\ndocument.title = "fixture"\n'
  await write(used, original)
  await write(bare, 'document.title = "fixture"\n')
  await write(unused, '// eslint-disable-next-line no-undef\nMath.abs(1)\n')
  return { bare, configDir, original, unused, used }
}
const buildSuppressionWorker = ({
  bare,
  configDir,
  unused,
  used
}: {
  bare: string
  configDir: string
  unused: string
  used: string
}) => {
  const worker = `
    import { ESLint } from ${JSON.stringify(import.meta.resolve('eslint'))};
    import { cleanIgnores } from ${JSON.stringify(join(import.meta.dir, 'clean-ignores.ts'))};
    const paths = ${JSON.stringify([used, bare, unused])};
    const options = { cwd: process.cwd(), overrideConfigFile: ${JSON.stringify(join(configDir, 'eslint.generated.mjs'))} };
    const check = new ESLint(options);
    const before = await check.lintFiles(paths);
    await cleanIgnores(paths);
    const cleanup = await Bun.file(paths[0]).text();
    const fix = new ESLint({ ...options, fix: true });
    await ESLint.outputFixes(await fix.lintFiles(paths));
    const after = await check.lintFiles(paths);
    process.stdout.write(JSON.stringify({ before, cleanup, after }));
  `
  return worker
}
const runWorker = async (root: string, worker: string) => {
  const child = Bun.spawn(['bun', '-e', worker], {
    cwd: root,
    stderr: 'pipe',
    stdout: 'pipe'
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ])
  return { exitCode, stderr, stdout }
}
interface SuppressionFixtureResult {
  exitCode: number
  original: string
  result: SuppressionResult
  stderr: string
  unused: string
  used: string
}
interface SuppressionResult {
  after: ESLint.LintResult[]
  before: ESLint.LintResult[]
  cleanup: string
}
const runSuppressionFixture = async (root: string): Promise<SuppressionFixtureResult> => {
  const { bare, configDir, original, unused, used } = await setupSuppressionFixture(root)
  const { exitCode, stderr, stdout } = await runWorker(root, buildSuppressionWorker({ bare, configDir, unused, used }))
  const result = readRequiredJson<SuppressionResult>(stdout)
  return { exitCode, original, result, stderr, unused, used }
}
describe('plain JS no-undef suppressions', () => {
  let fixture: SuppressionFixtureResult
  let root: string | undefined
  beforeEach(async () => {
    root = await mkdtemp(join(import.meta.dir, '.no-undef-fixture-'))
    fixture = await runSuppressionFixture(root)
  })
  afterEach(async () => {
    if (root !== undefined) await rm(root, { force: true, recursive: true })
    root = undefined
  })
  test('clean preserves a plain JS no-undef suppression and identifies unused directives', () => {
    const { exitCode, original, result, stderr } = fixture
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(result.before[0]?.errorCount).toBe(0)
    expect(result.before[1]?.messages.some(message => message.ruleId === 'no-undef')).toBe(true)
    expect(result.before[2]?.messages.some(message => message.ruleId === null)).toBe(true)
    expect(result.cleanup).toBe(original)
  })
  test('fix preserves a plain JS no-undef suppression and check still rejects an unsuppressed global', async () => {
    const { exitCode, original, result, stderr, unused, used } = fixture
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(result.after[0]?.errorCount).toBe(0)
    expect(await file(used).text()).toBe(original)
    expect(result.after[1]?.messages.some(message => message.ruleId === 'no-undef')).toBe(true)
    expect(result.after[1]?.errorCount).toBeGreaterThan(0)
    expect(result.after[2]?.errorCount).toBe(0)
    expect(await file(unused).text()).not.toContain('eslint-disable')
  })
})
