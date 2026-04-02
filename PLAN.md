# lintmax overhaul: anti AI slop, agent-first

## Branding

lintmax is an anti AI slop tool designed for agents. Not opinionated, not strict - just the most powerful code checking tools combined for better and more consistent code quality. Default consumer is an AI agent, not a human.

## Output format

Default mode (agent): grouped by file, then by linter, lines compressed.

```
apps/web/showcase.tsx
 biome
  42,55,60,78,92,103 no-explicit-any
  1312 no-children-prop
 eslint
  1184,1209,1215,1220,1225 no-unsafe-call
 oxlint
  800,804 jsx-no-jsx-as-prop
sync.ts
 oxlint
  37,66 no-await-expression-member
```

Zero output on success (exit code 0 is enough).

`--human` flag: current verbose output for human debugging.

Token savings: ~325 tokens → ~22 tokens per 3 errors (93% reduction).

## Comment deletion

Delete all comments by default. Code explains itself - comments are slop.

Delete:
- `// this function does X`
- `/* TODO: refactor */`
- `// added by @john`
- all single-line `//` comments
- all block `/* */` comments

Keep:
- lint ignore directives (`eslint-disable`, `biome-ignore`, `oxlint-disable`, `@ts-nocheck`, `@ts-expect-error`, `@ts-ignore`)
- JSDoc `/** */` on exported declarations (API documentation, powers IDE hover)
- shebangs (`#!/usr/bin/env`)
- license headers: configurable, delete by default

## Default ignores

`readonly/**` ignored by default (generated code, same as `node_modules/` or `dist/`). Consumer repos using the `readonly/` convention no longer need `ignores: ['readonly/**']` in their config.

## Implementation

### Phase 1: JSON collection

Run each linter with structured output:
- biome: `--reporter=json`
- oxlint: `-f json`
- eslint: `-f json`
- tsc: `--pretty false` → `file(line,col): error TSxxxx: message`
- prettier: `--list-different` → filenames only

Parse into unified structure:
```ts
type Diagnostic = { file: string; line: number; rule: string; linter: string }
```

### Phase 2: Aggregation

- Group by file
- Within file, group by linter
- Within linter, group by rule, collect line numbers
- Deduplicate overlapping rules between linters

### Phase 3: Output formatting

Agent mode (default): grouped format, zero output on success.

Human mode (`--human`): current verbose output.

### Phase 4: Comment deletion

- Run as a fix step before linters
- AST-based removal (not regex) to handle edge cases
- Preserve lint ignores, JSDoc on exports, shebangs

### Phase 5: tsc integration

- Optional `typecheck: true` in lintmax config
- Run `tsc --noEmit --pretty false`
- Parse and include in grouped output under `tsc`

### Phase 6: Rule catalog

Extract all rules programmatically:
- oxlint: `--rules` (markdown table with fixable column)
- biome: parse schema or source metadata
- eslint: `--print-config`

New command: `lintmax rules` / `lintmax rules --fixable`

## Tests

Test fixtures double as playground showcase examples.

### Test 1: Magic

Messy TypeScript file violating every fixable rule.

- `lintmax check` → compact error output
- `lintmax fix` → silence (exit 0)
- `lintmax check` → silence (exit 0)
- Proves: messy in → clean out → zero noise

### Test 2: Coverage + Efficiency

TypeScript file violating every rule (fixable + non-fixable).

- `lintmax check` → compact output
- Compare against raw linter output token count
- `lintmax: 75 tokens / raw: 1600 tokens (95% saved)`
- Snapshot for tracking linter updates

## Documentation site (fumadocs)

The playground IS the documentation. One Next.js app with fumadocs.

### Landing page (playground)

Pre-computed examples from test fixtures (no API call needed for demos):

- Dark code editor, pre-loaded with AI slop (typical ChatGPT/Copilot output)
- Below: two tabs
  - "check" → compact output with token count badge
  - "fix" → diff view showing cleaned code, silent output
- Toggle: "raw linter output" → switches to verbose output, token count jumps from 22 to 325
- "Try your own code" → POST to `/api/lint` → server runs lintmax → returns result

### Docs pages

Minimal, generated from code:
- Install (`bun add -d lintmax`)
- Config reference
- Rules catalog (live searchable, from rule extraction)

### Stack

- fumadocs (docs framework on Next.js App Router)
- shadcn components
- shiki (syntax highlighting)
- `/api/lint` route (runs lintmax server-side)
- deployed on Vercel

## CI optimization

Skip CI on markdown-only changes:
```yaml
paths-ignore:
  - '**.md'
```

## CLI

```
lintmax fix              # agent: fix all, delete comments, silent on success
lintmax fix --human      # human: verbose output
lintmax check            # agent: compact error output
lintmax check --human    # human: verbose output
lintmax rules            # rule catalog
lintmax rules --fixable  # fixable rules only
```

## File changes

- `src/pipeline.ts` - JSON output from linters, parse results
- `src/format.ts` - new: agent output formatter
- `src/comments.ts` - new: comment deletion
- `src/rules.ts` - new: rule catalog extraction
- `src/cli.ts` - `--human` flag, `rules` command
- `src/constants.ts` - add `readonly/**` to default ignores
- `tests/fixtures/dirty-fixable.ts` - Test 1
- `tests/fixtures/dirty-all.ts` - Test 2
- `tests/magic.test.ts` - Test 1
- `tests/coverage.test.ts` - Test 2
- `docs/` - fumadocs site + playground
