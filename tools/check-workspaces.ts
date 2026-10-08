#!/usr/bin/env bun
import { file, Glob, spawn } from 'bun'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { escapeGlobPath, listProjectFiles } from '../packages/lintmax/src/project-files.js'
const root = process.cwd()
const files = await listProjectFiles({ root })
const candidates = new Set(files)
if (!candidates.has('package.json')) process.exit(0)
const isWorkspaceManifest = (value: unknown): value is { workspaces?: string[] } =>
  typeof value === 'object' &&
  value !== null &&
  (!('workspaces' in value) ||
    (Array.isArray(value.workspaces) && value.workspaces.every((entry: unknown) => typeof entry === 'string')))
const pkg: unknown = await file(join(root, 'package.json')).json()
if (!isWorkspaceManifest(pkg)) throw new Error('Invalid package.json workspaces: expected an array of strings')
const workspaces = (
  await Promise.all(
    (pkg.workspaces ?? []).map(async pattern =>
      Array.fromAsync(new Glob(pattern).scan({ cwd: root, dot: true, onlyFiles: false }))
    )
  )
).flat()
const excluded = await Promise.all(
  workspaces.map(async path => {
    const stats = await lstat(join(root, path))
    if (!(stats.isDirectory() || stats.isSymbolicLink())) return []
    const manifest = `${path}/package.json`
    const hasManifest = await file(join(root, manifest)).exists()
    const ignored = hasManifest ? !candidates.has(manifest) : !files.some(entry => entry.startsWith(`${path}/`))
    return ignored ? ['--ignore-package', escapeGlobPath(`./${path}`)] : []
  })
)
const subprocess = spawn({
  cmd: ['sherif', '-i', 'typescript', ...excluded.flat()],
  cwd: root,
  stderr: 'inherit',
  stdout: 'inherit',
  timeout: 60_000
})
process.exitCode = await subprocess.exited
