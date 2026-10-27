import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { findReplay, latestRunRecord, renderResumeScript } from "./build-replay.mjs";

const roots = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const ARGS = { spec: "docs/plan/issues/7.md", issue: 7, branch: "feat/x", title: "X", tier: 1, maxRounds: 2, skip: [], epic: null };
const LABELS = ["failing tests from acceptance criteria", "implement the spec", "adversarial review (round 1)"];

const started = (i, label) => ({ type: "started", key: `k${i}`, agentId: `a${i}`, label, phase: "p" });
const result = (i, value = { n: i }) => ({ type: "result", key: `k${i}`, agentId: `a${i}`, result: value });
const failed = (i) => ({ type: "failed", key: `k${i}`, agentId: `a${i}` });

function finished(labels) {
  return [{ type: "launched" }, ...labels.flatMap((label, i) => [started(i, label), result(i)])];
}

function makeHistory() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "build-replay-"));
  roots.push(dir);
  return dir;
}

function addRun(history, { session = "s1", runId = "wf_a", entries, record, transcript, age = 0, rawJournal } = {}) {
  const dir = path.join(history, session, "subagents", "workflows", runId);
  mkdirSync(dir, { recursive: true });
  const journal = path.join(dir, "journal.jsonl");
  writeFileSync(journal, rawJournal ?? entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const when = new Date(Date.now() - age * 1000);
  utimesSync(journal, when, when);
  if (record) {
    mkdirSync(path.join(history, session, "workflows"), { recursive: true });
    writeFileSync(path.join(history, session, "workflows", `${runId}.json`), JSON.stringify({ runId, workflowName: "build-feature", args: ARGS, ...record }));
  }
  if (transcript) {
    const block = { type: "tool_use", name: "Workflow", input: transcript };
    writeFileSync(path.join(history, `${session}.jsonl`), JSON.stringify({ type: "assistant", message: { content: [block] } }) + "\n");
  }
}

const labels = (r) => r.steps.map((s) => s.label);

test("an interrupted run with a transcript replays its finished steps and goes live at the unfinished one", () => {
  const h = makeHistory();
  addRun(h, { entries: [...finished(LABELS.slice(0, 1)), started(1, LABELS[1])], transcript: { name: "build-feature", args: ARGS } });
  const r = findReplay({ issue: 7, history: h });
  assert.equal(r.ok, true);
  assert.deepEqual(labels(r), [LABELS[0]]);
  assert.equal(r.interrupted, LABELS[1]);
  assert.equal(r.liveFrom, LABELS[1]);
  assert.deepEqual(r.steps[0].result, { n: 0 });
});

test("a failed entry ends the list as the interrupted step", () => {
  const h = makeHistory();
  addRun(h, { entries: [...finished(LABELS.slice(0, 1)), started(1, LABELS[1]), failed(1)], transcript: { name: "build-feature", args: ARGS } });
  const r = findReplay({ issue: 7, history: h });
  assert.deepEqual([labels(r), r.interrupted], [[LABELS[0]], LABELS[1]]);
});

test("a ready run replays every step and goes live nowhere", () => {
  const h = makeHistory();
  addRun(h, { entries: finished(LABELS), record: { result: { status: "ready" } } });
  const r = findReplay({ issue: 7, history: h });
  assert.equal(r.ok, true);
  assert.deepEqual(labels(r), LABELS);
  assert.equal(r.liveFrom, null);
  assert.equal(r.interrupted, null);
});

test("a run blocked at review or implement drops the step that blocked", () => {
  for (const stage of ["review", "implement"]) {
    const h = makeHistory();
    addRun(h, { entries: finished(LABELS), record: { result: { status: "blocked", stage } } });
    const r = findReplay({ issue: 7, history: h });
    assert.deepEqual(labels(r), LABELS.slice(0, 2), stage);
    assert.equal(r.liveFrom, LABELS[2], stage);
    assert.equal(r.interrupted, null, stage);
  }
});

test("a block whose step returned nothing replays up to that step", () => {
  const h = makeHistory();
  addRun(h, { entries: [...finished(LABELS.slice(0, 2)), started(2, LABELS[2]), failed(2)], record: { result: { status: "blocked", stage: "review" } } });
  const r = findReplay({ issue: 7, history: h });
  assert.deepEqual(labels(r), LABELS.slice(0, 2));
  assert.equal(r.liveFrom, LABELS[2]);
});

test("a run blocked at tests or input is refused", () => {
  for (const stage of ["tests", "input"]) {
    const h = makeHistory();
    addRun(h, { entries: finished(LABELS), record: { result: { status: "blocked", stage } } });
    const r = findReplay({ issue: 7, history: h });
    assert.equal(r.ok, false, stage);
    assert.match(r.reason, new RegExp(stage));
  }
});

test("a budget block replays every step whatever the stage", () => {
  const h = makeHistory();
  addRun(h, { entries: finished(LABELS), record: { result: { status: "blocked", stage: "tests", reason: "budget" } } });
  const r = findReplay({ issue: 7, history: h });
  assert.equal(r.ok, true);
  assert.deepEqual(labels(r), LABELS);
});

test("tier, skip and profile differences refuse the replay; skip order and case do not matter", () => {
  const h = makeHistory();
  addRun(h, { entries: finished(LABELS), record: { args: { ...ARGS, skip: ["Tests", "review"] }, result: { status: "ready" } } });
  const same = { tier: 1, skip: ["review", "tests"] };
  assert.equal(findReplay({ issue: 7, history: h, args: same }).ok, true);
  assert.equal(findReplay({ issue: 7, history: h, args: { ...same, tier: 2 } }).ok, false);
  assert.equal(findReplay({ issue: 7, history: h, args: { ...same, skip: ["tests"] } }).ok, false);
  assert.equal(findReplay({ issue: 7, history: h, args: { ...same, profile: { label: "Code (implementer → reviewer)" } } }).ok, false);
});

test("only the newest run of the issue counts, even when it is unusable", () => {
  const h = makeHistory();
  addRun(h, { session: "old", runId: "wf_old", entries: finished(LABELS), record: { result: { status: "ready" } }, age: 100 });
  addRun(h, { session: "new", runId: "wf_new", entries: finished(LABELS), record: { result: { status: "blocked", stage: "tests" } }, age: 10 });
  const r = findReplay({ issue: 7, history: h });
  assert.equal(r.ok, false);
  addRun(h, { session: "other", runId: "wf_other", entries: finished(LABELS), record: { args: { ...ARGS, issue: 8 }, result: { status: "ready" } }, age: 1 });
  assert.equal(findReplay({ issue: 7, history: h }).ok, false);
  assert.equal(findReplay({ issue: 8, history: h }).runId, "wf_other");
});

test("a resume-script run found by its transcript belongs to its issue", () => {
  const h = makeHistory();
  addRun(h, { entries: [...finished(LABELS.slice(0, 1)), started(1, LABELS[1])], transcript: { scriptPath: "docs/plan/issues/7.resume.js", args: ARGS } });
  assert.equal(findReplay({ issue: 7, history: h }).interrupted, LABELS[1]);
  assert.equal(findReplay({ issue: 9, history: h }).ok, false);
});

test("a chained resume prefixes the steps its predecessor replayed, when its journal is newer than the run file", () => {
  const h = makeHistory();
  const replayed = [{ label: LABELS[0], result: { n: "old" } }];
  addRun(h, { entries: [...finished([LABELS[1]]), started(1, LABELS[2])], transcript: { scriptPath: "docs/plan/issues/7.resume.js", args: ARGS } });
  const chained = findReplay({ issue: 7, history: h, previous: { replayed, writtenAt: 0 } });
  assert.deepEqual(labels(chained), [LABELS[0], LABELS[1]]);
  assert.deepEqual(chained.steps[0].result, { n: "old" });
  assert.equal(chained.liveFrom, LABELS[2]);
  const stale = findReplay({ issue: 7, history: h, previous: { replayed, writtenAt: Date.now() + 3600e3 } });
  assert.deepEqual(labels(stale), [LABELS[1]]);
});

test("a corrupt journal line is refused, a half-written last line is ignored", () => {
  const h = makeHistory();
  const lines = finished(LABELS.slice(0, 1)).map((e) => JSON.stringify(e));
  addRun(h, { rawJournal: [lines[0], "{not json", ...lines.slice(1)].join("\n") + "\n", record: { result: { status: "ready" } } });
  const bad = findReplay({ issue: 7, history: h });
  assert.equal(bad.ok, false);

  const h2 = makeHistory();
  addRun(h2, { rawJournal: lines.join("\n") + '\n{"type":"started","ke', transcript: { name: "build-feature", args: ARGS } });
  const r = findReplay({ issue: 7, history: h2 });
  assert.equal(r.ok, true);
  assert.deepEqual(labels(r), [LABELS[0]]);
});

test("a missing history, an unfinished first step or an unknown issue never throw", () => {
  assert.equal(findReplay({ issue: 7, history: path.join(os.tmpdir(), "no-such-history-dir") }).ok, false);
  const h = makeHistory();
  addRun(h, { entries: [{ type: "launched" }, started(0, LABELS[0])], transcript: { name: "build-feature", args: ARGS } });
  assert.equal(findReplay({ issue: 7, history: h }).ok, false);
  assert.equal(findReplay({ issue: 404, history: h }).ok, false);
  assert.equal(findReplay({}).ok, false);
});

test("renderResumeScript swaps the marker line, keeps meta first and returns null without a marker", () => {
  const source = ["export const meta = { name: \"build-feature\" }", "const a = 1", 'const REPLAY = {"steps":[],"interrupted":null} // @replay', "const b = 2", ""].join("\n");
  assert.ok(source.startsWith("export const meta"));
  const steps = [{ label: LABELS[0], result: { tests: [{ name: "it's \"quoted\" $& $1" }], projects: [] } }];
  const out = renderResumeScript(source, { steps, interrupted: LABELS[1] });
  assert.ok(out.startsWith("export const meta"));
  const lines = out.split("\n").filter((l) => l.includes("// @replay"));
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0].replace(/^const REPLAY = /, "").replace(/ \/\/ @replay$/, ""));
  assert.deepEqual(parsed, { steps, interrupted: LABELS[1] });
  assert.equal(out.split("\n").length, source.split("\n").length);
  assert.equal(renderResumeScript("export const meta = {}\n", { steps, interrupted: null }), null);
});

