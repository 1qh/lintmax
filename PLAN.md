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
 prettier
  unformatted
sync.ts
 oxlint
  37,66 no-await-expression-member
```

Zero output on success (exit code 0 is enough).

`--human` flag: current verbose output for human debugging.

Token savings: ~325 tokens → ~22 tokens per 3 errors (93% reduction).

### Prettier in the grouped format

Prettier has no rules - a file is either formatted or not. In the grouped output, prettier violations show as `unformatted` under the file. No line numbers since prettier reformats the whole file.

### Deduplication

Biome and eslint may flag the same thing (e.g. both catch `no-explicit-any`). Deduplicate by file+line: if two linters report the same file and same line, keep only the first linter’s report (biome > oxlint > eslint priority, since biome is fastest to fix with).

## Comment deletion

Delete all comments by default in fix mode. Code explains itself - comments are slop.

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

License headers: delete by default (the LICENSE file is in the repo root).

### Parser

Use the TypeScript compiler API (`typescript` package, already a dependency) to extract comment ranges. Deduplicate by position (comments attach to multiple AST nodes). No extra dependency needed.

Keep rule is simple - no AST node association needed:

- `/**` → keep (JSDoc, always intentional)
- `//` → delete (unless lint ignore pattern)
- `/* */` → delete (unless lint ignore pattern)
- Lint ignore pattern: `/eslint-disable|biome-ignore|oxlint-disable|@ts-nocheck|@ts-expect-error|@ts-ignore/`

### Verified JSON schemas

```
biome --reporter=json
  { diagnostics: [{ severity, message, category, location: { path, start: { line, column } } }] }
  rule name in "category" field: "lint/suspicious/noExplicitAny"

oxlint -f json
  { diagnostics: [{ message, code, severity, filename, labels: [{ span: { line, column } }] }] }
  rule name in "code" field: "eslint(no-unused-vars)"

eslint -f json
  [{ filePath, messages: [{ ruleId, severity, message, line, column }] }]

tsc --pretty false
  file(line,col): error TSxxxx: message
  regex: /^(.+)\((\d+),(\d+)\): error (TS\d+): (.+)$/

prettier --list-different
  one filename per line
