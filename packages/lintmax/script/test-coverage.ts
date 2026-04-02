import { spawnSync } from 'bun'
import { copyFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
const root = join(import.meta.dir, '..')
const cli = join(root, 'dist/cli.js')
const fixtureTs = join(root, 'readonly/fixtures/fixture-fixable.ts')
const fixtureTsx = join(root, 'readonly/fixtures/fixture-react-a11y.tsx')
const workTs = join(root, 'src/coverage-work.ts')
const workTsx = join(root, 'src/coverage-work.tsx')
const decoder = new TextDecoder()
copyFileSync(fixtureTs, workTs)
copyFileSync(fixtureTsx, workTsx)
const agentResult = spawnSync({
  cmd: ['bun', cli, 'check'],
  cwd: root,
  stderr: 'pipe',
  stdout: 'pipe'
})
const agentOutput = decoder.decode(agentResult.stdout)
const biomeResult = spawnSync({
  cmd: ['bun', 'node_modules/.bin/biome', 'check', '--config-path', 'node_modules/.cache/lintmax', workTs, workTsx],
  cwd: root,
  stderr: 'pipe',
  stdout: 'pipe'
})
const oxlintResult = spawnSync({
  cmd: ['bun', 'node_modules/.bin/oxlint', '-c', 'node_modules/.cache/lintmax/.oxlintrc.json', workTs, workTsx],
  cwd: root,
  stderr: 'pipe',
  stdout: 'pipe'
})
const eslintResult = spawnSync({
  cmd: [
    'bun',
    'node_modules/.bin/eslint',
    '--config',
    'node_modules/.cache/lintmax/eslint.generated.mjs',
    workTs,
    workTsx
  ],
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
unlinkSync(workTs)
unlinkSync(workTsx)
process.stdout.write(`agent output:\n${agentOutput}\n`)
const ruleLines = agentOutput.split('\n').filter(l => l.startsWith('  '))
process.stdout.write(`unique rule violations: ${ruleLines.length}\n`)
if (ruleLines.length < 100) throw new Error(`expected at least 100 rule violations, got ${ruleLines.length}`)
const agentSize = agentOutput.length
const verboseSize = verboseOutput.length
const reduction = verboseSize > 0 ? 1 - agentSize / verboseSize : 0
const pct = Math.round(reduction * 100)
process.stdout.write(`agent output: ${agentSize} chars\n`)
process.stdout.write(`verbose output: ${verboseSize} chars\n`)
process.stdout.write(`reduction: ${pct}%\n`)
if (verboseSize > 0 && agentSize > 0 && reduction <= 0.9) throw new Error(`expected >90% reduction, got ${pct}%`)
process.stdout.write('coverage test passed\n')
