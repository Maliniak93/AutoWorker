import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AREAS, buildAreaModel } from "./areas.mjs";
import { CONFIG } from "./config.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "areas.mjs");
const playbook = (name) => `.claude/skills/${name}/SKILL.md`;
const sorted = (list) => [...list].sort();

const FIXTURE = [
  { name: "Api", paths: ["api/", "migrations/"], tests: true, implementer: ["api-playbook"], testWriter: ["api-tests"], checklist: ["Api"] },
  { name: "Web", paths: ["web/"], tests: true, implementer: ["web-playbook", "shared-playbook"], testWriter: ["api-tests", "web-tests"], checklist: ["Web"] },
  { name: "Claude", paths: [".claude/", "CLAUDE.md"], tests: false, implementer: ["claude-playbook"], testWriter: [], checklist: ["Claude"] },
  { name: "Scripts", paths: ["scripts/"], tests: false, implementer: [], testWriter: [], checklist: ["Scripts"] },
  { name: "Docs", paths: ["docs/", "README.md", "*.md", "Dockerfile*"], tests: false, implementer: [], testWriter: [], checklist: ["Docs"] },
];
const model = buildAreaModel(FIXTURE);

test("areaOfPath maps prefixes, exact names and globs", () => {
  const expected = {
    "api/users/handler.ts": "Api",
    "migrations/001.sql": "Api",
    "web\\src\\app.ts": "Web",
    "./web/index.html": "Web",
    ".claude/skills/x/SKILL.md": "Claude",
    "CLAUDE.md": "Claude",
    "scripts/gh.mjs": "Scripts",
    "docs/plan/ideas.md": "Docs",
    "README.md": "Docs",
    "CHANGELOG.md": "Docs",
    "Dockerfile.prod": "Docs",
    "web/README.md": "Web",
    "package.json": null,
  };
  for (const [file, area] of Object.entries(expected)) assert.equal(model.areaOfPath(file), area, file);
  assert.equal(model.parseArea("WEB"), "Web");
  assert.equal(model.parseArea("nope"), null);
});

test("areaOfFiles prefers test areas, then count, then config order", () => {
  assert.equal(model.areaOfFiles(["web/a.ts", "scripts/x.mjs", "scripts/y.mjs"]), "Web");
  assert.equal(model.areaOfFiles(["scripts/x.mjs", ".claude/skills/x/SKILL.md", ".claude/rules/y.md"]), "Claude");
  assert.equal(model.areaOfFiles([".claude/a.md", "scripts/a.mjs"]), "Claude");
  assert.equal(model.areaOfFiles(["package.json"]), null);
  assert.equal(model.areaOfFiles([]), null);
});

test("outsideArea lists every path outside the ticket area", () => {
  assert.deepEqual(model.outsideArea("Api", ["api/a.ts", "web/a.ts", "docs/x.md", "package.json"]), ["web/a.ts", "docs/x.md", "package.json"]);
  assert.deepEqual(model.outsideArea("Web", ["web/a.ts"]), []);
});

test("profileOf per area", () => {
  const table = {
    Api: { tests: true, implementer: ["api-playbook"], testWriter: ["api-tests"], checklist: ["Common", "Api"], phases: "test-writer → implementer → reviewer" },
    Web: { tests: true, implementer: ["web-playbook", "shared-playbook"], testWriter: ["api-tests", "web-tests"], checklist: ["Common", "Web"], phases: "test-writer → implementer → reviewer" },
    Claude: { tests: false, implementer: ["claude-playbook"], testWriter: [], checklist: ["Common", "Claude"], phases: "implementer → reviewer" },
    Docs: { tests: false, implementer: [], testWriter: [], checklist: ["Common", "Docs"], phases: "implementer → reviewer" },
  };
  for (const [area, want] of Object.entries(table)) {
    const profile = model.profileOf(area);
    assert.equal(profile.area, area, area);
    assert.equal(profile.known, true, area);
    assert.equal(profile.tests, want.tests, area);
    assert.equal(profile.review, true, area);
    assert.deepEqual(sorted(profile.implementerPlaybooks), sorted(want.implementer.map(playbook)), area);
    assert.deepEqual(sorted(profile.testWriterPlaybooks), sorted(want.testWriter.map(playbook)), area);
    assert.deepEqual(profile.checklist, want.checklist, area);
    assert.equal(profile.label, `${area} (${want.phases})`, area);
  }
});

test("profileOf without a known area runs the full path with every test area's playbooks", () => {
  for (const area of [null, undefined, "", "epic", "Nope"]) {
    const profile = model.profileOf(area);
    assert.equal(profile.known, false, String(area));
    assert.equal(profile.area, null, String(area));
    assert.equal(profile.tests, true, String(area));
    assert.equal(profile.review, true, String(area));
    assert.deepEqual(sorted(profile.implementerPlaybooks), sorted(["api-playbook", "web-playbook", "shared-playbook"].map(playbook)), String(area));
    assert.deepEqual(sorted(profile.testWriterPlaybooks), sorted(["api-tests", "web-tests"].map(playbook)), String(area));
    assert.deepEqual(sorted(profile.checklist), sorted(["Common", "Api", "Web", "Claude", "Scripts", "Docs"]), String(area));
    assert.equal(profile.label, "No area - full path", String(area));
  }
  assert.equal(buildAreaModel([FIXTURE[3]]).profileOf(null).tests, false);
});

test("profileOf skip overrides", () => {
  for (const area of ["Api", "Claude"]) {
    const noTests = model.profileOf(area, { skip: ["tests"] });
    assert.equal(noTests.tests, false, area);
    assert.equal(noTests.review, true, area);
    assert.deepEqual(noTests.testWriterPlaybooks, [], area);
    assert.ok(!noTests.label.includes("test-writer"), noTests.label);

    const noReview = model.profileOf(area, { skip: ["review"] });
    assert.equal(noReview.review, false, area);
    assert.ok(!noReview.label.includes("reviewer"), noReview.label);
  }
  assert.equal(model.profileOf("Api", { skip: ["tests"] }).label, "Api (implementer → reviewer)");
});

test("the configured areas feed the module exports and the cli", () => {
  assert.deepEqual(AREAS, CONFIG.areas.map((a) => a.name));
  const run = (args) => {
    const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", windowsHide: true });
    assert.equal(res.status, 0, res.stderr);
    return res.stdout.trim();
  };
  const table = run([]);
  for (const area of AREAS) assert.match(table, new RegExp(area.replace("/", "\/")));
  assert.equal(run(["of", "no/such/file.zzz"]), "—");
  assert.equal(JSON.parse(run(["profile", "--no-tests"])).label, "No area - full path");
  const first = CONFIG.areas.find((a) => a.paths?.some((p) => p.endsWith("/")));
  if (first) {
    const file = `${first.paths.find((p) => p.endsWith("/"))}x.txt`;
    assert.equal(run(["of", file]), first.name);
    assert.equal(run(["outside", first.name, file, "zz-unmatched.zzz"]), "zz-unmatched.zzz");
    assert.equal(JSON.parse(run(["profile", first.name])).area, first.name);
  }
});
