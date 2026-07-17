import { $, file, write } from 'bun'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

const OK_LINE_RE = /^ok(?: \(cached\))?$/v
const root = join(import.meta.dir, '..')
const workFile = join(root, 'src/magic-work.ts')
const cli = join(root, 'dist/cli.mjs')
const DIRTY_FIXTURE = `// Helper function to add two numbers
import { join } from "path";
/* This formats a greeting */
const greet = function(name: string) {
  // Build the message using concatenation
  const message = "Hello, " + name + "!"
  // Return the result
  return message
}
// Process data from file
const processData = function(filePath: string) {
  // Normalize the path
  const data = filePath.trim()
  return data
}
// Check if path is non-empty
const checkExists = function(p: string) {
  // Inspect the length
  const result = p.length > 0
  return result
}
// Build a full path
const buildPath = function(dir: string, file: string) {
  // Join the parts
  return join(dir, file)
}
/*
 * Constants for the application
 * These are used throughout the codebase
 */
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT = 5000;
const API_BASE = "https://api.example.com";
// Utility to double a number
const double = function(n: number) {
  return n * 2
}
// Check if number is positive
const isPositive = function(n: number) {
  const positive = n > 0
  return positive
}
// Get absolute value
const abs = function(n: number) {
  return n < 0 ? -n : n
}
// Unused type
type StringOrNumber = string | number
// Export all the functions and constants
export { greet, processData, checkExists, buildPath, MAX_RETRIES, DEFAULT_TIMEOUT, API_BASE, double, isPositive, abs }
export type { StringOrNumber }
`
const run = async (args: string[]) => $`bun ${cli} ${args}`.cwd(root).quiet().nothrow()
const decoder = new TextDecoder()
const assert = (condition: boolean, msg: string) => {
  if (!condition) throw new Error(`FAIL: ${msg}`)
}
await write(workFile, DIRTY_FIXTURE)
const checkResult = await run(['check'])
assert(checkResult.exitCode !== 0, 'check should fail on dirty fixture')
const checkStdout = decoder.decode(checkResult.stdout)
assert(checkStdout.includes('comments'), 'check output should mention comments linter')
assert(checkStdout.includes('deletable'), 'check output should mention deletable rule')
process.stdout.write(`check output:\n${checkStdout}\n`)
const fixResult = await run(['fix'])
const fixStdout = decoder.decode(fixResult.stdout)
assert(
  fixResult.exitCode === 0,
  `fix should exit 0, got ${fixResult.exitCode}\n${fixStdout}\n${decoder.decode(fixResult.stderr)}`
)
assert(OK_LINE_RE.test(fixStdout.trim()), `fix should emit only ok, got: ${fixStdout.trim()}`)
const recheckResult = await run(['check'])
const recheckStdout = decoder.decode(recheckResult.stdout)
assert(
  recheckResult.exitCode === 0,
  `recheck should exit 0, got ${recheckResult.exitCode}\n${recheckStdout}\n${decoder.decode(recheckResult.stderr)}`
)
assert(OK_LINE_RE.test(recheckStdout.trim()), `recheck should emit only ok, got: ${recheckStdout.trim()}`)
const fixed = await file(workFile).text()
const lines = fixed.split('\n')
for (const line of lines) {
  const trimmed = line.trim()
  if (trimmed.startsWith('//') || trimmed.startsWith('/*'))
    assert(
      trimmed.startsWith('/**') || /eslint-disable|biome-ignore|@ts-/v.test(trimmed),
      `unexpected comment in fixed file: ${trimmed}`
    )
}
await unlink(workFile)
process.stdout.write('magic test passed\n')
