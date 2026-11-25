import { write as bunWrite } from 'bun'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkJsxExtension, hasJsx } from './jsx-extension.js'
const withTmp = async <T>(run: (tmp: string) => Promise<T>): Promise<T> => {
  const tmp = await mkdtemp(join(tmpdir(), 'jsx-ext-test-'))
  try {
    return await run(tmp)
  } finally {
    await rm(tmp, { force: true, recursive: true })
  }
}
const flaggedNames = async (name: string, code: string): Promise<Set<string | undefined>> =>
  withTmp(async tmp => {
    await bunWrite(join(tmp, name), code)
    const d = await checkJsxExtension({ root: tmp })
    return new Set(d.map(x => x.file.split('/').pop()))
  })
const extensionCases: { code: string; isFlagged: boolean; name: string; title: string }[] = [
  { code: 'const X = () => <div>hi</div>', isFlagged: true, name: 'elem.ts', title: 'catches JSX element in .ts' },
  { code: 'const X = () => <>hi</>', isFlagged: true, name: 'frag.ts', title: 'catches JSX fragment in .ts' },
  { code: 'const X = () => <br />', isFlagged: true, name: 'self.ts', title: 'catches self-closing JSX in .ts' },
  {
    code: "import { createContext } from 'react'\nconst Ctx = createContext([])\nconst P = ({ children }: { children: unknown }) => <Ctx value={[]}>{children}</Ctx>",
    isFlagged: true,
    name: 'ctx.ts',
    title: 'catches Context.Provider pattern in .ts'
  },
  {
    code: 'const X = ({ ok }: { ok: boolean }) => ok ? <span>yes</span> : null',
    isFlagged: true,
    name: 'ternary.ts',
    title: 'catches JSX inside ternary in .ts'
  },
  {
    code: "import type { ReactNode } from 'react'\nconst X = (): ReactNode => <p>hi</p>",
    isFlagged: true,
    name: 'typeimport.ts',
    title: 'catches JSX with only type imports in .ts'
  },
  { code: 'const f = <T>(x: T): T => x', isFlagged: false, name: 'generic.ts', title: 'ignores generics in .ts' },
  {
    code: 'const f = <T extends unknown>(x: T) => x',
    isFlagged: false,
    name: 'constrained.ts',
    title: 'ignores constrained generics in .ts'
  },
  { code: 'const x = a < b && c > d', isFlagged: false, name: 'compare.ts', title: 'ignores comparison operators in .ts' },
  {
    code: 'const f = async <T>(x: T): Promise<T> => x',
    isFlagged: false,
    name: 'asyncgen.ts',
    title: 'ignores async generic functions'
  },
  {
    code: 'interface Box<T> { value: T }\ntype Fn<A, B> = (a: A) => B',
    isFlagged: false,
    name: 'iface.ts',
    title: 'ignores generic interfaces and types'
  },
  { code: 'declare const X: () => <div />', isFlagged: false, name: 'types.d.ts', title: 'ignores .d.ts files' },
  { code: 'const X = () => <div>hi</div>', isFlagged: false, name: 'valid.tsx', title: 'ignores .tsx files' }
]
const parsingCases: { code: string; isJsx: boolean; title: string }[] = [
  { code: 'const X = () => <div>hi</div>', isJsx: true, title: 'true for JSX element' },
  { code: 'const X = () => <>hi</>', isJsx: true, title: 'true for JSX fragment' },
  { code: 'const X = () => <br />', isJsx: true, title: 'true for self-closing' },
  { code: 'const X = () => <div><span>a</span></div>', isJsx: true, title: 'true for nested JSX' },
  { code: 'const X = () => { return <p>hi</p> }', isJsx: true, title: 'true for JSX in return' },
  { code: 'const f = <T>(x: T): T => x', isJsx: false, title: 'false for generic fn' },
  { code: 'interface Box<T> { value: T }', isJsx: false, title: 'false for generic interface' },
  { code: 'const x = a < b && c > d', isJsx: false, title: 'false for comparison' },
  { code: 'const x = value as string', isJsx: false, title: 'false for type assertion' },
  { code: '', isJsx: false, title: 'false for empty file' },
  { code: 'const x = 1\nconst y = 2', isJsx: false, title: 'false for plain code' },
  { code: 'const f = async <T>(x: T): Promise<T> => x', isJsx: false, title: 'false for async generic' },
  {
    code: '<MyContext.Provider value={1}>{children}</MyContext.Provider>',
    isJsx: true,
    title: 'true for Context.Provider'
  }
]
describe('jsx-requires-tsx-extension', () => {
  test.each(extensionCases)('$title', async ({ code, isFlagged, name }) => {
    const found = await flaggedNames(name, code)
    expect(found.has(name)).toBe(isFlagged)
  })
  test('returns correct diagnostic shape', async () => {
    const match = await withTmp(async tmp => {
      await bunWrite(join(tmp, 'shape.ts'), 'const X = () => <span />')
      const d = await checkJsxExtension({ root: tmp })
      return d.find(x => x.file.endsWith('shape.ts'))
    })
    expect(match).toBeDefined()
    expect(match?.rule).toBe('jsx-requires-tsx-extension')
    expect(match?.linter).toBe('lintmax')
    expect(match?.line).toBe(1)
  })
})
describe('hasJsx — direct unit tests', () => {
  test.each(parsingCases)('$title', async ({ code, isJsx }) => {
    expect(await hasJsx(code)).toBe(isJsx)
  })
})
