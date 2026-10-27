#!/usr/bin/env node
// Usage: node scripts/idea.mjs <verb> ...
//   context [--out <file>] [-- <free text>]   markdown digest of the repo map, board, ideas, ADRs and saved prompts; with free text also related items
//   list [--all]                              saved prompts as a table; used and dropped hidden without --all
//   path <slug>                               absolute path of the prompt file, existing or not
//   show <slug>                               print the prompt body without frontmatter
//   check <slug>                              validate the prompt and copy its body to the clipboard; last line IDEA_RESULT: {json}
//   mark <slug> <draft|ready|used|dropped> [--issue <n>]   rewrite status (and issue) in the frontmatter

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArea } from "./areas.mjs";
import { AREA_NAMES, PLAN_DIR, ROOT } from "./config.mjs";
import { GH_LIMIT_EXIT, clockTime, limitFromText } from "./gh.mjs";
import { parsePriority, shortOf } from "./priority.mjs";

const GH_PROJECT = path.join(ROOT, "scripts", "gh-project.mjs");

const KINDS = ["new", "change", "cleanup"];
const STATUSES = ["draft", "ready", "used", "dropped"];
const SECTIONS = ["Goal", "How it should work", "Decisions already made", "Out of scope", "Open questions for /design"];
const SPLIT = "Proposed split";
const MAX_BODY_LINES = 80;
const SKIP_DIRS = new Set(["node_modules", ".git", "bin", "obj", "dist"]);
const MAX_CHILDREN = 30;
const STOPWORDS = new Set(
  "this that with have should from into what when will would could about there their them then than been were are and for the want need make".split(/\s+/),
);

function fail(message) {
  throw new Error(message);
}

function run(bin, argv, { timeout = 15000, input } = {}) {
  return spawnSync(bin, argv, { cwd: ROOT, encoding: "utf8", timeout, windowsHide: true, shell: false, input });
}

function promptsDir() {
  const res = run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (res.error || res.status !== 0) fail(`git rev-parse failed: ${(res.stderr ?? res.error?.message ?? "").trim()}`);
  const dir = path.join(path.dirname(path.normalize(res.stdout.trim())), path.relative(ROOT, PLAN_DIR), "prompts");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function promptPath(slug) {
  if (!slug) fail("usage: <verb> <slug>");
  return path.join(promptsDir(), `${slug}.md`);
}

function parseFile(file) {
  const text = readFileSync(file, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) return { meta: {}, body: text, hasFrontmatter: false, raw: text };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: match[2].replace(/^\n+/, ""), hasFrontmatter: true, raw: text };
}

function readPrompts() {
  const dir = promptsDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const { meta } = parseFile(path.join(dir, f));
      return { ...meta, slug: f.slice(0, -3) };
    });
}

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const name = argv[i].slice(2);
      if (name === "all") flags[name] = true;
      else flags[name] = argv[++i];
    } else positional.push(argv[i]);
  }
  return { flags, positional };
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function readText(file) {
  return existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : "";
}

function subdirs(dir) {
  const skipped = path.join(PLAN_DIR, "prompts");
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name) && path.join(dir, e.name) !== skipped)
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function repoMap() {
  const lines = [];
  const items = [];
  for (const top of subdirs(ROOT)) {
    const children = subdirs(path.join(ROOT, top));
    const shown = children.slice(0, MAX_CHILDREN);
    items.push(top, ...shown.map((c) => `${top}/${c}`));
    lines.push(`${top}/${shown.length ? `: ${shown.join(", ")}${children.length > shown.length ? ", ..." : ""}` : ""}`);
  }
  return { lines, items };
}

function board() {
  const res = run(process.execPath, [GH_PROJECT, "list"], { timeout: 25000 });
  if (res.error) return { error: res.error.code === "ETIMEDOUT" ? "timeout" : res.error.message };
  if (res.status === GH_LIMIT_EXIT) {
    const limit = limitFromText(`${res.stdout}\n${res.stderr}`);
    if (limit) return { limit };
  }
  if (res.status !== 0) return { error: (res.stderr || "gh-project failed").trim().split("\n")[0].slice(0, 100) };
  try {
    return { issues: JSON.parse(res.stdout) };
  } catch {
    return { error: "invalid JSON" };
  }
}

