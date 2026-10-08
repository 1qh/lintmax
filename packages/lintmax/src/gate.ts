import { cwd, envValue } from './core.js'
import { runLint } from './pipeline.js'
import { listProjectFiles } from './project-files.js'
import { formatStaleness, scanStaleness } from './staleness.js'
import { hashTree, loadState, saveState } from './state.js'
const envNoCache = 'LINTMAX_NO_CACHE'
const computeGreenKey = async (version: string): Promise<null | string> => {
  if (envValue(envNoCache) === '1') return null
  const files = await listProjectFiles({ root: cwd })
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
/** A stale dep FAILS the gate: the baseline is clean, so every finding here is a new one, and a warning nobody has to act on is how the check sat broken for its whole life while printing nothing. A dep leaves the gate through `staleExceptions` with its reason and trigger, never by being tolerated in the output. A scan that cannot reach the registry is reported and does NOT fail — an offline developer is never blocked by it, but the silence that once read as clean is gone. */
const emitStaleness = async (): Promise<void> => {
  try {
    const issues = await scanStaleness()
    const formatted = formatStaleness(issues)
    if (formatted.length > 0) {
      process.stderr.write(`${formatted}\n`)
      process.exitCode = 1
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    process.stderr.write(`lintmax: staleness scan could not complete, so dep freshness is UNKNOWN: ${reason}\n`)
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
