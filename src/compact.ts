import { file, spawnSync, write } from 'bun'
import { CliExitError, decodeText } from './core.js'
import { joinPath } from './path.js'
const COMPACT_REGEX = /(?:\r?\n){2,}/gu,
  compactBasenames = new Set(['.env.example', '.gitignore', '.npmrc', '.prettierignore', 'Dockerfile', 'Makefile']),
  compactExtensions = new Set([
    '.cjs',
    '.css',
    '.gql',
    '.graphql',
    '.html',
    '.js',
    '.json',
    '.jsonc',
    '.jsx',
    '.mjs',
    '.mts',
    '.scss',
    '.sql',
    '.ts',
    '.tsx',
    '.txt',
    '.yaml',
    '.yml'
  ]),
  basename = ({ path }: { path: string }): string => {
    const index = path.lastIndexOf('/')
    if (index === -1) return path
    return path.slice(index + 1)
  },
  extension = ({ path }: { path: string }): string => {
    const slashIndex = path.lastIndexOf('/'),
      dotIndex = path.lastIndexOf('.')
    return dotIndex > slashIndex ? path.slice(dotIndex) : ''
  },
  compactContent = ({ content }: { content: string }): string => content.replace(COMPACT_REGEX, '\n'),
  isCompactCandidate = ({ relativePath }: { relativePath: string }): boolean => {
    const fileName = basename({ path: relativePath })
    if (compactBasenames.has(fileName)) return true
    return compactExtensions.has(extension({ path: relativePath }))
  },
  isBinary = ({ bytes }: { bytes: Uint8Array }): boolean => {
    for (const byte of bytes) if (byte === 0) return true
    return false
  },
  listCompactFiles = ({ env, root }: { env: Record<string, string | undefined>; root: string }): string[] => {
    const result = spawnSync({
      cmd: ['git', '-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      env,
      stderr: 'pipe',
      stdout: 'pipe'
    })
    if (result.exitCode !== 0) {
      const stderr = decodeText(result.stderr).trim()
      if (stderr.toLowerCase().includes('not a git repository')) return []
      throw new CliExitError({
        code: result.exitCode,
        message: stderr.length > 0 ? stderr : 'Failed to list files for compact step'
      })
    }
    const entries = decodeText(result.stdout).split('\0'),
      files: string[] = []
    for (const entry of entries) if (entry.length > 0 && entry !== 'bun.lock') files.push(entry)
    return files
  },
  runCompact = async ({
    env,
    mode,
    root
  }: {
    env: Record<string, string | undefined>
    mode: 'check' | 'fix'
    root: string
  }) => {
    const files = listCompactFiles({ env, root }),
      results = await Promise.all(
        files.map(async relativePath => {
          if (!isCompactCandidate({ relativePath })) return { changed: false, relativePath, scanned: false }
          const absolutePath = joinPath(root, relativePath),
            source = file(absolutePath)
          if (!(await source.exists())) return { changed: false, relativePath, scanned: false }
          const bytes = new Uint8Array(await source.arrayBuffer())
          if (isBinary({ bytes })) return { changed: false, relativePath, scanned: true }
          const content = decodeText(bytes),
            compacted = compactContent({ content })
          if (content === compacted) return { changed: false, relativePath, scanned: true }
          if (mode === 'fix') await write(absolutePath, compacted)
          return { changed: true, relativePath, scanned: true }
        })
      ),
      changed: string[] = []
    let scanned = 0
    for (const result of results) {
      if (result.scanned) scanned += 1
      if (result.changed) changed.push(result.relativePath)
    }
    if (mode === 'fix') {
      process.stdout.write(`[compact] Scanned ${scanned} files\n`)
      process.stdout.write(`[compact] Updated ${changed.length} files\n`)
      return
    }
    if (changed.length === 0) return
    const shown = changed.slice(0, 10),
      suffix = changed.length > shown.length ? `\n...and ${changed.length - shown.length} more` : ''
    throw new CliExitError({
      code: 1,
      message: `[compact]\nFiles requiring compaction:\n${shown.join('\n')}${suffix}\nRun: lintmax fix`
    })
  }
export { runCompact }
