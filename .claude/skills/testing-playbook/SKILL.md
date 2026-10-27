---
name: testing-playbook
description: Test conventions - where tests and helpers live, how to run a single test, and the patterns every new test follows.
user-invocable: false
---

# Testing playbook

The test-writer reads this first on every Code ticket (`project.config.json` -> `areas[Code].testWriter`).

Write tests RED first: derive them from the spec's acceptance criteria, run them, and confirm they fail
before any production code exists. A compile failure because the API does not exist yet is an acceptable
red — report which type/member is missing. A new test that passes immediately is a bug in the test or a
spec already satisfied — never leave that unresolved.

## Layout

- `tests/server/*.test.ts` — server tests in the Node environment. Most go through `buildApp` and `app.inject()` (integration level, no socket). `main.test.ts` spawns the real entry for the busy-port case.
- `tests/client/*.test.tsx` — component tests in jsdom: the first line is `// @vitest-environment jsdom`.
- `tests/pty.test.ts` — the node-pty smoke test (a real PTY running host programs). It is the only test that starts a host program.
- Each test file mirrors its `src/` file: `src/server/health.ts` -> `tests/server/health.test.ts`. Vitest picks up `tests/**/*.test.{ts,tsx}` (`vite.config.ts`). There is no end-to-end layer yet.

## Where a helper lives — never copy one

- `tests/helpers/` holds the shared fakes. `probe.ts` exports `fakeProbe({ missing?, ghLoggedIn? })`, a prober where every tool is `ok` unless overridden.
- Rule of thumb: a duplicated test helper is extracted into `tests/helpers/` on the second use — it is plumbing, and copies drift silently.

## How to run tests

Prerequisite: `npm ci` in WSL2 or Linux (it compiles `node-pty`). `claude` on PATH is optional: without it the `claude --version` pty test is skipped, and the test says so.

- Whole suite: `npm test` (runs `vitest run`).
- One file: `npx vitest run tests/server/health.test.ts`.
- One test by name: `npx vitest run tests/server/health.test.ts -t "GET /api/health returns 200 with version and ok tools"` (`-t` matches a substring of the full name; use the test's sentence).

## Patterns every test follows

- Test names are the AC's sentence, under a `describe` that names the endpoint or component: `describe("GET /api/health")` containing `it("a missing tool is reported as missing without failing the endpoint")`.
- Server: arrange with `buildApp({ probe: fakeProbe({ … }) })`, act with `app.inject({ method, url })`, assert on `statusCode` and the parsed JSON. The busy-port test in `main.test.ts` is the one exception that uses a real socket.
- Host tools are faked through the injected `probe`; a unit test never runs the real `claude`, `git` or `gh`.
- Client: render with Testing Library, stub `fetch` with `vi.stubGlobal("fetch", …)` returning a `Response`, `waitFor` the visible text; `cleanup()` and `vi.unstubAllGlobals()` in `afterEach`.
- Assert on behaviour (status, fields, visible text), not on internals.
- Temporary files: `mkdtempSync(join(tmpdir(), "aw-…"))`, never a path inside the repo.
- Cross-cutting cases for a new endpoint: the 200 happy path, a missing dependency (answers 200 and reports `missing`, never 500), and an unknown `/api` route answers 404 (`static.test.ts`). There is no login yet, so no authorisation test; a bad request must get a 4xx Fastify reply.

## Definition of done

- Every acceptance criterion has a test that fails if the behaviour regresses, named as the spec names it.
- No test is skipped, commented out or weakened to pass.
