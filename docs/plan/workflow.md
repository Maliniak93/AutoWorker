# Workflow

How features get designed and built. A spec is a GitHub issue on the project's **GitHub Project** — never a file in the repo. "The default branch" is `defaultBranch` in `project.config.json`.

## The board

| Field / label | Values | Set by |
|---|---|---|
| Status (built-in) | Todo → In progress → Done | `/design` publishes at Todo; `/build` sets In progress; merging the PR closes the issue and the project's "Item closed" workflow sets Done |
| Tier | 1, 2 | `/design`; `/build --tier` overrides for one run |
| Kind | New, Change, Cleanup | `/design` |
| Area | the names in `project.config.json` `areas` (none on an epic; see "Area") | `create --area`, `edit <n> --area`, `set <n> Area <v>` |
| Priority | P0–P3 (none on a part; see "Priority") | `create --priority` (default P2), `priority <n> <P>` / `/prio` |
| Branch | `feat/<slug>` (none on an epic) | `/design` (`create` reads the card back); a card without one is healed by `gh-project.mjs heal <n>` |
| labels | `spec` (buildable), `epic` (umbrella of a split — its sub-issues are built, never the epic), `skip-tests` | `/design` |

**The queue.** The board order is the build queue, in priority bands: P0 first, then other In progress items, then Todo P1, P2, P3 in board order. `gh-project.mjs queue` prints it; `/board` shows it against git.

**Epics.** `/design` can split work into an `epic` with one sub-issue per part. Each part is a full spec with its own tier, kind, branch and ACs, and leaves the default branch green when it merges. Parts are built in the order they were attached; `prepare` refuses a part while an earlier sibling is open.

## Flow

`/idea` (optional: shape a loose idea into a prompt) → `/design` (interview, publish the spec as an issue) → `/build #<n>` (branch, tests, implementation, verify, review, PR) → **you merge**. `/ops <task>` for git/PR/CI chores, `/check` to verify, `/board` to see the queue, `/prio #<n> P<k>` to reprioritise.

## Agents (`.claude/agents/*.md`)

| Agent | Model / effort | Job | Returns |
|---|---|---|---|
| `test-writer` | Tier 1: haiku/high; Tier 2: sonnet/medium | writes failing tests from the spec's acceptance criteria and runs them filtered to confirm red | `{tests[], projects[], contextFiles[], notes[]}` |
| `implementer` | Tier 1: sonnet/medium; Tier 2: sonnet/high; Tier-1 skip-tests cleanup: haiku/high — escalating once per run to opus/medium (Tier 1) or opus/high (Tier 2) | makes the tests green, owning the design and the tests (every change to either goes in `deviations`), then runs `verify.mjs` itself with up to 3 fixes | `{status, verified, failures[], filesTouched[], projects[], commandsRun[], notes[], deviations[], openQuestions[], manualTest[]}` |
| `reviewer` | opus/medium (Tier 1) or opus/high (Tier 2); re-reviews opus/medium | fresh context, reads the uncommitted change via `scripts/review-diff.mjs` against the spec, applies the `review-checklist` sections of the Area | `{findings[{severity, file, line, claim, evidence}], summary}` |
| `ops` | sonnet/medium | `/ops` chores only: commits, PRs, CI triage, `.github/**` — never a merge | `{branch, commit?, prUrl?, notes[]}` |
| `Explore` | haiku/medium | read-only codebase research for `/design` and `/idea` | text with `path:line` evidence |
| `idea-critic` | sonnet/medium | fresh-context devil's advocate for an `/idea` prompt | ≤ 8 one-line findings, or `none` |

Author ≠ reviewer: the reviewer always runs in a clean context and never edits a file.

## Tier rule

| Tier | When | Starting model |
|---|---|---|
| 1 | a precedent for this exists in the same area; well-scoped, low ambiguity | test-writer haiku/high, implementer sonnet/medium (a skip-tests cleanup: haiku/high), escalating once to opus/medium; reviewer opus/medium |
| 2 | new pattern, cross-module work, or an algorithm | test-writer sonnet/medium, implementer sonnet/high, escalating once to opus/high; reviewer opus/high |

`/design` sets the tier; `/build --tier` overrides it. Escalation happens at most once per run, only upward, only after a real failure (an implementer still red after its 3 fixes).

## Area

