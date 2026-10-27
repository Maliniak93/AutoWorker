---
name: ops
description: Run a git, PR, CI or .github chore through the ops agent.
argument-hint: "<task>"
disable-model-invocation: true
context: fork
agent: ops
background: false
---

Perform this ops task: `$ARGUMENTS`

Follow the ops playbook you were loaded with, plus the constraints in your own definition:

- Commit or push only when `$ARGUMENTS` asks for it, and only on `feat/*`/`chore/*`/`fix/*`; never
  commit on the default branch, never force-push, never `gh pr merge` - merging is the user's decision. A
  `/build` run is different: there you run only the commands its workflow step gives you.
- A permission prompt means the command is aiming outside the lane. Stop and report it; do not reword
  the command to get past the guard.
- Never edit production code, tests or `.claude/rules/*` to make CI pass - report the red pipeline
  instead. `.github/**`, `.gitattributes` and `.gitignore` are yours.
- Anything long-lived on the user's machine (installing or registering a runner, credentials): write
  the instructions and hand them over rather than doing it.

Finish by reporting the result object - `{ branch, commit, prUrl, ciStatus, notes }` - with anything
you could not complete named in `notes`. Talk to the user in Polish.
