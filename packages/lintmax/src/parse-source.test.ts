import { describe, expect, test } from 'bun:test'
import { parseAnyDialect } from './parse-source.js'

const AMBIENT_DTS = 'const styles: Record<string, string>\nexport default styles\n'
const JSX_TSX = 'const A = () => <div>{1}</div>\nexport default A\n'
const GENERIC_ARROW_TS = 'const id = <T,>(v: T): T => v\nexport { id }\n'
describe('parseAnyDialect', () => {
  test('parses an ambient declaration whose const carries no initializer', () => {
    expect(parseAnyDialect({ label: 'probe', sourceText: AMBIENT_DTS }).errors).toHaveLength(0)
  })
  test('parses jsx', () => {
    expect(parseAnyDialect({ label: 'probe', sourceText: JSX_TSX }).errors).toHaveLength(0)
  })
  test('parses a generic arrow that the jsx dialect rejects', () => {
    expect(parseAnyDialect({ label: 'probe', sourceText: GENERIC_ARROW_TS }).errors).toHaveLength(0)
  })
  test('throws with the label when no dialect parses', () => {
    expect(() => parseAnyDialect({ label: 'probe', sourceText: 'const = = =\n' })).toThrow(
      /probe cannot parse the source/v
    )
  })
})
