#!/usr/bin/env node
// Usage: node scripts/ship.mjs <issue> (--from-run | --branch <b> --title <t> --json '<run report>' [--blocked]) [--dry-run]
//   --from-run  branch, title, report and --blocked come from the newest build-feature workflow record of <issue>
//   --blocked   only post the report, no git; --dry-run prints the commands and runs the read-only guards only
//   a shipping run first needs the tree proven green: node scripts/verify.mjs --cache-check (--all when the card is the last build of its epic)
//   last stdout line: SHIP_RESULT: {...}; exit 0 ok, 2 failed, 4 GitHub limit exhausted (stderr: reset time and a GITHUB_LIMIT line; rerun after the reset)

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { latestRunRecord } from "./build-replay.mjs";
import { DEFAULT_BRANCH, ROOT, repoSlug } from "./config.mjs";
import { GH_LIMIT_EXIT, GhLimitError, limitFromGhFailure, limitFromText, limitText, spawnGh } from "./gh.mjs";

const BOOLEAN_FLAGS = new Set(["blocked", "dry-run", "from-run"]);
const VERIFY_ARGV = ["scripts/verify.mjs", "--cache-check"];
const VERIFY_ALL_ARGV = ["scripts/verify.mjs", "--all", "--cache-check"];
const NOT_GREEN = "the tree was not proven green by verify.mjs (cache miss)";
const TRUNKS = [DEFAULT_BRANCH, "master", "main"];

function run(cmd, argv) {
  const res = cmd === "gh" ? spawnGh(argv) : spawnSync(cmd, argv, { cwd: ROOT, encoding: "utf8", windowsHide: true, shell: false });
  const err = res.error?.message ?? (res.stderr ?? "").trim();
  const out = {
    ok: !res.error && res.status === 0,
    out: (res.stdout ?? "").trim(),
    firstErr: err.split(/\r?\n/).find(Boolean) ?? "",
    all: `${res.stdout ?? ""}\n${res.stderr ?? ""}`,
  };
  if (!out.ok && !res.error) throwOnLimit(cmd, argv, res, out.all);
  return out;
}

function throwOnLimit(cmd, argv, res, all) {
  if (cmd === "gh") {
    const limit = limitFromGhFailure(res.stderr);
    if (limit) throw limit;
  } else if (argv[0]?.endsWith("gh-project.mjs") && res.status === GH_LIMIT_EXIT) {
    const limit = limitFromText(all);
    if (limit) throw new GhLimitError(limit.kind, limit.resetAt);
  }
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) throw new Error(`unexpected argument: ${argv[i]}`);
    const key = argv[i].slice(2);
    flags[key] = BOOLEAN_FLAGS.has(key) ? true : argv[++i];
  }
  return flags;
}

let issue;
let result = { ok: false };
let exitCode = 2;

function finish() {
  console.log(`SHIP_RESULT: ${JSON.stringify(result)}`);
  process.exit(exitCode);
}

const verifyArgv = ({ lastBuild }) => (lastBuild ? VERIFY_ALL_ARGV : VERIFY_ARGV);

function checkVerified(gate) {
  const argv = verifyArgv(gate);
  const res = run(process.execPath, argv);
  const line = res.all.split(/\r?\n/).reverse().find((l) => l.startsWith("VERIFY_RESULT: "));
  let parsed = null;
  try {
    parsed = JSON.parse(line.slice("VERIFY_RESULT: ".length));
  } catch {
  }
  if (res.ok && parsed?.ok === true) return { ok: true };
  return {
    ok: false,
    error: parsed
      ? `${NOT_GREEN}; run node scripts/verify.mjs ${gate.lastBuild ? "--all " : ""}--fix --cache first`
      : `${NOT_GREEN}; node ${argv.join(" ")} gave no result: ${res.firstErr}`,
  };
}

export function gateCommand(gate) {
  return `node ${verifyArgv(gate).join(" ")}`;
}

function readCard() {
  const bodyFile = path.join(os.tmpdir(), `kit-ship-${issue}-${process.pid}.md`);
  try {
    const res = run(process.execPath, ["scripts/gh-project.mjs", "get", issue, "--out", bodyFile, "--raw"]);
    if (!res.ok) throw new Error(`gh-project.mjs get ${issue} failed: ${res.firstErr}`);
    return { ...JSON.parse(res.out.split(/\r?\n/).pop()), body: readFileSync(bodyFile, "utf8") };
  } finally {
    rmSync(bodyFile, { force: true });
  }
}

function outsideOf(area) {
  if (!area) return [];
  const res = run(process.execPath, ["scripts/areas.mjs", "outside", area]);
  if (!res.ok) throw new Error(`areas.mjs outside ${area} failed: ${res.firstErr}`);
  return res.out.split(/\r?\n/).filter(Boolean);
}

function postReport(report) {
  const res = run(process.execPath, ["scripts/gh-project.mjs", "report", issue, "--json", JSON.stringify(report)]);
  return res.ok ? { ok: true } : { ok: false, error: res.firstErr };
}

function fromRun(issue) {
  const record = latestRunRecord({ issue });
  if (!record) throw new Error(`--from-run: no finished build-feature run of #${issue} with a ship report in the Claude Code history`);
  return { branch: record.args.branch, title: record.args.title, json: JSON.stringify(record.result.ship.report), blocked: Boolean(record.result.ship.blocked) };
}

