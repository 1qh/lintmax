import { NextResponse } from 'next/server'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const MAX_INPUT_SIZE = 50_000
const TIMEOUT_MS = 10_000
const RATE_LIMIT = new Map<string, number[]>()
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 10

const findBin = (name: string): string => {
  const result = spawnSync('which', [name], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  if (result.status === 0) return result.stdout.trim()
  const candidates = [
    join(process.cwd(), 'node_modules', '.bin', name),
    join(process.cwd(), '..', '..', 'node_modules', '.bin', name),
  ]
  for (const c of candidates) {
    const check = spawnSync('test', ['-f', c], { stdio: ['pipe', 'pipe', 'pipe'] })
    if (check.status === 0) return c
  }
  return name
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
  if (!checkRateLimit(ip))
    return NextResponse.json({ error: 'Rate limit exceeded. Max 10 requests per minute.' }, { status: 429 })

  let body: { code?: string }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const code = body.code
  if (!code || typeof code !== 'string')
    return NextResponse.json({ error: 'Missing code field' }, { status: 400 })
  if (code.length > MAX_INPUT_SIZE)
    return NextResponse.json({ error: `Code exceeds ${MAX_INPUT_SIZE} byte limit` }, { status: 400 })

  const dir = join(tmpdir(), `lintmax-api-${randomUUID()}`)
  const filePath = join(dir, 'input.ts')

  try {
    await mkdir(dir, { recursive: true })
    await writeFile(filePath, code)

    const biomeBin = findBin('biome')
    const oxlintBin = findBin('oxlint')

    const lines: string[] = []
    const fileName = 'input.ts'

    const biome = spawnSync(biomeBin, ['check', '--reporter=json', filePath], {
      timeout: TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const biomeOut = biome.stdout?.toString() ?? ''
    try {
      const parsed = JSON.parse(biomeOut) as {
        diagnostics?: { category?: string; location?: { start?: { line?: number } } }[]
      }
      const byRule = new Map<string, number[]>()
      for (const d of parsed.diagnostics ?? []) {
        const rule = d.category
        if (rule) {
          const line = d.location?.start?.line ?? 0
          const arr = byRule.get(rule) ?? []
          if (line > 0) arr.push(line)
          byRule.set(rule, arr)
        }
      }
      if (byRule.size > 0) {
        lines.push(fileName)
        lines.push(' biome')
        for (const [rule, lineNums] of [...byRule.entries()].sort((a, b) => a[0].localeCompare(b[0])))
          lines.push(`  ${lineNums.length > 0 ? lineNums.join(',') + ' ' : ''}${rule}`)
      }
    } catch {}

    const oxlint = spawnSync(oxlintBin, ['-f', 'json', filePath], {
      timeout: TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const oxOut = oxlint.stdout?.toString() ?? ''
    try {
      const parsed = JSON.parse(oxOut) as {
        diagnostics?: { code?: string; labels?: { span?: { line?: number } }[] }[]
      }
      const byRule = new Map<string, number[]>()
      for (const d of parsed.diagnostics ?? []) {
        const rule = d.code
        if (rule) {
          const line = d.labels?.[0]?.span?.line ?? 0
          const arr = byRule.get(rule) ?? []
          if (line > 0) arr.push(line)
          byRule.set(rule, arr)
        }
      }
      if (byRule.size > 0) {
        if (lines.length === 0) lines.push(fileName)
        lines.push(' oxlint')
        for (const [rule, lineNums] of [...byRule.entries()].sort((a, b) => a[0].localeCompare(b[0])))
          lines.push(`  ${lineNums.length > 0 ? lineNums.join(',') + ' ' : ''}${rule}`)
      }
    } catch {}

    const output = lines.join('\n')
    return NextResponse.json({
      exitCode: output.length > 0 ? 1 : 0,
      output,
    })
  } catch {
    return NextResponse.json({ error: 'Lint timed out or failed' }, { status: 504 })
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
