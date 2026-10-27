import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { AREA_NAMES } from "./config.mjs";

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const SLUG = "area-idea";
const AREA_OPTIONS = [...AREA_NAMES, "epic"];
const roots = [];

after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

function sandboxRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), "idea-check-"));
  roots.push(root);
  mkdirSync(path.join(root, "scripts"));
  for (const file of readdirSync(SCRIPTS)) if (file.endsWith(".mjs")) copyFileSync(path.join(SCRIPTS, file), path.join(root, "scripts", file));
  copyFileSync(path.join(SCRIPTS, "..", "project.config.json"), path.join(root, "project.config.json"));
  mkdirSync(path.join(root, "docs", "plan", "prompts"), { recursive: true });
  const git = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  return root;
}

function prompt({ area, split, priority = "P2 — nice to have", kind = "change" }) {
  const sections = [
    ["Goal", "One change in one place."],
    ...(kind === "change" ? [["Current behaviour", "Today it does not exist."]] : []),
    ["How it should work", "It works as described."],
    ["Decisions already made", "None."],
    ["Out of scope", "Nothing else."],
    ...(split === undefined ? [] : [["Proposed split", split]]),
    ["Open questions for /design", "None."],
  ];
  return [
    "---",
    `slug: ${SLUG}`,
    "title: Area check",
    "target: design",
    `kind: ${kind}`,
    "status: draft",
    "created: 2026-10-19",
    ...(priority === null ? [] : [`priority: ${priority}`]),
    ...(area === undefined ? [] : [`area: ${area}`]),
    "---",
    "",
    "# Area check",
    "",
    ...sections.flatMap(([name, body]) => [`## ${name}`, "", body, ""]),
  ].join("\n");
}

function writePrompt(root, options) {
  writeFileSync(path.join(root, "docs", "plan", "prompts", `${SLUG}.md`), prompt(options), "utf8");
}

function check(root) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "idea.mjs"), "check", SLUG], { cwd: root, encoding: "utf8" });
  const line = res.stdout.split(/\r?\n/).find((l) => l.startsWith("IDEA_RESULT: "));
  return {
    code: res.status,
    out: `${res.stdout}${res.stderr}`,
    result: line ? JSON.parse(line.slice("IDEA_RESULT: ".length)) : null,
  };
}

test("check requires a known area", () => {
  const root = sandboxRepo();

  writePrompt(root, { area: AREA_NAMES[0].toLowerCase() });
  const ok = check(root);
  assert.equal(ok.code, 0, ok.out);
  assert.equal(ok.result.ok, true);

  for (const area of [undefined, "nope"]) {
    writePrompt(root, { area });
    const bad = check(root);
    assert.equal(bad.code, 1, `area ${area}: ${bad.out}`);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.problems.some((p) => /\barea\b/i.test(p)), JSON.stringify(bad.result.problems));
    for (const option of AREA_OPTIONS) assert.ok(bad.out.toLowerCase().includes(option.toLowerCase()), `${option} listed for area ${area}: ${bad.out}`);
  }
});

test("epic needs a proposed split by area", () => {
  const root = sandboxRepo();
  const [first, second] = AREA_NAMES;
  const split = `1. ${first} — the goal API\n2. ${second} — the goal screen`;

  writePrompt(root, { area: "epic", split });
  const good = check(root);
  assert.equal(good.code, 0, good.out);
  assert.equal(good.result.ok, true);

  writePrompt(root, { area: "epic" });
  const noSection = check(root);
  assert.equal(noSection.code, 1, noSection.out);
  assert.ok(noSection.result.problems.some((p) => p.includes("Proposed split")), JSON.stringify(noSection.result.problems));

  writePrompt(root, { area: "epic", split: `1. ${first} — the goal API` });
  const onePart = check(root);
  assert.equal(onePart.code, 1, onePart.out);
  assert.equal(onePart.result.ok, false);

  writePrompt(root, { area: "epic", split: `1. ${first} — the goal API\n2. Nothing concrete — the goal screen` });
  const noArea = check(root);
  assert.equal(noArea.code, 1, noArea.out);
  assert.equal(noArea.result.ok, false);
});

test("check requires a priority with a reason", () => {
  const root = sandboxRepo();

  writePrompt(root, { area: AREA_NAMES[0], priority: "P1 — blocks #440" });
  const ok = check(root);
  assert.equal(ok.code, 0, ok.out);
  assert.equal(ok.result.ok, true);

  for (const priority of [null, "P5 — x", "P1"]) {
    writePrompt(root, { area: AREA_NAMES[0], priority });
    const bad = check(root);
    assert.equal(bad.code, 1, `priority ${priority}: ${bad.out}`);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.problems.some((p) => /\bpriority\b/.test(p)), `priority ${priority}: ${JSON.stringify(bad.result.problems)}`);
  }
});

test("a new idea needs no current behaviour, a change does", () => {
  const root = sandboxRepo();

  writePrompt(root, { area: AREA_NAMES[0], kind: "new" });
  assert.equal(check(root).code, 0);

  writePrompt(root, { area: AREA_NAMES[0], kind: "change" });
  const change = check(root);
  assert.equal(change.code, 0, change.out);

  writePrompt(root, { area: AREA_NAMES[0], kind: "fix" });
  const fix = check(root);
  assert.equal(fix.code, 1, fix.out);
});
