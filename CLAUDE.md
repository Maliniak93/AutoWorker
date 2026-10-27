# AutoWorker

Web app that automates the owner's work with Claude: it replaces a pile of ad-hoc scripts and manages code production for the owner's other apps. Self-hosted (WSL or another machine). The owner talks Polish; code, specs, commits and docs are English.

**Status:** the application is not designed yet. Today the repo holds the tooling that builds it (`scripts/`, `.claude/`). The first `/idea` → `/design` cycle decides the stack and scaffolds `src/`; until then `verify.steps` has only the scripts test step.

## Process

`/idea` → `/design` → `/build #<n>` → **the owner merges**. Specs are GitHub issues on the project board, never files. Full process, tiers, agents, DoR/DoD: `docs/plan/workflow.md`. Product scope: `docs/plan/product.md`. Design: `docs/plan/architecture.md`. ADRs: `docs/plan/decisions.md`.

## Commands

| Task | Command | Notes |
| --- | --- | --- |
| Check tooling | `node scripts/preflight.mjs` | node, git, gh, auth scope, remote, default branch |
| Verify the change | `node scripts/verify.mjs` | scope picked from changed files; `--all` runs every step |
| Script tests | `node --test "scripts/*.test.mjs"` | built-in runner, no npm dependencies |
| Board / queue | `node scripts/gh-project.mjs queue` | `list`, `get <n>`, `set <n> <field> <value>` |
| Area of files | `node scripts/areas.mjs of <path…>` | the map lives in `project.config.json` |
| Ship a build | `node scripts/ship.mjs <n> --from-run` | run by `/build` only: commit, push, open PR |
| Plan status | `node scripts/plan-status.mjs --write` | refreshes the block in `docs/plan/README.md` |
| Idea prompts | `node scripts/idea.mjs list` | saved `/idea` prompts; also `show <slug>`, `context` |

## Repo layout

- `project.config.json` — the one config: name, default branch (`main`), GitHub project number, areas, verify steps.
- `.claude/` — agents, skills (slash commands + playbooks), hooks, workflows; `settings.json` is the shared allow-list.
- `scripts/` — Node ESM tooling (`*.mjs`, Node >= 22, no npm deps), tests beside it as `*.test.mjs`.
- `docs/plan/` — product, architecture, decisions, ideas, workflow; `prompts/` holds `/idea` output.
- `src/`, `tests/` — application code and its tests (Code area); created by the first architecture spec.

## Hard rules

- Agents never merge, never push to `main`, never force-push; only `ship.mjs` (in `/build`) and `ops` (in `/ops`) run git mutations.
- Work happens on `feat/*`, `fix/*` or `chore/*` branches cut from `main`; `main` changes only through a merged PR.
- A spec is a GitHub issue with Tier, Kind, Area, Priority and Branch; no spec lives as a file in the repo.
- Scripts take project values from `scripts/config.mjs`, never hardcode them, and add no npm dependency.
- Secrets never enter the repo: `.env*` is ignored and denied to agents; commit `.env.example` only.
- A hard rule changes only together with an ADR in `docs/plan/decisions.md`. Application rules are added here by the first architecture spec.

## Conventions

- Look a library API up with context7 before writing code against it.
- Tests are written red first from the spec's acceptance criteria (`testing-playbook`); production conventions live in `dev-playbook` and `.claude/rules/`.
- A convention changed → update its playbook or rule in the same change; keep this file at or under 75 lines.
