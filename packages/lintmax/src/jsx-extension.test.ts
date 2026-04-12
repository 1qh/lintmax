import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkJsxExtension } from './jsx-extension.js'
const tmp = mkdtempSync(join(tmpdir(), 'jsx-ext-test-'))
afterAll(() => rmSync(tmp, { recursive: true }))
const write = (name: string, code: string) => writeFileSync(join(tmp, name), code)
const check = async () => {
  const d = await checkJsxExtension({ root: tmp })
  return new Set(d.map(x => x.file.split('/').pop()))
}
describe('jsx-requires-tsx-extension', () => {
  test('catches JSX element in .ts', async () => {
    write('elem.ts', 'const X = () => <div>hi</div>')
    const found = await check()
    expect(found.has('elem.ts')).toBe(true)
  })
  test('catches JSX fragment in .ts', async () => {
    write('frag.ts', 'const X = () => <>hi</>')
    const found = await check()
    expect(found.has('frag.ts')).toBe(true)
  })
  test('catches self-closing JSX in .ts', async () => {
    write('self.ts', 'const X = () => <br />')
    const found = await check()
    expect(found.has('self.ts')).toBe(true)
  })
  test('ignores generics in .ts', async () => {
    write('generic.ts', 'const f = <T>(x: T): T => x')
    const found = await check()
    expect(found.has('generic.ts')).toBe(false)
  })
  test('ignores constrained generics in .ts', async () => {
    write('constrained.ts', 'const f = <T extends unknown>(x: T) => x')
    const found = await check()
    expect(found.has('constrained.ts')).toBe(false)
  })
  test('ignores comparison operators in .ts', async () => {
    write('compare.ts', 'const x = a < b && c > d')
    const found = await check()
    expect(found.has('compare.ts')).toBe(false)
  })
  test('ignores .d.ts files', async () => {
    write('types.d.ts', 'declare const X: () => <div />')
    const found = await check()
    expect(found.has('types.d.ts')).toBe(false)
  })
  test('ignores .tsx files', async () => {
    write('valid.tsx', 'const X = () => <div>hi</div>')
    const found = await check()
    expect(found.has('valid.tsx')).toBe(false)
  })
  test('returns correct diagnostic shape', async () => {
    write('shape.ts', 'const X = () => <span />')
    const d = await checkJsxExtension({ root: tmp })
    const match = d.find(x => x.file.endsWith('shape.ts'))
    expect(match).toBeDefined()
    expect(match?.rule).toBe('jsx-requires-tsx-extension')
    expect(match?.linter).toBe('lintmax')
    expect(match?.line).toBe(1)
  })
})
