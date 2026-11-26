#!/usr/bin/env bun
/** biome-ignore-all lint/performance/noAwaitInLoops: npm calls are serialised to avoid concurrent manifest-write 422s */
/* eslint-disable no-console -- release diagnostics are CLI output */
import { file, sleep, spawn } from 'bun'
import { join } from 'node:path'
interface CommandResult {
  exitCode: number
  stderr: string
  stdout: string
}
const runCommand = async (cmd: string[], cwd = process.cwd()): Promise<CommandResult> => {
  const timeout = 120_000
  try {
    const subprocess = spawn({ cmd, cwd, stderr: 'pipe', stdout: 'pipe', timeout })
    const [exitCode, stderr, stdout] = await Promise.all([
      subprocess.exited,
      new Response(subprocess.stderr).text(),
      new Response(subprocess.stdout).text()
    ])
    const signal = subprocess.signalCode
    const diagnostic = signal ? `\n${cmd.join(' ')} terminated by ${signal} (timeout ${timeout}ms)` : ''
    return { exitCode: signal ? 1 : exitCode, stderr: `${stderr}${diagnostic}`, stdout }
  } catch (error) {
    return { exitCode: 1, stderr: String(error), stdout: '' }
  }
}
const registryVersions = (document: unknown): object => {
  if (typeof document !== 'object' || document === null || !('versions' in document))
    throw new Error('registry document missing versions')
  const { versions } = document
  if (typeof versions !== 'object' || versions === null || Array.isArray(versions))
    throw new Error('registry document versions must be an object')
  return versions
}
const versionsToRetire = (document: unknown, current: string): string[] => {
  const entries: [string, unknown][] = Object.entries(registryVersions(document))
  const selected: string[] = []
  for (const [version, metadata] of entries) {
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))
      throw new Error(`registry document has invalid metadata for ${version}`)
    if (version !== current && !('deprecated' in metadata)) selected.push(version)
  }
  return selected
}
const retireVersions = async (name: string, versions: string[]): Promise<number> => {
  const failures: string[] = []
  for (const version of versions) {
    const spec = `${name}@${version}`
    // eslint-disable-next-line no-await-in-loop -- sequential to avoid concurrent npm manifest-write 422s
    const unpublish = await runCommand(['npm', 'unpublish', spec])
    if (unpublish.exitCode === 0) console.log(`${spec} unpublished`)
    else {
      // eslint-disable-next-line no-await-in-loop -- sequential to avoid concurrent npm manifest-write 422s
      const deprecate = await runCommand(['npm', 'deprecate', spec, 'superseded by latest'])
      if (deprecate.exitCode === 0) console.log(`${spec} deprecated`)
      else failures.push(`${spec} failed:\nunpublish: ${unpublish.stderr.trim()}\ndeprecate: ${deprecate.stderr.trim()}`)
    }
  }
  for (const failure of failures) console.error(failure)
  return failures.length > 0 ? 1 : 0
}
const REGISTRY_WAIT_MS = 600_000
const REGISTRY_POLL_MS = 15_000
const fetchDocument = async (name: string): Promise<unknown> => {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error(`registry request failed: ${response.status} ${response.statusText}`)
  const document: unknown = await response.json()
  return document
}
const documentWithVersion = async (name: string, version: string, deadline: number): Promise<unknown> => {
  const document = await fetchDocument(name)
  if (Object.hasOwn(registryVersions(document), version)) return document
  if (Date.now() > deadline)
    throw new Error(`current version ${version} is still absent from the registry; refusing to retire versions`)
  await sleep(REGISTRY_POLL_MS)
  const next = await documentWithVersion(name, version, deadline)
  return next
}
const pruneFromRegistry = async (name: string, version: string): Promise<number> => {
  try {
    const document = await documentWithVersion(name, version, Date.now() + REGISTRY_WAIT_MS)
    const selected = versionsToRetire(document, version)
    if (selected.length === 0) {
      console.log(`${name}: no versions to retire`)
      return 0
    }
    const code = await retireVersions(name, selected)
    return code
  } catch (error) {
    console.error(`${name}: prune failed: ${String(error)}`)
    return 1
  }
}
const main = async (): Promise<number> => {
  const pkg: unknown = await file(join(process.cwd(), 'package.json')).json()
  if (typeof pkg !== 'object' || pkg === null || !('name' in pkg && 'version' in pkg))
    throw new Error('package.json missing name or version')
  if (typeof pkg.name !== 'string' || pkg.name.length === 0 || typeof pkg.version !== 'string' || pkg.version.length === 0)
    throw new Error('package.json name and version must be non-empty strings')
  const code = await pruneFromRegistry(pkg.name, pkg.version)
  return code
}
if (import.meta.main) process.exitCode = await main()
export { type CommandResult, pruneFromRegistry, runCommand, versionsToRetire }
