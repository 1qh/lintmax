import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanFileIgnores, isRuleActive, normalizeRule } from './clean-ignores.js'
const tmp = mkdtempSync(join(tmpdir(), 'clean-ignores-test-'))
afterAll(() => rmSync(tmp, { recursive: true }))
const active = new Set([
  '@typescript-eslint/no-unsafe-call',
  'complexity',
  'lint/style/noProcessEnv',
  'no-console',
  'promise/prefer-await-to-then',
  'react-perf/jsx-no-new-object-as-prop',
  'react_perf/jsx-no-new-object-as-prop'
])
const writeAndClean = async (name: string, content: string) => {
  const path = join(tmp, name)
  writeFileSync(path, content)
  const removed = await cleanFileIgnores(path, active)
  return { content: readFileSync(path, 'utf8'), removed }
}
describe('cleanFileIgnores — eslint', () => {
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
  test('handles eslint-disable-next-line', async () => {
    const { content, removed } = await writeAndClean(
      'next-line.ts',
      '// eslint-disable-next-line fake-rule\nconst x = 1\n'
    )
    expect(removed).toBe(1)
    expect(content).toBe('const x = 1\n')
  })
  test('keeps eslint-disable-next-line for active rule', async () => {
    const { content, removed } = await writeAndClean(
      'keep-next-line.ts',
      '// eslint-disable-next-line complexity\nconst x = 1\n'
    )
    expect(removed).toBe(0)
    expect(content).toContain('complexity')
  })
})
describe('cleanFileIgnores — oxlint', () => {
  test('keeps oxlint-disable for active rule', async () => {
    const { content, removed } = await writeAndClean(
      'keep-oxlint.ts',
      '/* oxlint-disable react-perf/jsx-no-new-object-as-prop */\nconst x = 1\n'
    )
    expect(removed).toBe(0)
    expect(content).toContain('react-perf/jsx-no-new-object-as-prop')
  })
  test('removes oxlint-disable for inactive rule', async () => {
    const { content, removed } = await writeAndClean('remove-oxlint.ts', '/* oxlint-disable fake/rule */\nconst x = 1\n')
    expect(removed).toBe(1)
    expect(content).not.toContain('fake/rule')
  })
  test('handles oxlint-disable-next-line', async () => {
    const { content, removed } = await writeAndClean(
      'oxlint-next.ts',
      '// oxlint-disable-next-line fake/rule\nconst x = 1\n'
    )
    expect(removed).toBe(1)
    expect(content).toBe('const x = 1\n')
  })
  test('trims comma-separated oxlint rules', async () => {
    const { content, removed } = await writeAndClean(
      'oxlint-multi.ts',
      '/* oxlint-disable react-perf/jsx-no-new-object-as-prop, fake/gone */\nconst x = 1\n'
    )
    expect(removed).toBe(1)
    expect(content).toContain('react-perf/jsx-no-new-object-as-prop')
    expect(content).not.toContain('fake/gone')
  })
})
describe('cleanFileIgnores — biome', () => {
  test('keeps biome-ignore-all for active rule', async () => {
    const { content, removed } = await writeAndClean(
      'keep-biome.ts',
      '/** biome-ignore-all lint/style/noProcessEnv: reason */\nconst x = 1\n'
    )
    expect(removed).toBe(0)
    expect(content).toContain('lint/style/noProcessEnv')
  })
  test('removes biome-ignore-all for inactive rule', async () => {
    const { content, removed } = await writeAndClean(
      'remove-biome.ts',
      '/** biome-ignore-all lint/fake/rule: reason */\nconst x = 1\n'
    )
    expect(removed).toBe(1)
    expect(content).toBe('const x = 1\n')
  })
  test('handles per-line biome-ignore', async () => {
    const { content, removed } = await writeAndClean(
      'biome-per-line.ts',
      '/** biome-ignore lint/fake/rule: reason */\nconst x = 1\n'
    )
    expect(removed).toBe(1)
    expect(content).toBe('const x = 1\n')
  })
  test('keeps per-line biome-ignore for active rule', async () => {
    const { content, removed } = await writeAndClean(
      'biome-keep-per.ts',
      '/** biome-ignore lint/style/noProcessEnv: env access */\nconst x = 1\n'
    )
    expect(removed).toBe(0)
    expect(content).toContain('lint/style/noProcessEnv')
  })
})
describe('cleanFileIgnores — edge cases', () => {
  test('no changes returns 0', async () => {
    const { removed } = await writeAndClean('clean.ts', 'const x = 1\nconst y = 2\n')
    expect(removed).toBe(0)
  })
  test('preserves non-ignore lines', async () => {
    const { content, removed } = await writeAndClean(
      'preserve.ts',
      "/* eslint-disable fake-rule */\nimport { foo } from 'bar'\nconst x = foo()\n"
    )
    expect(removed).toBe(1)
    expect(content).toContain("import { foo } from 'bar'")
    expect(content).toContain('const x = foo()')
  })
  test('handles underscore/hyphen variant matching', async () => {
    const { removed } = await writeAndClean(
      'variant.ts',
      '/* oxlint-disable react_perf/jsx-no-new-object-as-prop */\nconst x = 1\n'
    )
    expect(removed).toBe(0)
  })
  test('empty file returns 0', async () => {
    const { removed } = await writeAndClean('empty.ts', '')
    expect(removed).toBe(0)
  })
})
describe('normalizeRule', () => {
  test('oxc(rule) → bare rule', () => {
    const v = normalizeRule('oxc(no-map-spread)')
    expect(v).toContain('no-map-spread')
  })
  test('eslint-plugin-react-perf(rule) → react-perf/rule', () => {
    const v = normalizeRule('eslint-plugin-react-perf(jsx-no-new-object-as-prop)')
    expect(v).toContain('react-perf/jsx-no-new-object-as-prop')
  })
  test('eslint-plugin-jsx-a11y(rule) → jsx-a11y/rule', () => {
    const v = normalizeRule('eslint-plugin-jsx-a11y(prefer-tag-over-role)')
    expect(v).toContain('jsx-a11y/prefer-tag-over-role')
  })
  test('typescript-eslint(rule) → @typescript-eslint/rule', () => {
    const v = normalizeRule('typescript-eslint(no-unsafe-call)')
    expect(v).toContain('@typescript-eslint/no-unsafe-call')
  })
  test('@typescript-eslint/rule → typescript-eslint(rule)', () => {
    const v = normalizeRule('@typescript-eslint/no-unsafe-call')
    expect(v).toContain('typescript-eslint(no-unsafe-call)')
  })
  test('underscore variant generated', () => {
    const v = normalizeRule('react-perf/jsx-no-new-object-as-prop')
    expect(v).toContain('react_perf/jsx_no_new_object_as_prop')
  })
  test('hyphen variant generated from underscore', () => {
    const v = normalizeRule('react_perf(jsx-no-new-object-as-prop)')
    expect(v).toContain('react-perf(jsx-no-new-object-as-prop)')
  })
  test('plain rule with hyphen generates underscore variant', () => {
    const v = normalizeRule('no-console')
    expect(v).toContain('no-console')
    expect(v).toContain('no_console')
  })
  test('plain rule without hyphen returns itself only', () => {
    const v = normalizeRule('eqeqeq')
    expect(v).toEqual(['eqeqeq'])
  })
  test('@next/next/rule → nextjs(rule)', () => {
    const v = normalizeRule('@next/next/no-img-element')
    expect(v).toContain('nextjs(no-img-element)')
  })
})
describe('isRuleActive', () => {
  const rules = new Set(['@typescript-eslint/no-unsafe-call', 'no-console', 'react-perf/jsx-no-new-object-as-prop'])
  test('exact match', () => {
    expect(isRuleActive('no-console', rules)).toBe(true)
  })
  test('not in set', () => {
    expect(isRuleActive('fake-rule', rules)).toBe(false)
  })
  test('matches via underscore variant', () => {
    expect(isRuleActive('react_perf/jsx-no-new-object-as-prop', rules)).toBe(true)
  })
  test('matches via typescript-eslint() variant', () => {
    expect(isRuleActive('typescript-eslint(no-unsafe-call)', rules)).toBe(true)
  })
  test('matches via eslint-plugin- prefix in normalized set', () => {
    const s = new Set<string>()
    for (const v of normalizeRule('eslint-plugin-react-perf(jsx-no-new-object-as-prop)')) s.add(v)
    expect(isRuleActive('react-perf/jsx-no-new-object-as-prop', s)).toBe(true)
  })
})
