/* eslint-disable prefer-named-capture-group */
/** biome-ignore-all lint/nursery/useNamedCaptureGroup: test fixtures */
import { file, write } from 'bun'
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cleanFileIgnores,
  isRuleActive,
  loadOxlintOffRules,
  normalizeRule,
  splitDirective,
  splitRules
} from './clean-ignores.js'
import { cacheDir } from './core.js'
import { parseRules } from './ignores.js'

const tmp = await mkdtemp(join(tmpdir(), 'clean-ignores-test-'))
afterAll(async () => rm(tmp, { recursive: true }))
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
  await write(path, content)
  const removed = await cleanFileIgnores(path, active)
  return { content: await file(path).text(), removed }
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
  test('keeps the reason when trimming a rule, even though the reason holds a comma', async () => {
    const { content, removed } = await writeAndClean(
      'trim-keeps-reason.ts',
      '/* eslint-disable no-console, some-fake-rule -- the index is the identity, so a key adds nothing */\nconst x = 1\n'
    )
    expect(removed).toBe(1)
    expect(content).toContain('no-console')
    expect(content).not.toContain('some-fake-rule')
    expect(content).toContain('-- the index is the identity, so a key adds nothing')
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
describe('cleanFileIgnores — multi-file batch', () => {
  test('cleans multiple files independently', async () => {
    const a = await writeAndClean('batch-a.ts', '/* eslint-disable fake-a */\nconst a = 1\n')
    const b = await writeAndClean('batch-b.ts', '/* eslint-disable no-console */\nconst b = 2\n')
    const c = await writeAndClean('batch-c.ts', 'const c = 3\n')
    expect(a.removed).toBe(1)
    expect(a.content).toBe('const a = 1\n')
    expect(b.removed).toBe(0)
    expect(b.content).toContain('no-console')
    expect(c.removed).toBe(0)
  })
  test('handles file with multiple ignore types', async () => {
    const { content, removed } = await writeAndClean(
      'mixed.ts',
      '/* eslint-disable fake-rule */\n/* oxlint-disable fake/thing */\n/** biome-ignore-all lint/fake/x: y */\nconst x = 1\n'
    )
    expect(removed).toBe(3)
    expect(content).toBe('const x = 1\n')
  })
  test('handles file with mix of active and inactive', async () => {
    const { content, removed } = await writeAndClean(
      'mixed-active.ts',
      '/* eslint-disable no-console */\n/* eslint-disable fake-rule */\n/** biome-ignore-all lint/style/noProcessEnv: x */\nconst x = 1\n'
    )
    expect(removed).toBe(1)
    expect(content).toContain('no-console')
    expect(content).toContain('lint/style/noProcessEnv')
    expect(content).not.toContain('fake-rule')
  })
})
describe('splitRules', () => {
  test('single rule', () => {
    expect(splitRules('no-console')).toEqual(['no-console'])
  })
  test('comma-separated', () => {
    expect(splitRules('no-console, complexity')).toEqual(['no-console', 'complexity'])
  })
  test('strips trailing */', () => {
    expect(splitRules('no-console */')).toEqual(['no-console'])
  })
  test('strips trailing --comment', () => {
    expect(splitRules('no-console -- reason here')).toEqual(['no-console'])
  })
  test('a comma inside the reason does not read as another rule', () => {
    expect(splitRules('no-console -- the index is the identity, so a key adds nothing')).toEqual(['no-console'])
  })
  test('keeps the reason so a rewrite can re-attach it', () => {
    expect(splitDirective('no-console, complexity -- both are intentional, see below')).toEqual({
      reason: ' -- both are intentional, see below',
      rules: ['no-console', 'complexity']
    })
  })
  test('empty string', () => {
    expect(splitRules('')).toEqual([])
  })
  test('whitespace only', () => {
    expect(splitRules('  ,  ')).toEqual([])
  })
  test('mixed with trailing junk', () => {
    expect(splitRules('no-console, complexity -- note */')).toEqual(['no-console', 'complexity'])
  })
})
describe('parseRules (ignores.ts)', () => {
  const eslintRe = /eslint-disable(?:-next-line)?\s+([^\n]*)/gv
  const oxlintRe = /oxlint-disable(?:-next-line)?\s+([^\n]*)/gv
  const biomeRe = /biome-ignore(?:-all)?\s+([\w/]+)/gu
  test('parses eslint-disable single rule', () => {
    expect(parseRules('/* eslint-disable no-console */', eslintRe)).toEqual(['no-console'])
  })
  test('parses eslint-disable multi rule', () => {
    expect(parseRules('/* eslint-disable no-console, complexity */', eslintRe)).toEqual(['no-console', 'complexity'])
  })
  test('parses eslint-disable-next-line', () => {
    expect(parseRules('// eslint-disable-next-line no-console', eslintRe)).toEqual(['no-console'])
  })
  test('parses oxlint-disable', () => {
    expect(parseRules('/* oxlint-disable react-perf/jsx-no-new-object-as-prop */', oxlintRe)).toEqual([
      'react-perf/jsx-no-new-object-as-prop'
    ])
  })
  test('parses biome-ignore', () => {
    expect(parseRules('/** biome-ignore lint/style/noProcessEnv: reason */', biomeRe)).toEqual(['lint/style/noProcessEnv'])
  })
  test('parses biome-ignore-all', () => {
    expect(parseRules('/** biome-ignore-all lint/nursery/noForIn: reason */', biomeRe)).toEqual(['lint/nursery/noForIn'])
  })
  test('returns empty for no match', () => {
    expect(parseRules('const x = 1', eslintRe)).toEqual([])
  })
})
describe('loadOxlintOffRules', () => {
  const inDir = async <T>(dir: string, fn: () => Promise<T>): Promise<T> => {
    const before = process.cwd()
    process.chdir(dir)
    try {
      return await fn()
    } finally {
      process.chdir(before)
    }
  }
  test('refuses when the generated config is absent rather than reading it as "no rule is off"', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'off-absent-'))
    expect(inDir(dir, loadOxlintOffRules)).rejects.toThrow(/generated config is absent/u)
  })
  test('refuses when the generated config carries no parseable JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'off-garbage-'))
    await write(join(dir, cacheDir, '.oxlintrc.json'), 'not json at all')
    expect(inDir(dir, loadOxlintOffRules)).rejects.toThrow(/no parseable JSON/u)
  })
  test('reads an off rule from a valid config, so the refusal is not blanket', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'off-valid-'))
    await write(
      join(dir, cacheDir, '.oxlintrc.json'),
      JSON.stringify({ rules: { 'no-console': 'off', 'no-debugger': 'error' } })
    )
    const off = await inDir(dir, loadOxlintOffRules)
    expect(off.has('no-console')).toBe(true)
    expect(off.has('no-debugger')).toBe(false)
  })
})
