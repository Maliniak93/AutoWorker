#!/usr/bin/env node
// Usage: node scripts/preflight.mjs [--dry-run]
//   --dry-run   only check; never run a fix command
//   checks: the tools of preflight.tools (`<tool> --version`), gh login and `project` scope, git remote origin, the default branch, then preflight.extra (name, cmd, fix, hint)
//   last stdout line: PREFLIGHT_RESULT: {"ok":…,"checks":[{name,status,detail,fix?}]}; exit 0 when every check passed or was fixed

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG, DEFAULT_BRANCH, ROOT } from "./config.mjs";
import { spawnGh } from "./gh.mjs";

const NODE_MAJOR_FLOOR = 22;

const ok = (name, detail) => ({ name, status: "ok", detail });
const fixed = (name, detail) => ({ name, status: "fixed", detail });
const fail = (name, detail, fix) => ({ name, status: "fail", detail, ...(fix ? { fix } : {}) });

const quote = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : JSON.stringify(a));

function run(cmd, args, { timeout = 30_000 } = {}) {
  const res = cmd === "gh" ? spawnGh(args, { cwd: ROOT, timeout }) : spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return {
    status: res.status,
    out: `${res.stdout ?? ""}${res.stderr ?? ""}`,
    missing: res.error?.code === "ENOENT",
    timedOut: res.error?.code === "ETIMEDOUT",
  };
}

// A single command string so .cmd shims (npm, npx) resolve on Windows.
function runLine(argv, { timeout = 10 * 60 * 1000 } = {}) {
  const res = spawnSync(argv.map(quote).join(" "), { cwd: ROOT, shell: true, encoding: "utf8", timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}`, timedOut: res.error?.code === "ETIMEDOUT" };
}

const firstLine = (s) => s.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
const lastLines = (s, n = 8) => s.split(/\r?\n/).filter((l) => l.trim()).slice(-n).join("\n");

function checkTool(tool) {
  if (tool === "node") {
    const v = process.versions.node;
    if (Number(v.split(".")[0]) >= NODE_MAJOR_FLOOR) return ok("node", `v${v}`);
    return fail("node", `v${v} is below the required major ${NODE_MAJOR_FLOOR}`, `install Node ${NODE_MAJOR_FLOOR} or newer and put it first on PATH`);
  }
  const res = runLine([tool, "--version"], { timeout: 30_000 });
  if (res.status === 0) return ok(tool, firstLine(res.out) || "installed");
  return fail(tool, `\`${tool} --version\` failed: ${firstLine(res.out) || "not found"}`, `install ${tool} and put it on PATH`);
}

function checkGhAuth() {
  const res = run("gh", ["auth", "status"]);
  if (res.missing) return fail("gh-auth", "gh CLI is not installed", "install GitHub CLI (https://cli.github.com), then `! gh auth login`");
  if (res.status !== 0) return fail("gh-auth", `not logged in: ${firstLine(res.out)}`, "! gh auth login");
  const line = res.out.split(/\r?\n/).find((l) => /Token scopes:/i.test(l));
  if (!line) return ok("gh-auth", "logged in (token scopes not reported)");
  const scopes = [...line.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const missing = ["repo", "project"].filter((s) => !scopes.includes(s));
  if (!missing.length) return ok("gh-auth", `logged in, scopes: ${scopes.join(", ")}`);
  return fail("gh-auth", `token lacks scope(s): ${missing.join(", ")}`, `! gh auth refresh -s ${missing.join(",")}`);
}

function checkGit() {
  const inside = run("git", ["rev-parse", "--is-inside-work-tree"]);
  if (inside.missing) return fail("git-remote", "git is not installed", "install git");
  if (inside.status !== 0 || firstLine(inside.out) !== "true") return fail("git-remote", `${ROOT} is not inside a git work tree`, "run from a clone of the repo (`git init` or `git clone`)");
  const origin = run("git", ["remote", "get-url", "origin"]);
  if (origin.status !== 0) return fail("git-remote", "remote `origin` is not configured", "git remote add origin <url of the GitHub repo>");
  return ok("git-remote", `origin ${firstLine(origin.out)}`);
}

function checkDefaultBranch() {
  const has = (ref) => run("git", ["rev-parse", "--verify", "--quiet", ref]).status === 0;
  if (has(`refs/heads/${DEFAULT_BRANCH}`) || has(`refs/remotes/origin/${DEFAULT_BRANCH}`)) return ok("default-branch", DEFAULT_BRANCH);
  return fail("default-branch", `branch \`${DEFAULT_BRANCH}\` exists neither locally nor on origin`, `make an initial commit on \`${DEFAULT_BRANCH}\` and push it, or set defaultBranch in project.config.json`);
}

function checkExtra(entry, { dryRun }) {
  const name = entry.name ?? entry.cmd?.join(" ") ?? "extra";
  if (!Array.isArray(entry.cmd) || !entry.cmd.length) return fail(name, "preflight.extra entry has no cmd");
  const first = runLine(entry.cmd);
  if (first.status === 0) return ok(name, "ok");
  const hint = entry.hint ?? (entry.fix ? entry.fix.join(" ") : undefined);
  const why = first.timedOut ? "timed out" : firstLine(first.out) || `exit ${first.status}`;
  if (!entry.fix?.length) return fail(name, why, hint);
  if (dryRun) return fail(name, `${why} (dry run: fix not run)`, entry.fix.join(" "));
  const fixRes = runLine(entry.fix);
  if (fixRes.status !== 0) return fail(name, `fix \`${entry.fix.join(" ")}\` failed:\n${lastLines(fixRes.out)}`, hint);
  const again = runLine(entry.cmd);
  if (again.status === 0) return fixed(name, `${why} - ran \`${entry.fix.join(" ")}\``);
  return fail(name, `still failing after \`${entry.fix.join(" ")}\`:\n${lastLines(again.out)}`, hint);
}

function progressLine(c) {
  const mark = c.status === "fail" ? "✗" : "✓";
  const tag = c.status === "fixed" ? " [fixed]" : "";
  let line = `${mark} ${c.name}${tag} — ${c.detail}`;
  if (c.fix) line += ` → ${c.fix}`;
  return line;
}

export function preflight({ dryRun = false, log = (s) => process.stderr.write(`${s}\n`) } = {}) {
  const tools = CONFIG.preflight?.tools ?? ["node", "git", "gh"];
  const steps = [
    ...tools.map((t) => () => checkTool(t)),
    () => checkGhAuth(),
    () => checkGit(),
    () => checkDefaultBranch(),
    ...(CONFIG.preflight?.extra ?? []).map((e) => () => checkExtra(e, { dryRun })),
  ];
  const checks = [];
  for (const step of steps) {
    let result;
    try {
      result = step();
    } catch (e) {
      result = fail("preflight", `unexpected error: ${e.message}`);
    }
    checks.push(result);
    log(progressLine(result));
  }
  return { ok: checks.every((c) => c.status !== "fail"), checks };
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true;
    else {
      process.stderr.write(`preflight: unknown argument '${a}'\n`);
      process.exit(2);
    }
  }
  return args;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = preflight(parseArgs(process.argv.slice(2)));
  console.log(`PREFLIGHT_RESULT: ${JSON.stringify(result)}`);
  process.exitCode = result.ok ? 0 : 1;
}
