import { write as bunWrite } from 'bun'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkJsxExtension, hasJsx } from './jsx-extension.js'
const withTmp = async (run: (tmp: string) => Promise<void>) => {
  const tmp = await mkdtemp(join(tmpdir(), 'jsx-ext-test-'))
  try {
    await run(tmp)
  } finally {
    await rm(tmp, { force: true, recursive: true })
  }
}
const write = async (tmp: string, name: string, code: string) => bunWrite(join(tmp, name), code)
const check = async (tmp: string) => {
  const d = await checkJsxExtension({ root: tmp })
  return new Set(d.map(x => x.file.split('/').pop()))
}
const expectFlagged = async (name: string, code: string, flagged: boolean) => {
  await withTmp(async tmp => {
    await write(tmp, name, code)
    const found = await check(tmp)
    expect(found.has(name)).toBe(flagged)
  })
}
const registerJsxExtensionCases = () => {
  test('catches JSX element in .ts', async () => expectFlagged('elem.ts', 'const X = () => <div>hi</div>', true))
  test('catches JSX fragment in .ts', async () => expectFlagged('frag.ts', 'const X = () => <>hi</>', true))
  test('catches self-closing JSX in .ts', async () => expectFlagged('self.ts', 'const X = () => <br />', true))
  test('catches Context.Provider pattern in .ts', async () =>
    expectFlagged(
      'ctx.ts',
      "import { createContext } from 'react'\nconst Ctx = createContext([])\nconst P = ({ children }: { children: unknown }) => <Ctx value={[]}>{children}</Ctx>",
      true
    ))
  test('catches JSX inside ternary in .ts', async () =>
    expectFlagged('ternary.ts', 'const X = ({ ok }: { ok: boolean }) => ok ? <span>yes</span> : null', true))
  test('catches JSX with only type imports in .ts', async () =>
    expectFlagged('typeimport.ts', "import type { ReactNode } from 'react'\nconst X = (): ReactNode => <p>hi</p>", true))
}
const registerNonJsxExtensionCases = () => {
  test('ignores generics in .ts', async () => expectFlagged('generic.ts', 'const f = <T>(x: T): T => x', false))
  test('ignores constrained generics in .ts', async () =>
    expectFlagged('constrained.ts', 'const f = <T extends unknown>(x: T) => x', false))
  test('ignores comparison operators in .ts', async () => expectFlagged('compare.ts', 'const x = a < b && c > d', false))
  test('ignores async generic functions', async () =>
    expectFlagged('asyncgen.ts', 'const f = async <T>(x: T): Promise<T> => x', false))
  test('ignores generic interfaces and types', async () =>
    expectFlagged('iface.ts', 'interface Box<T> { value: T }\ntype Fn<A, B> = (a: A) => B', false))
  test('ignores .d.ts files', async () => expectFlagged('types.d.ts', 'declare const X: () => <div />', false))
  test('ignores .tsx files', async () => expectFlagged('valid.tsx', 'const X = () => <div>hi</div>', false))
  test('returns correct diagnostic shape', async () => {
    await withTmp(async tmp => {
      await write(tmp, 'shape.ts', 'const X = () => <span />')
      const d = await checkJsxExtension({ root: tmp })
      const match = d.find(x => x.file.endsWith('shape.ts'))
      expect(match).toBeDefined()
      expect(match?.rule).toBe('jsx-requires-tsx-extension')
      expect(match?.linter).toBe('lintmax')
      expect(match?.line).toBe(1)
    })
  })
}
describe('jsx-requires-tsx-extension', () => {
  registerJsxExtensionCases()
  registerNonJsxExtensionCases()
})
const registerJsxParsingCases = () => {
  test('true for JSX element', async () => expect(await hasJsx('const X = () => <div>hi</div>')).toBe(true))
  test('true for JSX fragment', async () => expect(await hasJsx('const X = () => <>hi</>')).toBe(true))
  test('true for self-closing', async () => expect(await hasJsx('const X = () => <br />')).toBe(true))
  test('true for nested JSX', async () => expect(await hasJsx('const X = () => <div><span>a</span></div>')).toBe(true))
  test('true for JSX in return', async () => expect(await hasJsx('const X = () => { return <p>hi</p> }')).toBe(true))
}
const registerNonJsxParsingCases = () => {
  test('false for generic fn', async () => expect(await hasJsx('const f = <T>(x: T): T => x')).toBe(false))
  test('false for generic interface', async () => expect(await hasJsx('interface Box<T> { value: T }')).toBe(false))
  test('false for comparison', async () => expect(await hasJsx('const x = a < b && c > d')).toBe(false))
  test('false for type assertion', async () => expect(await hasJsx('const x = value as string')).toBe(false))
  test('false for empty file', async () => expect(await hasJsx('')).toBe(false))
  test('false for plain code', async () => expect(await hasJsx('const x = 1\nconst y = 2')).toBe(false))
  test('false for async generic', async () =>
    expect(await hasJsx('const f = async <T>(x: T): Promise<T> => x')).toBe(false))
  test('true for Context.Provider', async () =>
    expect(await hasJsx('<MyContext.Provider value={1}>{children}</MyContext.Provider>')).toBe(true))
}
describe('hasJsx — direct unit tests', () => {
  registerJsxParsingCases()
  registerNonJsxParsingCases()
})
