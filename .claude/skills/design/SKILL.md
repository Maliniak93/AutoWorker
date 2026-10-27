---
name: design
description: Interview the user about a feature, a change to existing behaviour, or a refactor, then - after approval - publish a build-ready spec as an issue on the project's GitHub Project. Writes no code.
argument-hint: "<feature, change or refactor description | idea:<slug>>"
disable-model-invocation: true
model: claude-opus-5-5
effort: high
---

Turn `$ARGUMENTS` into a spec that `/build` can execute unattended. The spec is drafted locally,
discussed until approved, and only then published as a GitHub issue with Status **Todo** on the
project. You write a document, never code. Talk to the user in Polish; write the spec in English.

## First run guard

Read `project.config.json`. If `"name"` is still `"my-project"` or `github.projectNumber` is `0`, tell the
user to follow README.md "Quick start" (run `node scripts/gh-project.mjs init`) and stop.

`$ARGUMENTS` = `idea:<slug>` → `node scripts/idea.mjs show <slug>` is the request (shaped by `/idea`):
its "Decisions already made" are settled — do not re-ask them; its "Open questions for /design" are yours
to ask or settle; its "Related" names related issues — an open `#n` listed first is the issue to amend
(**Amending an existing issue** below). After `create`/`edit` publishes, run
`node scripts/idea.mjs mark <slug> used --issue <n>`.

Three kinds of spec come through here, and they are shaped differently:

| Kind | Trigger | Shape |
|---|---|---|
| **New** | something that does not exist yet | Goal → Scope → AC with new tests |
| **Change** | existing behaviour should work differently | **Current behaviour → desired behaviour**, then Scope → AC on updated or new tests |
| **Cleanup** | deletion, config, docs, a pure move — no behaviour changes | Goal → Scope → AC proved by commands, plus skip-tests |

A bug — something already broken against its own intent — is not a design: fix it directly, or write it
up as a change spec once you know the cause. "I want it to work differently" is a **change**, and it is yours.

## Steps

1. Run `node scripts/plan-status.mjs` — it lists every open spec issue — and `node scripts/gh-project.mjs queue` (the build
   queue in board order, with each item's `id`, `manual` and an epic's `next`), then read **only** the sections of
   `docs/plan/architecture.md` / `ideas.md` that this change actually touches. Not the folder. If an open issue already
   covers the idea, say so and ask whether to extend it instead. An `idea:<slug>` prompt: its `priority:` is the proposed
   priority; its `area:` and `## Proposed split` are the starting cut (`epic` means an umbrella with those parts).
2. Need a fact about the code (does this module exist, what does that consumer do, is there a
   precedent)? Send an `Explore` subagent for it. Do not read a dozen files yourself.
   **For a change or a refactor this is mandatory before you write a line of the spec**: send
   `Explore` after the current implementation — which modules, entities, components and tests
   own the behaviour today — and write what it found under "Current behaviour". A change spec that
   guesses at today's code produces a Tier-2 mess at implementation time.
   **Every spec gets a `## Code map`** (new behaviour too): ask Explore for the precedent to copy,
   the test files and helpers to extend, and the files that will change — as `path:start-end — why` or
   `path — Member()` lines, 5–15 of them — and paste that list into the draft. The test-writer,
   implementer and reviewer start from it instead of each rediscovering the code, which is where most
   of a build run's tokens go.
   The draft's area: `node scripts/areas.mjs of <the Code map paths>`, checked against the Area rules in
   `docs/plan/workflow.md` → Area.
   If Explore finds the change needs another **open** issue merged first, list it under
   `## Depends on` — `prepare` then refuses to build until it is closed.
3. Ask as many questions as the design genuinely needs — there is no quota. The filter is not the
   count, it is this: **ask only what changes the design, and only what you cannot settle yourself.**
   Anything an ADR, a rule in `.claude/rules/`, or an existing pattern already answers, decide and
   record under Design decisions instead of asking. Use `AskUserQuestion`, one topic per question,
   batched 2–4 per call so the user answers a screen at a time rather than a drip. When an answer
   opens a real fork, ask the follow-up — a spec that hides an open question inside prose is worse
   than one more round.
