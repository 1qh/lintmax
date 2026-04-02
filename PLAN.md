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

Prettier currently only runs on `**/*.md`. In the grouped output, prettier violations show as `unformatted` under the file. No line numbers since prettier reformats the whole file.

### sort-package-json in the grouped format

sort-package-json currently checks/fixes `**/package.json`. In the grouped output, violations show as:

```
package.json
 sort-package-json
  unsorted
```

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

Default is `true` (delete comments). Requires adding `comments?: boolean` to `SyncOptions` in `src/lintmax-types.ts`.

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

sort-package-json --check
  exit code 1 if unsorted, filename on stdout
```

## Default ignores

`readonly/**` already added to `DEFAULT_SHARED_IGNORE_PATTERNS` in `src/constants.ts`. Done.

## Existing compact step

The current “compact” feature (removing consecutive blank lines in source files) is a fix step, not a lint step. It stays as-is, runs before linters in fix mode. Not part of the new output format.

In agent mode, compact’s stdout output (`[compact] Scanned X files / Updated Y files`) must be suppressed. Only print on failure or in `--human` mode.

## Biome double-run in fix mode

`pipeline.ts` runs biome fix twice - before and after oxlint+eslint - to clean up after other fixers. In agent mode check, only capture JSON from the single check run. In fix mode, biome fix runs are silent (no JSON capture needed since they’re just fixing), then the final check run captures JSON for the report.

## Flowmark

`pipeline.ts` conditionally runs flowmark if installed. The plan treats it as a fix-only step (like compact). No JSON output, no parser needed. If flowmark fails, report it as a simple failure in the grouped output (no line numbers, just the tool name).

## Config sync step

`pipeline.ts:204-213` runs config sync before linting, using `run()` with `silent: true`. In agent mode, this should remain silent. In human mode, it’s already silent. No change needed for `--human` threading on this step.

## Exit code disambiguation

- exit 0 = success, no output
- exit 1 + valid JSON = lint errors found, parse and format
- exit 1 + invalid JSON = tool crashed, report as internal error with raw stderr
- exit 2+ = tool crashed, same as above

## Deduplication clarification

Dedup by file+line removes only exact duplicates (same file, same line, from different linters). Two different rules on the same line from different linters are NOT deduped - they’re separate violations that happen to share a line.

## Runtime config for comments

`lintmax.json` runtime config (read at `pipeline.ts:216`) already has `compact?: boolean`. Add `comments?: boolean` to the same runtime config. Thread it into the pipeline: if `comments` is true (default), run comment deletion before linters in fix mode, report deletable comments in check mode.

## Smoke test updates

The smoke test (`script/smoke.ts`) will need updating after the output format changes. Assertions must match agent-mode behavior (silent on success, grouped format on failure). Update as part of each phase, not as a separate phase.

## Key blocker: `run()` cannot capture output

The current `run()` in `src/core.ts` uses `spawnSync` with `stdout: 'inherit'` (or `'pipe'` with silent mode that dumps to stderr on failure). There is no way to capture and return stdout as a string for JSON parsing.

Need a new `runCapture()` function in `src/core.ts`:

```ts
const runCapture = ({ args, command, env, label }: RunOpts): { exitCode: number; stderr: string; stdout: string }
```

This returns stdout/stderr as strings instead of piping to terminal. All JSON parsing depends on this.

## `--human` flag plumbing

The `--human` flag needs to thread through the entire pipeline:

1. `src/cli.ts`: parse `--human` from `process.argv`, pass to `runLint`
2. `src/pipeline.ts`: `runLint` receives `{ command, human }`. In human mode, use existing `run()` with `inherit`. In agent mode, use `runCapture()` with JSON flags.
3. `createCheckSteps` / `createFixSteps` need to conditionally add JSON flags (e.g. `--reporter=json` for biome) based on the `human` flag.

## JSON parse error handling

Linters may crash, output partial JSON, or mix errors into stdout. Every `JSON.parse` call must be wrapped in try/catch. On failure: fall back to raw output as a single error message, and still exit with the tool’s exit code.

## Implementation order

Build end-to-end for one linter first (biome) as proof of concept. Then add others one at a time.

### Phase 1: runCapture + Biome end-to-end (proof of concept)

- Add `runCapture()` to `src/core.ts`
- Run biome with `--reporter=json` via `runCapture()`, capture stdout
- Parse JSON with try/catch, handle malformed output
- Minimal aggregator: group by file → by rule → collect line numbers
- Minimal formatter: output grouped format string
- Test: run on a dirty fixture, verify output matches expected format
- New files: `src/aggregate.ts`, `src/format.ts`
- Modified files: `src/core.ts`, `src/pipeline.ts`

### Phase 2: Add remaining linters (extends Phase 1)

Add parsers one at a time, feeding into the same aggregation pipeline:

- oxlint: parse `{ diagnostics: [{ code, filename, labels: [{ span: { line } }] }] }` with try/catch
- eslint: parse `[{ filePath, messages: [{ ruleId, line }] }]` with try/catch
- tsc (optional, if `typecheck: true` in config): parse `--pretty false` output with regex
- prettier: parse `--list-different` filenames (no JSON, just split lines)
- sort-package-json: check exit code, report filename if unsorted

Each parser produces `Diagnostic[]`, all feed into the same aggregator.

### Phase 3: Aggregation + deduplication

- Collect all `Diagnostic[]` from all parsers
- Deduplicate: same file+line from multiple linters → keep biome > oxlint > eslint
- Group by file → by linter → by rule → collect line numbers
- Sort files alphabetically, linters by priority, rules alphabetically

### Phase 4: Output formatting + --human flag

Agent mode (default):

- Build grouped format string from aggregated diagnostics
- Print to stdout
- Zero output on success
- Exit code 1 if any errors

Human mode (`--human`):

- Current behavior: use existing `run()` with `inherit` for all tools
- No JSON parsing, no aggregation, direct tool output
- In fix mode: still fix everything, then show verbose check output after

Threading: `cli.ts` parses `--human`, passes boolean to `runLint`, `runLint` branches between agent path (runCapture + aggregate + format) and human path (existing run).

### Phase 5: Comment deletion (independent)

- In fix mode: run before linters, delete comments, then linters fix the rest
- In check mode: report deletable comment locations as diagnostics (linter = `comments`, rule = `deletable`)
- Use TypeScript compiler API to get comment ranges
- Deduplicate by position
- Check keep patterns (JSDoc `/**`, lint ignores, shebangs)
- Remove non-matching comments, preserve surrounding whitespace
- New file: `src/comments.ts`
- Modified: `src/lintmax-types.ts` (add `comments?: boolean` to `SyncOptions`)

### Phase 6: Rule catalog (after Phase 2)

Extract all rules programmatically:

- oxlint: parse `--rules` markdown table output
- biome: parse biome.json schema from `@biomejs/biome` package
- eslint: use `--print-config` on a dummy file, extract rule keys

New command: `lintmax rules` / `lintmax rules --fixable`

Output as compact list for agents, table for `--human`.

Modified: `src/cli.ts` (add `rules` command handling, currently rejects anything not `fix`/`check`/`init`/`--version`/`--help`)

### Phase 7: Remove `q` wrapper (after Phase 4)

Once lintmax is silent on success by default, `q` is unnecessary:

- Remove `q` from all package.json scripts
- Remove `script/q-install.sh`
- Remove `q` from `postinstall`
- Update `verify`, `build`, `check`, `fix`, `smoke`, `release` scripts

## Tests

Test fixtures are also playground showcase examples. Write by hand - each fixture should look like recognizable AI-generated code.

### Test 1: Magic

A deliberately messy TypeScript file that looks like ChatGPT output: wrong quotes, unused imports, `any` types, comments explaining obvious code, bad formatting, unsorted imports.

- `lintmax check` → compact error output
- `lintmax fix` → silence (exit 0)
- `lintmax check` → silence (exit 0)
- Assert: the fixed file has zero comments (except lint ignores/JSDoc), consistent formatting, no unused imports

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
- Rules catalog (live searchable table from Phase 6 data)
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

The `git add .` stages any auto-fixes so they’re included in the commit.

## File changes

- `src/core.ts` - add `runCapture()` function for JSON output capture
- `src/pipeline.ts` - branch between agent (runCapture + JSON) and human (run + inherit) paths, accept `human` flag
- `src/format.ts` - new: agent output formatter (grouped format)
- `src/aggregate.ts` - new: deduplication, grouping, sorting
- `src/comments.ts` - new: comment deletion using TypeScript compiler API
- `src/rules.ts` - new: rule catalog extraction from all linters
- `src/cli.ts` - parse `--human` flag, add `rules` command, pass `human` to `runLint`
- `src/lintmax-types.ts` - add `comments?: boolean` to `SyncOptions`
- `src/constants.ts` - `readonly/**` already added (done)
- `tests/fixtures/dirty-fixable.ts` - Test 1 (AI slop, all fixable violations)
- `tests/fixtures/dirty-all.ts` - Test 2 (all rule violations)
- `tests/magic.test.ts` - Test 1 runner
- `tests/coverage.test.ts` - Test 2 runner + token comparison
- `docs/` - fumadocs site + playground
- `script/q-install.sh` - remove (Phase 7)
- `package.json` - remove `q` from all scripts (Phase 7)
