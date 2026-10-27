<!-- Template of an /idea prompt (target design). Copy from the frontmatter down to the last heading. Remove every HTML comment when writing the file; delete an optional section you leave empty. English text, code identifiers as in the code, no code fences, ≤ ~60 lines. -->

---
slug: <kebab-case>
title: <title>
target: design
kind: <new|change|cleanup>
status: draft
created: <YYYY-MM-DD>
area: <one Area from project.config.json (see node scripts/areas.mjs) | epic>
priority: <P0|P1|P2|P3> — <reason>
issue:
---
# <title>

## Goal
<!-- 1–3 sentences: which user problem this solves and what exists once the change is done. -->

## Current behaviour
<!-- Only kind: change (otherwise delete the section): how it works today from the user's view — screen/route, what is visible, what hurts. -->

## How it should work
<!-- Scenarios from the user's view, step by step, with concrete examples: values, dates, before → after. Screens and routes by name. -->

## Decisions already made
<!-- Settled with the user; /design does not ask them again. Each line marked **requirement** or **suggestion**; MVP vs later goes here too. -->

## Out of scope
<!-- What this change deliberately does not cover — above all the neighbouring thing that is easy to assume. -->

## Proposed split
<!-- Only area: epic (otherwise delete the section): numbered parts in build order, each `<n>. <Area> — <what>`, e.g. `1. Code — the goal API`. At least two. -->

## Risks and notes
<!-- Optional: clashes with an ADR / hard rule / product "Out of scope", edge cases, data risks. -->

## Open questions for /design
<!-- What /idea deliberately left for /design: technical choices (module, event, endpoint, data model), code facts for Explore to check. -->

## Related
<!-- Optional: issues (#n — why), lines from ideas.md, ADRs, saved prompts. An amendment of an open #n — its first line here. -->
