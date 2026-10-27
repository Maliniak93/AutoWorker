#!/usr/bin/env node
// Usage: node scripts/verify.mjs [--quick] [--all] [--projects A,B] [--fix] [--cache] [--cache-check]
//   (no flags)       steps for the areas of the files changed against the default branch (committed, staged, unstaged, untracked); a verify.fullScope path means --all
//   --quick          only the steps named "format" and "build" (within the scope)
//   --all            every configured step
//   --projects A,B   the steps of exactly these areas (names from project.config.json)
//   --fix            first run each selected step's "fix" command
//   --cache          skip the run when the same tree (HEAD + tracked + untracked content) already passed these steps or a superset of them (.git/verify-cache.json)
//   --cache-check    run nothing: ok if this tree already passed these steps under --cache, else a "cache" failure (exit 2)
// Steps come from verify.steps in project.config.json: { name, cmd[], fix?[], areas[] | "*" }. The last stdout line is VERIFY_RESULT: <json>; exit 0 green, 2 red.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { areaOfPath } from "./areas.mjs";
import { AREA_NAMES, CONFIG, DEFAULT_BRANCH, ROOT } from "./config.mjs";

const IS_WIN = process.platform === "win32";
const STEP_TIMEOUT_MS = 120 * 60 * 1000;
const CACHE_MAX_ENTRIES = 10;
const QUICK_STEPS = new Set(["format", "build"]);
const STOP_ON_RED = new Set(["format", "build"]);
const SEP = "\0";

export function parseArgs(argv) {
  const args = { quick: false, all: false, fix: false, cache: false, cacheCheck: false, projects: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--quick") args.quick = true;
    else if (a === "--all") args.all = true;
    else if (a === "--fix") args.fix = true;
    else if (a === "--cache") args.cache = true;
    else if (a === "--cache-check") args.cacheCheck = true;
    else if (a === "--projects" || a.startsWith("--projects=")) {
      const val = a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[++i];
      args.projects = (val ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!args.projects.length) throw new Error("--projects requires a comma-separated list of area names");
    } else throw new Error(`unknown argument '${a}'`);
  }
  return args;
}

const norm = (p) => p.replaceAll("\\", "/").replace(/^\.\//, "");

export function parsePorcelain(output) {
  const files = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const rest = line.slice(3);
    const arrow = rest.indexOf(" -> ");
    const names = /[RC]/.test(line.slice(0, 2)) && arrow !== -1 ? [rest.slice(0, arrow), rest.slice(arrow + 4)] : [rest];
    for (const n of names) files.push(n.startsWith('"') ? JSON.parse(n) : n.trim());
  }
  return files.filter(Boolean);
}

// git(args) returns stdout or null when the command failed.
export function changedFiles(git, defaultBranch = DEFAULT_BRANCH) {
  for (const base of [`${defaultBranch}...HEAD`, `origin/${defaultBranch}...HEAD`]) {
    const diff = git(["diff", "--name-only", base]);
    if (diff === null) continue;
    const status = git(["status", "--porcelain", "--untracked-files=all"]) ?? "";
    const files = [...diff.split(/\r?\n/).map((s) => s.trim()).filter(Boolean), ...parsePorcelain(status)];
    return { files: [...new Set(files.map(norm))], base, treatAsAll: false };
  }
  return { files: [], base: null, treatAsAll: true };
}

export function isFullScope(file, fullScope) {
  const f = norm(file);
  return fullScope.some((entry) => {
    const e = norm(entry);
    return e.endsWith("/") ? f.startsWith(e) : f === e;
  });
}

const appliesTo = (step, areas) => step.areas === "*" || (Array.isArray(step.areas) && step.areas.some((a) => areas.has(a)));

// Pure: which steps run, and why.
export function computeScope({ args, changed, steps, fullScope = [], areaOf = areaOfPath, areaNames = AREA_NAMES }) {
  let areas = new Set();
  let full = false;
  let mode;
  if (args.all) {
    full = true;
    mode = "--all: every step";
  } else if (args.projects) {
    const known = new Map(areaNames.map((n) => [n.toLowerCase(), n]));
    const unknown = args.projects.filter((p) => !known.has(p.toLowerCase()));
    if (unknown.length) throw new Error(`unknown --projects entr${unknown.length > 1 ? "ies" : "y"}: ${unknown.join(", ")} (areas: ${areaNames.join(", ")})`);
    areas = new Set(args.projects.map((p) => known.get(p.toLowerCase())));
    mode = `--projects ${[...areas].join(",")}`;
  } else if (changed.treatAsAll) {
    full = true;
    mode = `auto: no ${DEFAULT_BRANCH} or origin/${DEFAULT_BRANCH} ref found - treating as --all`;
  } else if (changed.files.some((f) => isFullScope(f, fullScope))) {
    full = true;
    mode = `auto (diff base: ${changed.base}): full-scope file changed - treating as --all`;
  } else {
    areas = new Set(changed.files.map(areaOf).filter(Boolean));
    mode = `auto (diff base: ${changed.base}): ${changed.files.length} changed path(s)`;
  }
  let selected = full ? steps : steps.filter((s) => appliesTo(s, areas));
  if (args.quick) selected = selected.filter((s) => QUICK_STEPS.has(s.name));
  return { mode, full, areas: [...areas], steps: selected };
}

