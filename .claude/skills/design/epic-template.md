<!-- Body of an epic — the umbrella of a split. It is never built: its sub-issues are, one by one, in the order they were attached. No acceptance criteria here — every AC lives in exactly one part. Delete every HTML comment before publishing. -->

## Goal

<!-- One sentence: what exists once every part has merged. -->

## Why

<!-- The problem this closes, and in one line why it is split rather than one spec. -->

## Parts

<!-- Build order. One line each: what the part delivers and what state the default branch is in after it merges. `create --parent` numbers them; fill the issue numbers in with `edit` once they exist, or leave the list unnumbered — the sub-issue list on GitHub is the source of truth. -->

1. **<part title>** — <what it delivers>; after merge: <what works on the default branch>.
2. **<part title>** — <what it delivers>; depends on 1 for <what>.

## Out of scope

<!-- What no part covers, even though it is adjacent. -->

## Design decisions

<!-- Decisions that span parts (a contract shape, a naming rule, an ADR). A decision that concerns one part only goes in that part. -->

## Manual test

<!-- One continuous manual scenario of about 15–30 numbered steps, from an empty state to the final state, assuming all parts have merged: the whole feature as a person uses it. Preparation first (the standard preparation in docs/plan/workflow.md → Manual test plan), then Steps on concrete values, dates and routes, each ending in `→ <expected result>`. It is a draft: the last part's build refreshes it against what was actually built. -->
