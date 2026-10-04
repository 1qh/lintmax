import type { ESLint } from 'eslint'
import { file, write } from 'bun'
import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { readRequiredJson } from './core.js'
test('fix preserves a plain JS no-undef suppression and check still rejects an unsuppressed global', async () => {
  const root = await mkdtemp(join(import.meta.dir, '.no-undef-fixture-'))
  try {
    const configDir = join(root, 'node_modules/.cache/lintmax')
    await write(
      join(configDir, '.oxlintrc.json'),
      JSON.stringify({ rules: { 'no-debugger': 'error', 'no-undef': 'off' } })
    )
    await write(
      join(configDir, 'eslint.generated.mjs'),
      `export default [
      { files: ['**/*.js'], languageOptions: { sourceType: 'script' }, rules: { 'no-undef': 'error' } },
      { files: ['**/*.ts'], rules: { 'no-undef': 'off' } },
      { linterOptions: { reportUnusedDisableDirectives: 'error' } }
    ]\n`
    )
    const used = join(root, 'browser.js')
    const bare = join(root, 'unsuppressed.js')
    const unused = join(root, 'unused.js')
    const original = '// eslint-disable-next-line no-undef\ndocument.title = "fixture"\n'
    await write(used, original)
    await write(bare, 'document.title = "fixture"\n')
    await write(unused, '// eslint-disable-next-line no-undef\nMath.abs(1)\n')
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
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    const result = readRequiredJson<{
      after: ESLint.LintResult[]
      before: ESLint.LintResult[]
      cleanup: string
    }>(stdout)
    expect(result.before[0]?.errorCount).toBe(0)
    expect(result.before[1]?.messages.some(message => message.ruleId === 'no-undef')).toBe(true)
    expect(result.before[2]?.messages.some(message => message.ruleId === null)).toBe(true)
    expect(result.cleanup).toBe(original)
    expect(result.after[0]?.errorCount).toBe(0)
    expect(await file(used).text()).toBe(original)
    expect(result.after[1]?.messages.some(message => message.ruleId === 'no-undef')).toBe(true)
    expect(result.after[1]?.errorCount).toBeGreaterThan(0)
    expect(result.after[2]?.errorCount).toBe(0)
    expect(await file(unused).text()).not.toContain('eslint-disable')
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
