/** biome-ignore-all lint/suspicious/useAwait: async test fns */
import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sync } from './index.js'
const tmp = mkdtempSync(join(tmpdir(), 'config-gen-test-'))
const cacheDir = join(tmp, 'node_modules', '.cache', 'lintmax')
afterAll(() => rmSync(tmp, { recursive: true }))
const setupAndSync = async () => {
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
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
    await setupAndSync()
    const biomePath = join(cacheDir, 'biome.json')
    expect(existsSync(biomePath)).toBe(true)
    const config = JSON.parse(readFileSync(biomePath, 'utf8')) as {
      files?: { experimentalScannerIgnores?: string[]; includes?: string[] }
    }
    expect(config.files?.experimentalScannerIgnores).toBeDefined()
    expect(Array.isArray(config.files?.experimentalScannerIgnores)).toBe(true)
  })
  test('experimentalScannerIgnores contains node_modules', async () => {
    const config = JSON.parse(readFileSync(join(cacheDir, 'biome.json'), 'utf8')) as {
      files?: { experimentalScannerIgnores?: string[] }
    }
    const scannerIgnores = config.files?.experimentalScannerIgnores ?? []
    expect(scannerIgnores.some(p => p.includes('node_modules'))).toBe(true)
  })
  test('experimentalScannerIgnores contains .next', async () => {
    const config = JSON.parse(readFileSync(join(cacheDir, 'biome.json'), 'utf8')) as {
      files?: { experimentalScannerIgnores?: string[] }
    }
    const scannerIgnores = config.files?.experimentalScannerIgnores ?? []
    expect(scannerIgnores.some(p => p.includes('.next'))).toBe(true)
  })
  test('includes has !! negation patterns', async () => {
    const config = JSON.parse(readFileSync(join(cacheDir, 'biome.json'), 'utf8')) as {
      files?: { includes?: string[] }
    }
    const includes = config.files?.includes ?? []
    expect(includes.some(p => p.startsWith('!!'))).toBe(true)
  })
  test('no ignore field in files (biome 2.x)', async () => {
    const config = JSON.parse(readFileSync(join(cacheDir, 'biome.json'), 'utf8')) as {
      files?: Record<string, unknown>
    }
    expect(config.files).not.toHaveProperty('ignore')
  })
})