function main() {
  const [first, ...rest] = process.argv.slice(2);
  issue = first;
  try {
    if (!/^\d+$/.test(issue ?? "")) throw new Error("usage: ship.mjs <issue> (--from-run | --branch <b> --title <t> --json '<run report>' [--blocked]) [--dry-run]");
    const flags = parseFlags(rest);
    if (flags["from-run"]) Object.assign(flags, fromRun(issue));
    for (const required of ["branch", "title", "json"]) if (!flags[required]) throw new Error(`--${required} is required`);
    const { branch, title } = flags;
    const report = JSON.parse(flags.json);
    result = { ok: false, branch };

    if (flags.blocked) {
      const posted = postReport({ ...report, status: "blocked" });
      result = { ok: posted.ok, branch, reportPosted: posted.ok, ...(posted.ok ? {} : { failedCommand: "gh-project.mjs report", error: posted.error }) };
      exitCode = posted.ok ? 0 : 2;
      finish();
    }

    const card = readCard();
    const gate = { lastBuild: Boolean(card.lastBuild) };
    const outsideArea = outsideOf(card.area);
    if (outsideArea.length) report.outsideArea = outsideArea;

    const repo = repoSlug();
    const body = `Spec: #${issue} - the build run report is on the issue.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)`;
    const steps = [
      { label: "git add -A", cmd: "git", argv: ["add", "-A"] },
      { label: "git commit", cmd: "git", argv: ["commit", "-m", title, "-m", `Spec: #${issue}`, "-m", "Co-Authored-By: Claude <noreply@anthropic.com>"] },
      { label: "git push", cmd: "git", argv: ["push", "-u", "origin", branch] },
      { label: "gh pr create", cmd: "gh", argv: ["pr", "create", "--repo", repo, "--base", DEFAULT_BRANCH, "--head", branch, "--title", title, "--body", body] },
    ];

    const current = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
    let failed = null;
    if (!current.ok) failed = { command: "git rev-parse --abbrev-ref HEAD", error: current.firstErr };
    else if (current.out !== branch) failed = { command: "guard", error: `current branch is ${current.out}, expected ${branch}` };
    else if (!/^(feat|fix|chore)\//.test(branch) || TRUNKS.includes(branch)) failed = { command: "guard", error: `refusing to ship branch ${branch}` };

    if (flags["dry-run"]) {
      const existing = run("gh", ["pr", "list", "--repo", repo, "--head", branch, "--state", "open", "--json", "url", "--limit", "1"]);
      const existingUrl = existing.ok ? JSON.parse(existing.out || "[]")[0]?.url : null;
      if (existingUrl) console.log(`an open PR exists and will be reused: ${existingUrl}`);
      if (failed) console.log(`guard failed: ${failed.error}`);
      console.log(`would run: ${gateCommand(gate)}`);
      if (!failed) {
        const verified = checkVerified(gate);
        console.log(`verify cache: ${verified.ok ? "green" : verified.error}`);
        if (!verified.ok) failed = { command: gateCommand(gate), error: verified.error };
      }
      for (const s of steps) console.log(`would run: ${s.cmd} ${s.argv.map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
      for (const m of report.manualTest ?? []) console.log(`would replace: ## Manual test in #${m.issue} from ${m.file}`);
      console.log(`would post: gh-project.mjs report ${issue} --json ${JSON.stringify({ ...report, status: "shipped" })}`);
      result = { ok: !failed, dryRun: true, branch, ...(failed ? { failedCommand: failed.command, error: failed.error } : {}) };
      exitCode = failed ? 2 : 0;
      finish();
    }

    if (!failed) {
      const verified = checkVerified(gate);
      if (!verified.ok) {
        const posted = postReport({ deviations: report.deviations, status: "blocked", stage: "verify", reason: NOT_GREEN });
        result = { ok: false, branch, reportPosted: posted.ok, failedCommand: gateCommand(gate), error: verified.error };
        exitCode = 2;
        finish();
      }
    }

    let prUrl = null;
    if (!failed) {
      for (const s of steps) {
        const res = run(s.cmd, s.argv);
        if (s.label === "git commit" && !res.ok) {
          const ahead = run("git", ["rev-list", "--count", `origin/${DEFAULT_BRANCH}..HEAD`]);
          if (/nothing to commit|nothing added to commit/i.test(res.all) && ahead.ok && Number(ahead.out) > 0) continue;
        }
        if (s.label === "gh pr create") {
          if (res.ok) prUrl = res.out.split(/\r?\n/).pop();
          else if (/already exists/i.test(res.all)) {
            const view = run("gh", ["pr", "view", branch, "--repo", repo, "--json", "url"]);
            if (view.ok) {
              prUrl = JSON.parse(view.out).url;
              continue;
            }
          }
        }
        if (!res.ok) {
          failed = { command: s.label, error: res.firstErr };
          break;
        }
      }
    }
    const sha = run("git", ["rev-parse", "--short", "HEAD"]);

    const posted = failed
      ? postReport({ deviations: report.deviations, status: "blocked", stage: "ship", reason: `${failed.command}: ${failed.error}` })
      : postReport({ ...report, status: "shipped" });
    result = {
      ok: !failed && posted.ok,
      branch,
      commit: sha.ok ? sha.out : null,
      prUrl,
      reportPosted: posted.ok,
      ...(failed ? { failedCommand: failed.command, error: failed.error } : posted.ok ? {} : { failedCommand: "gh-project.mjs report", error: posted.error }),
    };
    exitCode = result.ok ? 0 : 2;
  } catch (err) {
    if (err instanceof GhLimitError) {
      console.error(limitText(err).trimEnd());
      result = { ...result, ok: false, error: `GitHub limit (${err.kind})`, limit: { kind: err.kind, resetAt: err.resetAt } };
      exitCode = GH_LIMIT_EXIT;
    } else {
      result = { ...result, ok: false, error: err.message };
      exitCode = 2;
    }
  }
  finish();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