export function findCacheHit(entries, { tree, steps }) {
  if (!tree) return null;
  return entries.find((e) => e.tree === tree && Array.isArray(e.steps) && steps.every((s) => e.steps.includes(s)) && e.result?.ok === true) ?? null;
}

export function loadCache(file, fs = { readFileSync }) {
  try {
    const entries = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

// An entry covering the same tree and a subset of the new steps is superseded.
export function withGreen(entries, { tree, steps }, at = new Date().toISOString()) {
  const kept = entries.filter((e) => !(e.tree === tree && Array.isArray(e.steps) && e.steps.every((s) => steps.includes(s))));
  kept.push({ tree, steps: [...steps], at, result: { ok: true } });
  return kept.slice(-CACHE_MAX_ENTRIES);
}

export function saveGreen(file, ctx, fs = { readFileSync, writeFileSync }) {
  try {
    fs.writeFileSync(file, JSON.stringify(withGreen(loadCache(file, fs), ctx)));
  } catch (e) {
    process.stderr.write(`verify.mjs: could not write the cache: ${e.message}\n`);
  }
}

function gitText(args) {
  const res = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true, shell: false });
  return res.status === 0 ? res.stdout : null;
}

function gitBuffer(args) {
  const res = spawnSync("git", args, { cwd: ROOT, maxBuffer: 1024 * 1024 * 1024, windowsHide: true, shell: false });
  return res.status === 0 ? res.stdout : null;
}

export function computeTreeHash(gitBuf = gitBuffer, read = (rel) => readFileSync(path.join(ROOT, rel))) {
  const head = gitBuf(["rev-parse", "HEAD"]);
  const diff = gitBuf(["diff", "HEAD", "--binary"]);
  const untracked = gitBuf(["ls-files", "--others", "--exclude-standard", "-z"]);
  if (!head || !diff || !untracked) return null;
  const hash = createHash("sha1").update(head).update(SEP).update(diff);
  for (const rel of untracked.toString("utf8").split(SEP).filter(Boolean).sort()) {
    hash.update(SEP).update(rel).update(SEP);
    try {
      hash.update(read(rel));
    } catch {
    }
  }
  return hash.digest("hex");
}

function cacheFile() {
  const dir = gitText(["rev-parse", "--git-dir"])?.trim();
  return dir ? path.join(path.resolve(ROOT, dir), "verify-cache.json") : null;
}

