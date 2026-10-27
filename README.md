# AutoWorker

Self-hosted web app that automates my work with Claude and manages code production for my other apps. The app itself is not designed yet; this repo currently holds the tooling that builds it: **idea → design → build → you merge**, with specs as GitHub issues on the [AutoWorker project board](https://github.com/users/Maliniak93/projects/2).

| Command | What it does |
| --- | --- |
| `/idea <loose idea>` | Interviews you, challenges the idea, saves a ready prompt file (`docs/plan/prompts/<slug>.md`). Writes no code. |
| `/design idea:<slug>` | Interviews about the technical side, drafts a spec, and after your "yes" publishes it as a GitHub issue (Status Todo, fields Tier / Kind / Area / Priority / Branch). A big idea becomes an `epic` with ordered parts. |
| `/build #<n>` | Cuts the branch, runs test-writer → implementer → reviewer, verifies, then `ship.mjs` commits, pushes and opens the PR. You merge. |
| `/ops <task>` | Git / PR / CI chores through the `ops` agent (the only agent that may run git mutations). |
| `/check`, `/board`, `/prio #<n> P<k>` | Verify the tree, show the board against git, change a priority. |

## Setup

Needs Node >= 22, git and the GitHub CLI logged in with the `project` scope (`gh auth refresh -s project`). Then `node scripts/preflight.mjs` should be green. Project settings live in `project.config.json`; project instructions in `CLAUDE.md`.

## First steps for the app

1. `/idea` the first thing the app should do (it will also ask about the stack).
2. `/design idea:<slug>`: the first spec must scaffold the stack and add the Code format/build/test steps to `verify.steps` in `project.config.json`, `.claude/skills/dev-playbook`, `.claude/skills/testing-playbook`, `docs/plan/architecture.md` and the "Standard preparation" in `docs/plan/workflow.md`.
3. `/build #<n>`, review the PR, merge.

## Daily flow

```
/idea add CSV export of reports      → docs/plan/prompts/csv-export.md   (answer the questions)
/clear
/design idea:csv-export              → GitHub issue #12 (approve the summary first)
/clear
/build #12                           → PR; review it, merge it
/board                               → what is next
```

- Run `/build` in a fresh session (`/clear` first) or `claude --model haiku "/build #12"` — the skill only relays; scripts and the `build-feature` workflow do the work.
- An interrupted `/build #12` replays the finished steps when re-run; `--fresh` starts over, `--skip tests,review` skips phases, `--tier 1|2` overrides the tier.
- Tier 1 = a precedent exists in the code (cheap models). Tier 2 = new pattern, cross-cutting work or an algorithm (stronger models). `/design` picks it.
- An epic is an umbrella issue plus ordered parts; each part is its own branch and PR, buildable once the previous one is merged.

## Safety rails

- `.claude/hooks/git-guard.mjs` prompts or denies git mutations outside `feat/*`, `fix/*`, `chore/*` branches and never allows a push to the default branch or a force-push. Merging is always yours.
- Agents never run git mutations; `ship.mjs` (in `/build`) and `ops` (in `/ops`) are the only exceptions.
- `.claude/settings.json` is a conservative allow-list; extend it in `.claude/settings.local.json` (gitignored), not by loosening the shared file.

## Layout

See `CLAUDE.md` (Repo layout).

## Troubleshooting

- `/idea` or `/design` says the config is not set up → run `node scripts/gh-project.mjs init` (see `project.config.json` `github.projectNumber`).
- `gh` errors about a missing scope → `gh auth refresh -s project`.
- `GITHUB_LIMIT` / exit code 4 → the GitHub API limit is used up; re-run after the printed reset time.
- `/build` refuses with "tree holds changes that are not this spec" → commit or stash your work first; the branch is cut from the default branch.
- Windows: run Claude Code from Git Bash or PowerShell with Node on PATH; the scripts need no shell.
