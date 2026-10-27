<!-- Body of a spec issue. Tier, Kind, Branch and Status live in project fields and skip-tests is a label, so none of them is repeated here. Delete every HTML comment before publishing. -->
<!-- Keep it under ~200 lines: link to architecture.md sections instead of restating them. -->

## Goal

<!-- One sentence: what exists when this spec is done. -->

## Current behaviour

<!-- Change only (delete the section for new behaviour): what the code does today, from what Explore actually found — the modules, entities, components and tests that own it. Then one line: what it should do instead. -->

## Why

<!-- The problem or gap this closes. Link the architecture.md section or ideas.md line this comes from, if any. -->

## Depends on

<!-- Only when this spec cannot build before another open issue merges: one line each, `- #128 — what it needs from it`. `prepare` refuses to build while any listed issue is open. Delete the section otherwise. -->

## Scope

<!-- What changes, grouped by Area when more than one: modules, entities, endpoints, screens, config. -->

## Code map

<!-- What Explore found, so no build agent has to rediscover it: one line each, `path:start-end — why` or `path — Member()`. Name the precedent to copy, the test files and helpers to extend (by member name), and the files expected to change. 5–15 lines; paths that exist today, plus new files marked (new). -->

## Out of scope

<!-- Explicitly not touched by this spec, even if related. Not optional. -->

## Design decisions

<!-- Points worth recording; reference ADRs by number. -->

## Data / API changes

| Entity / endpoint | Change | Migration? |
|---|---|---|
| | | |

## Acceptance criteria

<!-- Checkboxes so the project card shows progress. Each one Given/When/Then with a proof the reviewer can run. -->

- [ ] **AC-1** Given ___, when ___, then ___. — proof: `<test or command>`

## Manual test

<!-- The steps a person runs by hand after the merge. Delete the section when the change is not visible in the app: skip-tests, cleanup. About 5–15 steps. Describe behaviour, not exact labels, unless the label is a criterion. Standard preparation: docs/plan/workflow.md → Manual test plan. Shape: a numbered **Preparation** block (the standard preparation plus what this change adds), then numbered **Steps** on concrete values, dates and routes, each ending in `→ <expected result>`. -->

## Verification

<!-- Commands to run and the proof each AC names. The manual steps for a person are in ## Manual test above. With skip-tests: "No new tests: the gate is <commands> plus the existing suites". -->
