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
const trackedPackages = async (): Promise<string[]> => {
  const pkg = await readJson({ path: joinPath(lintmaxRoot, 'package.json') })
  const deps = pkg.dependencies
  return isRecord(deps) ? Object.keys(deps).toSorted((a, b) => a.localeCompare(b)) : []
}
const readLatestTag = (distTags: Record<string, unknown>, name: string): string => {
  const { latest } = distTags
  if (typeof latest !== 'string') throw new TypeError(`no latest tag for ${name}`)
  return latest
}
const readPublishTime = (time: Record<string, unknown>, latest: string, name: string): string => {
  const published = time[latest]
  if (typeof published !== 'string') throw new TypeError(`no publish time for ${name}@${latest}`)
  return published
}
const readPublishTables = (body: unknown, name: string) => {
  if (!isRecord(body)) throw new Error(`registry sent no document for ${name}`)
  const distTags = body['dist-tags']
  const { time } = body
  if (!isRecord(distTags)) throw new Error(`no dist-tags for ${name}`)
  if (!isRecord(time)) throw new Error(`no publish times for ${name} — the abbreviated packument omits them`)
  return { distTags, time }
}
const readPublishMetadata = (body: unknown, name: string): { latest: string; published: string } => {
  const { distTags, time } = readPublishTables(body, name)
  const latest = readLatestTag(distTags, name)
  const published = readPublishTime(time, latest, name)
  return { latest, published }
}
const fetchLatestPublish = async (name: string): Promise<number> => {
  const response = await fetch(`https://registry.npmjs.org/${name}`, {
    signal: AbortSignal.timeout(httpTimeoutMs)
  })
  if (!response.ok) throw new Error(`registry answered ${String(response.status)} for ${name}`)
  const body: unknown = await response.json()
  const { latest, published } = readPublishMetadata(body, name)
  const parsed = Date.parse(published)
  if (Number.isNaN(parsed)) throw new TypeError(`unparsable publish time for ${name}@${latest}: ${published}`)
  return parsed
}
const staleExceptions: Readonly<Record<string, { reason: string; revisitWhen: string }>> = {
  '@eslint/js': {
    reason:
      'it is the eslint monorepo own co-published config package, republished only when its recommended/all rule map changes; eslint core ships actively (10.8.x within days) while @eslint/js sits at 10.0.1 because that rule map is settled under eslint 10 — the age means finished, not abandoned',
    revisitWhen: 'eslint core is dropped from the gate, or @eslint/js publishes a version past 10.0.1'
  },
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
  },
  'eslint-plugin-react-hooks': {
    reason:
      'its source in facebook/react under packages/eslint-plugin-react-hooks received commits on 2026-10-14 and its npm record changed on 2026-10-15 through prerelease publishes; stable latest 7.1.1 is older than 6 months because stable releases follow React own release cadence — the age means a slow stable cadence, not abandonment',
    revisitWhen:
      'a stable eslint-plugin-react-hooks past 7.1.1 is published, or packages/eslint-plugin-react-hooks in facebook/react stops receiving commits for 6 months'
  }
}
const toIssue = (name: string, publishedAt: number): StaleIssue | undefined => {
  if (name in staleExceptions) return
  const age = Date.now() - publishedAt
  if (age < sixMonthsMs) return
  return { ageDays: Math.floor(age / (24 * 60 * 60 * 1000)), name }
}
const scanStaleness = async (force = false): Promise<StaleIssue[]> => {
  if (envValue(envSkip) === '1') return []
  const ci = envValue('CI') === 'true' || envValue('CI') === '1'
  const forced = force || ci || envValue(envForce) === '1'
  const state = await loadState()
  if (!forced && state.lastCheck > 0 && Date.now() - state.lastCheck < cacheTtlMs)
    return state.staleIssues.filter(issue => !Object.hasOwn(staleExceptions, issue.name))
  const names = await trackedPackages()
  const results = await Promise.all(
    names.map(async name => {
      const publishedAt = await fetchLatestPublish(name)
      return toIssue(name, publishedAt)
    })
  )
  const issues = results.filter((issue): issue is StaleIssue => issue !== undefined)
  await saveState({ ...state, lastCheck: Date.now(), staleIssues: issues })
  return issues
}
const formatStaleness = (issues: readonly StaleIssue[]): string => {
  if (issues.length === 0) return ''
  const lines = issues.map(issue => `  ${issue.name} latest release ${issue.ageDays}d old (>6mo)`)
  return `lintmax: stale linter deps — FAILS the gate:\n${lines.join('\n')}\nClear by bumping the dependency, or adding a staleExceptions entry with a reason and a revisitWhen trigger.`
}
export { formatStaleness, scanStaleness, type StaleIssue, trackedPackages }
