import { spawnSync } from 'bun'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const root = join(import.meta.dir, '..')
const workFile = join(root, 'src/magic-work.ts')
const cli = join(root, 'dist/cli.mjs')
const DIRTY_FIXTURE = `// Helper function to add two numbers
import { readFileSync, existsSync } from "fs";
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
  // Read the file
  const data = readFileSync(filePath, "utf-8")
  return data
}
// Check if path exists
const checkExists = function(p: string) {
  // Use existsSync
  const result = existsSync(p)
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
  if (n > 0) {
    return true
  } else {
    return false
  }
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
assert(
  fixResult.exitCode === 0,
  `fix should exit 0, got ${fixResult.exitCode}\n${fixStdout}\n${decoder.decode(fixResult.stderr)}`
)
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
