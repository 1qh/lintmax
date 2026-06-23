import { env as bunEnv, file, write } from 'bun'
import { createHash } from 'node:crypto'
import { homedir, platform, tmpdir } from 'node:os'
import { isRecord } from './normalize.js'
import { joinPath } from './path.js'

interface StateShape {
  lastCheck: number
  lastGreenByCwd: Record<string, string>
  versions: Record<string, string>
}
const appDir = 'lintmax'
const fileName = 'state.json'
const userCacheDir = (): string => {
  const home = homedir()
  if (platform() === 'darwin') return joinPath(home, 'Library', 'Caches')
  if (platform() === 'win32') return bunEnv.LOCALAPPDATA ?? joinPath(home, 'AppData', 'Local')
  return bunEnv.XDG_CACHE_HOME ?? joinPath(home, '.cache')
}
const statePath = (): string => {
  const base = userCacheDir()
  if (base.length === 0) return joinPath(tmpdir(), appDir, fileName)
  return joinPath(base, appDir, fileName)
}
const emptyState = (): StateShape => ({ lastCheck: 0, lastGreenByCwd: {}, versions: {} })
const coerceStringMap = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) if (typeof raw === 'string') out[key] = raw
  return out
}
const loadState = async (): Promise<StateShape> => {
  const path = statePath()
  try {
    const handle = file(path)
    if (!(await handle.exists())) return emptyState()
    const parsed: unknown = JSON.parse(await handle.text())
    if (!isRecord(parsed)) return emptyState()
    const lastCheck = typeof parsed.lastCheck === 'number' ? parsed.lastCheck : 0
    return {
      lastCheck,
      lastGreenByCwd: coerceStringMap(parsed.lastGreenByCwd),
      versions: coerceStringMap(parsed.versions)
    }
  } catch {
    return emptyState()
  }
}
const saveState = async (state: StateShape): Promise<void> => {
  const path = statePath()
  try {
    await write(path, `${JSON.stringify(state, null, 2)}\n`)
  } catch {
    process.exitCode ??= 0
  }
}
const hashTree = async ({
  files,
  root,
  version
}: {
  files: readonly string[]
  root: string
  version: string
}): Promise<string> => {
  const hash = createHash('sha256')
  hash.update(`lintmax:${version}\n`)
  const sorted = [...files].toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  const digests = await Promise.all(
    sorted.map(async relativePath => {
      try {
        const digest = createHash('sha256')
        digest.update(await file(joinPath(root, relativePath)).bytes())
        return `${relativePath}:${digest.digest('hex')}\n`
      } catch {
        return `${relativePath}:unreadable\n`
      }
    })
  )
  for (const line of digests) hash.update(line)
  return hash.digest('hex')
}
export type { StateShape }
export { hashTree, loadState, saveState }
