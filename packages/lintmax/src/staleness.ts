import { envValue, lintmaxRoot, readJson } from './core.js'
import { isRecord } from './normalize.js'
import { joinPath } from './path.js'
import { loadState, saveState } from './state.js'

interface StaleIssue {
  ageDays: number
  name: string
}
const httpTimeoutMs = 15_000
const cacheTtlMs = 24 * 60 * 60 * 1000
const sixMonthsMs = 183 * 24 * 60 * 60 * 1000
const envSkip = 'LINTMAX_SKIP_STALENESS'
const envForce = 'LINTMAX_STALENESS_FORCE'
/** Every linter this ships, read from the manifest that declares them. A hand-kept list beside the real one watches whatever it happened to name on the day it was written: it held eight of twenty-four, and the dep pinning the whole fleet to an old eslint major sat outside it, stale for well over a year, unseen. */
const trackedPackages = async (): Promise<string[]> => {
  const pkg = await readJson({ path: joinPath(lintmaxRoot, 'package.json') })
  const deps = pkg.dependencies
  return isRecord(deps) ? Object.keys(deps).toSorted((a, b) => a.localeCompare(b)) : []
}
/** Resolves a package's newest publish time, or throws. The abbreviated packument (`application/vnd.npm.install-v1+json`) carries no `time`, so asking for it and then requiring `time` yielded "unknown" for every package on every run — and "unknown" was being read as "fresh". An unanswerable lookup is reported, never folded into the same value as a healthy one. */
const fetchLatestPublish = async (name: string): Promise<number> => {
  const response = await fetch(`https://registry.npmjs.org/${name}`, {
    signal: AbortSignal.timeout(httpTimeoutMs)
  })
  if (!response.ok) throw new Error(`registry answered ${String(response.status)} for ${name}`)
  const body: unknown = await response.json()
  if (!isRecord(body)) throw new Error(`registry sent no document for ${name}`)
  const distTags = body['dist-tags']
  const { time } = body
  if (!isRecord(distTags)) throw new Error(`no dist-tags for ${name}`)
  if (!isRecord(time)) throw new Error(`no publish times for ${name} — the abbreviated packument omits them`)
  const { latest } = distTags
  if (typeof latest !== 'string') throw new Error(`no latest tag for ${name}`)
  const published = time[latest]
  if (typeof published !== 'string') throw new Error(`no publish time for ${name}@${latest}`)
  const parsed = Date.parse(published)
  if (Number.isNaN(parsed)) throw new Error(`unparsable publish time for ${name}@${latest}: ${published}`)
  return parsed
}
/** Age alone cannot tell a rotting package from a finished one, so a package leaves the gate ONLY with a reason and the trigger that ends the exception — never by being quietly dropped from the tracked set, which reads identically to "fresh" forever. Each entry is re-argued whenever this list is touched: an inherited exception is not a justified one. */
const staleExceptions: Readonly<Record<string, { reason: string; revisitWhen: string }>> = {
  '@types/react-dom': {
    reason:
      'DefinitelyTyped publishes actively (@types/react ships within weeks) and react-dom bundles no types of its own, so this is the only type source and its age means the surface is settled, not abandoned',
    revisitWhen: 'react-dom ships bundled types, or @types/react-dom publishes again'
  },
  'eslint-plugin-react': {
    reason:
      'it is the sole dep still pinning eslint to ^9, and replacing it COSTS coverage: of its 83 active rules oxlint re-owns 49 and @eslint-react/perfectionist re-own 5, 20 are obsolete under the new JSX transform or the propTypes era, 7 belong to the formatter, and 6 have no home anywhere — destructuring-assignment, no-invalid-html-attribute, no-adjacent-inline-elements, plus the class-only no-arrow-function-lifecycle, static-property-placement and require-optimization. Strictness is monotonic-up, so the gate carries a stale dep rather than drop six enforced rules',
    revisitWhen:
      'a maintained plugin covers those 6 ids, or every class component is gone (retiring the 3 class-only ones) and the other 3 are re-homed — then drop this dep and take eslint 10'
  }
}
const toIssue = (name: string, publishedAt: number): null | StaleIssue => {
  if (name in staleExceptions) return null
  const age = Date.now() - publishedAt
  if (age < sixMonthsMs) return null
  return { ageDays: Math.floor(age / (24 * 60 * 60 * 1000)), name }
}
const scanStaleness = async (force = false): Promise<StaleIssue[]> => {
  if (envValue(envSkip) === '1') return []
  const ci = envValue('CI') === 'true' || envValue('CI') === '1'
  const forced = force || ci || envValue(envForce) === '1'
  const state = await loadState()
  if (!forced && state.lastCheck > 0 && Date.now() - state.lastCheck < cacheTtlMs) return state.staleIssues
  const names = await trackedPackages()
  const results = await Promise.all(
    names.map(async name => {
      const publishedAt = await fetchLatestPublish(name)
      return toIssue(name, publishedAt)
    })
  )
  const issues = results.filter((issue): issue is StaleIssue => issue !== null)
  await saveState({ ...state, lastCheck: Date.now(), staleIssues: issues })
  return issues
}
const formatStaleness = (issues: readonly StaleIssue[]): string => {
  if (issues.length === 0) return ''
  const lines = issues.map(issue => `  ${issue.name} latest release ${issue.ageDays}d old (>6mo)`)
  return `lintmax: stale linter deps (advisory):\n${lines.join('\n')}`
}
export type { StaleIssue }
export { formatStaleness, scanStaleness, trackedPackages }
