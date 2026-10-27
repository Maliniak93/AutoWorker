---
name: dev-playbook
description: Layout, conventions, patterns and Definition of done for changes to the project's production code.
user-invocable: false
---

# Dev playbook

The implementer reads this first on every Code ticket (`project.config.json` -> `areas[Code].implementer`). Stack (ADR-002): Node >= 22.18 running TypeScript through type stripping, Fastify 5 server, React + Vite client, Prettier. The application rules behind the conventions below are in `CLAUDE.md` (Application rules).

## Layout

- `src/server/` — the Fastify server. `main.ts` is the entry (`npm start`): it loads config, calls `buildApp(deps)` with the real tool prober and listens. `app.ts` builds the app (routes, static client); `config.ts`, `tools.ts`, `health.ts` hold the rest.
- `src/client/` — the React SPA: `index.html`, `main.tsx`, `App.tsx`. Vite builds it to `dist/client` (not committed).
- `src/shared/` — types both sides use (`health.ts`: `HealthResponse`).
- `tests/` mirrors `src/` (see `testing-playbook`). Root config: `vite.config.ts` (Vite and Vitest), `tsconfig.json`, `.env.example`.
- Names: files `kebab-case.ts`, components `PascalCase.tsx`, functions `camelCase`.

## Conventions

- Erasable TypeScript only (`erasableSyntaxOnly`): no `enum`, `namespace` or constructor parameter properties. Relative imports end in `.ts`. No `tsx` or `ts-node`, no server build step.
- Read the environment only in `loadConfig(env)` (`src/server/config.ts`); pass values down as arguments.
- Inject dependencies: `buildApp({ probe })` receives what it calls, so tests pass fakes.
- Host commands (`claude`, `git`, `gh`, OS commands) go through a wrapper like `run` in `tools.ts`: `execFile`, an argument array, no `shell` option, a timeout, a fixed command name. On Windows a `.cmd` shim is started through `cmd.exe /d /s /c` with the same fixed arguments. Never build a shell string from input.
- A host probe never throws: a failure is reported as `missing`.
- A request error is a Fastify reply with its status code and a JSON body (`reply.code(404).send({ error: "Not Found" })` in `app.ts`), never a thrown string. A startup error (bad config, busy port) is an `Error` or a one-line message that names the variable (`PORT`) and exits 1.
- The client talks to the server only through `/api/*` with `fetch`, typed by `src/shared/`.

## Patterns to copy

- New endpoint -> `src/server/health.ts` (the payload builder, typed with `src/shared/`) and its route in `src/server/app.ts` (`app.get("/api/health", …)`). Test: `tests/server/health.test.ts`.
- New screen -> `src/client/App.tsx` (`useEffect` + `fetch("/api/…")`, state typed from `src/shared/`). Test: `tests/client/App.test.tsx`.
- Host tool call -> `src/server/tools.ts` (`probeTool`, `probeGhAuth` over `run`, never throws), passed through `buildApp({ probe })` into `getHealth`.
- New environment variable -> read in `loadConfig` (`src/server/config.ts`), listed in `.env.example`.

## How to look an API up

Libraries move faster than training data: use context7 (`resolve-library-id`, then `query-docs`) before writing an API you are not certain of, and copy the nearest existing usage when it is unreachable.

## Definition of done

- `npm run build` (`tsc --noEmit` + `vite build`) is green and Prettier is clean (`npm run format:check`): the `build` and `format` verify steps.
- Each new environment variable is in `.env.example`, commented, with no secret value.
- A new module is added to `docs/plan/architecture.md` Components.
- `node scripts/verify.mjs` is green for the change's scope (the implementer runs it; `ship.mjs` re-checks it).
- A convention changed -> the matching `.claude/rules/*.md` is updated; a hard rule changed -> an ADR is appended to `docs/plan/decisions.md`.
