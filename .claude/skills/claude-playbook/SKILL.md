---
name: claude-playbook
description: Conventions for the Claude Code setup - skills, agents, workflows, rules and CLAUDE.md length, consistency and removed references.
user-invocable: false
---

# Claude playbook
The Claude setup is `.claude/` (agents in `agents/*.md`, skills and slash commands in `skills/<name>/SKILL.md`, path-scoped rules in `rules/*.md`, workflows in `workflows/`, hooks in `hooks/`) plus the root `CLAUDE.md`. The process it drives is `docs/plan/workflow.md`.

## Skills, agents, workflows and commands
- A skill is `skills/<name>/SKILL.md` with frontmatter `name` (equal to the folder name), a one-line `description` of what it is for, and `user-invocable: false` for a playbook or checklist an agent reads; leave it out for a slash command a person runs.
- An agent is `agents/<name>.md` with one job. It names the skills it preloads in its frontmatter `skills:` list.
- One job per file, one home per rule: a rule is written once, in the playbook or rule file that owns it. Other files point to it by name instead of copying its text. Duplicated rule text is the first thing to delete when two copies drift apart.

## CLAUDE.md
- Keep it at or under 75 lines. It loads into every session, so a detail moves to a playbook, a rule or `docs/plan/` and CLAUDE.md keeps a pointer.
- Edit in place: change the line that is wrong. Never append a correction, a dated note or a "previously" beside it.
- The Commands table and the hard architecture rules are cited by other files. A change to either lands in the same change as the file it affects.

## Consistency with the process
- A process change touches `docs/plan/workflow.md` (the process), CLAUDE.md (its summary) and every skill and agent that runs that step, in one change. A skill describing a step that `workflow.md` no longer has is a defect.
- Model and effort named in an agent or skill match the tier rules in `workflow.md` and CLAUDE.md.

## No references to removed things
When a skill, agent, script, flag or ADR is removed, grep its name across `.claude/`, `CLAUDE.md` and `docs/plan/`. A remaining reference is a bug.

## Definition of done
- Frontmatter is valid, `name` equals the folder, and a playbook is `user-invocable: false`.
- Every rule has one home; no text is duplicated from another skill or agent.
- CLAUDE.md is at or under 75 lines, and every line still agrees with `docs/plan/workflow.md`.
- The skills and agents touching a changed step agree with it; a grep for each removed name finds nothing.
- `node scripts/verify.mjs` is green.