```

### Config opt-out

Users who want to keep comments can set `comments: false` in lintmax config:

```ts
export default defineConfig({
  comments: false
})
```

Default is `true` (delete comments).

## Default ignores

`readonly/**` ignored by default (generated code, same as `node_modules/` or `dist/`). Consumer repos using the `readonly/` convention no longer need `ignores: ['readonly/**']` in their config.

## Implementation order

Each phase builds on the previous. Phases marked independent can be done in parallel.

### Phase 1: JSON collection (foundation)

Run each linter with structured output:

- biome: `--reporter=json` → `{ diagnostics: [{ location: { path, span }, category }] }`
- oxlint: `-f json` → `[{ filePath, messages: [{ line, column, ruleId }] }]`
- eslint: `-f json` → `[{ filePath, messages: [{ line, column, ruleId }] }]`
- tsc: `--pretty false` → parse `file(line,col): error TSxxxx: message` with regex
- prettier: `--list-different` → one filename per line

Verify exact JSON schemas by running each tool on a test file and inspecting output before coding the parsers.

Parse all results into unified structure:

```ts
type Diagnostic = { file: string; line: number; rule: string; linter: string }
```

### Phase 2: Aggregation (depends on Phase 1)

- Collect all diagnostics into one array
- Deduplicate: group by file+line, if multiple linters report same location, keep biome > oxlint > eslint (priority order)
- Group by file → by linter → by rule → collect line numbers
- Sort files alphabetically, linters by priority, rules alphabetically

### Phase 3: Output formatting (depends on Phase 2)

Agent mode (default):

- Build the grouped format string from aggregated diagnostics
- Print to stdout
- Zero output on success
- Exit code 1 if any errors

Human mode (`--human`):

- Current behavior, pipe through to sub-tools with human-readable output

### Phase 4: Comment deletion (independent)

- Run before linters in fix mode
- Use TypeScript compiler API to get comment ranges
- For each comment, check if it matches a keep pattern (lint ignore, JSDoc on exports, shebang)
- Remove non-matching comments, preserve whitespace/newlines
- New file: `src/comments.ts`

### Phase 5: tsc integration (independent)

- Add optional `typecheck: true` in lintmax config
- Run `tsc --noEmit --pretty false`
- Parse with regex: `/^(.+)\((\d+),(\d+)\): error (TS\d+): (.+)$/`
- Feed diagnostics into the same aggregation pipeline
- tsc errors are never fixable, always reported

### Phase 6: Rule catalog (independent, after Phase 1)

Extract all rules programmatically:

- oxlint: parse `--rules` markdown table output
- biome: parse `biome.json` schema from `@biomejs/biome` package
- eslint: use `--print-config` on a dummy file, extract rule keys
- tsc: static list of error codes (published, rarely changes)

New command: `lintmax rules` / `lintmax rules --fixable`

Output as compact list for agents, table for `--human`.

### Phase 7: Remove `q` wrapper (after Phase 3)

Once lintmax itself is silent on success, the `q` wrapper in package.json scripts is unnecessary. Remove `q` from all scripts, remove `script/q-install.sh`, remove `q` from `postinstall`.

## Tests

Test fixtures are also playground showcase examples. Write by hand to control the narrative - each fixture should look like recognizable AI-generated code.

### Test 1: Magic

A deliberately messy TypeScript file that looks like ChatGPT output: wrong quotes, unused imports, `any` types, comments explaining obvious code, bad formatting, unsorted imports.

- `lintmax check` → compact error output
- `lintmax fix` → silence (exit 0)
- `lintmax check` → silence (exit 0)
- Assert: the fixed file has zero comments (except lint ignores), consistent formatting, no unused imports

### Test 2: Coverage + Efficiency

A TypeScript file violating every non-fixable rule. Written by hand guided by the rule catalog from Phase 6.

- `lintmax check` → compact output
- Same file, run raw `biome check && oxlint && eslint` → capture verbose output
- Compare char/token counts
- Assert: lintmax output is >90% smaller
- Snapshot the compact output for tracking linter updates

## Documentation site

The playground IS the documentation. One Next.js app with fumadocs.

### Stack

- fumadocs (docs framework on Next.js App Router)
- shadcn/ui components
- shiki (syntax highlighting in code blocks)
- `/api/lint` route (runs lintmax server-side on posted code)
- deployed on Vercel

### API security

`/api/lint` accepts a code string, writes to a temp file, runs lintmax on it, returns the compact output. No code execution - lintmax only parses and lints, never runs the code. Rate limit: 10 requests/minute per IP via Vercel Edge Config or simple in-memory counter.

### Landing page (playground)

Pre-computed examples from test fixtures (instant, no API call):

- Dark code editor (shiki-highlighted), pre-loaded with Test 1 fixture (AI slop)
- Below: two tabs
  - “check” → compact output with token count badge
  - “fix” → diff view showing cleaned code, zero output below
- Toggle: “raw output” → switches to verbose linter output, token count jumps
- “Try your own code” → clears editor, enables API mode, POST to `/api/lint` on submit

### Docs pages (fumadocs MDX)

Minimal:

- Install: `bun add -d lintmax`
- Config reference (auto-generated from TypeScript types)
- Rules catalog (live searchable table from Phase 6 data)
- Output format spec

## CLI

```
lintmax fix              # agent: fix all, delete comments, silent on success
lintmax fix --human      # human: verbose output
lintmax check            # agent: compact error output
lintmax check --human    # human: verbose output
lintmax rules            # rule catalog (compact)
lintmax rules --human    # rule catalog (table)
lintmax rules --fixable  # fixable rules only
```

## File changes

- `src/pipeline.ts` - run linters with JSON/structured output, feed into aggregator
- `src/format.ts` - new: agent output formatter (grouped format)
- `src/aggregate.ts` - new: deduplication, grouping, sorting
- `src/comments.ts` - new: comment deletion using TypeScript compiler API
- `src/rules.ts` - new: rule catalog extraction from all linters
- `src/cli.ts` - `--human` flag, `rules` command
- `src/constants.ts` - add `readonly/**` to default ignores
- `tests/fixtures/dirty-fixable.ts` - Test 1 (AI slop, all fixable violations)
- `tests/fixtures/dirty-all.ts` - Test 2 (all rule violations)
- `tests/magic.test.ts` - Test 1 runner
- `tests/coverage.test.ts` - Test 2 runner + token comparison
- `docs/` - fumadocs site + playground
- remove `script/q-install.sh` and `q` references (Phase 7)