function boardLines(issues) {
  const open = issues.filter((i) => i.status !== "Done").sort((a, b) => a.number - b.number);
  const done = issues.filter((i) => i.status === "Done").sort((a, b) => b.number - a.number);
  const lines = open.map((i) => {
    const subs = (i.subIssues ?? []).map((s) => `#${s.number ?? s}`);
    const epic = subs.length ? ` · epic of ${subs.join(",")}` : "";
    return `- #${i.number} [${i.status} · Tier ${i.tier ?? "?"} · ${i.kind ?? "?"}${i.area ? ` · ${i.area}` : ""}${i.priority ? ` · ${shortOf(i.priority)}` : ""}${epic}] ${i.title}`;
  });
  return [...lines, ...done.map((i) => `- #${i.number} ${i.title}`)];
}

function ideas() {
  const found = [];
  let section = "";
  for (const line of readText(path.join(PLAN_DIR, "ideas.md")).split("\n")) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) section = h[1].trim();
    const b = /^- \*\*(.+?)\*\*(.*)$/.exec(line);
    if (b) found.push({ name: b[1], tier: /\(tier (\d)/.exec(b[2])?.[1], section });
  }
  return found;
}

function adrs() {
  return readText(path.join(PLAN_DIR, "decisions.md")).split("\n").filter((l) => l.startsWith("## ADR-")).map((l) => l.slice(3).trim());
}

function outOfScope() {
  const lines = readText(path.join(PLAN_DIR, "product.md")).split("\n");
  const start = lines.findIndex((l) => l.startsWith("## Out of scope"));
  if (start < 0) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (/^\s*[-*] /.test(line)) out.push(line.trim());
  }
  return out;
}

function stems(text) {
  const spaced = text
    .replace(/https?:\/\/[^/\s]+/g, " ")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, " ")
    .replace(/(\p{Ll}|[0-9])(\p{Lu})/gu, "$1 $2");
  const words = spaced.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return new Set(words.map((w) => w.slice(0, 5)));
}

function related(freeText, sources) {
  const query = stems(freeText);
  const lines = [];
  for (const [source, items] of sources) {
    const hits = [];
    for (const item of items) {
      const m = [...stems(item)].filter((s) => query.has(s));
      if (m.length) hits.push(`${item} (${m.join(", ")})`);
    }
    if (hits.length) lines.push(`- ${source}: ${hits.join("; ")}`);
  }
  return lines.slice(0, 15);
}

function listRows(all) {
  return readPrompts().filter((p) => all || !["used", "dropped"].includes(p.status));
}

function table(rows) {
  if (!rows.length) return ["none"];
  const cell = (v) => (v ?? "").replace(/\|/g, "/");
  return [
    "| slug | status | target | kind | created | title |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((p) => `| ${[p.slug, p.status, p.target, p.kind, p.created, p.title].map(cell).join(" | ")} |`),
  ];
}

