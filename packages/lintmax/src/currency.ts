import { file, write } from 'bun'
import type { Pkg } from './core.js'
import { cwd, ignoreEntries, pathExists, readRequiredJson, writeJson } from './core.js'
import { joinPath } from './path.js'

const CONSUMER_CI_WORKFLOW = `name: lintmax
on:
  push:
  pull_request:
jobs:
  lintmax:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bunx lintmax check
`
const isLintmaxRepo = async (pkg: Pkg): Promise<boolean> => {
  if (pkg.name === 'lintmax') return true
  const ownPackagePath = joinPath(cwd, 'packages', 'lintmax', 'package.json')
  if (!(await pathExists({ path: ownPackagePath }))) return false
  try {
    const own = await readRequiredJson<Pkg>({ path: ownPackagePath })
    return own.name === 'lintmax'
  } catch {
    return false
  }
}
const ensureScripts = async ({ pkg, pkgPath }: { pkg: Pkg; pkgPath: string }): Promise<boolean> => {
  const scripts = pkg.scripts ?? {}
  let changed = false
  if (scripts.fix !== 'lintmax fix') {
    scripts.fix = 'lintmax fix'
    changed = true
  }
  if (scripts.check !== 'lintmax check') {
    scripts.check = 'lintmax check'
    changed = true
  }
  if (!changed) return false
  pkg.scripts = scripts
  await writeJson({ data: pkg, path: pkgPath })
  return true
}
const ensureTsconfig = async (): Promise<void> => {
  const tsconfigPath = joinPath(cwd, 'tsconfig.json')
  const hasConfig = await pathExists({ path: joinPath(cwd, 'lintmax.config.ts') })
  const include = hasConfig ? ['lintmax.config.ts'] : []
  if (!(await pathExists({ path: tsconfigPath }))) {
    const tsconfig: Record<string, unknown> = { extends: 'lintmax/tsconfig' }
    if (include.length > 0) tsconfig.include = include
    await writeJson({ data: tsconfig, path: tsconfigPath })
    return
  }
  try {
    const tsconfig = await readRequiredJson<{ [key: string]: unknown; extends?: string; include?: string[] }>({
      path: tsconfigPath
    })
    let changed = false
    if (tsconfig.extends !== 'lintmax/tsconfig') {
      tsconfig.extends = 'lintmax/tsconfig'
      changed = true
    }
    const toAdd = include.filter(entry => !(tsconfig.include ?? []).includes(entry))
    if (toAdd.length > 0) {
      tsconfig.include = [...(tsconfig.include ?? []), ...toAdd]
      changed = true
    }
    if (changed) await writeJson({ data: tsconfig, path: tsconfigPath })
  } catch {
    process.exitCode ??= 0
  }
}
const ensureGitignore = async (): Promise<void> => {
  const gitignorePath = joinPath(cwd, '.gitignore')
  if (await pathExists({ path: gitignorePath })) {
    const content = await file(gitignorePath).text()
    const toAdd = ignoreEntries.filter(entry => !content.includes(entry))
    if (toAdd.length > 0) await write(gitignorePath, `${content.trimEnd()}\n${toAdd.join('\n')}\n`)
    return
  }
  await write(gitignorePath, `${ignoreEntries.join('\n')}\n`)
}
const ensureWorkflowCurrency = async (): Promise<void> => {
  const workflowDir = joinPath(cwd, '.github', 'workflows')
  if (!(await pathExists({ path: workflowDir }))) return
  const target = joinPath(workflowDir, 'lintmax.yml')
  if (await pathExists({ path: target })) {
    const current = await file(target).text()
    if (current === CONSUMER_CI_WORKFLOW) return
  }
  await write(target, CONSUMER_CI_WORKFLOW)
}
const ensureProjectCurrency = async (): Promise<void> => {
  const pkgPath = joinPath(cwd, 'package.json')
  if (!(await pathExists({ path: pkgPath }))) return
  let pkg: Pkg
  try {
    pkg = await readRequiredJson<Pkg>({ path: pkgPath })
  } catch {
    return
  }
  if (await isLintmaxRepo(pkg)) return
  await ensureScripts({ pkg, pkgPath })
  await ensureTsconfig()
  await ensureGitignore()
  await ensureWorkflowCurrency()
}
export { ensureProjectCurrency }
