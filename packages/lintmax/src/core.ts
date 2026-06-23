import { $, env as bunEnv, file } from 'bun'
import { isRecord } from './normalize.js'
import { dirnamePath, fromFileUrl, joinPath } from './path.js'

interface FailureRecord {
  code: number
  label: string
  message?: string
}
interface Pkg {
  [key: string]: unknown
  scripts?: Record<string, string>
}
interface RunOpts {
  args: string[]
  command: string
  env: Record<string, string | undefined>
  label: string
  silent?: boolean
}
interface StepSpec {
  args: string[]
  command?: string
  label: string
  silent?: boolean
}
class CliExitError extends Error {
  public code: number
  public override name = 'CliExitError'
  public constructor({ code, message }: { code: number; message?: string }) {
    super(message ?? '')
    this.code = code
  }
}
const decoder = new TextDecoder()
const cacheDir = 'node_modules/.cache/lintmax'
const cwd = process.cwd()
const lintmaxRoot = dirnamePath(dirnamePath(fromFileUrl(import.meta.url)))
const PRETTIER_MD_ARGS = [
  '--single-quote',
  '--no-semi',
  '--trailing-comma',
  'none',
  '--print-width',
  '80',
  '--arrow-parens',
  'avoid',
  '--tab-width',
  '2',
  '--prose-wrap',
  'preserve'
]
const parseJsonObject = ({ text }: { text: string }): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(text)
  return isRecord(parsed) ? parsed : {}
}
const decodeText = (bytes: Uint8Array | undefined) => decoder.decode(bytes ?? new Uint8Array())
const pathExists = async ({ path }: { path: string }): Promise<boolean> => file(path).exists()
const readJson = async ({ path }: { path: string }): Promise<Record<string, unknown>> => {
  if (!(await pathExists({ path }))) return {}
  try {
    const text = await file(path).text()
    return parseJsonObject({ text })
  } catch {
    return {}
  }
}
const readRequiredJson = async <T>({ path }: { path: string }): Promise<T> => {
  const text = await file(path).text()
  return JSON.parse(text) as T
}
const ensureDirectory = async ({ directory }: { directory: string }): Promise<void> => {
  const result = await $`mkdir -p ${directory}`.quiet().nothrow()
  if (result.exitCode === 0) return
  const stderr = result.stderr.toString().trim()
  throw new CliExitError({
    code: result.exitCode,
    message: stderr.length > 0 ? stderr : `Failed to create directory: ${directory}`
  })
}
const resolvePackageJsonPath = async ({ pkg }: { pkg: string }): Promise<null | string> => {
  try {
    return fromFileUrl(import.meta.resolve(`${pkg}/package.json`))
  } catch {
    const consumerCandidate = joinPath(cwd, 'node_modules', pkg, 'package.json')
    if (await pathExists({ path: consumerCandidate })) return consumerCandidate
    return null
  }
}
const resolveBin = async ({ bin, pkg }: { bin: string; pkg: string }): Promise<string> => {
  const packageJsonPath = await resolvePackageJsonPath({ pkg })
  if (!packageJsonPath)
    throw new CliExitError({
      code: 1,
      message: `Cannot find ${pkg} — run: bun add -d ${pkg}`
    })
  const pkgJson = await readRequiredJson<{ bin?: Record<string, string> | string }>({ path: packageJsonPath })
  const pkgDir = dirnamePath(packageJsonPath)
  const binPath = typeof pkgJson.bin === 'string' ? pkgJson.bin : (pkgJson.bin?.[bin] ?? '')
  return joinPath(pkgDir, binPath)
}
const run = async ({ args, command, env, label, silent = false }: RunOpts): Promise<void> => {
  const base = $`${command} ${args}`.cwd(cwd).env(env).nothrow()
  const result = await (silent ? base.quiet() : base)
  if (result.exitCode === 0) return
  if (silent) {
    process.stderr.write(`[${label}]\n`)
    const stdout = result.stdout.toString()
    if (stdout.length > 0) process.stderr.write(stdout)
    const stderr = result.stderr.toString()
    if (stderr.length > 0) process.stderr.write(stderr)
  }
  throw new CliExitError({ code: result.exitCode })
}
const runCapture = async ({
  args,
  command,
  env
}: RunOpts): Promise<{ exitCode: number; stderr: string; stdout: string }> => {
  const result = await $`${command} ${args}`.cwd(cwd).env(env).quiet().nothrow()
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString()
  }
}
const envValue = (name: string): string => bunEnv[name] ?? ''
const readVersion = async () => {
  const pkg = await readRequiredJson<{ version: string }>({
    path: joinPath(lintmaxRoot, 'package.json')
  })
  return pkg.version
}
const usage = ({ version }: { version: string }) => {
  process.stdout.write(`lintmax v${version}\n\n`)
  process.stdout.write('Usage: lintmax <command>\n\n')
  process.stdout.write('Commands:\n')
  process.stdout.write('  fix       Format, auto-fix, and gate all files (default)\n')
  process.stdout.write('  check     Verify all files without modifying (CI)\n')
  process.stdout.write('  rules     List all enabled rules\n')
  process.stdout.write('  version   Show version\n')
}
export type { FailureRecord, Pkg, RunOpts, StepSpec }
export {
  bunEnv,
  cacheDir,
  CliExitError,
  cwd,
  decodeText,
  ensureDirectory,
  envValue,
  lintmaxRoot,
  pathExists,
  PRETTIER_MD_ARGS,
  readJson,
  readRequiredJson,
  readVersion,
  resolveBin,
  run,
  runCapture,
  usage
}