test("latestRunRecord returns the newest run of the issue that carries a ship report", () => {
  const h = makeHistory();
  const ship = { blocked: false, report: { status: "shipped", tests: ["T"] } };
  addRun(h, { session: "s1", runId: "wf_old", entries: finished(LABELS), record: { timestamp: "2026-01-01T10:00:00Z", result: { status: "ready", ship } }, age: 60 });
  addRun(h, { session: "s2", runId: "wf_new", entries: finished(LABELS), record: { timestamp: "2026-01-01T11:00:00Z", result: { status: "ready", ship: { ...ship, blocked: true } } } });
  const r = latestRunRecord({ issue: 7, history: h });
  assert.deepEqual([r.runId, r.args.branch, r.result.ship.blocked], ["wf_new", "feat/x", true]);
});

test("latestRunRecord finds a run that left no journal and returns null when the newest run has no ship report", () => {
  const h = makeHistory();
  const put = (session, runId, timestamp, result) => {
    mkdirSync(path.join(h, session, "workflows"), { recursive: true });
    writeFileSync(path.join(h, session, "workflows", `${runId}.json`), JSON.stringify({ runId, workflowName: "build-feature", args: ARGS, timestamp, result }));
  };
  put("s1", "wf_replayed", "2026-01-01T10:00:00Z", { status: "ready", ship: { blocked: false, report: {} } });
  assert.equal(latestRunRecord({ issue: 7, history: h }).runId, "wf_replayed");
  assert.equal(latestRunRecord({ issue: 7, since: Date.parse("2026-01-01T10:30:00Z"), history: h }), null);
  assert.equal(latestRunRecord({ issue: 8, history: h }), null);
  assert.equal(latestRunRecord({ issue: 7, history: path.join(h, "missing") }), null);
  put("s2", "wf_legacy", "2026-01-01T11:00:00Z", { status: "ready", nextCommand: "node scripts/ship.mjs 7 --json '{}'" });
  assert.equal(latestRunRecord({ issue: 7, history: h }), null);
});
