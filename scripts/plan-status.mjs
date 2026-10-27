#!/usr/bin/env node
// Usage: node scripts/plan-status.mjs [--write] [--no-gh] [--area <area>] [--priority <P0-P3>]
//   --write     also replace the status:start/status:end block in PLAN_DIR/README.md (always unfiltered)
//   --no-gh     skip the GitHub queries and report git alone
//   --area      list only the items in that area (an epic matches through any of its parts)
//   --priority  list only the items of that priority (a part counts with its epic)

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { GH_LIMIT_EXIT, clockTime, limitFromGhFailure, limitFromText, spawnGh } from "./gh.mjs";
import { parseArea } from "./areas.mjs";
import { AREA_NAMES, DEFAULT_BRANCH, PLAN_DIR, ROOT } from "./config.mjs";
import { PRIORITIES, orderWarnings, parsePriority, rankOf } from "./priority.mjs";
import { areaText, priorityText, queueLines, queueOf, withPartAreas } from "./queue.mjs";

const GH_PROJECT = path.join(ROOT, "scripts", "gh-project.mjs");
const README = path.join(PLAN_DIR, "README.md");
const START = "<!-- status:start -->";
const END = "<!-- status:end -->";
const GH_TIMEOUT_MS = 8000;
const PROJECT_TIMEOUT_MS = 20000;
const TRUNK = DEFAULT_BRANCH;

let ghLimit = null;

function noteLimit(bin, res) {
  if (ghLimit || res.error) return;
  if (bin === "gh") ghLimit = limitFromGhFailure(res.stderr);
  else if (res.status === GH_LIMIT_EXIT) ghLimit = limitFromText(`${res.stdout}\n${res.stderr}`);
}

function run(bin, argv, timeout = 15000) {
  const res =
    bin === "gh"
      ? spawnGh(argv, { timeout })
      : spawnSync(bin, argv, {
          cwd: ROOT,
          encoding: "utf8",
          timeout,
          windowsHide: true,
          shell: false,
        });
  if (res.error || res.status !== 0) {
    if (bin === "gh" || argv[0] === GH_PROJECT) noteLimit(bin, res);
    return null;
  }
  return res.stdout.trim();
}

const limitNote = () => `GitHub limit until ${ghLimit.resetAt ? clockTime(ghLimit.resetAt) : "?"}`;

const git = (...argv) => run("git", argv);
const lines = (text) => (text ? text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []);

