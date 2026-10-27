---
name: dev-playbook
description: Layout, conventions, patterns and Definition of done for changes to the project's production code.
user-invocable: false
---

# Dev playbook
<!-- FILL IN: replace this file's placeholders with your stack's conventions. The implementer reads it first on every Code ticket (project.config.json -> areas[Code].implementer). Keep it short and concrete: a rule an agent can follow without guessing. Delete this comment when done. -->

## Layout
<!-- FILL IN: where things live. Source folders, how a feature/module is organised, where shared code goes, naming. One short list. -->

## Conventions
<!-- FILL IN: language and framework conventions the code must follow: error handling, validation, logging, configuration, dependency rules between modules, what is forbidden. Link to the hard architecture rules in CLAUDE.md instead of repeating them. -->

## Patterns to copy
<!-- FILL IN: for each recurring kind of change (a new endpoint, a new screen, a new job, a data migration), the one existing file or folder to copy as the precedent. -->

## How to look an API up
Libraries move faster than training data: use context7 (`resolve-library-id`, then `query-docs`) before writing an API you are not certain of, and copy the nearest existing usage when it is unreachable.

## Definition of done
<!-- FILL IN: the checks beyond green tests that every Code change needs: generated clients or schemas regenerated, request samples or docs updated, migrations added, formatter clean. -->
- `node scripts/verify.mjs` is green for the change's scope (the implementer runs it; `ship.mjs` re-checks it).
- A convention changed -> the matching `.claude/rules/*.md` is updated; a hard rule changed -> an ADR is appended to `docs/plan/decisions.md`.
