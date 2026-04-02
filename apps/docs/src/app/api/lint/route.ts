import { NextResponse } from 'next/server'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const MAX_INPUT_SIZE = 50_000
const TIMEOUT_MS = 10_000
const RATE_LIMIT = new Map<string, number[]>()
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 10

const findBinary = (name: string): string | null => {
  const searchDirs = [
    process.cwd(),
    resolve(process.cwd(), '..'),
    resolve(process.cwd(), '../..'),
    '/var/task',
    '/var/task/apps/docs',
  ]
  for (const base of searchDirs) {
    const binPath = join(base, 'node_modules', '.bin', name)
    if (existsSync(binPath)) return binPath
  }
  try {
    const result = execFileSync('find', ['/var/task', '-name', name, '-path', '*/node_modules/.bin/*', '-maxdepth', '5'], {
      encoding: 'utf8',
      timeout: 3000,
    })
    const found = result.trim().split('\n')[0]
    if (found && existsSync(found)) return found
  } catch {}
  return null
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
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })

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
    return NextResponse.json({ error: 'Code too large' }, { status: 400 })

  const dir = join(tmpdir(), `lint-${randomUUID()}`)
  const filePath = join(dir, 'input.ts')

  try {
    await mkdir(dir, { recursive: true })
    await writeFile(filePath, code)

    const biomeBin = findBinary('biome')
    const oxlintBin = findBinary('oxlint')
    const lines: string[] = []
    const fileName = 'input.ts'

    if (biomeBin) {
      try {
        execFileSync(biomeBin, ['check', '--reporter=json', filePath], { timeout: TIMEOUT_MS })
      } catch (e: unknown) {
        const err = e as { stdout?: Buffer }
        const stdout = err.stdout?.toString() ?? ''
        try {
          const parsed = JSON.parse(stdout) as {
            diagnostics?: { category?: string; location?: { start?: { line?: number } } }[]
          }
          const byRule = new Map<string, number[]>()
          for (const d of parsed.diagnostics ?? []) {
            if (d.category) {
              const line = d.location?.start?.line ?? 0
              const arr = byRule.get(d.category) ?? []
              if (line > 0) arr.push(line)
              byRule.set(d.category, arr)
            }
          }
          if (byRule.size > 0) {
            lines.push(fileName)
            lines.push(' biome')
            for (const [rule, nums] of [...byRule.entries()].sort((a, b) => a[0].localeCompare(b[0])))
              lines.push(`  ${nums.length > 0 ? nums.join(',') + ' ' : ''}${rule}`)
          }
        } catch {}
      }
    }

    if (oxlintBin) {
      try {
        execFileSync(oxlintBin, ['-f', 'json', filePath], { timeout: TIMEOUT_MS })
      } catch (e: unknown) {
        const err = e as { stdout?: Buffer }
        const stdout = err.stdout?.toString() ?? ''
        try {
          const parsed = JSON.parse(stdout) as {
            diagnostics?: { code?: string; labels?: { span?: { line?: number } }[] }[]
          }
          const byRule = new Map<string, number[]>()
          for (const d of parsed.diagnostics ?? []) {
            if (d.code) {
              const line = d.labels?.[0]?.span?.line ?? 0
              const arr = byRule.get(d.code) ?? []
              if (line > 0) arr.push(line)
              byRule.set(d.code, arr)
            }
          }
          if (byRule.size > 0) {
            if (lines.length === 0) lines.push(fileName)
            lines.push(' oxlint')
            for (const [rule, nums] of [...byRule.entries()].sort((a, b) => a[0].localeCompare(b[0])))
              lines.push(`  ${nums.length > 0 ? nums.join(',') + ' ' : ''}${rule}`)
          }
        } catch {}
      }
    }

    let varTaskLs = ''
    try {
      varTaskLs = readdirSync('/var/task').join(', ')
    } catch {}

    const output = lines.join('\n')
    return NextResponse.json({
      exitCode: output.length > 0 ? 1 : 0,
      output: output || (biomeBin || oxlintBin ? '' : `Linter binaries not available. cwd=${process.cwd()} /var/task=[${varTaskLs}]`),
    })
  } catch {
    return NextResponse.json({ error: 'Lint failed' }, { status: 500 })
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