The single-select project field Area says which part of the repo a ticket changes. `project.config.json` `areas` is the single source of the list, of each Area's `paths`, and of its build profile (`tests`, `implementer` and `testWriter` playbooks, review `checklist` sections); `node scripts/areas.mjs` prints the map, `areas.mjs of <path…>` the Area of those files.

- **General rule.** Of the files a change touches, the Area with the most files wins (ties: the list order in the config). A change that spans several Areas becomes an epic with one part per Area; the umbrella has none. Adjust this rule here when your Areas need a combined one.
- **Profile.** The Area decides the phases: an Area with `tests: true` runs test-writer → implementer → reviewer, any other runs implementer → reviewer (the implementer then writes the missing tests itself). The workflow prompt starts with `Read first: <playbooks>`; the reviewer applies the named `review-checklist` sections. A ticket without an Area takes the full path.
- **Outside the Area.** `areas.mjs outside <Area>` lists the changed files outside the ticket's Area: each is a `minor` reviewer finding, `blocking` only when unrelated to the spec. The run report lists them too.

## Priority

The single-select field Priority says how urgent a top-level item is. A part has none and follows its epic; an item without a value counts as P2.

| Level | Meaning |
|---|---|
| P0 | urgent: drop the queue — a broken default branch, data loss, a blocker for everything else; lifted above running work |
| P1 | high: next in line, wanted this week or blocking a planned milestone |
| P2 | normal: the default; planned work in board order |
| P3 | low: nice to have, builds when nothing more urgent waits |

A Todo item with priority P goes directly after the last Todo item whose priority is P or more urgent. No open item stands ahead of its open dependency (`## Depends on`): `priority`, `create`, `edit` and `move` raise the dependency into the dependent's band. `/board` shows a Priority column and warns about misplaced cards.

## Definition of Ready (before `/build` accepts a spec)

- An open issue on the project with the `spec` label, Status Todo (or In progress for a resumed run), and a Branch.
- Every acceptance criterion is a checkbox that names a test or a command that proves it.
- Tier is set (1 or 2); `skip-tests` is set deliberately — only on a spec that changes no behaviour.
- No open question left in the body; no open issue under `## Depends on`.
- A change visible in the app has its `## Manual test` section.

## Manual test plan

The steps a person runs by hand after a merge. A spec whose change is visible in the app ends with `## Manual test`; an epic holds the whole-feature scenario in the same section. Omit it for `skip-tests` specs and cleanups. A part plan is about 5–15 steps, an epic's scenario 15–30. Shape: a numbered **Preparation** block, then numbered **Steps** on concrete values, dates and routes, each ending in `→ <expected result>`. A part with no UI effect carries only `Verified in the epic plan, step <n>.` `gh-project.mjs check` rejects a `- [ ]` line in the section.

**Standard preparation** (the start of every plan):
<!-- FILL IN: how to bring the app to a state where a plan can run: pull the default branch, start the app, create a fresh account, seed data, the local URL. -->

## Definition of Done

- `node scripts/verify.mjs` is green for the change's scope (picked from the changed files against the default branch; a file in `verify.fullScope` widens it to everything). The implementer runs it; `--all` on an epic's last part; `ship.mjs` re-checks with `--cache-check`.
- Review has zero `blocking` findings.
- The Definition of done of each playbook in the Area's profile holds.
- The whole change is committed on the issue's branch, pushed, and its PR against the default branch is open; the run report is commented on the issue and its acceptance criteria are ticked.
- Any rule or ADR the spec touched is in the same commit.
- The user merges the PR when CI is green.

## Git conventions

- Branch: the issue's Branch field — `feat/<slug>` — cut by `gh-project.mjs prepare`. Chores: `chore/<slug>` or `fix/<slug>`.
- Commit message: the spec's title, a `Spec: #<n>` line and the co-author trailer — made by `ship.mjs`. PR opened by `ship.mjs` against the default branch. **The user merges; no agent merges.**
- No agent runs a git mutation in a build run: `prepare` cuts the branch and `ship.mjs` commits and pushes. Otherwise only `ops` inside an explicit `/ops <task>`.
- `git-guard` hook: commit/push on `feat/*`, `fix/*`, `chore/*` and `gh pr create --base <default branch>` from those run without asking; `gh pr merge` and a push to the default branch ask; a force-push to it is denied.
