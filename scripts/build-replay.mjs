#!/usr/bin/env node
// Usage: node scripts/build-replay.mjs <issue> [--history <dir>] [--json]
//   <issue>    spec issue number whose newest build-feature run is replayed
//   --history  Claude Code history folder of the project (default: ~/.claude/projects/<repo path with every non-alphanumeric as "-">)
//   --json     print the findReplay result as JSON instead of the summary

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./config.mjs";

export const historyDir = ({ repoRoot = ROOT, configDir } = {}) =>
  path.join(configDir ?? (process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude")), "projects", repoRoot.replace(/[^A-Za-z0-9]/g, "-"));

const HISTORY = historyDir();

const REPLAY_MARKER = /^const REPLAY = .* \/\/ @replay$/m;
const WORKFLOW = "build-feature";

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

const dirs = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
};

const normSkip = (skip) =>
  (Array.isArray(skip) ? skip : skip ? [skip] : []).map((s) => String(s).trim().toLowerCase()).filter(Boolean).sort().join(",");

function candidates(history) {
  const found = [];
  for (const session of dirs(history)) {
    const wfRoot = path.join(history, session, "subagents", "workflows");
    for (const runId of dirs(wfRoot)) {
      const dir = path.join(wfRoot, runId);
      const journal = path.join(dir, "journal.jsonl");
      if (!/^wf_/.test(runId) || !existsSync(journal)) continue;
      const stat = statSync(journal);
      const dirStat = statSync(dir);
      found.push({ session, runId, journal, mtimeMs: stat.mtimeMs, createdMs: dirStat.birthtimeMs || stat.mtimeMs });
    }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function transcriptArgs(history, session, issue, cache) {
  if (cache.has(session)) return cache.get(session);
  let found = null;
  const file = path.join(history, `${session}.jsonl`);
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.includes('"Workflow"') || !(line.includes(WORKFLOW) || line.includes(".resume.js"))) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const content = entry?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type !== "tool_use" || block.name !== "Workflow") continue;
        const input = block.input ?? {};
        const mine = input.name === WORKFLOW || (typeof input.scriptPath === "string" && input.scriptPath.endsWith(".resume.js"));
        if (mine && Number(input.args?.issue) === issue) found = input.args;
      }
    }
  }
  cache.set(session, found);
  return found;
}

function readJournal(file) {
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      entries.push(JSON.parse(lines[i]));
    } catch {
      // a half-written last line of a live journal is harmless; anywhere else the format is not what we know
      if (i < lines.length - 1) return null;
    }
  }
  return entries;
}

function journalSteps(entries) {
  const started = [];
  const outcomes = new Map();
  for (const e of entries) {
    if (e?.type === "started") started.push({ key: e.key, label: e.label });
    else if (e?.type === "result" || e?.type === "failed") outcomes.set(e.key, [...(outcomes.get(e.key) ?? []), e]);
  }
  const steps = [];
  let interrupted = null;
  const seen = new Map();
  for (const s of started) {
    const i = seen.get(s.key) ?? 0;
    seen.set(s.key, i + 1);
    const o = outcomes.get(s.key)?.[i];
    if (o?.type === "result" && o.result != null && typeof s.label === "string") steps.push({ label: s.label, result: o.result });
    else {
      interrupted = s.label ?? "?";
      break;
    }
  }
  return { steps, interrupted };
}

export function findReplay({ issue, args = null, previous = null, history = HISTORY } = {}) {
  try {
    const n = Number(issue);
    const cache = new Map();
    for (const c of candidates(history)) {
      const record = readJson(path.join(history, c.session, "workflows", `${c.runId}.json`));
      let runArgs = null;
      if (record?.result) {
        if (record.workflowName !== WORKFLOW || Number(record.args?.issue) !== n) continue;
        runArgs = record.args;
      } else {
        runArgs = transcriptArgs(history, c.session, n, cache);
        if (!runArgs) continue;
      }
      return replayOf({ c, record: record?.result ? record : null, runArgs, args, previous, issue: n });
    }
    return { ok: false, reason: `no earlier build-feature run of #${n} found in the history` };
  } catch (error) {
    return { ok: false, reason: `replay lookup failed: ${error?.message ?? error}` };
  }
}

