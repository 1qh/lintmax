import { spawnSync } from 'bun'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const root = join(import.meta.dir, '..')
const workFile = join(root, 'src/magic-work.ts')
const cli = join(root, 'dist/cli.js')
const DIRTY_FIXTURE = `// Helper function to add two numbers
const add = (a: number, b: number) => {
  // Return the sum
  return a + b;
}
/* This formats a greeting */
const greet = (name: string) => {
  // Build the message
  const message = "Hello, " + name + "!"
  // Return the result
  return message
}
// Constants for the app
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT = 5000;
// Export everything
export { add, greet, MAX_RETRIES, DEFAULT_TIMEOUT }
`
const run = (args: string[]) =>
  spawnSync({
    cmd: ['bun', cli, ...args],
    cwd: root,
    stderr: 'pipe',
    stdout: 'pipe'
  })
const decoder = new TextDecoder()
const assert = (condition: boolean, msg: string) => {
  if (!condition) throw new Error(`FAIL: ${msg}`)
}
writeFileSync(workFile, DIRTY_FIXTURE)
const checkResult = run(['check'])
assert(checkResult.exitCode !== 0, 'check should fail on dirty fixture')
const checkStdout = decoder.decode(checkResult.stdout)
assert(checkStdout.includes('comments'), 'check output should mention comments linter')
assert(checkStdout.includes('deletable'), 'check output should mention deletable rule')
process.stdout.write(`check output:\n${checkStdout}\n`)
const fixResult = run(['fix'])
const fixStdout = decoder.decode(fixResult.stdout)
assert(fixResult.exitCode === 0, `fix should exit 0, got ${fixResult.exitCode}\n${decoder.decode(fixResult.stderr)}`)
assert(fixStdout.trim() === '', 'fix should be silent')
const recheckResult = run(['check'])
const recheckStdout = decoder.decode(recheckResult.stdout)
assert(
  recheckResult.exitCode === 0,
  `recheck should exit 0, got ${recheckResult.exitCode}\n${recheckStdout}\n${decoder.decode(recheckResult.stderr)}`
)
assert(recheckStdout.trim() === '', 'recheck should be silent')
const fixed = readFileSync(workFile, 'utf8')
const lines = fixed.split('\n')
for (const line of lines) {
  const trimmed = line.trim()
  if (trimmed.startsWith('//') || trimmed.startsWith('/*'))
    assert(
      trimmed.startsWith('/**') || /eslint-disable|biome-ignore|@ts-/u.test(trimmed),
      `unexpected comment in fixed file: ${trimmed}`
    )
}
unlinkSync(workFile)
process.stdout.write('magic test passed\n')
