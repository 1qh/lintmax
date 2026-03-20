# lintmax

Opinionated max-strict lint/format/typecheck with a minimal config surface.

## Quick start

Install and initialize:

```bash
bun add -d lintmax
bunx lintmax init
```

Run checks:

```bash
bun fix
bun check
```

`lintmax` works without configuration. Add `lintmax.config.ts` only when you need to tune behavior.

## Canonical knobs

- `off`: disable rules
- `ignores`: ignore file globs
- `overrides`: map file globs to per-linter `off` arrays

Example:

```ts
import { defineConfig } from 'lintmax'

export default defineConfig({
  ignores: ['vendor/**'],
  eslint: { off: ['@typescript-eslint/no-magic-numbers'] },
  overrides: {
    '**/*.test.ts': {
      eslint: ['no-console'],
      oxlint: ['no-console'],
      biome: ['noConsole']
    }
  }
})
```

Advanced options: `doc/advanced-configuration.md`.

License: MIT
