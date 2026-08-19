import { file, Glob, write } from 'bun'
import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SHARED_IGNORE_PATTERNS } from './constants.js'
import { readRequiredJson } from './core.js'
import { sync } from './index.js'

const tmp = await mkdtemp(join(tmpdir(), 'config-gen-test-'))
const cacheDir = join(tmp, 'node_modules', '.cache', 'lintmax')
afterAll(async () => rm(tmp, { recursive: true }))
const setupProject = async () => {
  await write(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
  const origCwd = process.cwd()
  process.chdir(tmp)
  try {
    await sync()
  } finally {
    process.chdir(origCwd)
  }
}
describe('biome config generation', () => {
  it('generates biome.json with experimentalScannerIgnores', async () => {
    await setupProject()
    const biomePath = join(cacheDir, 'biome.json')
    expect(await file(biomePath).exists()).toBe(true)
    const config = readRequiredJson<{
      files?: { experimentalScannerIgnores?: string[]; includes?: string[] }
    }>(await file(biomePath).text())
    expect(config.files?.experimentalScannerIgnores).toBeDefined()
    expect(Array.isArray(config.files?.experimentalScannerIgnores)).toBe(true)
  })
  it('experimentalScannerIgnores contains node_modules', async () => {
    const config = readRequiredJson<{ files?: { experimentalScannerIgnores?: string[] } }>(
      await file(join(cacheDir, 'biome.json')).text()
    )
    const scannerIgnores = config.files?.experimentalScannerIgnores ?? []
    expect(scannerIgnores.some(p => p.includes('node_modules'))).toBe(true)
  })
  it('experimentalScannerIgnores contains .next', async () => {
    const config = readRequiredJson<{ files?: { experimentalScannerIgnores?: string[] } }>(
      await file(join(cacheDir, 'biome.json')).text()
    )
    const scannerIgnores = config.files?.experimentalScannerIgnores ?? []
    expect(scannerIgnores.some(p => p.includes('.next'))).toBe(true)
  })
  it('includes has !! negation patterns', async () => {
    const config = readRequiredJson<{ files?: { includes?: string[] } }>(await file(join(cacheDir, 'biome.json')).text())
    const includes = config.files?.includes ?? []
    expect(includes.some(p => p.startsWith('!!'))).toBe(true)
  })
  it('no ignore field in files (biome 2.x)', async () => {
    const config = readRequiredJson<{ files?: Record<string, unknown> }>(await file(join(cacheDir, 'biome.json')).text())
    expect(config.files).not.toHaveProperty('ignore')
  })
})
describe('Glob-based isIgnored matching', () => {
  const ignoreGlobs = DEFAULT_SHARED_IGNORE_PATTERNS.map(p => new Glob(p))
  const isIgnored = (p: string): boolean => ignoreGlobs.some(g => g.match(p))
  it('matches readonly/ui/src/components/foo.tsx', () => {
    expect(isIgnored('readonly/ui/src/components/foo.tsx')).toBe(true)
  })
  it('matches readonly/ui/src/styles/globals.css', () => {
    expect(isIgnored('readonly/ui/src/styles/globals.css')).toBe(true)
  })
  it('matches .next/server/app/page.js', () => {
    expect(isIgnored('.next/server/app/page.js')).toBe(true)
  })
  it('matches web/stdb/blog/.next/cache/x.js', () => {
    expect(isIgnored('web/stdb/blog/.next/cache/x.js')).toBe(true)
  })
  it('matches dist/index.js', () => {
    expect(isIgnored('dist/index.js')).toBe(true)
  })
  it('matches _generated/api.ts', () => {
    expect(isIgnored('_generated/api.ts')).toBe(true)
  })
  it('matches nested _generated', () => {
    expect(isIgnored('lib/spacetimedb/src/generated/index.ts')).toBe(true)
  })
  it('matches module_bindings', () => {
    expect(isIgnored('backend/spacetimedb/module_bindings/index.ts')).toBe(true)
  })
  it('does NOT match lib/shared/src/constants.ts', () => {
    expect(isIgnored('lib/shared/src/constants.ts')).toBe(false)
  })
  it('does NOT match web/stdb/blog/src/app/page.tsx', () => {
    expect(isIgnored('web/stdb/blog/src/app/page.tsx')).toBe(false)
  })
  it('does NOT match src/index.ts', () => {
    expect(isIgnored('src/index.ts')).toBe(false)
  })
})
