import { spawn } from 'bun'
import { expect, test } from 'bun:test'
import { formatStaleness } from './staleness.js'
const scanFixture = `
import { mock, spyOn } from 'bun:test'
mock.module(${JSON.stringify(new URL('core.js', import.meta.url).href)}, () => ({
  cwd: '',
  envValue: name => name === 'LINTMAX_NO_CACHE' ? '1' : '',
  lintmaxRoot: '',
  readJson: async () => ({ dependencies: { eslint: 'latest', 'eslint-plugin-react-hooks': 'latest' } })
}))
mock.module(${JSON.stringify(new URL('state.js', import.meta.url).href)}, () => ({
  hashTree: async () => '',
  loadState: async () => ({ lastCheck: 0, lastGreenByCwd: {}, staleIssues: [], versions: {} }),
  saveState: async () => undefined
}))
mock.module(${JSON.stringify(new URL('pipeline.js', import.meta.url).href)}, () => ({
  runLint: async () => undefined
}))
mock.module(${JSON.stringify(new URL('project-files.js', import.meta.url).href)}, () => ({
  listProjectFiles: async () => []
}))
const now = 2_000_000_000_000
const published = new Date(now - 200 * 24 * 60 * 60 * 1000).toISOString()
spyOn(Date, 'now').mockReturnValue(now)
spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({
  'dist-tags': { latest: '7.1.1' },
  time: { '7.1.1': published }
}))
`
const runFixture = async (action: string): Promise<{ exitCode: number; stderr: string; stdout: string }> => {
  const subprocess = spawn({
    cmd: [process.execPath, '--eval', `${scanFixture}\n${action}`],
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: 10_000
  })
  const [exitCode, stderr, stdout] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stderr).text(),
    new Response(subprocess.stdout).text()
  ])
  return { exitCode, stderr, stdout }
}
test('staleness output names the gate failure and both ways to clear it', () => {
  const output = formatStaleness([{ ageDays: 200, name: 'eslint' }])
  expect(output).not.toContain('advisory')
  expect(output).toContain('FAILS the gate')
  expect(output).toContain('eslint latest release 200d old (>6mo)')
  expect(output).toContain('bumping the dependency')
  expect(output).toContain('staleExceptions entry with a reason and a revisitWhen trigger')
  expect(formatStaleness([])).toBe('')
})
test('the scan exempts active react hooks upstream while flagging an unlisted stale dependency', async () => {
  const result = await runFixture(`
const { scanStaleness } = await import(${JSON.stringify(new URL('staleness.js', import.meta.url).href)})
process.stdout.write(JSON.stringify(await scanStaleness(true)))
`)
  expect(result.exitCode).toBe(0)
  expect(result.stderr).toBe('')
  expect(result.stdout).toBe(JSON.stringify([{ ageDays: 200, name: 'eslint' }]))
}, 15_000)
test('a cached scan filters excepted dependencies while retaining unlisted stale dependencies', async () => {
  const result = await runFixture(`
mock.module(${JSON.stringify(new URL('state.js', import.meta.url).href)}, () => ({
  loadState: async () => ({
    lastCheck: now - 1000,
    lastGreenByCwd: {},
    staleIssues: [
      { ageDays: 200, name: 'eslint-plugin-react-hooks' },
      { ageDays: 200, name: 'eslint' }
    ],
    versions: {}
  }),
  saveState: async () => { throw new Error('a cache hit must not save state') }
}))
spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('a cache hit must not fetch') })
const { scanStaleness } = await import(${JSON.stringify(new URL('staleness.js', import.meta.url).href)})
process.stdout.write(JSON.stringify(await scanStaleness()))
`)
  expect(result.exitCode).toBe(0)
  expect(result.stderr).toBe('')
  expect(result.stdout).toBe(JSON.stringify([{ ageDays: 200, name: 'eslint' }]))
}, 15_000)
test('a stale dependency fails the gate without printing the ok success line', async () => {
  const result = await runFixture(`
const { runGate } = await import(${JSON.stringify(new URL('gate.js', import.meta.url).href)})
await runGate({ command: 'check', human: false, version: 'test' })
`)
  expect(result.exitCode).toBe(1)
  expect(result.stdout).toBe('')
  expect(result.stderr).toContain('FAILS the gate')
  expect(result.stderr).toContain('eslint latest release 200d old (>6mo)')
}, 15_000)
