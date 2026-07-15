import { $, file, write } from 'bun'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const decoder = new TextDecoder()
const root = join(import.meta.dir, '..')
const pack = await $`bun pm pack`.cwd(root).quiet().nothrow()
const output = decoder.decode(pack.stdout).trim()
const tarball = output
  .split('\n')
  .find(l => l.endsWith('.tgz'))
  ?.trim()
if (pack.exitCode !== 0 || !tarball) throw new Error(`pack failed: ${decoder.decode(pack.stderr)}`)
const dir = await mkdtemp(join(tmpdir(), 'lintmax-smoke-'))
const cleanup = async () => rm(dir, { force: true, recursive: true })
const has = async (f: string) => file(join(dir, f)).exists()
const readJson = async <T>(f: string): Promise<T> => JSON.parse(await file(join(dir, f)).text()) as T
const lintmaxCli = 'node_modules/lintmax/dist/cli.mjs'
const writeConfig = async ({ content }: { content: string }) => write(join(dir, 'lintmax.config.ts'), content)
const required = [
  'node_modules/lintmax/dist/cli.mjs',
  'node_modules/lintmax/dist/eslint.mjs',
  'node_modules/lintmax/dist/index.d.mts',
  'node_modules/lintmax/dist/index.mjs',
  'node_modules/lintmax/oxlintrc.json',
  'node_modules/lintmax/tsconfig.json'
]
const run = async ({ cmd, label }: { cmd: string[]; label: string }) => {
  const result = await $`${cmd}`.cwd(dir).quiet().nothrow()
  if (result.exitCode !== 0) {
    process.stderr.write(`${label} failed:\n${decoder.decode(result.stdout)}\n${decoder.decode(result.stderr)}\n`)
    throw new Error(`${label} exited ${result.exitCode}`)
  }
}
const runExpectFail = async ({ cmd, expect, label }: { cmd: string[]; expect: string; label: string }) => {
  const result = await $`${cmd}`.cwd(dir).quiet().nothrow()
  if (result.exitCode === 0) throw new Error(`${label} unexpectedly succeeded`)
  const stderr = decoder.decode(result.stderr)
  const stdout = decoder.decode(result.stdout)
  const combinedOutput = `${stdout}\n${stderr}`
  if (!combinedOutput.includes(expect))
    throw new Error(`${label} did not include expected error: ${expect}\nActual output:\n${combinedOutput}`)
}
try {
  const runCheck = async ({ label }: { label: string }) => run({ cmd: ['bun', lintmaxCli, 'check'], label })
  const runCheckExpectFail = async ({ expect, label }: { expect: string; label: string }) =>
    runExpectFail({
      cmd: ['bun', lintmaxCli, 'check'],
      expect,
      label
    })
  process.stdout.write(`smoke dir: ${dir}\n`)
  await $`bun init -y`.cwd(dir).quiet()
  await write(join(dir, 'index.ts'), "const ok = 'lintmax-smoke'\nexport { ok }\n")
  await $`bun add ${join(root, tarball)}`.cwd(dir).quiet()
  const checks = await Promise.all(required.map(async f => ({ exists: await has(f), f })))
  for (const { exists, f } of checks) if (!exists) throw new Error(`missing ${f} in installed package`)
  await run({ cmd: ['bun', lintmaxCli, 'fix'], label: 'lintmax fix' })
  await runCheck({ label: 'lintmax check' })
  await writeConfig({
    content: "import { defineConfig } from 'lintmax'\n\nexport default defineConfig({ ignores: ['generated/**'] })\n"
  })
  await runCheck({ label: 'shared ignores propagation' })
  const biomeConfig = await readJson<{ files?: { includes?: string[] } }>('node_modules/.cache/lintmax/biome.json')
  const oxlintConfig = await readJson<{ ignorePatterns?: string[] }>('node_modules/.cache/lintmax/.oxlintrc.json')
  if (!biomeConfig.files?.includes?.includes('!!**/generated/**'))
    throw new Error('shared ignores not propagated to biome config')
  if (!oxlintConfig.ignorePatterns?.includes('generated/**'))
    throw new Error('shared ignores not propagated to oxlint config')
  await mkdir(join(dir, 'readonly', 'ui'), { recursive: true })
  await write(join(dir, 'readonly', 'ui', 'vendored.ts'), 'export function vendored() {\n  return 1\n}\n')
  await write(join(dir, 'readonly', 'ui', 'VENDORED.md'), '# vendored\n\n*   badly    formatted   list\n')
  await mkdir(join(dir, 'generated'), { recursive: true })
  await write(join(dir, 'generated', 'codegen.ts'), 'export function codegen() {\n  return 2\n}\n')
  await runCheck({ label: 'a shared-ignored path is not linted (the pattern must reach the linter, not just the config)' })
  const vendoredAfter = await file(join(dir, 'readonly', 'ui', 'vendored.ts')).text()
  if (!vendoredAfter.includes('export function vendored'))
    throw new Error('fix rewrote a shared-ignored file: the ignore reached the config but not the formatter')
  const vendoredMd = await file(join(dir, 'readonly', 'ui', 'VENDORED.md')).text()
  if (!vendoredMd.includes('*   badly    formatted   list'))
    throw new Error('prettier reformatted markdown under a shared-ignored path')
  await writeConfig({
    content:
      "import { defineConfig } from 'lintmax'\n\nexport default defineConfig({\n  biome: { ignores: ['biome-only/**'] },\n  eslint: { ignores: ['eslint-only/**'] },\n  oxlint: { ignores: ['oxlint-only/**'] }\n})\n"
  })
  await runCheck({ label: 'per-linter ignores propagation' })
  const biomeScopedIgnores = await readJson<{ files?: { includes?: string[] } }>('node_modules/.cache/lintmax/biome.json')
  const oxlintScopedIgnores = await readJson<{ ignorePatterns?: string[] }>('node_modules/.cache/lintmax/.oxlintrc.json')
  const eslintGenerated = await file(join(dir, 'node_modules/.cache/lintmax/eslint.generated.mjs')).text()
  if (!biomeScopedIgnores.files?.includes?.includes('!!**/biome-only/**'))
    throw new Error('biome.ignores not propagated to biome config')
  if (!oxlintScopedIgnores.ignorePatterns?.includes('oxlint-only/**'))
    throw new Error('oxlint.ignores not propagated to oxlint config')
  if (!eslintGenerated.includes('eslint-only/**')) throw new Error('eslint.ignores not propagated to eslint config')
  if (eslintGenerated.includes('next-env.d.ts'))
    throw new Error('default shared ignores leaked into generated eslint sync options')
  await writeConfig({
    content:
      "import { defineConfig } from 'lintmax'\n\nexport default defineConfig({ overrides: { '**/*.test.ts': { eslint: ['no-console'] } } })\n"
  })
  await runCheck({ label: 'override map shorthand' })
  const sharedOverrideGenerated = await file(join(dir, 'node_modules/.cache/lintmax/eslint.generated.mjs')).text()
  if (!sharedOverrideGenerated.includes('"files":["**/*.test.ts"]'))
    throw new Error('shared override shorthand not emitted to eslint generated config')
  if (!sharedOverrideGenerated.includes('"no-console":"off"'))
    throw new Error('shared override shorthand rule-off not emitted to eslint generated config')
  if (!sharedOverrideGenerated.includes('lintmax.sharedOverride'))
    throw new Error('symbol-based shared override marker path not emitted to generated eslint config')
  if (sharedOverrideGenerated.includes('lintmaxShared'))
    throw new Error('internal shared override marker leaked into generated eslint config')
  await writeConfig({
    content:
      "import { defineConfig } from 'lintmax'\n\nexport default defineConfig({ overrides: { '**/*.ts': { eslint: {} } } })\n"
  })
  await runCheckExpectFail({
    expect: 'overrides[0].eslint must be an array of rule names',
    label: 'shared override scoped off required'
  })
  await writeConfig({
    content:
      "import { defineConfig } from 'lintmax'\n\nexport default defineConfig({ overrides: { '**/*.ts': { invalid: ['no-console'] } } })\n"
  })
  await runCheckExpectFail({
    expect: 'overrides.**/*.ts.invalid is not supported',
    label: 'shared override unknown key unsupported'
  })
  await writeConfig({
    content:
      "import { defineConfig } from 'lintmax'\n\nconst bad: any = new Map()\nexport default defineConfig({ overrides: bad })\n"
  })
  await runCheckExpectFail({
    expect: 'overrides must be an object',
    label: 'shared override plain-object required'
  })
  await write(
    join(dir, 'lintmax.config.ts'),
    "import { defineConfig } from 'lintmax'\n\nexport default defineConfig({ biome: { overrides: [{ includes: ['src/**'] }] } })\n"
  )
  await runExpectFail({
    cmd: ['bun', 'node_modules/lintmax/dist/cli.mjs', 'check'],
    expect: 'biome.overrides[0].off is required',
    label: 'biome override off required'
  })
  await write(
    join(dir, 'lintmax.config.ts'),
    "import { defineConfig } from 'lintmax'\n\nexport default defineConfig({ oxlint: { overrides: [{ files: ['src/**'] }] } })\n"
  )
  await runExpectFail({
    cmd: ['bun', 'node_modules/lintmax/dist/cli.mjs', 'check'],
    expect: 'oxlint.overrides[0].off is required',
    label: 'oxlint override off required'
  })
  await write(
    join(dir, 'lintmax.config.ts'),
    "import { defineConfig } from 'lintmax'\n\nexport default defineConfig({ overrides: { '**/*.ts': { eslint: ['lintmax/does-not-exist'] } } })\n"
  )
  await runExpectFail({
    cmd: ['bun', 'node_modules/lintmax/dist/cli.mjs', 'check'],
    expect: 'overrides.eslint contains unknown eslint rules',
    label: 'shared eslint override invalid rule name'
  })
  await write(
    join(dir, 'lintmax.config.ts'),
    "import { defineConfig } from 'lintmax'\n\nexport default defineConfig({ overrides: { '**/*.ts': { eslint: ['react-hooks/no-deriving-state-in-effects'] } } })\n"
  )
  await run({
    cmd: ['bun', 'node_modules/lintmax/dist/cli.mjs', 'check'],
    label: 'shared eslint override valid plugin rule'
  })
  await write(
    join(dir, 'lintmax.config.ts'),
    "import { defineConfig } from 'lintmax'\n\nexport default defineConfig({ biome: { off: ['lintmax/does-not-exist'] } })\n"
  )
  await runExpectFail({
    cmd: ['bun', 'node_modules/lintmax/dist/cli.mjs', 'check'],
    expect: 'unknown biome rules',
    label: 'biome off invalid rule name'
  })
  await write(
    join(dir, 'lintmax.config.ts'),
    "import { defineConfig } from 'lintmax'\n\nexport default defineConfig({ oxlint: { off: ['lintmax/does-not-exist'] } })\n"
  )
  await runExpectFail({
    cmd: ['bun', 'node_modules/lintmax/dist/cli.mjs', 'check'],
    expect: 'unknown oxlint rules',
    label: 'oxlint off invalid rule name'
  })
  await write(
    join(dir, 'lintmax.config.ts'),
    "import { defineConfig } from 'lintmax'\n\nexport default defineConfig({\n  eslint: {\n    off: ['lintmax/does-not-exist']\n  }\n})\n"
  )
  await runExpectFail({
    cmd: ['bun', 'node_modules/lintmax/dist/cli.mjs', 'check'],
    expect: 'unknown eslint rules',
    label: 'eslint off invalid rule name'
  })
  await write(
    join(dir, 'lintmax.config.ts'),
    "import { defineConfig } from 'lintmax'\n\nexport default defineConfig({ eslint: { tailwind: false } })\n"
  )
  await runExpectFail({
    cmd: ['bun', 'node_modules/lintmax/dist/cli.mjs', 'check'],
    expect: 'eslint.tailwind is not supported in sync config',
    label: 'nested eslint tailwind unsupported'
  })
  await write(
    join(dir, 'lintmax.config.ts'),
    "import { defineConfig } from 'lintmax'\n\nexport default defineConfig({ eslint: { tsconfigRootDir: '/tmp' } })\n"
  )
  await runExpectFail({
    cmd: ['bun', 'node_modules/lintmax/dist/cli.mjs', 'check'],
    expect: 'eslint.tsconfigRootDir is not supported in sync config',
    label: 'nested eslint tsconfigRootDir unsupported'
  })
  await write(
    join(dir, 'lintmax.config.ts'),
    "import { defineConfig } from 'lintmax'\n\nexport default defineConfig({ eslint: { append: [{ parserOptions: { ecmaVersion: Number.NaN } }] } })\n"
  )
  await runExpectFail({
    cmd: ['bun', 'node_modules/lintmax/dist/cli.mjs', 'check'],
    expect: 'eslint.append[0].parserOptions.ecmaVersion must be JSON-serializable',
    label: 'eslint append json-serializable required'
  })
  await write(
    join(dir, 'lintmax.config.ts'),
    "import { defineConfig } from 'lintmax'\n\nexport default defineConfig({ eslint: { append: [new Date() as any] } })\n"
  )
  await runExpectFail({
    cmd: ['bun', 'node_modules/lintmax/dist/cli.mjs', 'check'],
    expect: 'eslint.append[0] must be an object',
    label: 'eslint append plain object required'
  })
  await write(
    join(dir, 'lintmax.config.ts'),
    "import { defineConfig } from 'lintmax'\n\nconst shared = { ecmaVersion: 2022 }\n\nexport default defineConfig({\n  eslint: {\n    append: [\n      {\n        languageOptions: {\n          parserOptions: { first: shared, second: shared }\n        }\n      }\n    ]\n  }\n})\n"
  )
  await run({
    cmd: ['bun', 'node_modules/lintmax/dist/cli.mjs', 'check'],
    label: 'eslint append allows repeated object references'
  })
  await write(
    join(dir, 'lintmax.config.ts'),
    "import { defineConfig } from 'lintmax'\n\nexport default defineConfig({ eslint: { off: ['@typescript-eslint/await-thenable'] } })\n"
  )
  await run({
    cmd: ['bun', 'node_modules/lintmax/dist/cli.mjs', 'check'],
    label: 'eslint off accepts extends-derived rule names'
  })
  await write(
    join(dir, 'lintmax.config.ts'),
    "import { defineConfig } from 'lintmax'\n\nexport default defineConfig({\n  eslint: {\n    off: ['@next/next/no-html-link-for-pages', '@typescript-eslint/no-magic-numbers']\n  },\n  tailwind: false\n})\n"
  )
  await run({
    cmd: ['bun', 'node_modules/lintmax/dist/cli.mjs', 'check'],
    label: 'single-file eslint customization'
  })
  await mkdir(join(dir, 'ui/src/styles'), { recursive: true })
  await mkdir(join(dir, 'src/styles'), { recursive: true })
  await write(join(dir, 'ui/src/styles/globals.css'), "@import 'tailwindcss';\n")
  await write(join(dir, 'src/styles/globals.css'), "@import 'tailwindcss';\n")
  await write(
    join(dir, 'lintmax.config.ts'),
    "import { defineConfig } from 'lintmax'\n\nexport default defineConfig({})\n"
  )
  await run({
    cmd: ['bun', 'node_modules/lintmax/dist/cli.mjs', 'check'],
    label: 'tailwind auto-detection prefers ui path on ambiguity'
  })
  await mkdir(join(dir, 'generated'), { recursive: true })
  await write(
    join(dir, 'generated/eslint-import-preset.mjs'),
    "export const recommended = [{ plugins: { demo: { meta: { name: 'eslint-plugin-demo', version: '1.0.0' }, rules: { 'demo/noop': { create: () => ({}), meta: { schema: [], type: 'problem' } } } } }, rules: { 'demo/noop': 'off' } }]\n"
  )
  await write(
    join(dir, 'lintmax.config.ts'),
    "import { defineConfig, eslintImport } from 'lintmax'\n\nexport default defineConfig({\n  eslint: {\n    append: [\n      eslintImport({\n        files: ['src/**/*.ts'],\n        from: './generated/eslint-import-preset.mjs',\n        name: 'recommended'\n      })\n    ]\n  }\n})\n"
  )
  await run({
    cmd: ['bun', 'node_modules/lintmax/dist/cli.mjs', 'check'],
    label: 'eslintImport helper supports runtime preset imports'
  })
  const eslintImportGenerated = await file(join(dir, 'node_modules/.cache/lintmax/eslint.generated.mjs')).text()
  if (!eslintImportGenerated.includes('generated/eslint-import-preset.mjs'))
    throw new Error('eslintImport helper did not emit runtime import to generated eslint config')
  if (eslintImportGenerated.includes('eslint-plugin-demo'))
    throw new Error('eslintImport helper unexpectedly serialized plugin objects into generated eslint config')
  if (!eslintImportGenerated.includes('appendImports'))
    throw new Error('eslintImport helper did not emit append import expansion path')
  await write(join(dir, 'eslint.config.ts'), "throw new Error('should not be used by lintmax')\n")
  await run({
    cmd: ['bun', 'node_modules/lintmax/dist/cli.mjs', 'check'],
    label: 'ignore consumer eslint config file'
  })
  await rm(join(dir, 'eslint.config.ts'), { force: true })
  await rm(join(dir, 'lintmax.config.ts'), { force: true })
  process.stdout.write('smoke test passed\n')
} finally {
  await cleanup()
  await rm(join(root, tarball), { force: true })
}
