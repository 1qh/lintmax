# lintmax overhaul: token-efficient agent-first output

## Problem

lintmax output is designed for humans. Agents (Claude Code, Cursor, etc.) are now the primary consumer. Every decorative line, source snippet, help text, and progress indicator costs tokens and provides zero value to an agent that already knows what each rule means and will read the source file itself.

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

`lintmax fix --human` or `lintmax check --human`: current verbose output for human debugging.

## Token savings

```
current: ~325 tokens per 3 errors
new:      ~22 tokens per 3 errors (93% reduction)
```

## Implementation

### Phase 1: JSON collection

Run each linter with JSON output instead of human output:
- biome: `--reporter=json`
- oxlint: `-f json`
- eslint: `-f json`
- tsc: `--pretty false` (line-parseable: `file(line,col): error TSxxxx: message`)
- prettier: `--list-different` (filenames only)

Parse all results into a unified structure:
```ts
type Diagnostic = { file: string; line: number; rule: string; linter: string }
```

### Phase 2: Aggregation and deduplication

- Group by file
- Within file, group by linter
- Within linter, group by rule, collect line numbers
- Deduplicate overlapping rules between linters (biome and eslint may flag the same thing)

### Phase 3: Output formatting

Agent mode (default):
- Build the grouped format string
- Print to stdout
- Exit with code 1 if any errors

Human mode (`--human`):
- Current behavior, unchanged

### Phase 4: tsc integration

- Add optional `typecheck: true` in lintmax config
- Run `tsc --noEmit --pretty false`
- Parse `file(line,col): error TSxxxx: message` format
- Include in grouped output under `tsc` linter

### Phase 5: Rule catalog

Extract all available rules programmatically:
- oxlint: `--rules` (markdown table with fixable column)
- biome: parse biome.json schema or source metadata
- eslint: `--print-config` active rules
- tsc: static error code list

Output as machine-readable catalog:
```
rules[705]{linter,name,fixable}:
 oxlint,no-explicit-any,yes
 oxlint,no-unused-vars,yes
 biome,useConst,yes
 ...
```

Track diffs when linters update via snapshot.

## Tests

### Test 1: Magic

A deliberately messy TypeScript file violating every fixable rule (bad formatting, wrong quotes, unused imports, unsorted imports, etc.).

- `lintmax check` on it → outputs all violations in compact format
- `lintmax fix` on it → silence (exit 0)
- `lintmax check` again → silence (exit 0)
- Proves: messy input → clean output → zero noise

### Test 2: Coverage + Efficiency

A TypeScript file violating every rule (fixable + non-fixable).

- `lintmax check` on it → compact output showing all caught violations
- Also runs raw linters on same file, compares token counts
- Prints comparison: `lintmax: 75 tokens / raw: 1600 tokens (95% saved)`
- Proves: full rule coverage + token efficiency
- Doubles as snapshot for tracking linter updates

## Showcase

### Playground (Vercel-deployed)

Web page where you paste dirty code and see:
- Left: raw linter output (verbose)
- Right: lintmax output (compact)
- Token count comparison in real-time
- "Fix" button that shows the cleaned code + silent output

### README

- Terminal recording (GIF) showing Test 1 and Test 2 in action
- Rule count badge auto-updated from catalog
- Before/after token comparison screenshot

## CLI changes

```
lintmax fix              # agent mode: fix all, silent on success
lintmax fix --human      # human mode: current verbose output
lintmax check            # agent mode: compact error output
lintmax check --human    # human mode: current verbose output
lintmax rules            # print rule catalog
lintmax rules --fixable  # print only fixable rules
```

## CI optimization

Skip CI when only markdown/docs change. In consumer repos (like cnsync), the sync.yml workflow should use path filtering:

```yaml
on:
  push:
    branches: [main]
    paths-ignore:
      - '**.md'
      - 'PLAN.md'
      - 'LICENSE'
      - '.gitignore'
```

lintmax itself should also skip tests/lint on doc-only changes in its own CI.

## File changes in lintmax repo

- `src/pipeline.ts` - run linters with JSON output, parse results
- `src/format.ts` - new: agent output formatter (grouped format)
- `src/rules.ts` - new: rule catalog extraction
- `src/cli.ts` - add `--human` flag, add `rules` command
- `tests/fixtures/dirty-fixable.ts` - Test 1 fixture
- `tests/fixtures/dirty-all.ts` - Test 2 fixture
- `tests/magic.test.ts` - Test 1
- `tests/coverage.test.ts` - Test 2
