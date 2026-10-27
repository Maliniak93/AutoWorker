# Claude starter kit

A stack-neutral copy of the Skarbiec workflow: **idea → design → build → you merge**, with specs as GitHub issues on a GitHub Project.

| Command | What it does |
| --- | --- |
| `/idea <loose idea>` | Interviews you, challenges the idea, saves a ready prompt file (`docs/plan/prompts/<slug>.md`). Writes no code. |
| `/design idea:<slug>` | Interviews about the technical side, drafts a spec, and after your "yes" publishes it as a GitHub issue (Status Todo, fields Tier / Kind / Area / Priority / Branch). A big idea becomes an `epic` with ordered parts. |
| `/build #<n>` | Cuts the branch, runs test-writer → implementer → reviewer, verifies, then `ship.mjs` commits, pushes and opens the PR. You merge. |
| `/ops <task>` | Git / PR / CI chores through the `ops` agent (the only agent that may run git mutations). |
| `/check`, `/board`, `/prio #<n> P<k>` | Verify the tree, show the board against git, change a priority. |

Not included (port from Skarbiec if you need them): `/fix` (bug pipeline), `autobuild` (unattended queue), e2e agent, compose tooling.

## Quick start (about 10 minutes)

1. **Copy the kit into the new project** (an empty repo with a GitHub remote is best):
   ```
   node bootstrap.mjs <path-to-new-project>
   ```
   or copy everything by hand, except `README.md` and `bootstrap.mjs`. Rename `CLAUDE.md.template` to `CLAUDE.md`.
2. **Tools**: Node >= 22, git, and the GitHub CLI (`gh`). Log in with the project scope:
   ```
   gh auth login
   gh auth refresh -s project
   ```
3. **GitHub repo**: the project needs a GitHub remote (`git remote add origin ...`, push the default branch once — `gh repo create` does it in one go).
4. **Edit `project.config.json`**:
   - `name` — the project name (also the GitHub Project title).
   - `defaultBranch` — `main` or `master`.
   - `areas` — which paths belong to which area (code, docs, scripts...). The area decides the build profile: whether a test-writer runs, which playbooks the agents read first, which review-checklist sections apply. Add `Backend` / `Frontend` / whatever matches your stack.
   - `verify.steps` — the commands that define "green" (format, build, test, lint...), each tied to areas. `/check` and `/build` run only the steps that the changed files touch. `fullScope` paths (lockfiles, CI) run everything.
   - `formatOnEdit` — optional formatter run after each file edit (default: prettier, only if installed).
   - `preflight.extra` — extra things `/build` must have ready (a database, Docker...).
5. **Create the GitHub Project, fields and labels** (idempotent, writes the project number back into the config):
   ```
   node scripts/gh-project.mjs init
   ```
6. **Fill in `CLAUDE.md`** (everything marked `FILL IN`: stack, commands table, hard architecture rules, conventions). Keep it short — it is loaded into every session.
7. **Fill in the playbooks** in `.claude/skills/dev-playbook/SKILL.md` and `testing-playbook/SKILL.md` (layout, conventions, how to write and run tests). These are what the implementer and test-writer read first, so this is where most of the quality comes from. Add path-scoped rules in `.claude/rules/` (see `example.md`).
8. **Fill in `docs/plan/`**: `product.md` (what the product is and an "Out of scope" list — `/idea` challenges ideas against it), `architecture.md`, `decisions.md` (ADRs; `/design` checks it before an architectural change).
9. **Check the setup**:
   ```
   node scripts/preflight.mjs
   node scripts/verify.mjs --all
   node --test
   ```
10. **Commit the kit** on the default branch and push (`/ops commit and push the starter kit`, or by hand). `/build` cuts every branch from it.

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

```
project.config.json       the one file you edit to adapt scripts and agents
CLAUDE.md                 project instructions (from CLAUDE.md.template)
.claude/agents/           idea-critic, explore, test-writer, implementer, reviewer, ops
.claude/skills/           idea, design, build, ops, check, board, prio + playbooks + review-checklist
.claude/workflows/        build-feature.js (the /build pipeline)
.claude/hooks/            git-guard, format-on-edit
.claude/rules/            path-scoped rules you add
scripts/                  gh-project, idea, ship, verify, preflight, plan-status, areas, ...
docs/plan/                product, architecture, decisions (ADRs), ideas, workflow
```

## Troubleshooting

- `/idea` or `/design` says the config is not set up → steps 4–5.
- `gh` errors about a missing scope → `gh auth refresh -s project`.
- `GITHUB_LIMIT` / exit code 4 → the GitHub API limit is used up; re-run after the printed reset time.
- `/build` refuses with "tree holds changes that are not this spec" → commit or stash your work first; the branch is cut from the default branch.
- Windows: run Claude Code from Git Bash or PowerShell with Node on PATH; the scripts need no shell.
