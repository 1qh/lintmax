import { spawnSync } from 'bun'
import { copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const monorepoRoot = join(root, '..', '..')
const cli = join(root, 'dist/cli.mjs')
const fixtureTs = join(root, 'readonly/fixtures/fixture-fixable.ts')
const fixtureTsx = join(root, 'readonly/fixtures/fixture-react-a11y.tsx')
const workTs = join(root, 'src/coverage-work.ts')
const workTsx = join(root, 'src/coverage-work.tsx')
const cacheDir = join(root, 'node_modules/.cache/lintmax')
const binDir = join(monorepoRoot, 'node_modules/.bin')
const decoder = new TextDecoder()
const cleanup = () => {
  // oxlint-disable-next-line node/no-sync
  rmSync(workTs, { force: true })
  // oxlint-disable-next-line node/no-sync
  rmSync(workTsx, { force: true })
}
try {
  // oxlint-disable-next-line node/no-sync
  copyFileSync(fixtureTs, workTs)
  // oxlint-disable-next-line node/no-sync
  copyFileSync(fixtureTsx, workTsx)
  // oxlint-disable-next-line node/no-sync
  const agentResult = spawnSync({
    cmd: ['bun', cli, 'check'],
    cwd: root,
    stderr: 'pipe',
    stdout: 'pipe'
  })
  const agentOutput = decoder.decode(agentResult.stdout)
  // oxlint-disable-next-line node/no-sync
  const biomeResult = spawnSync({
    cmd: [join(binDir, 'biome'), 'check', '--config-path', cacheDir, workTs, workTsx],
    cwd: root,
    stderr: 'pipe',
    stdout: 'pipe'
  })
  // oxlint-disable-next-line node/no-sync
  const oxlintResult = spawnSync({
    cmd: [join(binDir, 'oxlint'), '-c', join(cacheDir, '.oxlintrc.json'), workTs, workTsx],
    cwd: root,
    stderr: 'pipe',
    stdout: 'pipe'
  })
  // oxlint-disable-next-line node/no-sync
  const eslintResult = spawnSync({
    cmd: [join(binDir, 'eslint'), '--config', join(cacheDir, 'eslint.generated.mjs'), workTs, workTsx],
    cwd: root,
    stderr: 'pipe',
    stdout: 'pipe'
  })
  const ESC = String.fromCodePoint(27)
  const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, 'gu')
  const PATH_RE = /\/[^\s:]+\//gu
  const stripAnsiAndPaths = (s: string) => s.replaceAll(ANSI_RE, '').replaceAll(PATH_RE, '/')
  const verboseRaw = [
    decoder.decode(biomeResult.stdout),
    decoder.decode(biomeResult.stderr),
    decoder.decode(oxlintResult.stdout),
    decoder.decode(oxlintResult.stderr),
    decoder.decode(eslintResult.stdout),
    decoder.decode(eslintResult.stderr)
  ].join('\n')
  const verboseOutput = stripAnsiAndPaths(verboseRaw)
  process.stdout.write(`agent output:\n${agentOutput}\n`)
  const ruleLines = agentOutput.split('\n').filter(l => l.startsWith('  '))
  process.stdout.write(`unique rule violations: ${ruleLines.length}\n`)
  if (ruleLines.length < 50) throw new Error(`expected at least 50 rule violations, got ${ruleLines.length}`)
  const agentSize = agentOutput.length
  const verboseSize = verboseOutput.length
  const reduction = verboseSize > 0 ? 1 - agentSize / verboseSize : 0
  const pct = Math.round(reduction * 100)
  process.stdout.write(`agent output: ${agentSize} chars\n`)
  process.stdout.write(`verbose output (normalized): ${verboseSize} chars\n`)
  process.stdout.write(`reduction: ${pct}%\n`)
  if (verboseSize > 0 && agentSize > 0 && reduction <= 0.85) throw new Error(`expected >85% reduction, got ${pct}%`)
  process.stdout.write('coverage test passed\n')
} finally {
  cleanup()
}
