# Architecture

## Overview

AutoWorker is a self-hosted Node + TypeScript web app (ADR-002): a Fastify server exposes a JSON API and serves a React single-page client. Today it ships a health page that reports the app version and whether `claude`, `git` and `gh` are available. Around it sits the tooling that builds it: `scripts/` (GitHub Project and build pipeline, Node ESM) and `.claude/` (agents, skills, hooks, the `build-feature` workflow). See `docs/plan/workflow.md` for how they fit together.

## Components

- **Server** (`src/server/`): `main.ts` loads config and listens (a busy port exits with code 1 and a `PORT` hint); `app.ts` builds the Fastify app, registers `GET /api/health` and serves `dist/client` with an SPA fallback for non-`/api` GET routes; `config.ts` reads `HOST` and `PORT`; `tools.ts` probes CLI tools; `health.ts` assembles the health payload. TypeScript runs through Node's native type stripping.
- **Client** (`src/client/`): React app built by Vite to `dist/client`; `App.tsx` fetches `/api/health` and shows the version and each tool's status.
- **Shared** (`src/shared/`): types used by both sides, such as `HealthResponse`.
- **Tests** (`tests/`): Vitest, including a `node-pty` smoke test that proves terminals can be spawned.

## Data flow

Browser -> `GET /api/health` -> `getHealth` -> `probeTool` (`<tool> --version`) and `probeGhAuth` (`gh auth status`) for `claude`, `git`, `gh` -> JSON `HealthResponse` -> `App` renders it. A probe never throws; a failure is reported as `missing`.

## Current vs target

| Area | Today | Target |
| --- | --- | --- |
| Code | server, client, shared types and tests exist; `verify.steps` runs Code `format`, `build` and `test` | terminal sessions (WebSocket, xterm.js, `node-pty`), state in `node:sqlite`, Docker packaging |
