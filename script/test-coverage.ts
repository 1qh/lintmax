import { spawnSync } from 'bun'
import { unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const root = join(import.meta.dir, '..')
const cli = join(root, 'dist/cli.js')
const workFile = join(root, 'src/coverage-work.ts')
const DIRTY_FIXTURE = `/* eslint-disable @typescript-eslint/no-unused-vars */
// biome-ignore lint: test fixture
const useAny = (x: any): any => x
const compare = (a: number, b: number) => {
  if (a == b) return true
  if (a != b) return false
  return a === b
}
const shadow = (undefined: string) => undefined
const emptyBlock = (x: number) => {
  if (x > 0) {
  }
}
const noReturn = (x: number) => {
  x + 1
}
const selfCompare = (n: number) => n === n
const typeAssertion = {} as { name: string }
const negatedCondition = (x: boolean) => {
  if (!x) {
    return 'no'
  } else {
    return 'yes'
  }
}
export { useAny, compare, shadow, emptyBlock, noReturn, selfCompare, typeAssertion, negatedCondition }
`
const decoder = new TextDecoder()
writeFileSync(workFile, DIRTY_FIXTURE)
const agentResult = spawnSync({
  cmd: ['bun', cli, 'check'],
  cwd: root,
  stderr: 'pipe',
  stdout: 'pipe'
})
const agentOutput = decoder.decode(agentResult.stdout)
const biomeResult = spawnSync({
  cmd: ['bun', 'node_modules/.bin/biome', 'check', '--config-path', 'node_modules/.cache/lintmax', workFile],
  cwd: root,
  stderr: 'pipe',
  stdout: 'pipe'
})
const oxlintResult = spawnSync({
  cmd: ['bun', 'node_modules/.bin/oxlint', '-c', 'node_modules/.cache/lintmax/.oxlintrc.json', workFile],
  cwd: root,
  stderr: 'pipe',
  stdout: 'pipe'
})
const eslintResult = spawnSync({
  cmd: ['bun', 'node_modules/.bin/eslint', '--config', 'node_modules/.cache/lintmax/eslint.generated.mjs', workFile],
  cwd: root,
  stderr: 'pipe',
  stdout: 'pipe'
})
const verboseOutput = [
  decoder.decode(biomeResult.stdout),
  decoder.decode(biomeResult.stderr),
  decoder.decode(oxlintResult.stdout),
  decoder.decode(oxlintResult.stderr),
  decoder.decode(eslintResult.stdout),
  decoder.decode(eslintResult.stderr)
].join('\n')
unlinkSync(workFile)
const agentSize = agentOutput.length
const verboseSize = verboseOutput.length
const reduction = verboseSize > 0 ? 1 - agentSize / verboseSize : 0
const pct = Math.round(reduction * 100)
process.stdout.write(`agent output: ${agentSize} chars\n`)
process.stdout.write(`verbose output: ${verboseSize} chars\n`)
process.stdout.write(`reduction: ${pct}%\n`)
if (verboseSize > 0 && agentSize > 0 && reduction <= 0.9) throw new Error(`expected >90% reduction, got ${pct}%`)
process.stdout.write('coverage test passed\n')