function replayOf({ c, record, runArgs, args, previous, issue }) {
  if (args) {
    if (Number(args.tier) !== Number(runArgs.tier ?? 1)) return { ok: false, reason: `tier changed (${runArgs.tier ?? 1} -> ${args.tier})` };
    if (normSkip(args.skip) !== normSkip(runArgs.skip)) return { ok: false, reason: `skip changed (${normSkip(runArgs.skip) || "none"} -> ${normSkip(args.skip) || "none"})` };
    if (args.profile && args.profile.label !== runArgs.profile?.label) return { ok: false, reason: "profile changed" };
  }
  const entries = readJournal(c.journal);
  if (!entries) return { ok: false, reason: "journal has an unreadable line" };
  let { steps, interrupted } = journalSteps(entries);

  if (previous?.replayed?.length && c.createdMs > Number(previous.writtenAt ?? Infinity)) {
    steps = [...previous.replayed.filter((s) => s && typeof s.label === "string" && "result" in s), ...steps];
  }

  const status = record?.result?.status;
  const stage = record?.result?.stage;
  let note;
  let dropped = null;
  if (!record) note = "run was interrupted";
  else if (status === "ready") note = "run finished ready";
  else if (status === "blocked" && record.result.reason === "budget") note = "run stopped on the token budget";
  else if (status === "blocked" && (stage === "implement" || stage === "review")) {
    note = `run blocked at ${stage}`;
    if (!interrupted && steps.length) {
      dropped = steps.pop().label;
    }
  } else if (status === "blocked") return { ok: false, reason: `run blocked at ${stage ?? "?"}: a fresh run is needed` };
  else return { ok: false, reason: `run ended with status ${status ?? "unknown"}` };

  if (!steps.length) return { ok: false, reason: "the previous run finished no step" };
  const liveFrom = interrupted ?? dropped ?? (record ? null : "next step");
  return { ok: true, runId: c.runId, session: c.session, issue, steps, interrupted, liveFrom, note };
}

// Read from the run records, not the journals: a fully replayed run starts no agent and may leave no journal.
export function latestRunRecord({ issue, since = 0, history = HISTORY } = {}) {
  const n = Number(issue);
  let best = null;
  for (const session of dirs(history)) {
    const dir = path.join(history, session, "workflows");
    let files = [];
    try {
      files = readdirSync(dir).filter((f) => /^wf_.*\.json$/.test(f));
    } catch {
      continue;
    }
    for (const file of files) {
      const record = readJson(path.join(dir, file));
      if (record?.workflowName !== WORKFLOW || Number(record.args?.issue) !== n || !record.result) continue;
      const at = Date.parse(record.timestamp ?? "") || statSync(path.join(dir, file)).mtimeMs;
      if (!best || at > best.at) best = { at, runId: file.replace(/\.json$/, ""), session, args: record.args, result: record.result };
    }
  }
  return best && best.at >= since && best.result.ship ? best : null;
}

export function renderResumeScript(source, { steps, interrupted }) {
  if (!REPLAY_MARKER.test(source)) return null;
  const line = `const REPLAY = ${JSON.stringify({ steps, interrupted: interrupted ?? null })} // @replay`;
  return source.replace(REPLAY_MARKER, () => line);
}

function main(argv) {
  let issue = null;
  let history = HISTORY;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--history") history = argv[++i];
    else if (argv[i] === "--json") json = true;
    else if (/^#?\d+$/.test(argv[i])) issue = Number(argv[i].replace("#", ""));
    else {
      console.error("usage: build-replay.mjs <issue> [--history <dir>] [--json]");
      process.exit(2);
    }
  }
  if (issue == null) {
    console.error("usage: build-replay.mjs <issue> [--history <dir>] [--json]");
    process.exit(2);
  }
  const res = findReplay({ issue, history });
  if (json) console.log(JSON.stringify(res));
  else if (!res.ok) console.log(`no replay: ${res.reason}`);
  else {
    console.log(`run ${res.runId} (session ${res.session}) - ${res.note}`);
    console.log(`replays ${res.steps.length} step(s):`);
    for (const s of res.steps) console.log(`  - ${s.label}`);
    console.log(`live from: ${res.liveFrom ?? "ship (nothing left to run)"}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2));
