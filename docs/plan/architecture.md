# Architecture

## Overview

The application is not designed yet; the first architecture spec (`/idea` → `/design`) decides the stack and scaffolds it. What exists today is the tooling that builds it: `scripts/` (GitHub Project and build pipeline, Node ESM) and `.claude/` (agents, skills, hooks, the `build-feature` workflow). See `docs/plan/workflow.md` for how they fit together.

## Components

None yet for the application.

## Data flow

None yet for the application.

## Current vs target

| Area | Today | Target |
| --- | --- | --- |
| Code | no `src/`, no stack, no `package.json`; `verify.steps` holds only `scripts-test`, so a Code change is not verified yet | stack and scripts chosen by the first architecture spec, which also adds the Code `format`/`build`/`test` steps to `verify.steps` in `project.config.json` and adapts `dev-playbook` and `testing-playbook` |