4. Draft the issue body in the session scratchpad as `<slug>.md`, from
   `.claude/skills/design/issue-template.md`. **Never write it into the repo** — the draft is not a
   deliverable, the issue is. Pick a kebab-case `<slug>`; the branch becomes `feat/<slug>`. Keep a
   list of open questions in the conversation, not in the draft. Leave the template's HTML comments
   and unused sections in place — publishing strips them — and never re-write the draft only to
   tidy it.
5. Tier: **1** when a precedent pattern exists in the same area and no design decision is left
   open. **2** for a new pattern, anything that spans modules, an algorithm that needs property tests, or
   any "decide at implementation" left in the text. A change that rewrites how existing code
   behaves is Tier 2 unless the rewrite is mechanical.
6. Every acceptance criterion is a checkbox, Given/When/Then, **and names the test or the command
   that proves it** (`AddItem returns 422 for an unknown id`, `node scripts/verify.mjs --quick`).
   An AC without one is not finished - either name it or drop it. For a change, name the **existing**
   test that must be updated, not just the new one.
7. skip-tests only when the spec adds and alters no behaviour at all (deletion, config, docs, a pure
   move). Then every AC's proof must be a command, a grep or an existing test, and Verification
   says so in one line. Never reach for it to dodge writing a test for real behaviour — the workflow
   will ship that spec without a single new assertion.
8. **Manual test plan.** Write `## Manual test` (the shape is in `issue-template.md`) when the change is visible in
   the app. Omit the section for a `skip-tests` spec or a cleanup. For a part or a single spec, a
   **part plan**: a numbered **Preparation** block (the standard preparation in `docs/plan/workflow.md` →
   Manual test plan, plus what this change adds), then 5–15 numbered **Steps** on concrete values, dates
   and routes, each ending in `→ <expected result>`. Describe behaviour, not exact labels, unless the label
   is an AC. A part with no UI effect of its own gets only the line
   `Verified in the epic plan, step <n>.`, where `<n>` is its step in the umbrella's plan. The approval summary
   names the plan's step count (`Manual test: 9 steps`), or `no plan` when the section is omitted.
9. If the design changes a hard rule, append a draft ADR (status 🕐) to `docs/plan/decisions.md`
   and reference it from Design decisions. Do not silently break an ADR. This is the only repo file
   `/design` may touch.
10. Scope is a promise: everything the change does **not** include goes under Out of scope, especially
   the adjacent thing the user will assume is included. For a change spec, the adjacent thing is
   usually "and while we are in there, clean up X" — name it and exclude it.
11. Watch for a split the whole time — see **Splitting into an epic** below.

## Splitting into an epic

A split can come up at any moment — while you read the plan, when `Explore` reports back, in the
middle of the interview, after the draft, or when `/build` blocked because the spec was too big —
and from either side: the user says "split it", or you see the signal and **propose it yourself**
instead of silently writing one oversized spec. Propose with `AskUserQuestion`: the cut you
recommend (one line per part: what it delivers, what the default branch can do after it merges), "keep it one
spec" and, where it makes sense, a coarser or finer cut. The user decides.

Signals worth a proposal:
- the ACs fall into groups that share no test project and no module;
- the work spans layers in sequence (contract + producer → consumer → UI) and each step leaves
  the default branch working;
- one part is mechanical (Tier 1, or `skip-tests` cleanup) and another is a new pattern (Tier 2) —
  splitting lets each run with its own tier and skip;
- the change has more than one area and the Area rules in `docs/plan/workflow.md` do not make it one
  ticket: cut an epic with one part per area;
- the diff would be too large to review in one sitting (roughly > 8 ACs or > 3 modules) — past
  that, a single run's test-writer and implementer contexts grow past 300k tokens.

A good cut:
- **Each part is one issue, one branch, one PR**, with its own Goal, Scope, Out of scope and ACs that
  prove it on its own — never an AC that only passes once a later part merges.
- **Each part leaves the default branch green and coherent.** A contract nobody uses yet is fine; a
  half-migrated module, or a UI that calls an endpoint that does not exist yet, is not.
- **Granular but not trivial:** a part too small for its own PR (a rename, one config line) folds into
  its neighbour. A spec that is merely long is still one issue.
- **Build order is merge order.** Parts are attached in build order and `prepare` refuses a part
  while an earlier sibling is open, because every branch is cut from the default branch. Work that is
  truly independent of the rest is not a part — it is a separate spec with no epic.

