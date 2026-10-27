---
name: idea
description: Thinking partner before /design - interviews, challenges and improves a loose idea, then saves a ready prompt file that `/design idea:<slug>` reads. Writes no spec, no issue, no code.
argument-hint: "<loose idea | slug of a saved prompt>"
disable-model-invocation: true
model: claude-opus-5-5
effort: high
---

Shape `$ARGUMENTS` into one prompt file per coherent change, good enough that `/design` starts from
settled product decisions instead of a loose paragraph. You decide **what and why** with the user;
**how** stays with `/design`. Talk to the user in Polish. Write the prompt file in English, with code
identifiers, routes and type names exactly as in the code.

## First run guard

Read `project.config.json`. If `"name"` is still `"my-project"` or `github.projectNumber` is `0`, tell the
user to follow README.md "Setup" (run `node scripts/gh-project.mjs init`) and stop.

## 0. Start

- No arguments → `node scripts/idea.mjs list`, then `AskUserQuestion`: continue one of the drafts, or
  a new idea (then ask for it).
- Arguments equal to a listed slug → `node scripts/idea.mjs show <slug>` and refine that prompt: steps
  2–7 on the existing file, never a second file for the same idea.

## 1. Context

Run, with the arguments verbatim in a quoted heredoc so quotes and URLs survive:

```
node scripts/idea.mjs context --out <scratchpad>/idea-context.md -- "$(cat <<'IDEA'
<arguments>
IDEA
)"
```

Read its output: app map, board (open and done issues), ideas.md, ADR titles, product "Out of scope",
saved prompts, and "Possibly related" matches. That is your map. Never read `architecture.md`
wholesale — at most the one section a question needs.

## 2. Triage — at most 5 lines to the user

- How you understood the goal, in one sentence.
- Kind: **new**, **change** (existing behaviour should differ) or **cleanup**. A **bug** (code fails its
  own intent) is not a design prompt: say so and stop.
- An **open** issue already covers it → the prompt becomes an amendment request for `#n`. A **done**
  issue built it → this is a change of that issue's behaviour.
- Several ideas in one input → one prompt file each; ask which comes first and finish it before the next.
- A conflict with product "Out of scope", an ADR or a hard rule in CLAUDE.md → say so plainly, with the
  ADR number.
- Area: run `node scripts/areas.mjs` for the area -> paths table and set `area:` in the frontmatter to one
  option, or `epic` with a `## Proposed split` section (numbered parts in build order, each
  `<n>. <Area> — <what>`). The Area rules in `docs/plan/workflow.md` decide between them.
- Priority: set `priority: P<k> — <reason>` in the frontmatter (P0, P1, P2, P3; definitions in
  `docs/plan/workflow.md` → Priority); P2 unless the reason says otherwise.

A pure question ("why…?", "what is…?") → answer it briefly from the map, or from the one `Explore` call
(step 4), then ask whether a change sits behind it. None → stop.

## 3. Interview

No question quota. The filter: **ask only what changes the prompt, and only at product level** —
behaviour, screens and routes, concrete examples with values and dates, edge cases, non-goals,
priority and MVP. Never ask how to implement it: every technical choice or code fact goes under
"Open questions for /design".

`AskUserQuestion`, 2–4 questions per call, one topic each, your recommended option first. Be a critical,
creative partner, not a stenographer:
- What problem does it solve? Is there a simpler alternative that solves most of it?
- MVP vs the full version — propose the cut.
- Adjacent value: a related line from ideas.md or a done issue it could build on.
- Propose deferring or dropping it when it does not pay off; propose a split into an epic when it is big.
- Offer your own proposals as options labelled `Idea: …`.

## 4. One fact from the code

At most **one** `Explore` subagent call, for a single fact the map cannot settle and that changes the
prompt ("does X exist?", "where does screen Y get Z from?"). No other code reading.

## 5. Write the prompt

`node scripts/idea.mjs path <slug>` gives the file path (kebab-case slug). Write it with `Write` from
`.claude/skills/idea/prompt-template.md`, `status: draft` while iterating, the template's HTML comments
removed. Principles:
- what and why, not how; one prompt = one coherent change; ≤ ~60 lines; no code, no code fences;
- concrete examples (values, dates, before → after);
- under "Decisions already made" mark each item as **requirement** or **suggestion**;
- an amendment of `#n` names it in the title line and under "Related".

## 6. Critic

Spawn the `idea-critic` agent with the prompt path and `<scratchpad>/idea-context.md`. Findings that
need the user's decision → one `AskUserQuestion` round; fix the rest yourself. Never show the raw
critic output.

## 7. Finish

`node scripts/idea.mjs mark <slug> ready`, then `node scripts/idea.mjs check <slug>`; fix what it lists
until its `IDEA_RESULT` says `ok`. Final report, at most 10 lines, in Polish: goal, kind, key
decisions, open questions for /design, the path, "w schowku" when `clipboard` is true, and the next
step: `/clear`, then `/design idea:<slug>` (an amendment of `#n` uses the same command; `/design`
amends `#n`).

## Hard constraints

- The prompt file is the only thing you write. No spec, no issue, no code, no other repo file.
- No git command that changes state.
