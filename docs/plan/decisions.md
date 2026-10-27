# Decisions

Architecture decision records. Status: ✅ accepted / 🕐 pending / ❌ rejected. Check this file before any architectural change; append a new ADR when a hard rule in CLAUDE.md changes. `/idea` lists the `## ADR-` titles below, so keep that heading shape.

## ADR-001 ✅ Specs are GitHub issues, built by an idea → design → build pipeline

**Context:** work on the app is produced by Claude agents and needs a repeatable, reviewable process with the owner as the only merger.
**Decision:** every spec is an issue on the project's GitHub Project; `/build` cuts the branch, runs test-writer → implementer → reviewer, and `ship.mjs` opens the PR; the owner merges. `master` is the default branch and changes only through merged PRs.
**Consequences:** no spec file lives in the repo; agents never merge or push to `master`; the process is defined once in `docs/plan/workflow.md`.

## ADR-002 ✅ TypeScript on Node: Fastify + React/Vite, node-pty for terminals

**Context:** AutoWorker is a self-hosted web app that drives the `claude` CLI, so it needs a server that can run interactive terminal sessions, a browser UI, and one toolchain that the agents can build and verify.
**Decision:**
- Stack: Node >= 22.18 with TypeScript run through Node's native type stripping (no `tsx`/`ts-node`; `erasableSyntaxOnly`, relative imports use `.ts`), Fastify 5 for the server, React + Vite for the client (built to `dist/client` and served by `@fastify/static`), Vitest for tests, Prettier for formatting. Terminals go through `node-pty`.
- State storage: `node:sqlite` plus a data directory (`AUTOWORKER_DATA_DIR`), introduced in a later step; not part of this ADR's code.
- Docker login: Claude Code authenticates inside the container through `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`); `ANTHROPIC_API_KEY` and `GH_TOKEN` are the alternatives. Values live in `.env`, never in the repo.
- Platforms: WSL2/Linux is the target (and where `verify.mjs` is run); `node-pty` needs `build-essential` and `python3` there.

**Rejected alternatives:** Python/FastAPI (a second toolchain next to the Node scripts and a JS client); C#/ASP.NET Core (no maintained Linux PTY library); Express or Hono (Fastify gives schema-friendly routing and a maintained static plugin); htmx (the terminal UI needs a real client app).
**Feasibility result:** the `tests/pty.test.ts` smoke test spawns `node --version` (always) and `claude --version` (skipped only when `claude` is not on PATH) in a PTY and both exit 0 with a version line on the build machine; on Windows `claude` is a `.cmd` shim, so the test starts it through `cmd.exe /c`. The native WSL2 run is covered by the spec's manual test.
**Consequences:** one language end to end; `verify.steps` gains Code `format`, `build` and `test`; a native module (`node-pty`) means installs need a C++ toolchain; `CLAUDE.md` application rules (part 3) rest on this ADR.
