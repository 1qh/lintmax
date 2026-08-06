import { describe, expect, test } from 'bun:test'
import type { GroupedFile } from './aggregate.js'
import { formatGrouped } from './format.js'

describe('formatGrouped', () => {
  const oneFinding: GroupedFile[] = [
    { file: 'src/utils.ts', linters: [{ linter: 'biome', rules: [{ lines: [1312], rule: 'noChildrenProp' }] }] }
  ]
  test('prefixes a single line number with L so it cannot read as a count', () => {
    const out = formatGrouped({ files: oneFinding })
    expect(out).toContain('  L1312 noChildrenProp')
    expect(out).not.toContain('  1312 noChildrenProp')
  })
  test('every line number in the output carries the L prefix', () => {
    const files: GroupedFile[] = [
      {
        file: 'a.ts',
        linters: [
          { linter: 'biome', rules: [{ lines: [42, 55, 60], rule: 'noExplicitAny' }] },
          { linter: 'oxlint', rules: [{ lines: [800, 804], rule: 'react-perf' }] }
        ]
      }
    ]
    const out = formatGrouped({ files })
    expect(out).toContain('  L42,55,60 noExplicitAny')
    expect(out).toContain('  L800,804 react-perf')
    for (const line of out.split('\n')) expect(/^ {2}\d/u.test(line)).toBe(false)
  })
  test('a lineless finding (prettier) prints the marker alone, no L', () => {
    const files: GroupedFile[] = [
      { file: 'x.css', linters: [{ linter: 'prettier', rules: [{ lines: [], rule: 'unformatted' }] }] }
    ]
    expect(formatGrouped({ files })).toContain('  unformatted')
  })
  test('empty input renders nothing', () => {
    expect(formatGrouped({ files: [] })).toBe('')
  })
})
