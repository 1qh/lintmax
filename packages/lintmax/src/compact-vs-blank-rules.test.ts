import { describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { runCompact } from './compact.js'
import { isRecord } from './normalize.js'
import { fromFileUrl, joinPath } from './path.js'
describe('a lint rule that requires a blank line cannot coexist with the compact stage', () => {
  test('compact deletes the blank line after an import block, so any rule demanding one is unsatisfiable', async () => {
    const root = joinPath(tmpdir(), `lintmax-compact-blank-${Date.now()}`)
    await Bun.$`mkdir -p ${root}`.quiet()
    await Bun.$`git -C ${root} init -q`.quiet()
    const subject = joinPath(root, 'subject.ts')
    const before = "import { a } from 'b'\n\nconst x = 1\n"
    await Bun.write(subject, before)
    await Bun.$`git -C ${root} add -A`.quiet()
    await runCompact({ env: process.env, isIgnored: () => false, mode: 'fix', root })
    const after = await Bun.file(subject).text()
    expect(after, 'this guard judges nothing: compaction did not run on the file it was meant to compact').not.toBe(before)
    expect(
      after.includes('\n\n'),
      'compact left a blank line, so the premise behind disabling every blank-line rule no longer holds — re-derive which rules are safe to enable before trusting this'
    ).toBe(false)
  })
  test('the shipped oxlint config disables the import rule that demands that exact blank line', async () => {
    const configPath = fromFileUrl(import.meta.resolve('../oxlintrc.json'))
    const parsed: unknown = await Bun.file(configPath).json()
    if (!isRecord(parsed)) throw new Error('the shipped oxlint config is not an object')
    const { rules } = parsed
    if (!isRecord(rules)) throw new Error('the shipped oxlint config declares no rules map')
    expect(
      rules['import/newline-after-import'],
      'import/newline-after-import requires a blank line after the import block and the compact stage deletes every blank line, so the pair is unsatisfiable: fix removes it, check demands it back, and the finding never clears. It is off because a gate whose count ratchets on findings nobody can clear cannot surface a real one — measured at 429 files across one consumer tree the day oxlint began enforcing it'
    ).toBe('off')
  })
})
