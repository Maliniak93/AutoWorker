---
name: scripts-playbook
description: node --test conventions, GitHub API budget, usage headers and the Definition of done for scripts/*.mjs changes.
user-invocable: false
---

# Scripts playbook
Tooling lives in `scripts/` as Node ESM (`*.mjs`, Node >= 22, no npm dependencies), run as `node scripts/<name>.mjs`. Its tests use the built-in runner, `node --test`; no test dependency is added. Project values (default branch, repo, project number, areas) come from `scripts/config.mjs`, never hardcoded.

## Tests (`node --test`)
- A test sits beside its script as `<name>.test.mjs` (`ship.mjs` → `ship.test.mjs`) and imports the script's exported functions. `verify.mjs` runs every `scripts/*.test.mjs` in its `scripts-test` step.
- No network: a test never calls GitHub, the Claude CLI or a dev server. Anything that needs `gh` runs against `scripts/fake-gh.cjs`, wired in through `GH_BIN` by `scripts/fake-gh-sandbox.mjs` (a temp copy of `scripts/` with a recorded call log).
- Pure logic (parsing, state decisions) gets plain `assert` cases on exported functions. A wait takes an injected clock, never a real sleep.

## GitHub API budget
- REST over GraphQL wherever REST answers the question: the core quota is separate from the GraphQL one the project reads spend.
- One call per fact: read a value once and reuse it. A loop over items becomes one page or one batched GraphQL mutation, never a call per item.
- A script that spends GitHub calls handles `GhLimitError` through `exitOnGhLimit` from `gh.mjs`; it never retries in a loop.

## Usage header
- The header is the file's line 2, right after the shebang: `// Usage: node scripts/<name>.mjs [<flags>]  <one-line description>`, then one `//` line per flag. It is the only prose in the file.
- A flag added, renamed or removed changes the header in the same change. A header naming a flag the script no longer accepts is a bug.

## Commands row
A script a person runs gets one row in the CLAUDE.md `Commands` table (task, command, one-line description). Edit the row when the script changes; never add a second row for the same script.

## Definition of done
- A `node --test` test for each acceptance criterion the script's behaviour answers. A criterion that is a command (a grep, a dry run) shows that command in `commandsRun` instead.
- The usage header is current: every flag listed, none removed.
- The CLAUDE.md `Commands` row is updated when a script was added, renamed or its usage changed.
- `node scripts/verify.mjs` is green (scoped by the changed files; `scripts-test` runs on any scripts change).
