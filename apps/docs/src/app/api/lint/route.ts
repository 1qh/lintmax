import { Biome, Distribution } from '@biomejs/js-api'
import { NextResponse } from 'next/server'
const MAX_INPUT_SIZE = 50_000
const RATE_LIMIT = new Map<string, number[]>()
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 10
let biomeInstance: Biome | null = null
const getBiome = async (): Promise<Biome> => {
  if (biomeInstance) return biomeInstance
  const instance = await Biome.create({ distribution: Distribution.NODE })
  instance.applyConfiguration({
    linter: {
      rules: {
        complexity: { useArrowFunction: 'error' },
        recommended: true,
        style: { noVar: 'error', useTemplate: 'error' },
        suspicious: { noExplicitAny: 'error' }
      }
    }
  })
  biomeInstance = instance
  return instance
}
const checkRateLimit = (ip: string): boolean => {
  const now = Date.now()
  const timestamps = RATE_LIMIT.get(ip) ?? []
  const recent = timestamps.filter(t => now - t < RATE_WINDOW_MS)
  if (recent.length >= RATE_MAX) return false
  recent.push(now)
  RATE_LIMIT.set(ip, recent)
  return true
}
export const POST = async (request: Request) => {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!checkRateLimit(ip)) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  let body: { code?: string }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { code } = body
  if (!code || typeof code !== 'string') return NextResponse.json({ error: 'Missing code field' }, { status: 400 })
  if (code.length > MAX_INPUT_SIZE) return NextResponse.json({ error: 'Code too large' }, { status: 400 })
  try {
    const b = await getBiome()
    const lint = b.lintContent(code, { filePath: 'input.ts' })
    const fmt = b.formatContent(code, { filePath: 'input.ts' })
    const byRule = new Map<string, number[]>()
    for (const d of lint.diagnostics) {
      const rule = d.category as string
      const span = d.location.span as undefined | { start: number }
      const line = span ? code.slice(0, span.start).split('\n').length : 0
      const arr = byRule.get(rule) ?? []
      if (line > 0) arr.push(line)
      byRule.set(rule, arr)
    }
    if (fmt.content !== code) byRule.set('format', [])
    const lines: string[] = []
    if (byRule.size > 0) {
      lines.push('input.ts')
      lines.push(' biome')
      for (const [rule, nums] of [...byRule.entries()].toSorted((x, y) => x[0].localeCompare(y[0])))
        lines.push(`  ${nums.length > 0 ? `${nums.join(',')} ` : ''}${rule}`)
    }
    const output = lines.join('\n')
    return NextResponse.json({
      exitCode: output.length > 0 ? 1 : 0,
      output
    })
  } catch (error) {
    return NextResponse.json(
      { error: `Lint failed: ${error instanceof Error ? error.message : 'unknown'}` },
      { status: 500 }
    )
  }
}
