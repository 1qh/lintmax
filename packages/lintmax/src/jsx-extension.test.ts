import { write as bunWrite } from 'bun'
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkJsxExtension, hasJsx } from './jsx-extension.js'

const tmp = await mkdtemp(join(tmpdir(), 'jsx-ext-test-'))
afterAll(async () => rm(tmp, { recursive: true }))
const write = async (name: string, code: string) => bunWrite(join(tmp, name), code)
const check = async () => {
  const d = await checkJsxExtension({ root: tmp })
  return new Set(d.map(x => x.file.split('/').pop()))
}
describe('jsx-requires-tsx-extension', () => {
  test('catches JSX element in .ts', async () => {
    await write('elem.ts', 'const X = () => <div>hi</div>')
    const found = await check()
    expect(found.has('elem.ts')).toBe(true)
  })
  test('catches JSX fragment in .ts', async () => {
    await write('frag.ts', 'const X = () => <>hi</>')
    const found = await check()
    expect(found.has('frag.ts')).toBe(true)
  })
  test('catches self-closing JSX in .ts', async () => {
    await write('self.ts', 'const X = () => <br />')
    const found = await check()
    expect(found.has('self.ts')).toBe(true)
  })
  test('catches Context.Provider pattern in .ts', async () => {
    await write(
      'ctx.ts',
      "import { createContext } from 'react'\nconst Ctx = createContext([])\nconst P = ({ children }: { children: unknown }) => <Ctx value={[]}>{children}</Ctx>"
    )
    const found = await check()
    expect(found.has('ctx.ts')).toBe(true)
  })
  test('catches JSX inside ternary in .ts', async () => {
    await write('ternary.ts', 'const X = ({ ok }: { ok: boolean }) => ok ? <span>yes</span> : null')
    const found = await check()
    expect(found.has('ternary.ts')).toBe(true)
  })
  test('catches JSX with only type imports in .ts', async () => {
    await write('typeimport.ts', "import type { ReactNode } from 'react'\nconst X = (): ReactNode => <p>hi</p>")
    const found = await check()
    expect(found.has('typeimport.ts')).toBe(true)
  })
  test('ignores generics in .ts', async () => {
    await write('generic.ts', 'const f = <T>(x: T): T => x')
    const found = await check()
    expect(found.has('generic.ts')).toBe(false)
  })
  test('ignores constrained generics in .ts', async () => {
    await write('constrained.ts', 'const f = <T extends unknown>(x: T) => x')
    const found = await check()
    expect(found.has('constrained.ts')).toBe(false)
  })
  test('ignores comparison operators in .ts', async () => {
    await write('compare.ts', 'const x = a < b && c > d')
    const found = await check()
    expect(found.has('compare.ts')).toBe(false)
  })
  test('ignores async generic functions', async () => {
    await write('asyncgen.ts', 'const f = async <T>(x: T): Promise<T> => x')
    const found = await check()
    expect(found.has('asyncgen.ts')).toBe(false)
  })
  test('ignores generic interfaces and types', async () => {
    await write('iface.ts', 'interface Box<T> { value: T }\ntype Fn<A, B> = (a: A) => B')
    const found = await check()
    expect(found.has('iface.ts')).toBe(false)
  })
  test('ignores .d.ts files', async () => {
    await write('types.d.ts', 'declare const X: () => <div />')
    const found = await check()
    expect(found.has('types.d.ts')).toBe(false)
  })
  test('ignores .tsx files', async () => {
    await write('valid.tsx', 'const X = () => <div>hi</div>')
    const found = await check()
    expect(found.has('valid.tsx')).toBe(false)
  })
  test('returns correct diagnostic shape', async () => {
    await write('shape.ts', 'const X = () => <span />')
    const d = await checkJsxExtension({ root: tmp })
    const match = d.find(x => x.file.endsWith('shape.ts'))
    expect(match).toBeDefined()
    expect(match?.rule).toBe('jsx-requires-tsx-extension')
    expect(match?.linter).toBe('lintmax')
    expect(match?.line).toBe(1)
  })
})
describe('hasJsx — direct unit tests', () => {
  test('true for JSX element', () => expect(hasJsx('const X = () => <div>hi</div>')).toBe(true))
  test('true for JSX fragment', () => expect(hasJsx('const X = () => <>hi</>')).toBe(true))
  test('true for self-closing', () => expect(hasJsx('const X = () => <br />')).toBe(true))
  test('true for nested JSX', () => expect(hasJsx('const X = () => <div><span>a</span></div>')).toBe(true))
  test('true for JSX in return', () => expect(hasJsx('const X = () => { return <p>hi</p> }')).toBe(true))
  test('false for generic fn', () => expect(hasJsx('const f = <T>(x: T): T => x')).toBe(false))
  test('false for generic interface', () => expect(hasJsx('interface Box<T> { value: T }')).toBe(false))
  test('false for comparison', () => expect(hasJsx('const x = a < b && c > d')).toBe(false))
  test('false for type assertion', () => expect(hasJsx('const x = value as string')).toBe(false))
  test('false for empty file', () => expect(hasJsx('')).toBe(false))
  test('false for plain code', () => expect(hasJsx('const x = 1\nconst y = 2')).toBe(false))
  test('false for async generic', () => expect(hasJsx('const f = async <T>(x: T): Promise<T> => x')).toBe(false))
  test('true for Context.Provider', () =>
    expect(hasJsx('<MyContext.Provider value={1}>{children}</MyContext.Provider>')).toBe(true))
})
