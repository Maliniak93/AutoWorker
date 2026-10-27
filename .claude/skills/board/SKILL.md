---
name: board
description: Show the project's GitHub Project board against git - open spec issues, the build queue in board order, and cards whose state disagrees with the branches. Changes nothing.
argument-hint: "[area|P0-P3]"
disable-model-invocation: true
model: haiku
effort: low
allowed-tools: Bash
---

Run `node scripts/plan-status.mjs`, or `node scripts/plan-status.mjs --priority <arg>` when the argument is P0-P3, or `node scripts/plan-status.mjs --area <arg>` for any other argument, and print its output verbatim, minus the first two lines (title and
generated-comment). Add nothing, change nothing.
