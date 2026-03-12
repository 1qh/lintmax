# lintmax

Maximum strictness linting, formatting, and type-checking in one package.

Wraps **6 tools** into a single CLI: [Biome](https://biomejs.dev), [oxlint](https://oxc.rs), [ESLint](https://eslint.org), [Prettier](https://prettier.io) (markdown), [sort-package-json](https://github.com/keithamus/sort-package-json), and [Flowmark](https://github.com/jlevy/flowmark) (optional).

All rules enabled at `error` by default. You only disable what you don’t need.

## Install

```bash
bun add -d lintmax
bunx lintmax init
```

`lintmax init` scaffolds:

- `tsconfig.json` extending `lintmax/tsconfig`
- `package.json` scripts (`fix`, `check`)
- `.gitignore` entries
- `.vscode/settings.json` (biome formatter, eslint, codeActionsOnSave)
- `.vscode/extensions.json`

## Usage

```bash
bun fix    # auto-fix and format everything
bun check  # check without modifying
```

## Customization

### Biome and oxlint overrides

Create `lintmax.config.ts`:

```ts
import { defineConfig } from 'lintmax'

export default defineConfig({
  compact: true,
  globalIgnorePatterns: ['packages/ui/**', '.intlayer/cache/**'],
  biome: {
    rules: { noBarrelFile: 'off' },
    overrides: [{ disableLinter: true, includes: ['packages/ui/**'] }]
  },
  oxlint: {
    ignorePatterns: ['_generated/'],
    rules: { 'unicorn/filename-case': 'off' }
  }
})
```

- `globalIgnorePatterns` appends patterns to Biome, ESLint, and oxlint ignore sets.
- `compact` runs a whitespace compaction pass before linting (`false` by default).
- `lintmax fix`: rewrites tracked/untracked text files by collapsing 2+ blank lines to 1.
- `lintmax check`: verifies compaction state without modifying files.

### ESLint overrides

Create `eslint.config.ts`:

```ts
import { eslint } from 'lintmax/eslint'

export default eslint({
  rules: { '@typescript-eslint/no-magic-numbers': 'off' },
  ignores: ['vendor/**'],
  tailwind: 'src/styles/globals.css',
  append: [{ files: ['tests/**'], rules: { 'no-magic-numbers': 'off' } }]
})
```

Without `eslint.config.ts`, lintmax generates a default config automatically.

### TypeScript

`tsconfig.json`:

```json
{ "extends": "lintmax/tsconfig" }
```

Strict mode, bundler resolution, ESNext target, JSX preserve. One preset for all.

## How it stays up to date

Biome config is built **dynamically** from the installed `@biomejs/biome` schema at runtime. New rules, category changes, and nursery promotions are picked up automatically.

ESLint plugins and oxlint are dependencies with auto-updating versions. Run `bun update` to get the latest rules without waiting for a lintmax release.

## What each tool handles

| Tool              | Scope                                                                           |
| ----------------- | ------------------------------------------------------------------------------- |
| Biome             | Formatting (JS/TS/JSX/TSX/CSS/JSON) + linting                                   |
| oxlint            | Fast linting (correctness, perf, style, pedantic)                               |
| ESLint            | Type-aware linting (typescript-eslint, React, Next.js, Tailwind, Perfectionist) |
| Prettier          | Markdown formatting                                                             |
| sort-package-json | package.json field ordering                                                     |
| Flowmark          | Markdown prose wrapping (optional, uses system install)                         |

## License

MIT
