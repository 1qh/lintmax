import { write as bunWrite } from 'bun'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findDangerousSuppressions } from './ignores.js'

describe('findDangerousSuppressions', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ni-'))
    await mkdir(join(dir, 'src'), { recursive: true })
  })
  afterEach(async () => rm(dir, { force: true, recursive: true }))
  const write = async (rel: string, content: string) => {
    await mkdir(join(dir, rel, '..'), { recursive: true })
    await bunWrite(join(dir, rel), content)
  }
  test('flags eslint no-unsafe suppression', async () => {
    await write('src/a.ts', '/* eslint-disable @typescript-eslint/no-unsafe-assignment */\nconst x = 1\nexport { x }\n')
    const found = await findDangerousSuppressions(dir)
    expect(found.some(d => d.rule.includes('no-unsafe-assignment'))).toBe(true)
  })
  test('flags no-non-null-assertion and ts-nocheck even in test files', async () => {
    await write(
      'src/b.test.ts',
      '/* eslint-disable @typescript-eslint/no-non-null-assertion */\nconst y = 1\nexport { y }\n'
    )
    await write('src/c.ts', '// @ts-nocheck\nconst z = 1\nexport { z }\n')
    const found = await findDangerousSuppressions(dir)
    expect(found.some(d => d.rule.includes('no-non-null-assertion'))).toBe(true)
    expect(found.some(d => d.rule.includes('ts-nocheck'))).toBe(true)
  })
  test('allows @ts-expect-error in test files, flags in non-test', async () => {
    await write('src/d.test.ts', '// @ts-expect-error testing rejection\nconst bad: string = 1\nexport { bad }\n')
    await write('src/e.ts', '// @ts-expect-error masking\nconst worse: string = 1\nexport { worse }\n')
    const found = await findDangerousSuppressions(dir)
    expect(found.some(d => d.file.endsWith('d.test.ts'))).toBe(false)
    expect(found.some(d => d.file.endsWith('e.ts'))).toBe(true)
  })
  test('ignores safe suppressions', async () => {
    await write('src/f.ts', '/* eslint-disable complexity */\nconst ok = 1\nexport { ok }\n')
    const found = await findDangerousSuppressions(dir)
    expect(found).toHaveLength(0)
  })
})
