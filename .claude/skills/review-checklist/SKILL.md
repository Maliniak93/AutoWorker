---
name: review-checklist
description: Adversarial checklist for reviewing a diff against its spec - blocking vs minor findings, evidence required.
user-invocable: false
---

# Review checklist
Purpose: a fresh-context, adversarial review of the working tree against one spec. You have not seen the
implementation being defended — verify every claim against the tree yourself, cite evidence, never take a prior
agent's report at face value.

## Gather your own evidence
1. Read the spec at the given path in full: Scope, Design decisions, Acceptance criteria, Out of scope.
2. The change is uncommitted on its branch before you are called; `<default branch>...HEAD` is empty here. `node scripts/review-diff.mjs --stat` lists it, `node scripts/review-diff.mjs -- <path>` shows a file's diff (new untracked files included), plain `node scripts/review-diff.mjs` shows everything. Nothing is staged.
3. Read only the `docs/plan/architecture.md`/`decisions.md` sections the spec names, plus the `.claude/rules/*` files scoped to what the diff touches.
4. Read the changed files and the tests that claim to prove them.
5. Run read-only commands to settle a claim instead of guessing: a targeted single-test run, a `grep` for a pattern a hard rule forbids, `ls` for a file the spec says should exist.

## Blocking findings — only these
The delegation names the sections that apply to the Area; `Common` applies to every change.

### Common
- An acceptance criterion with no test that would fail if the behavior regressed, and no verified command output backing it.
- A spec with the `skip-tests` label but changed real behavior — the skip is only for deletion, config, docs or a pure move. "No new tests" is then not a finding on its own; **behavior shipped under that skip is.**
- Scope creep: anything in the diff the spec doesn't ask for, or that its Out of scope section forbids.
- A convention or hard rule changed without a matching update to `.claude/rules/*` or `docs/plan/decisions.md`.
- A `## Manual test` plan — kept from the spec or rewritten in `docs/plan/issues/<n>.manual.md` — that names a route, screen or action absent from the code. Wording problems in it are minor.

### Code
- A violation of a hard architecture rule in `CLAUDE.md` or an accepted ADR.
- A security hole: unvalidated input at a boundary, a secret in the diff, an authorisation check skipped.
- Data loss: a migration or script that destroys data the spec does not say may be destroyed.
- The public surface changed (API, CLI, schema) but its generated client, docs or request samples were not updated.

### Claude
- CLAUDE.md disagrees with `docs/plan/workflow.md`, another skill or an agent.
- A reference to a removed skill, agent, script, flag or ADR remains in `.claude/`, `CLAUDE.md` or `docs/plan/`.

### Scripts
- An acceptance criterion with no `node --test` test (`<name>.test.mjs`) and no command shown in the run report.

### CI/Infra
- The acceptance criterion's command does not pass locally, or the runbook or README the change affects is not updated.

### Docs
- A link or path in a changed doc does not exist.

### Areas without a test-writer
- Scripts, Claude, Docs and CI/Infra have no test-writer. A changed production file under the Code area's paths (see `node scripts/areas.mjs`) in such a change is `blocking`: the ticket has the wrong Area, or it must be split.

Everything else — naming, style, duplication, a "nicer" alternative structure — is `minor`, or not worth reporting at all.

## Do not raise
Requests for extra abstraction, defensive code for cases the type system already makes impossible, tests for impossible cases, style preferences the rules don't actually state, or an alternative design the spec already settled. Flag only what affects correctness or the spec — a short spec faithfully implemented is a clean review; say so.

## Evidence discipline
Every finding needs `evidence` you actually saw: a quoted line, a command's output, or confirmation a file is absent. No evidence, no finding. Never edit a file to prove a point, and never run a git mutation.

## Output
```json
{
  "findings": [
    {
      "severity": "blocking",
      "file": "src/items/add-item.ts",
      "line": 42,
      "claim": "AC-3 has no test",
      "evidence": "grep -r \"unknown\" tests/items returns nothing",
      "suggestedFix": "add a test posting an unknown id and asserting the mapped status"
    }
  ],
  "summary": "1 blocking, 2 minor"
}
```
`findings: []` with a one-line `summary` is a valid, complete result when the change is clean.
