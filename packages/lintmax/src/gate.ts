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
const hasReusedGreenCache = async (greenKey: string | undefined): Promise<boolean> => {
  if (greenKey === undefined) return false
  const state = await loadState()
  if (state.lastGreenByCwd[cwd] !== greenKey) return false
  process.stdout.write('ok (cached)\n')
  return true
}
const persistGreen = async (greenKey: string | undefined) => {
  if (greenKey === undefined) return
  const state = await loadState()
  state.lastGreenByCwd[cwd] = greenKey
  await saveState(state)
}
const emitStaleness = async () => {
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
interface GateOptions {
  command: 'check' | 'fix'
  human: boolean
  paths?: string[]
  version: string
}
const finishProjectGate = async (version: string, stalePromise: ReturnType<typeof emitStaleness>) => {
  await persistGreen(await computeGreenKey(version))
  await stalePromise
  if (process.exitCode !== undefined && process.exitCode !== 0) return
  process.stdout.write('ok\n')
}
const runProjectGate = async ({ command, human: isHuman, version }: Omit<GateOptions, 'paths'>) => {
  const startKey = await computeGreenKey(version)
  if (await hasReusedGreenCache(startKey)) return
  const stalePromise = emitStaleness()
  await runLint({ command, human: isHuman })
  await finishProjectGate(version, stalePromise)
}
const runGate = async ({ command, human: isHuman, paths = [], version }: GateOptions) => {
  if (paths.length > 0) {
    await runLint({ command, human: isHuman, paths })
    process.stdout.write('ok\n')
    return
  }
  await runProjectGate({ command, human: isHuman, version })
}
export { runGate }
