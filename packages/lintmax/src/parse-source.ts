import { parse } from 'oxc-parser'
import { PARSE_DIALECTS } from './constants.js'
type Parsed = Awaited<ReturnType<typeof parse>>
const parseAnyDialect = async ({ label, sourceText }: { label: string; sourceText: string }): Promise<Parsed> => {
  let firstError: string | undefined
  const results = await Promise.all(PARSE_DIALECTS.map(async dialect => parse(dialect, sourceText)))
  for (const parsed of results) {
    const [parseError] = parsed.errors
    if (!parseError) return parsed
    firstError ??= parseError.message
  }
  throw new Error(`${label} cannot parse the source: ${firstError ?? 'unknown parse failure'}`)
}
export { parseAnyDialect }