function context(argv) {
  const dash = argv.indexOf("--");
  const freeText = dash >= 0 ? argv.slice(dash + 1).join(" ").trim() : "";
  const { flags } = parseFlags(dash >= 0 ? argv.slice(0, dash) : argv);
  const map = repoMap();
  const out = [`Prompts dir: ${promptsDir()}`, `Today: ${today()}`, "", "## Repo map", ...(map.lines.length ? map.lines : ["none"]), "", "## Board"];
  const b = board();
  const issues = b.error || b.limit ? [] : b.issues;
  if (b.limit) out.push(`GitHub limit until ${b.limit.resetAt ? clockTime(b.limit.resetAt) : "?"}`);
  else out.push(...(b.error ? [`board unavailable (${b.error})`] : boardLines(issues)));
  const ideaList = ideas();
  const adrList = adrs();
  const saved = listRows(false);
  out.push("", "## Ideas", ...ideaList.map((i) => `- ${i.name}${i.tier ? ` (tier ${i.tier})` : ""} — ${i.section}`));
  out.push("", "## ADRs", ...adrList, "", "## Product out of scope", ...outOfScope());
  out.push("", "## Saved prompts", ...table(saved));
  if (freeText) {
    const hits = related(freeText, [
      ["issues", issues.map((i) => `#${i.number} ${i.title}`)],
      ["ideas", ideaList.map((i) => i.name)],
      ["ADRs", adrList],
      ["directories", map.items],
      ["saved prompts", saved.map((p) => `${p.slug}: ${p.title ?? ""}`)],
    ]);
    out.push("", "## Possibly related", ...(hits.length ? hits : ["none"]));
  }
  const text = out.join("\n");
  if (flags.out) writeFileSync(flags.out, text + "\n", "utf8");
  console.log(text);
}

function list(argv) {
  console.log(table(listRows(parseFlags(argv).flags.all)).join("\n"));
}

function pathVerb([slug]) {
  console.log(promptPath(slug));
}

function requireFile(slug) {
  const file = promptPath(slug);
  if (!existsSync(file)) {
    const slugs = readPrompts().map((p) => p.slug);
    fail(`no prompt "${slug}"; available: ${slugs.length ? slugs.join(", ") : "none"}`);
  }
  return file;
}

function show([slug]) {
  console.log(parseFile(requireFile(slug)).body.trimEnd());
}

function sectionsOf(body) {
  const map = new Map();
  let current = null;
  for (const line of body.split("\n")) {
    const h = /^##\s+(.*?)\s*$/.exec(line);
    if (h) {
      current = h[1];
      map.set(current, []);
    } else if (current) map.get(current).push(line);
  }
  return map;
}

