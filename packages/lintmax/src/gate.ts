import { spawnSync } from 'bun'
import { bunEnv, cwd, envValue } from './core.js'
import { ensureProjectCurrency } from './currency.js'
import { runLint } from './pipeline.js'
import { formatStaleness, scanStaleness } from './staleness.js'
import { hashTree, loadState, saveState } from './state.js'

const envNoCache = 'LINTMAX_NO_CACHE'
const listTrackedFiles = (): null | string[] => {
  const isWorkTree = spawnSync({
    cmd: ['git', '-C', cwd, 'rev-parse', '--is-inside-work-tree'],
    env: bunEnv,
    stderr: 'pipe',
    stdout: 'pipe'
  })
  if (isWorkTree.exitCode !== 0) return null
  const result = spawnSync({
    cmd: ['git', '-C', cwd, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    env: bunEnv,
    stderr: 'pipe',
    stdout: 'pipe'
  })
  if (result.exitCode !== 0) return null
  return new TextDecoder()
    .decode(result.stdout)
    .split('\0')
    .filter(entry => entry.length > 0)
}
const computeGreenKey = (version: string): null | string => {
  if (envValue(envNoCache) === '1') return null
  const files = listTrackedFiles()
  if (files === null) return null
  return hashTree({ files, root: cwd, version })
}
const tryCached = async (greenKey: null | string): Promise<boolean> => {
  if (greenKey === null) return false
  const state = await loadState()
  if (state.lastGreenByCwd[cwd] !== greenKey) return false
  process.stdout.write('ok (cached)\n')
  return true
}
const persistGreen = async (greenKey: null | string): Promise<void> => {
  if (greenKey === null) return
  const state = await loadState()
  state.lastGreenByCwd[cwd] = greenKey
  await saveState(state)
}
const emitStaleness = async (): Promise<void> => {
  try {
    const issues = await scanStaleness()
    const formatted = formatStaleness(issues)
    if (formatted.length > 0) process.stderr.write(`${formatted}\n`)
  } catch {
    process.exitCode ??= 0
  }
}
const runGate = async ({ command, human, version }: { command: 'check' | 'fix'; human: boolean; version: string }) => {
  const startKey = computeGreenKey(version)
  if (await tryCached(startKey)) return
  if (command === 'fix') await ensureProjectCurrency()
  const stalePromise = emitStaleness()
  await runLint({ command, human })
  await persistGreen(computeGreenKey(version))
  await stalePromise
  process.stdout.write('ok\n')
}
export { runGate }
