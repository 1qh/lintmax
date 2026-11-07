import { cwd, envValue } from './core.js'
import { runLint } from './pipeline.js'
import { listProjectFiles } from './project-files.js'
import { formatStaleness, scanStaleness } from './staleness.js'
import { hashTree, loadState, saveState } from './state.js'
const envNoCache = 'LINTMAX_NO_CACHE'
const computeGreenKey = async (version: string): Promise<string | undefined> => {
  if (envValue(envNoCache) === '1') return
  const files = await listProjectFiles({ root: cwd })
  return hashTree({ files, root: cwd, version })
}
const tryCached = async (greenKey: string | undefined): Promise<boolean> => {
  if (greenKey === undefined) return false
  const state = await loadState()
  if (state.lastGreenByCwd[cwd] !== greenKey) return false
  process.stdout.write('ok (cached)\n')
  return true
}
const persistGreen = async (greenKey: string | undefined): Promise<void> => {
  if (greenKey === undefined) return
  const state = await loadState()
  state.lastGreenByCwd[cwd] = greenKey
  await saveState(state)
}
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
  if (process.exitCode !== undefined && process.exitCode !== 0) return
  process.stdout.write('ok\n')
}
export { runGate }
