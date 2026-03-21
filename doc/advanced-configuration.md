# Advanced Configuration

All options live in `lintmax.config.ts`.

## Top-level options

`ignores` (`string[]`)

```ts
ignores: ['packages/ui/**', '.intlayer/cache/**']
```

`compact` (`boolean`, default `true`)

```ts
compact: false
```

Compact normalization runs on code/config text files and excludes markdown by default.

`tailwind` (`boolean | string`)

```ts
tailwind: false
```

```ts
tailwind: 'src/styles/globals.css'
```

`tsconfigRootDir` (`string`)

```ts
tsconfigRootDir: '/absolute/project/root'
```

## `eslint`

Use top-level `tailwind` and `tsconfigRootDir`. `eslint.off` (`string[]`)

```ts
eslint: {
  off: ['@typescript-eslint/no-magic-numbers']
}
```

`eslint.ignores` (`string[]`)

```ts
eslint: {
  ignores: ['vendor/**']
}
```

`eslint.append` (`Array<Record<string, unknown> | EslintImportAppendEntry>`)

For JSON-serializable inline config objects:

```ts
eslint: {
  append: [{ files: ['tests/**'], rules: { 'no-magic-numbers': 'off' } }]
}
```

For preset modules that include runtime plugin objects/rule functions, use `eslintImport(...)`:

```ts
import { defineConfig, eslintImport } from 'lintmax'

export default defineConfig({
  eslint: {
    append: [
      eslintImport({
        files: ['backend/convex/**/*.ts', 'backend/convex/**/*.tsx'],
        from: '@noboil/convex/eslint',
        name: 'recommended'
      })
    ]
  }
})
```

## `biome`

`biome.off` (`string[]`)

```ts
biome: {
  off: ['noConsole']
}
```

`biome.ignores` (`string[]`)

```ts
biome: {
  ignores: ['_generated/**']
}
```

`biome.overrides` (`Array<{ includes, off }>`)

```ts
biome: {
  overrides: [{ includes: ['packages/ui/**'], off: ['noConsole'] }]
}
```

## `oxlint`

`oxlint.off` (`string[]`)

```ts
oxlint: {
  off: ['no-console']
}
```

`oxlint.ignores` (`string[]`)

```ts
oxlint: {
  ignores: ['_generated/**']
}
```

`oxlint.overrides` (`Array<{ files, off }>`)

```ts
oxlint: {
  overrides: [{ files: ['**/*.test.ts'], off: ['no-console'] }]
}
```

## Shared file-pattern overrides

```ts
overrides: {
  '**/*.test.ts': {
    eslint: ['no-console'],
    oxlint: ['no-console'],
    biome: ['noConsole']
  }
}
```

Each file-pattern entry must define at least one linter action: `biome`, `eslint`, or `oxlint`.

## TypeScript preset

```json
{ "extends": "lintmax/tsconfig" }
```
