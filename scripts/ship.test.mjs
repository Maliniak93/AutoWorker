import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { AREA_NAMES } from "./config.mjs";
import { buildState, createSandbox } from "./fake-gh-sandbox.mjs";

const BRANCH = "feat/outside-area";
const CODE = AREA_NAMES[0];
const GREEN = 'console.log(\'VERIFY_RESULT: {"ok":true,"failures":[]}\');\n';
const RED = 'console.log(\'VERIFY_RESULT: {"ok":false,"failures":[]}\');\nprocess.exit(2);\n';
const REPORT = JSON.stringify({ rounds: 0, reviewRan: true, minor: [] });

function gitIn(dir, argv) {
  const res = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...argv], { cwd: dir, encoding: "utf8", windowsHide: true });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.trim();
}

function shipSandbox({ verify = GREEN, branch = BRANCH, prs = [] } = {}) {
  const sandbox = createSandbox(buildState({ issues: [{ number: 50, status: "In progress", labels: ["spec"], area: CODE, branch: BRANCH }], prs }), { branch });
  fs.writeFileSync(path.join(sandbox.dir, "scripts", "verify.mjs"), verify);
  gitIn(sandbox.dir, ["add", "-A"]);
  gitIn(sandbox.dir, ["commit", "-m", "stub verify"]);
  return sandbox;
}

const ship = (sandbox, extra = [], json = REPORT) => sandbox.run("ship.mjs", ["50", "--branch", BRANCH, "--title", "Ship it", "--json", json, ...extra]);
const resultOf = (run) => JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1).slice("SHIP_RESULT: ".length));
const prCreates = (sandbox) => sandbox.log().filter((e) => e.args?.[0] === "pr" && e.args?.[1] === "create");

test("outsideArea in the report", () => {
  const sandbox = shipSandbox();
  try {
    fs.mkdirSync(path.join(sandbox.dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(sandbox.dir, "src", "a.ts"), "export {};\n");
    fs.mkdirSync(path.join(sandbox.dir, "docs", "plan"), { recursive: true });
    fs.writeFileSync(path.join(sandbox.dir, "docs", "plan", "workflow.md"), "# workflow\n");

    const run = ship(sandbox, ["--dry-run"]);

    const line = run.stdout.split(/\r?\n/).find((l) => l.startsWith("would post: gh-project.mjs report 50 --json "));
    assert.ok(line, run.out);
    const posted = JSON.parse(line.slice(line.indexOf("--json ") + "--json ".length));
    assert.deepEqual([...(posted.outsideArea ?? [])].sort(), ["docs/plan/workflow.md"]);
  } finally {
    sandbox.cleanup();
  }
});

test("gate argv", async () => {
  const { gateCommand } = await import("./ship.mjs");

  assert.equal(gateCommand({ lastBuild: true }), "node scripts/verify.mjs --all --cache-check");
  assert.equal(gateCommand({ lastBuild: false }), "node scripts/verify.mjs --cache-check");
});

test("dry run plans the ship and creates nothing", () => {
  const sandbox = shipSandbox();
  try {
    const before = gitIn(sandbox.dir, ["rev-parse", "HEAD"]);
    const run = ship(sandbox, ["--dry-run"]);

    assert.equal(run.code, 0, run.out);
    const planned = run.stdout.split(/\r?\n/).filter((l) => l.startsWith("would run: "));
    assert.ok(planned.includes("would run: git add -A"), run.out);
    assert.ok(planned.some((l) => l.startsWith("would run: git commit") && l.includes("Spec: #50")), run.out);
    assert.ok(planned.includes(`would run: git push -u origin ${BRANCH}`), run.out);
    assert.ok(planned.some((l) => l.startsWith("would run: gh pr create") && l.includes("--base") && l.includes("--head")), run.out);
    assert.ok(run.stdout.includes("verify cache: green"), run.out);
    assert.equal(resultOf(run).dryRun, true);
    assert.equal(gitIn(sandbox.dir, ["rev-parse", "HEAD"]), before);
    assert.equal(prCreates(sandbox).length, 0);
  } finally {
    sandbox.cleanup();
  }
});

test("refuses a tree verify has not proven green", () => {
  const sandbox = shipSandbox({ verify: RED });
  try {
    const before = gitIn(sandbox.dir, ["rev-parse", "HEAD"]);
    const run = ship(sandbox);

    assert.equal(run.code, 2, run.out);
    assert.match(resultOf(run).error, /not proven green/);
    assert.equal(gitIn(sandbox.dir, ["rev-parse", "HEAD"]), before);
    assert.equal(prCreates(sandbox).length, 0);
    assert.equal(sandbox.log().filter((e) => e.kind === "comment").length, 1, "the blocked report is posted");
  } finally {
    sandbox.cleanup();
  }
});

test("refuses the default branch and a wrong lane", () => {
  const onTrunk = shipSandbox({ branch: "" });
  try {
    const run = onTrunk.run("ship.mjs", ["50", "--branch", "master", "--title", "x", "--json", REPORT]);
    assert.equal(run.code, 2, run.out);
    assert.equal(resultOf(run).failedCommand, "guard");
    assert.equal(prCreates(onTrunk).length, 0);
  } finally {
    onTrunk.cleanup();
  }

  const sandbox = shipSandbox();
  try {
    const wrong = sandbox.run("ship.mjs", ["50", "--branch", "feat/other", "--title", "x", "--json", REPORT]);
    assert.equal(wrong.code, 2, wrong.out);
    assert.match(resultOf(wrong).error, /current branch is feat\/outside-area, expected feat\/other/);
    assert.equal(prCreates(sandbox).length, 0);
  } finally {
    sandbox.cleanup();
  }
});

test("--blocked only posts the report", () => {
  const sandbox = shipSandbox();
  try {
    const run = ship(sandbox, ["--blocked"], JSON.stringify({ stage: "review", reason: "stuck" }));

    assert.equal(run.code, 0, run.out);
    assert.equal(resultOf(run).reportPosted, true);
    assert.equal(prCreates(sandbox).length, 0);
    assert.equal(sandbox.log().filter((e) => e.kind === "comment").length, 1);
  } finally {
    sandbox.cleanup();
  }
});