function readSpecs(enabled) {
  if (!enabled) return null;
  const raw = run(process.execPath, [GH_PROJECT, "list"], PROJECT_TIMEOUT_MS);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function repoFacts() {
  const head = git("rev-parse", "--abbrev-ref", "HEAD");
  const dirty = lines(git("status", "--porcelain"));
  const localBranches = new Set(lines(git("for-each-ref", "--format=%(refname:short)", "refs/heads")));
  const remoteBranches = new Set(
    lines(git("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin")).map((b) =>
      b.replace(/^origin\//, ""),
    ),
  );
  const mergedLocal = new Set(lines(git("branch", "--merged", TRUNK, "--format=%(refname:short)")));
  const behindTrunk = git("rev-list", "--count", `${TRUNK}..origin/${TRUNK}`);

  return { head, dirty, localBranches, remoteBranches, mergedLocal, behindTrunk };
}

function pullRequests(enabled) {
  if (!enabled) return null;
  const raw = run(
    "gh",
    ["pr", "list", "--state", "all", "--limit", "60", "--json", "number,title,headRefName,state"],
    GH_TIMEOUT_MS,
  );
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mismatches(specs, facts, prs) {
  const merged = new Set((prs || []).filter((p) => p.state === "MERGED").map((p) => p.headRefName));
  const out = [];
  for (const s of specs.filter((x) => !x.epic && x.branch && x.status !== "Done")) {
    const exists = facts.localBranches.has(s.branch) || facts.remoteBranches.has(s.branch);
    if (merged.has(s.branch)) out.push(`#${s.number}: PR from \`${s.branch}\` merged but the issue is open (branch not linked to the issue) — close it`);
    else if (s.status === "Todo" && exists) out.push(`#${s.number}: card is Todo but \`${s.branch}\` exists — a run started without moving the card`);
  }
  // GitHub never closes a parent issue on its own, so an epic outlives its last merged part.
  const byNumber = new Map(specs.map((s) => [s.number, s]));
  for (const e of specs.filter((x) => x.epic && x.status !== "Done" && x.subIssues?.length)) {
    if (e.subIssues.every((n) => byNumber.get(n)?.status === "Done")) out.push(`#${e.number}: every part is done — close the epic (\`gh issue close ${e.number}\`)`);
  }
  return out;
}

// The most decisive fact wins, so the order matters.
function branchState(spec, facts, prs) {
  if (spec.epic) return `epic of ${(spec.subIssues || []).map((n) => `#${n}`).join(", ") || "no sub-issues yet"}`;
  if (!spec.branch) return "no Branch field on the card";

  const local = facts.localBranches.has(spec.branch);
  const remote = facts.remoteBranches.has(spec.branch);
  if (!local && !remote) return "not started";

  const ref = local ? spec.branch : `origin/${spec.branch}`;
  const ahead = Number(git("rev-list", "--count", `${TRUNK}..${ref}`) ?? "0");
  const pr = (prs || []).find((p) => p.headRefName === spec.branch);

  if (pr) return `PR #${pr.number} open, ${ahead} commit(s)`;
  if (ahead === 0) return local && facts.mergedLocal.has(spec.branch) ? "merged, branch not deleted" : "branch cut, nothing committed yet";
  return `${ahead} commit(s) ${local && remote ? "pushed" : local ? "local only" : "on origin only"}, no open PR`;
}

function strayBranches(facts, prs, specs) {
  const owned = new Set((specs || []).map((s) => s.branch).filter(Boolean));
  const withPr = new Set((prs || []).map((p) => p.headRefName));
  const candidates = new Set([...facts.localBranches, ...facts.remoteBranches]);

  return [...candidates]
    .filter((b) => /^(feat|chore|fix)\//.test(b) && !owned.has(b) && !withPr.has(b))
    .sort()
    .map((b) => {
      const local = facts.localBranches.has(b);
      const where = local && facts.remoteBranches.has(b) ? "" : local ? ", local only" : ", origin only";
      const ahead = Number(git("rev-list", "--count", `${TRUNK}..${local ? b : `origin/${b}`}`) ?? "0");
      return `\`${b}\` (${ahead === 0 ? "merged" : `${ahead} commit(s) ahead`}${where})`;
    });
}

function warningsOf(specs, queue) {
  const statusOf = new Map(specs.map((s) => [s.number, s.status]));
  const byNumber = new Map(specs.map((s) => [s.number, s]));
  const deps = new Map(
    queue.map((q) => [
      q.number,
      [q.number, ...(q.epic ? q.subIssues ?? [] : [])].flatMap((n) => (byNumber.get(n)?.dependsOn ?? []).filter((d) => d !== n && statusOf.get(d) !== "Done")),
    ]),
  );
  return orderWarnings(queue, deps);
}

function render(specs, facts, allPrs, { area = null, priority = null } = {}) {
  const prs = allPrs && allPrs.filter((p) => p.state === "OPEN");
  const out = [];
  out.push("<!-- Generated by `node scripts/plan-status.mjs --write`. Do not edit by hand. -->");
  out.push("");

  const byNumber = new Map((specs || []).map((s) => [s.number, s]));
  const withOwnerPriority = (s) => (s.parent != null && byNumber.has(s.parent) ? { ...s, priority: byNumber.get(s.parent).priority } : s);
  const matches = (s) => {
    if (priority && rankOf(withOwnerPriority(s)) !== PRIORITIES.indexOf(priority)) return false;
    if (!area) return true;
    const item = withPartAreas(s, specs);
    return item.epic ? item.partAreas.includes(area) : item.area === area;
  };
  const open = (specs || []).filter((s) => s.status !== "Done" && matches(s));
  if (specs === null) {
    out.push(`**Spec issues:** ${ghLimit ? `${limitNote()}.` : "not checked (`gh` unavailable or skipped)."}`);
  } else if (open.length) {
    out.push("| Issue | Title | Status | Area | Priority | Tier · Kind | Where it stands |");
    out.push("|---|---|---|---|---|---|---|");
    for (const s of open) {
      const kind = [s.tier ?? "?", s.kind ?? (s.epic ? "Epic" : "?"), s.skipTests && "skip-tests"].filter(Boolean).join(" · ");
      out.push(`| #${s.number} | ${s.title.replace(/\|/g, "\\|")} | ${s.status ?? "?"} | ${areaText(withPartAreas(s, specs))} | ${priorityText(withOwnerPriority(s))} | ${kind} | ${branchState(s, facts, prs)} |`);
    }
  } else {
    out.push("No open spec issues on the project.");
  }
  const doneCount = (specs || []).filter((s) => s.status === "Done").length;
  if (doneCount) out.push(`\n${doneCount} spec issue(s) done.`);
  out.push("");

  if (specs) {
    const fullQueue = queueOf(specs);
    const queue = fullQueue.filter(matches);
    if (queue.length) out.push("**Queue:**", "", ...queueLines(queue));
    else out.push("**Queue:** nothing in Todo — `/design` something.");
    const shown = new Set(queue.map((q) => q.number));
    const inversions = warningsOf(specs, fullQueue).filter((w) => shown.has(w.number));
    if (inversions.length) out.push("", "**Warnings:**", ...inversions.map((w) => `- ${w.text}`), "");
    const wrong = mismatches(specs, facts, allPrs);
    if (wrong.length) out.push(`**Mismatches:** ${wrong.join(" · ")}`);
    out.push("");
  }

  const head = facts.head || "unknown";
  const dirt = facts.dirty.length ? `${facts.dirty.length} uncommitted file(s)` : "clean";
  const behind = facts.behindTrunk && facts.behindTrunk !== "0" ? `, ${facts.behindTrunk} behind \`origin/${TRUNK}\`` : "";
  out.push(`**Checkout:** \`${head}\`, ${dirt}${behind}.`);

  if (prs === null) {
    out.push(`**Open PRs:** ${ghLimit ? `${limitNote()}.` : "not checked (`gh` unavailable or skipped)."}`);
  } else if (!prs.length) {
    out.push("**Open PRs:** none.");
  } else {
    out.push(`**Open PRs (${prs.length}):** ` + prs.map((p) => `#${p.number} ${p.title}`).join(" · "));
  }

  const strays = strayBranches(facts, prs, specs);
  if (specs && strays.length) out.push(`**Lane branches with no spec issue and no PR:** ${strays.join(" · ")}`);

  return out.join("\n");
}

const argv = process.argv.slice(2);
const wantWrite = argv.includes("--write");
const useGh = !argv.includes("--no-gh");
const areaAt = argv.indexOf("--area");
let area = null;
if (areaAt !== -1) {
  area = parseArea(argv[areaAt + 1]);
  if (!area) {
    process.stderr.write(`plan-status: unknown area "${argv[areaAt + 1] ?? ""}" — use one of: ${AREA_NAMES.join(", ")}\n`);
    process.exit(2);
  }
}

const priorityAt = argv.indexOf("--priority");
let priority = null;
if (priorityAt !== -1) {
  priority = parsePriority(argv[priorityAt + 1]);
  if (!priority) {
    process.stderr.write(`plan-status: unknown priority "${argv[priorityAt + 1] ?? ""}" — use one of: ${PRIORITIES.join(", ")}\n`);
    process.exit(2);
  }
}

if (!git("rev-parse", "--is-inside-work-tree")) {
  process.stdout.write("plan-status: not a git repository — nothing to report.\n");
  process.exit(0);
}

const specs = readSpecs(useGh);
const facts = repoFacts();
const prs = pullRequests(useGh);
const shown = render(specs, facts, prs, { area, priority });

process.stdout.write(`# Plan status — live, from git and GitHub (the README status block may lag)\n\n${shown}\n`);

if (!wantWrite) process.exit(0);
const block = area || priority ? render(specs, facts, prs) : shown;

const readme = readFileSync(README, "utf8");
const from = readme.indexOf(START);
const to = readme.indexOf(END);

if (from === -1 || to === -1 || to < from) {
  process.stderr.write(
    `plan-status: ${path.relative(ROOT, README)} has no ${START} / ${END} markers — add them around the generated block first.\n`,
  );
  process.exit(2);
}

writeFileSync(README, `${readme.slice(0, from + START.length)}\n${block}\n${readme.slice(to)}`, "utf8");
process.stderr.write(`plan-status: rewrote the status block in ${path.relative(ROOT, README)}\n`);
