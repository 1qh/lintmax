import { env as bunEnv, Glob, spawn } from 'bun'
import { lstat, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { DEFAULT_SHARED_IGNORE_PATTERNS } from './constants.js'
import { CliExitError } from './core.js'
const fixedIgnoreGlobs = ['**/node_modules/**', ...DEFAULT_SHARED_IGNORE_PATTERNS].map(pattern => new Glob(pattern))
const isIncludedProjectFile = (path: string): boolean => !fixedIgnoreGlobs.some(glob => glob.match(path))
const hasGitDirectory = async (directory: string): Promise<boolean> => {
  try {
    await lstat(join(directory, '.git'))
    return true
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  const parent = dirname(directory)
  return parent === directory ? false : hasGitDirectory(parent)
}
const escapeGlobPath = (path: string): string =>
  Array.from(path, character => (String.raw`\*?()[]{}!+@|`.includes(character) ? `\\${character}` : character)).join('')
const listVersionControlFiles = async ({
  env = bunEnv,
  root
}: {
  env?: Record<string, string | undefined>
  root: string
}): Promise<null | string[]> => {
  if (!(await hasGitDirectory(await realpath(resolve(root))))) return null
  const subprocess = spawn({
    cmd: ['git', '-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    env,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: 30_000
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text()
  ])
  if (exitCode !== 0)
    throw new CliExitError({
      code: exitCode,
      message: `Failed to list version-control files: ${stderr.trim()}`
    })
  return stdout.split('\0').filter(entry => entry.length > 0)
}
const listProjectFiles = async ({
  env,
  root
}: {
  env?: Record<string, string | undefined>
  root: string
}): Promise<string[]> => {
  const entries = await listVersionControlFiles({ env, root })
  if (entries !== null) {
    const present = await Promise.all(
      entries.map(async entry => {
        try {
          const stats = await lstat(join(root, entry))
          return stats.isFile() || stats.isSymbolicLink()
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
          throw error
        }
      })
    )
    return entries.filter((_entry, index) => present[index]).filter(isIncludedProjectFile)
  }
  const files: string[] = []
  for await (const path of new Glob('**/*').scan({ cwd: root, dot: true, followSymlinks: false, onlyFiles: true }))
    files.push(path)
  return files.filter(isIncludedProjectFile)
}
export { escapeGlobPath, listProjectFiles, listVersionControlFiles }
