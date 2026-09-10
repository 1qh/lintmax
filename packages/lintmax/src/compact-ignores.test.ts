import { describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { runCompact } from './compact.js'
describe('the compact stage honours the ignore list', () => {
  test('a file the config ignores is not rewritten, while one it does not is', async () => {
    const root = `${tmpdir()}/lintmax-compact-${Bun.randomUUIDv7()}`
    await Bun.$`mkdir -p ${root}/readonly ${root}/src`.quiet()
    await Bun.$`git init -q ${root}`.quiet()
    const vendored = `${root}/readonly/keep.ts`
    const mine = `${root}/src/mine.ts`
    const before = 'const a = 1\n\n\n\nconst b = 2\n'
    await Bun.write(vendored, before)
    await Bun.write(mine, before)
    await Bun.$`git -C ${root} add -A`.quiet()
    await runCompact({
      env: process.env,
      isIgnored: (one: string) => one.startsWith('readonly/'),
      mode: 'fix',
      root
    })
    expect(
      await Bun.file(vendored).text(),
      'the compact stage rewrote a file the ignore list excludes — every other stage honours that list, and this one walking the tree regardless is how a vendored, never-hand-edit tree loses hundreds of lines with nothing reporting it'
    ).toBe(before)
    expect(
      await Bun.file(mine).text(),
      'this guard judges nothing: compaction did not run on a file it was meant to compact'
    ).not.toBe(before)
    await Bun.$`rm -rf ${root}`.quiet()
  })
})
