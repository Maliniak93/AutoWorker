---
name: build
description: Build a spec issue from the project's GitHub Project end-to-end - branch, failing tests, implementation, verification, adversarial review, then commit, push and PR via ship.mjs - and leave the merge to you.
argument-hint: "#<issue> [--tier 1|2] [--skip tests,review] [--fresh] [+Nk]"
disable-model-invocation: true
model: haiku
effort: low
---

You relay; scripts and the `build-feature` workflow do all the work. Decide nothing yourself. Run in a
fresh session or `claude --model haiku "/build #<n>"`. Talk to the user in Polish.

1. No issue number in `$ARGUMENTS` → run `node scripts/plan-status.mjs` instead, print its **Queue** list
   and stop. Otherwise run `node scripts/preflight.mjs` and read its last stdout line, `PREFLIGHT_RESULT: <json>`.
   `"ok": false` → print each failed check as `name — detail → fix` and stop (the card is not moved). Checks with
   `"status": "fixed"` → one line saying what was started, stopped or installed, then continue.
2. Run `node scripts/gh-project.mjs prepare <issue> [--tier …] [--skip …] [--fresh]` with the issue number and any
   `--tier`/`--skip`/`--fresh` from `$ARGUMENTS`. Never pass a `+Nk` token to it — that is the turn's budget
   directive and the workflow reads it itself. It also cuts or switches the issue branch, and the
   `epic` info in `workflowArgs` (the last part of an epic also gets the epic and sibling bodies written locally).
   `workflowArgs.profile` (the build profile of the ticket's Area: phases, playbooks, review-checklist sections, label)
   is passed through verbatim; the workflow follows it and a ticket without an Area runs the full path.
   Print each line of prepare's `notes` (the no-area warning among them) before the workflow starts.
3. `"ok": false` → print `reason` and `next`, and stop. `stage: "branch"` → the tree held changes that are
   not this spec: name the `files` and stop; never offer to sweep them into the branch.
4. `"ok": true` → call the `Workflow` tool with `{ ...workflow, args: workflowArgs }`, both verbatim from
   prepare's output (`workflow` is `{ name }` or, on a resume, `{ scriptPath }`). `replay` set → say in one line
   `replay: <steps> → live from <liveFrom>` (`→ ship` when `liveFrom` is null). Then wait. (`prepare` already moved the card to In progress;
   `resumed: true` means a previous run left its branch — say so in one line.)
5. As soon as the workflow completes, run `node scripts/ship.mjs <issue> --from-run` (the workflow's `nextCommand`;
   it reads the branch, title and run report from the workflow record, so a truncated result loses nothing) as ONE
   Bash call with `timeout: 3600000` — for `ready` and `blocked` alike — and read its last stdout line,
   `SHIP_RESULT: <json>`. Run nothing between the workflow and this call: no build, test, grep or file read,
   and ignore IDE/LSP diagnostics — the workflow's verify and review are the only verdict.

## GitHub limit

`prepare` or `ship.mjs` that exits 4 hit the GitHub API limit (stderr names the reset time and carries a `GITHUB_LIMIT` line). Stop at once, no retry, no workaround: the final message is that reset time and "re-run `/build #<n>` after the reset" (after a `ship.mjs` exit 4 the work is verified and reviewed and stays on its branch; the re-run ships it).

## Report (at most 11 lines)

- `replay: <steps> → live from <liveFrom>` first, when prepare returned `replay`.
- `ready` and SHIP_RESULT `ok` → the `prUrl` (the merge is the user's), the issue `url`, `branch` and
  `commit`, `Profile: <label>` (the workflow's `ship.report.profile`; omit it when there is none), tests (`tests`, or "none — skip-tests"), `filesTouched` count, `rounds`, each of
  `minorFindings` as `file:line — claim` ("none" when empty), and the issues whose `## Manual test` the run
  updated (`manualTest[].issue`, or "none").
- `ready` and SHIP_RESULT not `ok` → `failedCommand` and `error`, then the remaining steps to finish by
  hand (commit, push, `gh pr create --base <default branch>`); the change is verified and reviewed.
- `blocked` → `stage`, then `reason`/`failures`/`findings` trimmed to one line each, then: fix the
  spec (`/design` amends the issue) or the named problem by hand, and re-run `/build #<n>` — the work
  stays on its branch.

Never commit, push, open or merge anything yourself — `ship.mjs` ships, the user merges — and never touch the issue.
