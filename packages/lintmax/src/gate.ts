import { $ } from 'bun'
import { bunEnv, cwd, envValue } from './core.js'
import { runLint } from './pipeline.js'
import { formatStaleness, scanStaleness } from './staleness.js'
import { hashTree, loadState, saveState } from './state.js'

const envNoCache = 'LINTMAX_NO_CACHE'
const listTrackedFiles = async (): Promise<null | string[]> => {
  const isWorkTree = await $`git -C ${cwd} rev-parse --is-inside-work-tree`.env(bunEnv).quiet().nothrow()
  if (isWorkTree.exitCode !== 0) return null
  const result = await $`git -C ${cwd} ls-files -z --cached --others --exclude-standard`.env(bunEnv).quiet().nothrow()
  if (result.exitCode !== 0) return null
  return result.stdout
    .toString()
    .split('\0')
    .filter(entry => entry.length > 0)
}
const computeGreenKey = async (version: string): Promise<null | string> => {
  if (envValue(envNoCache) === '1') return null
  const files = await listTrackedFiles()
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
  const startKey = await computeGreenKey(version)
  if (await tryCached(startKey)) return
  const stalePromise = emitStaleness()
  await runLint({ command, human })
  await persistGreen(await computeGreenKey(version))
  await stalePromise
  process.stdout.write('ok\n')
}
export { runGate }
