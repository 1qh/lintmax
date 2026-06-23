import { file, Glob, write } from 'bun'
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SHARED_IGNORE_PATTERNS } from './constants.js'
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
  test('generates biome.json with experimentalScannerIgnores', async () => {
    await setupProject()
    const biomePath = join(cacheDir, 'biome.json')
    expect(await file(biomePath).exists()).toBe(true)
    const config = (await file(biomePath).json()) as {
      files?: { experimentalScannerIgnores?: string[]; includes?: string[] }
    }
    expect(config.files?.experimentalScannerIgnores).toBeDefined()
    expect(Array.isArray(config.files?.experimentalScannerIgnores)).toBe(true)
  })
  test('experimentalScannerIgnores contains node_modules', async () => {
    const config = (await file(join(cacheDir, 'biome.json')).json()) as {
      files?: { experimentalScannerIgnores?: string[] }
    }
    const scannerIgnores = config.files?.experimentalScannerIgnores ?? []
    expect(scannerIgnores.some(p => p.includes('node_modules'))).toBe(true)
  })
  test('experimentalScannerIgnores contains .next', async () => {
    const config = (await file(join(cacheDir, 'biome.json')).json()) as {
      files?: { experimentalScannerIgnores?: string[] }
    }
    const scannerIgnores = config.files?.experimentalScannerIgnores ?? []
    expect(scannerIgnores.some(p => p.includes('.next'))).toBe(true)
  })
  test('includes has !! negation patterns', async () => {
    const config = (await file(join(cacheDir, 'biome.json')).json()) as {
      files?: { includes?: string[] }
    }
    const includes = config.files?.includes ?? []
    expect(includes.some(p => p.startsWith('!!'))).toBe(true)
  })
  test('no ignore field in files (biome 2.x)', async () => {
    const config = (await file(join(cacheDir, 'biome.json')).json()) as {
      files?: Record<string, unknown>
    }
    expect(config.files).not.toHaveProperty('ignore')
  })
})
describe('Glob-based isIgnored matching', () => {
  const ignoreGlobs = DEFAULT_SHARED_IGNORE_PATTERNS.map(p => new Glob(p))
  const isIgnored = (p: string): boolean => ignoreGlobs.some(g => g.match(p))
  test('matches readonly/ui/src/components/foo.tsx', () => {
    expect(isIgnored('readonly/ui/src/components/foo.tsx')).toBe(true)
  })
  test('matches readonly/ui/src/styles/globals.css', () => {
    expect(isIgnored('readonly/ui/src/styles/globals.css')).toBe(true)
  })
  test('matches .next/server/app/page.js', () => {
    expect(isIgnored('.next/server/app/page.js')).toBe(true)
  })
  test('matches web/stdb/blog/.next/cache/x.js', () => {
    expect(isIgnored('web/stdb/blog/.next/cache/x.js')).toBe(true)
  })
  test('matches dist/index.js', () => {
    expect(isIgnored('dist/index.js')).toBe(true)
  })
  test('matches _generated/api.ts', () => {
    expect(isIgnored('_generated/api.ts')).toBe(true)
  })
  test('matches nested _generated', () => {
    expect(isIgnored('lib/spacetimedb/src/generated/index.ts')).toBe(true)
  })
  test('matches module_bindings', () => {
    expect(isIgnored('backend/spacetimedb/module_bindings/index.ts')).toBe(true)
  })
  test('does NOT match lib/shared/src/constants.ts', () => {
    expect(isIgnored('lib/shared/src/constants.ts')).toBe(false)
  })
  test('does NOT match web/stdb/blog/src/app/page.tsx', () => {
    expect(isIgnored('web/stdb/blog/src/app/page.tsx')).toBe(false)
  })
  test('does NOT match src/index.ts', () => {
    expect(isIgnored('src/index.ts')).toBe(false)
  })
})
