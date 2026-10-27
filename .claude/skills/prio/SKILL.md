---
name: prio
description: Change the priority of a top-level item on the project board (P0, P1, P2, P3); the card is re-placed by the priority rule.
argument-hint: "#<n> <P0|P1|P2|P3>"
disable-model-invocation: true
model: haiku
effort: low
allowed-tools: Bash
---

Run `node scripts/gh-project.mjs priority <n> <P>` with the number (without `#`) and level from the arguments, and print its output (or its error) verbatim. Add nothing, change nothing else.