const quoteWin = (s) => (s === "" || /[\s"&|<>^%()]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

// Node refuses to spawn a .cmd directly (EINVAL), so a Windows script shim goes through cmd.exe with verbatim arguments.
export function resolveCommand(cmd, win = IS_WIN) {
  let [bin, ...rest] = cmd;
  if (win && (bin === "npm" || bin === "npx")) bin += ".cmd";
  if (win && /\.(cmd|bat)$/i.test(bin)) {
    return { file: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `"${[bin, ...rest].map(quoteWin).join(" ")}"`], verbatim: true };
  }
  return { file: bin, args: rest, verbatim: false };
}

function run(cmd) {
  const { file, args, verbatim } = resolveCommand(cmd);
  const startedAt = Date.now();
  const res = spawnSync(file, args, {
    cwd: ROOT,
    shell: false,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: STEP_TIMEOUT_MS,
    windowsHide: true,
    windowsVerbatimArguments: verbatim,
  });
  const timedOut = res.status === null && res.signal != null && !res.error;
  return { ok: !res.error && !timedOut && res.status === 0, status: res.status, timedOut, error: res.error ?? null, output: `${res.stdout ?? ""}\n${res.stderr ?? ""}`, durationMs: Date.now() - startedAt, cmdStr: cmd.join(" ") };
}

const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const FILE_RE = /([.\w][\w.\-/\\]*\.(?:[cm]?[jt]sx?|json|css|scss|html|md|py|go|rs|java|kt|cs|rb|php|yml|yaml))(?=[:()\s]|$)/;
const ERROR_RE = /error|fail|✗|×|FAIL|exception|panic/i;

const truncate = (s, max = 300) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
const duration = (ms) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

export function failureOf(name, r) {
  if (r.timedOut) return { step: name, summary: truncate(`timed out after ${duration(r.durationMs)}: ${r.cmdStr}`), file: null };
  if (r.error) return { step: name, summary: truncate(`failed to start: ${r.error.message}`), file: null };
  const lines = r.output.replace(ANSI_RE, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors = lines.filter((l) => ERROR_RE.test(l));
  const shown = (errors.length ? errors.slice(0, 5) : lines.slice(-5)).join(" | ");
  const file = (errors.join("\n") + "\n" + lines.join("\n")).match(FILE_RE)?.[1] ?? null;
  return { step: name, summary: truncate(shown || `exit ${r.status ?? "n/a"}, no output`), file };
}

function excerpt(output, max = 20) {
  const lines = output.replace(ANSI_RE, "").split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const shown = lines.slice(0, max).map((l) => `    | ${l}`);
  if (lines.length > max) shown.push(`    | ... (${lines.length - max} more line(s) omitted)`);
  return shown.join("\n");
}

function finish(ok, failures, extra = {}) {
  console.log(ok ? "\nverify.mjs: all checks passed" : `\nverify.mjs: FAILED at step ${[...new Set(failures.map((f) => `"${f.step}"`))].join(", ")}`);
  const json = JSON.stringify({ ok, failures, ...extra });
  console.log(`VERIFY_RESULT: ${json}`);
  if (!ok) process.stderr.write(`verify.mjs failed: ${failures.map((f) => `[${f.step}] ${f.summary}${f.file ? ` (${f.file})` : ""}`).join(" ")}\n`);
  process.exitCode = ok ? 0 : 2;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    return finish(false, [{ step: "args", summary: e.message, file: null }]);
  }

  const configured = CONFIG.verify?.steps ?? [];
  if (!configured.length) {
    console.log("verify.mjs: no verify steps configured (verify.steps in project.config.json) - nothing to run");
    return finish(true, [], { scope: { mode: "no steps configured", areas: [], full: false }, steps: [] });
  }

  let scope;
  try {
    scope = computeScope({ args, changed: args.all || args.projects ? null : changedFiles(gitText), steps: configured, fullScope: CONFIG.verify?.fullScope ?? [] });
  } catch (e) {
    return finish(false, [{ step: "args", summary: e.message, file: null }]);
  }
  const names = scope.steps.map((s) => s.name);
  const scopeJson = { mode: scope.mode, areas: scope.areas, full: scope.full };
  const cacheable = names.length > 0;
  const file = args.cache || args.cacheCheck ? cacheFile() : null;

  if (args.cacheCheck) {
    if (!cacheable) return finish(true, [], { cached: true, scope: scopeJson, steps: [] });
    const hit = file && findCacheHit(loadCache(file), { tree: computeTreeHash(), steps: names });
    if (hit) return finish(true, [], { cached: true, scope: scopeJson, steps: [] });
    return finish(false, [{ step: "cache", summary: "this working tree has no green verify run in the cache - run node scripts/verify.mjs --all --fix --cache", file: null }], { scope: scopeJson });
  }

  console.log("verify.mjs");
  console.log(`mode: ${scope.mode}`);
  console.log(`steps: ${names.length ? names.join(", ") : "(none for this scope)"} · fix: ${args.fix ? "yes" : "no"}`);

  const results = [];
  const failures = [];

  if (args.fix) {
    for (const s of scope.steps.filter((x) => Array.isArray(x.fix) && x.fix.length)) {
      console.log(`\n==> fix: ${s.name}\n    $ ${s.fix.join(" ")}`);
      const r = run(s.fix);
      console.log(r.ok ? `    ok (${duration(r.durationMs)})` : `    FAILED (${duration(r.durationMs)}, exit ${r.status ?? "n/a"})\n${excerpt(r.output)}`);
      results.push({ name: `fix:${s.name}`, status: r.ok ? "ok" : "failed", durationMs: r.durationMs });
    }
  }

  const tree = args.cache && cacheable ? computeTreeHash() : null;
  if (args.cache && cacheable && file && tree) {
    const hit = findCacheHit(loadCache(file), { tree, steps: names });
    if (hit) {
      console.log(`\ncache: this exact working tree already passed these steps at ${hit.at} - nothing to run`);
      return finish(true, [], { cached: true, scope: scopeJson, steps: results });
    }
  }

  if (!cacheable) console.log("\nnotice: no configured step applies to this scope - nothing to run");

  let stopped = false;
  for (const s of scope.steps) {
    if (stopped) {
      results.push({ name: s.name, status: "skipped", durationMs: 0 });
      continue;
    }
    console.log(`\n==> ${s.name}\n    $ ${s.cmd.join(" ")}`);
    const r = run(s.cmd);
    if (r.ok) console.log(`    ok (${duration(r.durationMs)})`);
    else console.log(`    FAILED (${duration(r.durationMs)}, exit ${r.status ?? "n/a"}${r.timedOut ? ", timed out" : ""})\n${excerpt(r.output)}`);
    results.push({ name: s.name, status: r.ok ? "ok" : "failed", durationMs: r.durationMs });
    if (!r.ok) {
      failures.push(failureOf(s.name, r));
      if (STOP_ON_RED.has(s.name)) stopped = true;
    }
  }

  if (!failures.length && file && tree) saveGreen(file, { tree, steps: names });
  finish(!failures.length, failures, { scope: scopeJson, steps: results });
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
