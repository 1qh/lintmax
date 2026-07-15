import { parseSync } from 'oxc-parser'
import { PARSE_DIALECTS } from './constants.js'

type Parsed = ReturnType<typeof parseSync>
const parseAnyDialect = ({ label, sourceText }: { label: string; sourceText: string }): Parsed => {
  let firstError: string | undefined
  for (const dialect of PARSE_DIALECTS) {
    // oxlint-disable-next-line node/no-sync
    const parsed = parseSync(dialect, sourceText)
    const [parseError] = parsed.errors
    if (!parseError) return parsed
    firstError ??= parseError.message
  }
  throw new Error(`${label} cannot parse the source: ${firstError ?? 'unknown parse failure'}`)
}
export { parseAnyDialect }
