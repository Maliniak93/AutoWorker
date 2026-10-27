# AutoWorker

Web app that automates the owner's work with Claude: it replaces a pile of ad-hoc scripts and manages code production for the owner's other apps. Self-hosted (WSL or another machine). The owner talks Polish; code, specs, commits and docs are English.

**Status:** the app is scaffolded: a Fastify + React health page and a Docker runtime (ADR-002). Its conventions are in `dev-playbook` and `testing-playbook`. The repo also holds the tooling that builds it (`scripts/`, `.claude/`).

## Process

`/idea` → `/design` → `/build #<n>` → **the owner merges**. Specs are GitHub issues on the project board, never files. Full process, tiers, agents, DoR/DoD: `docs/plan/workflow.md`. Product scope: `docs/plan/product.md`. Design: `docs/plan/architecture.md`. ADRs: `docs/plan/decisions.md`.

## Commands

| Task              | Command                                | Notes                                                                          |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------------------ |
| Check tooling     | `node scripts/preflight.mjs`           | node, git, gh, auth scope, remote, default branch                              |
| Verify the change | `node scripts/verify.mjs`              | scope picked from changed files; `--all` runs every step                       |
| Script tests      | `node --test "scripts/*.test.mjs"`     | built-in runner, no npm dependencies                                           |
| Install app deps  | `npm ci`                               | WSL2/Linux; compiles `node-pty` (needs `build-essential`, `python3`)           |
| Run the app       | `npm start`                            | builds the client, serves `http://127.0.0.1:4280` (`HOST`, `PORT` from `.env`) |
| Dev server        | `npm run dev`                          | server with `--watch` plus the Vite dev server                                 |
| App tests         | `npm test`                             | Vitest, whole suite; one file: `npx vitest run <file>`                         |
| Board / queue     | `node scripts/gh-project.mjs queue`    | `list`, `get <n>`, `set <n> <field> <value>`                                   |
| Area of files     | `node scripts/areas.mjs of <path…>`    | the map lives in `project.config.json`                                         |
| Ship a build      | `node scripts/ship.mjs <n> --from-run` | run by `/build` only: commit, push, open PR                                    |
| Plan status       | `node scripts/plan-status.mjs --write` | refreshes the block in `docs/plan/README.md`                                   |
| Idea prompts      | `node scripts/idea.mjs list`           | saved `/idea` prompts; also `show <slug>`, `context`                           |

## Repo layout

- `project.config.json` — the one config: name, default branch (`master`), GitHub project number, areas, verify steps.
- `.claude/` — agents, skills (slash commands + playbooks), hooks, workflows; `settings.json` is the shared allow-list.
- `scripts/` — Node ESM tooling (`*.mjs`, Node >= 22, no npm deps), tests beside it as `*.test.mjs`.
- `docs/plan/` — product, architecture, decisions, ideas, workflow; `prompts/` holds `/idea` output.
- `src/` — the app: `server/` (Fastify, entry `main.ts`), `client/` (React + Vite), `shared/` (types both use). `tests/` mirrors it (Vitest). Code area.

## Hard rules

- Agents never merge, never push to `master`, never force-push; only `ship.mjs` (in `/build`) and `ops` (in `/ops`) run git mutations.
- Work happens on `feat/*`, `fix/*` or `chore/*` branches cut from `master`; `master` changes only through a merged PR.
- A spec is a GitHub issue with Tier, Kind, Area, Priority and Branch; no spec lives as a file in the repo.
- Scripts take project values from `scripts/config.mjs`, never hardcode them, and add no npm dependency.
- Secrets never enter the repo: `.env*` is ignored and denied to agents; commit `.env.example` only.
- A hard rule changes only together with an ADR in `docs/plan/decisions.md`; the application rules below rest on ADR-002.

## Application rules (ADR-002)

- Server code lives in `src/server`, client code in `src/client`, types both use in `src/shared`; the client never imports from `src/server`.
- Server TypeScript uses only erasable syntax (Node runs it by type stripping): no `enum`, `namespace` or parameter properties; relative imports end in `.ts`.
- The app listens on `127.0.0.1` unless `HOST` says otherwise; only the Docker image sets `0.0.0.0`. There is no login, so nothing binds publicly.
- Host commands (`claude`, `git`, `gh`, OS commands) run with `shell: false`, an argument array and a timeout — never a shell string built from input.
- Every new environment variable is added to `.env.example`; secrets come only from the environment.
- Application dependencies go in `package.json` only; the `scripts/` rule "no npm dependency" stays.

## Conventions

- Look a library API up with context7 before writing code against it.
- Tests are written red first from the spec's acceptance criteria (`testing-playbook`); production conventions live in `dev-playbook` and `.claude/rules/`.
- A convention changed → update its playbook or rule in the same change; keep this file at or under 75 lines.