function copyToClipboard(text) {
  if (process.platform === "win32") {
    const dir = mkdtempSync(path.join(os.tmpdir(), "idea-"));
    const tmp = path.join(dir, "prompt.txt");
    try {
      writeFileSync(tmp, text, "utf8");
      const cmd = `Get-Content -Raw -Encoding UTF8 -LiteralPath '${tmp.replace(/'/g, "''")}' | Set-Clipboard`;
      return run("powershell", ["-NoProfile", "-Command", cmd]).status === 0;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  for (const [bin, argv] of [["pbcopy", []], ["xclip", ["-selection", "clipboard"]]]) {
    const res = run(bin, argv, { input: text });
    if (!res.error && res.status === 0) return true;
  }
  return false;
}

function check([slug]) {
  const file = requireFile(slug);
  const { meta, body, hasFrontmatter } = parseFile(file);
  const problems = [];
  if (!hasFrontmatter) problems.push("missing frontmatter block");
  for (const key of ["slug", "title", "target", "kind", "status", "created"]) if (!meta[key]) problems.push(`frontmatter: missing ${key}`);
  if (meta.slug && meta.slug !== slug) problems.push(`frontmatter: slug "${meta.slug}" differs from filename "${slug}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) problems.push(`filename slug "${slug}" is not kebab-case`);
  if (meta.target && meta.target !== "design") problems.push("frontmatter: target must be design");
  if (meta.kind && !KINDS.includes(meta.kind)) problems.push(`frontmatter: kind must be ${KINDS.join(" | ")}`);
  if (meta.status && !STATUSES.includes(meta.status)) problems.push(`frontmatter: status must be ${STATUSES.join(" | ")}`);
  if (meta.created && !/^\d{4}-\d{2}-\d{2}$/.test(meta.created)) problems.push("frontmatter: created must be YYYY-MM-DD");

  const lines = body.trimEnd().split("\n");
  if (!/^# \S/.test(lines[0] ?? "")) problems.push("body must start with a `# ` title line");
  const required = [...SECTIONS, ...(meta.kind === "change" ? ["Current behaviour"] : [])];
  const sections = sectionsOf(body);
  for (const name of required) {
    if (!sections.has(name)) problems.push(`missing section "## ${name}"`);
    else if (!sections.get(name).some((l) => l.trim())) problems.push(`section "## ${name}" is empty`);
  }
  const options = [...AREA_NAMES, "epic"].join(" | ");
  if (!meta.area) problems.push(`frontmatter: missing area (${options})`);
  else if (meta.area.toLowerCase() === "epic") {
    const parts = (sections.get(SPLIT) ?? []).map((l) => /^\d+\.\s+(.*)$/.exec(l.trim())?.[1]).filter(Boolean);
    if (!sections.has(SPLIT)) problems.push(`area epic needs a section "## ${SPLIT}"`);
    else if (parts.length < 2) problems.push(`section "## ${SPLIT}" needs at least two numbered parts`);
    else if (parts.some((p) => !parseArea(/^([^\s—–-]+)/.exec(p)?.[1]))) problems.push(`section "## ${SPLIT}": each part starts with an area (${AREA_NAMES.join(" | ")})`);
  } else if (!parseArea(meta.area)) problems.push(`frontmatter: area must be ${options}`);
  const priority = /^(P[0-3]) — \S/.exec(meta.priority ?? "");
  if (!priority || !parsePriority(priority[1])) problems.push("frontmatter: priority must be P0-P3 followed by ` — ` and a reason");
  if (lines.length > MAX_BODY_LINES) problems.push(`body has ${lines.length} lines, limit is ${MAX_BODY_LINES}`);
  if (body.includes("```")) problems.push("fenced code blocks are not allowed; describe what and why, not code");

  if (problems.length) {
    for (const p of problems) console.log(`- ${p}`);
    console.log(`IDEA_RESULT: ${JSON.stringify({ ok: false, path: file, problems })}`);
    process.exit(1);
  }
  const clipboard = copyToClipboard(body.trimEnd() + "\n");
  console.log(`- ok: ${required.length} sections, ${lines.length} lines`);
  console.log(`- ${clipboard ? "body copied to clipboard" : "clipboard unavailable"}`);
  console.log(`IDEA_RESULT: ${JSON.stringify({ ok: true, path: file, lines: lines.length, clipboard, next: `/design idea:${slug}` })}`);
}

function setKey(head, key, value) {
  const re = new RegExp(`^${key}:.*$`, "m");
  return re.test(head) ? head.replace(re, `${key}: ${value}`) : head.replace(/\n---$/, `\n${key}: ${value}\n---`);
}

function mark(argv) {
  const { flags, positional: [slug, status] } = parseFlags(argv);
  if (!slug || !STATUSES.includes(status)) fail(`usage: mark <slug> <${STATUSES.join("|")}> [--issue <n>]`);
  if (flags.issue !== undefined && !/^\d+$/.test(flags.issue)) fail("--issue must be a number");
  const file = requireFile(slug);
  const { hasFrontmatter, raw } = parseFile(file);
  if (!hasFrontmatter) fail(`${slug}: no frontmatter to update`);
  const eol = readFileSync(file, "utf8").includes("\r\n") ? "\r\n" : "\n";
  const [, head, tail] = /^(---\n[\s\S]*?\n---)([\s\S]*)$/.exec(raw);
  let next = setKey(head, "status", status);
  if (flags.issue !== undefined) next = setKey(next, "issue", flags.issue);
  writeFileSync(file, (next + tail).replace(/\n/g, eol), "utf8");
  console.log(`${slug}: ${status}${flags.issue !== undefined ? ` (#${flags.issue})` : ""}`);
}

const VERBS = { context, list, path: pathVerb, show, check, mark };

const [command, ...rest] = process.argv.slice(2);
try {
  const verb = VERBS[command];
  if (!verb) fail(`usage: idea.mjs ${Object.keys(VERBS).join(" | ")}`);
  verb(rest);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
