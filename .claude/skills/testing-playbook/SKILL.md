---
name: testing-playbook
description: Test conventions - where tests and helpers live, how to run a single test, and the patterns every new test follows.
user-invocable: false
---

# Testing playbook
<!-- FILL IN: replace this file's placeholders with your stack's testing conventions. The test-writer reads it first on every Code ticket (project.config.json -> areas[Code].testWriter). Keep it short and concrete. Delete this comment when done. -->

Write tests RED first: derive them from the spec's acceptance criteria, run them, and confirm they fail
before any production code exists. A compile failure because the API does not exist yet is an acceptable
red — report which type/member is missing. A new test that passes immediately is a bug in the test or a
spec already satisfied — never leave that unresolved.

## Layout
<!-- FILL IN: where tests live, how they are named, which test types exist (unit, integration, end-to-end) and which one to pick for what. -->

## Where a helper lives — never copy one
<!-- FILL IN: the shared helpers/fixtures folder(s). Rule of thumb: a duplicated test helper is extracted on the second use — it is plumbing, and copies drift silently. -->

## How to run tests
<!-- FILL IN: the command for the whole suite, for one file, and for one test by name (the test-writer and implementer use the one-test form to confirm red and green), plus any prerequisite (a database, a container runtime, a built artifact). -->

## Patterns every test follows
<!-- FILL IN: calling the system under test (arrange through helpers, act directly), naming (Method_Scenario_Outcome or similar), what to assert on, mocking policy, and the cross-cutting tests a new feature needs (authorisation or tenancy isolation, idempotency, error paths). -->

## Definition of done
- Every acceptance criterion has a test that fails if the behaviour regresses, named as the spec names it.
- No test is skipped, commented out or weakened to pass.
