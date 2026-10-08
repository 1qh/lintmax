import { spawn, write } from 'bun'
import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { listProjectFiles } from './project-files.js'
const runGit = async (args: string[]): Promise<void> => {
  const subprocess = spawn({ cmd: ['git', ...args], stderr: 'pipe', stdout: 'ignore', timeout: 30_000 })
  const [exitCode, stderr] = await Promise.all([subprocess.exited, new Response(subprocess.stderr).text()])
  if (exitCode !== 0) throw new Error(`Git fixture setup failed: ${stderr.trim()}`)
}
test('project files exclude Git-ignored files and retain tracked files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lintmax-project-files-'))
  try {
    await runGit(['init', '-q', root])
    await write(join(root, 'tracked.ts'), 'const tracked = 1\n')
    await write(join(root, 'ignored.ts'), 'const ignored = 1\n')
    await write(join(root, '.gitignore'), 'ignored.ts\n.gitignore\n')
    await runGit(['-C', root, 'add', 'tracked.ts'])
    expect(await listProjectFiles({ root })).toEqual(['tracked.ts'])
    await write(join(root, 'untracked.ts'), 'const untracked = 1\n')
    expect((await listProjectFiles({ root })).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'tracked.ts',
      'untracked.ts'
    ])
    await write(join(root, '.gitignore'), 'tracked.ts\nignored.ts\n.gitignore\n')
    expect((await listProjectFiles({ root })).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'tracked.ts',
      'untracked.ts'
    ])
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
test('project files outside Git include files matching a local ignore file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lintmax-project-files-'))
  try {
    await write(join(root, 'tracked.ts'), 'const tracked = 1\n')
    await write(join(root, 'ignored.ts'), 'const ignored = 1\n')
    await write(join(root, '.gitignore'), 'ignored.ts\n')
    expect((await listProjectFiles({ root })).toSorted((a, b) => a.localeCompare(b))).toEqual([
      '.gitignore',
      'ignored.ts',
      'tracked.ts'
    ])
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
test.each(['plain directory', 'Git checkout'])('project files in a %s exclude fixed ignore patterns', async mode => {
  const root = await mkdtemp(join(tmpdir(), 'lintmax-project-files-'))
  const excludedPaths = [
    'node_modules/pkg/index.js',
    'nested/node_modules/pkg/index.js',
    '_generated/index.ts',
    '.next/index.js',
    '.source/index.ts',
    '.venv-test/index.py',
    'venv/index.py',
    'dist/index.js',
    'nested/dist/index.js',
    'generated/index.ts',
    'module_bindings/index.ts',
    'next-env.d.ts',
    'readonly/index.ts',
    'expo/app/babel.config.js',
    'expo/app/global.css',
    'expo/app/metro.config.js',
    'expo/app/uniwind-env.d.ts',
    'expo/app/uniwind-types.d.ts'
  ]
  try {
    await Promise.all(excludedPaths.map(async path => mkdir(dirname(join(root, path)), { recursive: true })))
    await Promise.all(['index.ts', ...excludedPaths].map(async path => write(join(root, path), '')))
    if (mode === 'Git checkout') {
      await runGit(['init', '-q', root])
      await runGit(['-C', root, 'add', '-f', '--', 'index.ts', ...excludedPaths])
    }
    expect(await listProjectFiles({ root })).toEqual(['index.ts'])
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
test('a Git failure inside a checkout is reported instead of walking every file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lintmax-project-files-'))
  try {
    await mkdir(join(root, '.git'))
    await write(join(root, 'ignored.ts'), 'const ignored = 1\n')
    await expect(listProjectFiles({ root })).rejects.toThrow('Failed to list version-control files')
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
