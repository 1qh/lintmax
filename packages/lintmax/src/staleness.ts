import { envValue } from './core.js'
import { isRecord } from './normalize.js'
import { loadState, saveState } from './state.js'

interface StaleIssue {
  ageDays: number
  name: string
}
const httpTimeoutMs = 15_000
const cacheTtlMs = 24 * 60 * 60 * 1000
const sixMonthsMs = 183 * 24 * 60 * 60 * 1000
const trackedPackages: readonly string[] = [
  '@biomejs/biome',
  'eslint',
  'eslint-plugin-perfectionist',
  'oxlint',
  'prettier',
  'sort-package-json',
  'typescript',
  'typescript-eslint'
]
const envSkip = 'LINTMAX_SKIP_STALENESS'
const envForce = 'LINTMAX_STALENESS_FORCE'
const fetchLatestPublish = async (name: string): Promise<null | number> => {
  try {
    const response = await fetch(`https://registry.npmjs.org/${name}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      signal: AbortSignal.timeout(httpTimeoutMs)
    })
    if (!response.ok) return null
    const body: unknown = await response.json()
    if (!isRecord(body)) return null
    const distTags = body['dist-tags']
    const { time } = body
    if (!(isRecord(distTags) && isRecord(time))) return null
    const { latest } = distTags
    if (typeof latest !== 'string') return null
    const published = time[latest]
    if (typeof published !== 'string') return null
    const parsed = Date.parse(published)
    return Number.isNaN(parsed) ? null : parsed
  } catch {
    return null
  }
}
const toIssue = (name: string, publishedAt: null | number): null | StaleIssue => {
  if (publishedAt === null) return null
  const age = Date.now() - publishedAt
  if (age < sixMonthsMs) return null
  return { ageDays: Math.floor(age / (24 * 60 * 60 * 1000)), name }
}
const scanStaleness = async (force = false): Promise<StaleIssue[]> => {
  if (envValue(envSkip) === '1') return []
  const ci = envValue('CI') === 'true' || envValue('CI') === '1'
  const forced = force || ci || envValue(envForce) === '1'
  const state = await loadState()
  if (!forced && state.lastCheck > 0 && Date.now() - state.lastCheck < cacheTtlMs) return []
  const results = await Promise.all(trackedPackages.map(async name => toIssue(name, await fetchLatestPublish(name))))
  await saveState({ ...state, lastCheck: Date.now() })
  return results.filter((issue): issue is StaleIssue => issue !== null)
}
const formatStaleness = (issues: readonly StaleIssue[]): string => {
  if (issues.length === 0) return ''
  const lines = issues.map(issue => `  ${issue.name} latest release ${issue.ageDays}d old (>6mo)`)
  return `lintmax: stale linter deps (advisory):\n${lines.join('\n')}`
}
export type { StaleIssue }
export { formatStaleness, scanStaleness, trackedPackages }
