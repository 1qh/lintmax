#!/usr/bin/env bun
/* eslint-disable no-console */
import { file, Glob, spawn } from 'bun'
import { dirname, join } from 'node:path'
import { listProjectFiles } from '../packages/lintmax/src/project-files.js'
const nameVer = (p: { name: string; version: string }): string => `${p.name}@${p.version}`
interface Pkg {
  name?: string
  private?: boolean
  version?: string
  workspaces?: string[]
}
interface Target {
  dir: string
  name: string
  onNpm: boolean
  published: boolean
  version: string
}
const notFoundRe = /E404|404 Not Found/u
const toVersionList = (parsed: unknown): string[] => {
  if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string')
  if (typeof parsed === 'string') return [parsed]
  return []
}
const readPkg = async (path: string): Promise<Pkg> => {
  const parsed: unknown = await file(path)
    .json()
    .catch(() => ({}))
  return typeof parsed === 'object' && parsed !== null ? parsed : {}
}
const root = process.cwd()
const runCommand = async (
  cmd: string[],
  cwd = root,
  quiet = false
): Promise<{ exitCode: number; stderr: string; stdout: string }> => {
  const subprocess = spawn({ cmd, cwd, stderr: 'pipe', stdout: 'pipe', timeout: 300_000 })
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text()
  ])
  if (!quiet) {
    process.stdout.write(stdout)
    process.stderr.write(stderr)
  }
  return { exitCode, stderr, stdout }
}
const rootPkg = await readPkg(join(root, 'package.json'))
const globs = rootPkg.workspaces ?? ['packages/*']
const workspaceGlobs = globs.map(g => new Glob(`${g}/package.json`))
const files = await listProjectFiles({ root })
const paths = files
  .filter(rel => (rel === 'package.json' && (rootPkg.name ?? '') !== '') || workspaceGlobs.some(g => g.match(rel)))
  .map(rel => join(root, rel))
const pkgs = await Promise.all(
  paths.map(async path => ({
    path,
    pkg: await readPkg(path)
  }))
)
const resolve = async (path: string, pkg: Pkg): Promise<null | Target> => {
  if (!(pkg.name && pkg.version) || pkg.private) return null
  const view = await runCommand(['npm', 'view', pkg.name, 'versions', '--json'], root, true)
  if (view.exitCode !== 0 && !notFoundRe.test(view.stderr))
    throw new Error(`npm view ${pkg.name} failed, so whether it needs publishing is unknown: ${view.stderr.trim()}`)
  const all = toVersionList(view.exitCode === 0 ? JSON.parse(view.stdout.trim() || '[]') : [])
  return {
    dir: dirname(path),
    name: pkg.name,
    onNpm: view.exitCode === 0,
    published: all.includes(pkg.version),
    version: pkg.version
  }
}
const resolved = (await Promise.all(pkgs.map(async ({ path, pkg }) => resolve(path, pkg)))).filter(
  (t): t is Target => t !== null
)
const onNpm = resolved.filter(t => t.onNpm)
if (onNpm.length === 0) {
  console.log('no publishable package on npm (new packages are published manually once, then auto-release takes over)')
  process.exit(0)
}
const toPublish = onNpm.filter(t => !t.published)
if (toPublish.length === 0) {
  console.log(`already published: ${onNpm.map(nameVer).join(', ')}`)
  process.exit(0)
}
const publishOne = async (t: Target): Promise<Target & { ok: boolean }> => {
  const pub = await runCommand(['bun', 'publish', '--access', 'public'], t.dir)
  if (pub.exitCode === 0) return { ...t, ok: true }
  const recheck = await runCommand(['npm', 'view', `${t.name}@${t.version}`, 'version'], root, true)
  return { ...t, ok: recheck.exitCode === 0 && recheck.stdout.trim().length > 0 }
}
const results = await Promise.all(toPublish.map(publishOne))
const failed = results.filter(r => !r.ok)
if (failed.length > 0) {
  console.error(`publish failed: ${failed.map(nameVer).join(', ')}`)
  process.exit(1)
}
const first = results[0]
const tag = `v${first?.version ?? '0.0.0'}`
const tagged = await runCommand(['git', 'tag', tag])
const pushed = tagged.exitCode === 0 ? await runCommand(['git', 'push', 'origin', tag]) : tagged
const released =
  pushed.exitCode === 0 ? await runCommand(['gh', 'release', 'create', tag, '--title', tag, '--generate-notes']) : pushed
if (released.exitCode !== 0) {
  console.error(`published ${results.map(nameVer).join(', ')} but ${tag} did not land: ${released.stderr.trim()}`)
  process.exit(1)
}
const staleTags = async (): Promise<string[]> => {
  const ls = await runCommand(['git', 'ls-remote', '--tags', 'origin'], root, true)
  if (ls.exitCode !== 0)
    throw new Error(`cannot list remote tags, so whether older ones remain is unknown: ${ls.stderr.trim()}`)
  const names = ls.stdout
    .split('\n')
    .map(line => line.split('/').at(-1) ?? '')
    .filter(t => t && t !== tag && !t.endsWith('^{}'))
  return [...new Set(names)]
}
await Promise.all(
  (await staleTags()).map(async t => {
    await runCommand(['gh', 'release', 'delete', t, '--yes', '--cleanup-tag'])
    await runCommand(['git', 'push', 'origin', `:refs/tags/${t}`])
  })
)
const survivors = await staleTags()
if (survivors.length > 0) {
  console.error(`released ${tag} but older tags remain on the remote: ${survivors.join(', ')}`)
  process.exit(1)
}
console.log(`released: ${results.map(nameVer).join(', ')}`)
