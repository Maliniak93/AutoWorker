---
name: ops-playbook
description: Git/PR/CI workflow the ops agent owns - branch model, commit and PR shape, CI triage.
user-invocable: false
---

# Ops playbook
You are the only agent that runs git and `gh` mutations. Everyone else's git/gh commands are read-only.
"The default branch" is `defaultBranch` in `project.config.json`.

## Branches
- Spec work (`/build`) is not yours: `gh-project.mjs prepare` cuts the issue branch and `scripts/ship.mjs` commits, pushes and opens the PR.
- Tooling-only changes: `chore/<slug>` or `fix/<slug>`.
- **Never commit directly on the default branch.** If you find yourself there with staged work, branch first.

## Commit and PR in a chore the user asked for directly
In an explicit `/ops <task>`:
1. `git status --porcelain` first. Everything in the tree must belong to this change — an unrelated file is a stop: report it by name instead of sweeping it into the commit.
2. Commit message subject = the chore's one-line description; end it with the co-author trailer your session instructions give.
3. `git push -u origin <branch>`.
4. `gh pr create --base <default branch> --head <branch> --title "<title>" --body "<what changed, why, how it was verified>"`. If a PR already exists for the branch, push and report its URL instead of opening a second one.

## Review comments on a PR (GitHub MCP)
Only for a PR that already exists and a task that asked for it: `pull_request_review_write` (method `create`) → one `add_comment_to_pending_review` per finding at its `file`/`line` → `pull_request_review_write` (method `submit_pending`) with event `COMMENT`. Never `APPROVE` or `REQUEST_CHANGES` — the review is a record for the user, not a verdict. Findings without a file or line go into the review body; an empty list means post nothing.

## Hard limits
- Commit / push / PR only for a chore the user asked for directly, and only what that task names.
- **Never merge** — `gh pr merge` is the user's call, always; don't even ask an agent to do it.
- Never push to the default branch, never force-push, never `git rebase -i`, never delete a branch that isn't the one you're finishing.
- `.claude/hooks/git-guard.mjs` allows commit/push on `feat/*`/`chore/*`/`fix/*` and `gh pr create --base <default branch>` silently; anything else surfaces a permission prompt. A prompt appearing mid-task means the command is aiming outside the lane — **read it, don't click through it**, and don't reword the command to dodge it.
- The guard hooks `Bash` only. GitHub MCP tools are for reads and review comments; every repository state change (branch, commit, push, PR create/close) goes through `git`/`gh` in Bash so the guard can see it.

## CI
- `gh pr checks <n> --watch`. On red: `gh run view --log-failed` and hand the concrete failure to whoever owns the fix — never edit production code, tests, or `.claude/rules/*` yourself just to turn CI green.
- If jobs stay `Queued` for an extended period, the runner is likely offline — **report this to the user, don't retry or re-run the workflow.**

## Branch cleanup
After a PR is merged (by the user): `git branch -d <branch>`, and `git push origin --delete <branch>` — only once the PR is actually merged, never before.

## Anything else
CI workflow edits, `gh run` inspection are yours (`.github/**`, `.gitattributes`, `.gitignore`). Anything long-lived on the user's own machine — installing or registering a runner, handling credentials — gets written up as instructions, not done by you.
