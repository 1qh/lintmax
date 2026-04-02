# lintmax

Anti AI slop tool designed for agents. Runs biome, oxlint, eslint, prettier, sort-package-json.

## Repo structure

- `src/` - source code (TypeScript, compiled to `dist/`)
- `script/` - utility scripts (smoke test, cleanup)
- `PLAN.md` - implementation plan for the overhaul (READ THIS FIRST)

## Commands

- `bun run verify` - full pipeline: clean, install, build, fix, check, smoke
- `bun run build` - compile TypeScript to dist/
- `bun run fix` - run lintmax fix on itself
- `bun run check` - run lintmax check on itself
- `bun run smoke` - smoke test (packs tarball, installs in temp dir, runs)
- `bun run release` - publish to npm (only the repo owner runs this)

## Pre-commit

Uses `simple-git-hooks` configured in package.json. Hook runs `bun run verify && git add -u`. Never skip it with `SKIP_SIMPLE_GIT_HOOKS=1`.

## Rules

- No comments in code (the tool deletes comments - practice what we preach)
- Use `one-var: never` (separate const declarations)
- Never use `q` wrapper for new code (being removed in Phase 8)
- All changes must pass `bun run verify` via the pre-commit hook

## Current task

Implementing the overhaul described in PLAN.md. Start with Phase 1.
