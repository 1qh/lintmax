import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectExtraTargets, runExtraCoverage } from './extra-coverage.js'

const emptyPathEnv = async (): Promise<Record<string, string>> => {
  const dir = await mkdtemp(join(tmpdir(), 'lintmax-nopath-'))
  return { PATH: dir }
}
const bins = { dprint: '/nonexistent/dprint', tombi: '/nonexistent/tombi' }
describe('runExtraCoverage shell tooling', () => {
  test('a missing shell tool is reported as a note naming the install path', async () => {
    const env = await emptyPathEnv()
    const result = await runExtraCoverage({ bins, command: 'check', env, gitFiles: ['fake-script.sh'] })
    expect(result.notes.some(n => n.includes('brew install shellcheck shfmt'))).toBe(true)
  })
  test('no shell files means no shell tooling note', async () => {
    const env = await emptyPathEnv()
    const result = await runExtraCoverage({ bins, command: 'check', env, gitFiles: ['src/index.ts'] })
    expect(result.notes).toEqual([])
  })
  test('collectExtraTargets routes shell files by extension', () => {
    const targets = collectExtraTargets(['a.sh', 'b.bash', 'c.ts', 'd.toml', 'Dockerfile'])
    expect(targets.shell).toEqual(['a.sh', 'b.bash'])
  })
})