Drafting: the umbrella from `.claude/skills/design/epic-template.md` as `<slug>.md` (Goal, Why,
Parts in build order, overall Out of scope, cross-part Design decisions, Manual test — no AC), plus one full spec
per part from `issue-template.md` as `<slug>-<n>-<part-slug>.md`, each with its own tier, kind and
skip-tests. The umbrella gets the **whole-feature plan**: its `## Manual test` is one continuous
scenario of about 15–30 steps, from an empty state to the final state, assuming all parts merged;
each part carries its own part plan or the `Verified in the epic plan, step <n>.` line (step 8).
Check the umbrella with `check --epic` and every part with `check`. The approval summary
lists the parts one line each (title, tier, kind, AC count, plan step count).

Converting an already published spec (the user asks, or `/build` blocked on it): the existing issue
stays a part — narrow its body to that part with `edit --body-file`, never delete and re-create it —
and the new epic is created around it. Attach in build order: create the epic, then for each part
either `create --parent <epic>` (new part) or `edit <n> --parent <epic>` (the existing issue).

## Finish

Run `node scripts/gh-project.mjs check --body-file <scratchpad>/<slug>.md` (`--epic` for an
umbrella) and fix what it lists — it checks Goal, Out of scope, that every AC checkbox names a
`proof:`, and the shape of `## Manual test` (a warning when it is missing, an error when it has a `- [ ]`
line or neither a numbered step nor the `Verified in the epic plan` line). Then present a summary of at most 15 lines: goal (for a change: today → wanted), kind, tier, scope, the
acceptance criteria as one line each, `Area: <Area>` (one line per part for a split, none for the umbrella; the user may change it before publishing), whether tests are skipped, the manual plan's step count (or `no plan`), the split (if any), and anything
still open, plus one line `Priority: P<k> — <reason> → <output of node scripts/gh-project.mjs priority --where P<k> --body-file <scratchpad>/<slug>.md>`
(with the raises it prints; for an epic, the umbrella's priority and draft; parts never get one). The proposal is an `idea:` prompt's `priority:`,
otherwise chosen from the definitions in `docs/plan/workflow.md` → Priority. Refine within the band only with `--queue before:N|after:N`
(add it to `--where` and to `create`). Then ask for approval. Iterate on the draft until the user says yes; nothing is published
before that.

Only after an explicit yes — and with no open question left (each becomes an AC, an Out of scope line
or a Design decision) — publish. The script cleans and re-checks the draft itself:

```
node scripts/gh-project.mjs create --title "<title>" --body-file <scratchpad>/<slug>.md \
  --slug <slug> --tier <1|2> --kind <new|change|cleanup> --area <area> [--skip-tests] --priority <P0|P1|P2|P3> [--queue before:N|after:N]
```

`--priority` is the approved `Priority:` and is required for a top-level item (a single spec or the umbrella); `--queue` only
refines the position within the band. A part (`--parent`) takes neither: it lands right after the previous part and follows its epic.
Change an existing item's priority with `/prio #<n> P<k>` (an amend never uses `edit` for it).

For a split: first the umbrella with `--epic` (its `--tier` is the highest of its parts, its
`--kind` the one most parts share), then each part in build order with `--parent <umbrella number>`
and its own `--slug`, `--tier`, `--kind`, `--area`, `--skip-tests`. The umbrella takes no `--area`. The script prints `{"number","url","branch"}` per issue. It reads the card back and rewrites a missing field once; a
Branch or Tier still missing makes it exit non-zero listing the ready `node scripts/gh-project.mjs set <number> <field> <value>`
commands (a missing Area, Priority or Kind is only a warning) — run those instead of creating a duplicate.

**Amending an existing issue** (step 1 found one, or `/build` stopped on a spec that needs fixing):
start the draft from `node scripts/gh-project.mjs get <n> --out <scratchpad>/<slug>.md --raw`, edit
only what changes, and after the same explicit yes publish with
`node scripts/gh-project.mjs edit <n> --body-file <scratchpad>/<slug>.md [--tier <1|2>] [--area <area>]`. Never create a second issue for
the same spec.

Reply with the issue link(s) and tell the user to run `/build #<number>` (for a split: the first
part — each next part is buildable once the previous one has merged). Write no production code, no tests, no scaffolding at any point.
