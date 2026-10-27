# Decisions

Architecture decision records. Status: ✅ accepted / 🕐 pending / ❌ rejected. Check this file before any architectural change; append a new ADR when a hard rule in CLAUDE.md changes. `/idea` lists the `## ADR-` titles below, so keep that heading shape.

## ADR-001 ✅ Specs are GitHub issues, built by an idea → design → build pipeline

**Context:** work on the app is produced by Claude agents and needs a repeatable, reviewable process with the owner as the only merger.
**Decision:** every spec is an issue on the project's GitHub Project; `/build` cuts the branch, runs test-writer → implementer → reviewer, and `ship.mjs` opens the PR; the owner merges. `master` is the default branch and changes only through merged PRs.
**Consequences:** no spec file lives in the repo; agents never merge or push to `master`; the process is defined once in `docs/plan/workflow.md`.
