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

Delete all comments by default. Code explains itself - comments are slop.

Delete:

- all `//` comments
- all `/* */` comments

Keep:

- `/**` JSDoc (always intentional)
- lint ignore directives matching `/eslint-disable|biome-ignore|oxlint-disable|@ts-nocheck|@ts-expect-error|@ts-ignore/`
- shebangs (`#!/usr/bin/env`)

License headers: delete by default (the LICENSE file is in the repo root).

In fix mode: delete comments then run linters. In check mode: report files with deletable comments as errors in the grouped output under `comments` linter:

```
src/utils.ts
 comments
  1,5,12 deletable
```

### Parser

Use the TypeScript compiler API (`typescript` package, already a dependency) to extract comment ranges. Deduplicate by position (comments attach to multiple AST nodes). No extra dependency needed.

### Config opt-out

```ts
export default defineConfig({
  comments: false
})
```

Default is `true` (delete comments).

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

## Default ignores

`readonly/**` ignored by default (generated code, same as `node_modules/` or `dist/`). Consumer repos using the `readonly/` convention no longer need `ignores: ['readonly/**']` in their config.

## Existing compact step

The current “compact” feature (removing consecutive blank lines in source files) is a fix step, not a lint step. It stays as-is, runs before linters in fix mode. Not part of the new output format.

## Implementation order

Build end-to-end for one linter first (biome) as proof of concept: parse JSON → aggregate → output grouped format. Then add oxlint, eslint, tsc, prettier, comments one at a time.

### Phase 1: Biome end-to-end (proof of concept)

- Run biome with `--reporter=json`, capture stdout
- Parse `{ diagnostics: [{ category, location: { path, start: { line } } }] }`
- Group by file → by rule → collect line numbers
- Output grouped format
- Test: run on a dirty fixture, verify output matches expected format
- Once this works, the pattern is proven for all other linters

### Phase 2: Add remaining linters (extends Phase 1)

Add parsers one at a time, feeding into the same aggregation pipeline:

- oxlint: parse `{ diagnostics: [{ code, filename, labels: [{ span: { line } }] }] }`
- eslint: parse `[{ filePath, messages: [{ ruleId, line }] }]`
- tsc: parse `file(line,col): error TSxxxx: message` with regex
- prettier: parse `--list-different` filenames
- comments: TypeScript compiler API comment extraction

Each parser produces `Diagnostic[]`, all feed into the same aggregator.

### Phase 3: Aggregation + deduplication

- Collect all `Diagnostic[]` from all parsers
- Deduplicate: same file+line from multiple linters → keep biome > oxlint > eslint
- Group by file → by linter → by rule → collect line numbers
- Sort files alphabetically, linters by priority, rules alphabetically

### Phase 4: Output formatting

Agent mode (default):

- Build grouped format string from aggregated diagnostics
- Print to stdout
- Zero output on success
- Exit code 1 if any errors

Human mode (`--human`):

- Current behavior: pipe through to sub-tools with their native human-readable output
- In fix mode: still fix everything, then show verbose check output after
- In check mode: show verbose output from each tool

### Phase 5: Comment deletion (independent)

- In fix mode: run before linters, delete comments, then linters fix the rest
- In check mode: report deletable comment locations as diagnostics (linter = `comments`, rule = `deletable`)
- Use TypeScript compiler API to get comment ranges
- Deduplicate by position
- Check keep patterns (JSDoc `/**`, lint ignores, shebangs)
- Remove non-matching comments, preserve surrounding whitespace
- New file: `src/comments.ts`

### Phase 6: tsc integration (independent)

- Optional `typecheck: true` in lintmax config
- Run `tsc --noEmit --pretty false`
- Parse with regex
- Feed diagnostics into aggregation pipeline
- tsc errors are never fixable, always reported

### Phase 7: Rule catalog (after Phase 2)

Extract all rules programmatically:

- oxlint: parse `--rules` markdown table output
- biome: parse biome.json schema from `@biomejs/biome` package
- eslint: use `--print-config` on a dummy file, extract rule keys

New command: `lintmax rules` / `lintmax rules --fixable`

Output as compact list for agents, table for `--human`.

### Phase 8: Remove `q` wrapper (after Phase 4)

Once lintmax is silent on success by default, `q` is unnecessary:

- Remove `q` from all package.json scripts
- Remove `script/q-install.sh`
- Remove `q` from `postinstall`
- Update `verify` script to not use `q`

## Tests

Test fixtures are also playground showcase examples. Write by hand - each fixture should look like recognizable AI-generated code.

### Test 1: Magic

A deliberately messy TypeScript file that looks like ChatGPT output: wrong quotes, unused imports, `any` types, comments explaining obvious code, bad formatting, unsorted imports.

- `lintmax check` → compact error output
- `lintmax fix` → silence (exit 0)
- `lintmax check` → silence (exit 0)
- Assert: the fixed file has zero comments (except lint ignores/JSDoc), consistent formatting, no unused imports

### Test 2: Coverage + Efficiency

A TypeScript file violating every non-fixable rule. Written by hand guided by the rule catalog from Phase 7.

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

### API

`/api/lint` accepts a code string, writes to a temp file, runs lintmax check on it, returns the compact output. No code execution - lintmax only parses and lints, never runs the code.

- Rate limit: 10 requests/minute per IP
- Timeout: 10 second max per request
- Max input size: 50KB

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
- Rules catalog (live searchable table from Phase 7 data)
- Output format spec

## CLI

```
lintmax fix              # agent: fix all, delete comments, silent on success
lintmax fix --human      # human: fix all, show verbose check output after
lintmax check            # agent: compact error output
lintmax check --human    # human: verbose output from each tool
lintmax rules            # rule catalog (compact)
lintmax rules --human    # rule catalog (table)
lintmax rules --fixable  # fixable rules only
```

## Pre-commit

Using `simple-git-hooks` with config in package.json:

```json
"simple-git-hooks": {
  "pre-commit": "bun run verify && git add ."
}
```

`verify` = `bun clean && bun i && build && fix && check && smoke`.

The `git add .` stages any auto-fixes (formatting, comment deletion, import sorting) so they’re included in the commit. This is intentional - the pre-commit ensures every commit is clean.

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
- remove `script/q-install.sh` and `q` references (Phase 8)
