import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { profileOf } from "./areas.mjs";
import { AREA_NAMES, CONFIG } from "./config.mjs";
import { BODY, buildState, createSandbox } from "./fake-gh-sandbox.mjs";

const [AREA_A, AREA_B] = AREA_NAMES;

const positions = (sandbox) => sandbox.log().filter((e) => e.kind === "position");
const setFields = (sandbox) => sandbox.log().filter((e) => e.kind === "setField");

function boardState() {
  return buildState({
    issues: [
      { number: 1, status: "Done" },
      { number: 4, status: "Todo", labels: ["spec"] },
      { number: 3, status: "Todo", labels: ["spec"] },
      { number: 5, status: "Todo", labels: ["spec"] },
      { number: 9, status: "Todo", labels: ["epic"] },
      { number: 8, status: "Todo", labels: ["spec"], parent: 9 },
    ],
  });
}

test("move sends the position mutation", () => {
  const sandbox = createSandbox(boardState());
  try {
    const moved = sandbox.run("gh-project.mjs", ["move", "5", "before:3"]);

    assert.equal(moved.code, 0, moved.out);
    const sent = positions(sandbox);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].itemId, "ITEM_5");
    assert.equal(sent[0].afterId, "ITEM_4");
    assert.match(sent[0].query, /updateProjectV2ItemPosition/);
    assert.match(sent[0].query, /afterId/);

    const refused = sandbox.run("gh-project.mjs", ["move", "8", "top"]);

    assert.equal(refused.code, 1, refused.out);
    assert.match(refused.out, /#8 is not in the queue/);
    assert.equal(positions(sandbox).length, 1);
  } finally {
    sandbox.cleanup();
  }
});

test("create places the card", () => {
  const sandbox = createSandbox(boardState());
  try {
    const args = (title, slug) => ["create", "--title", title, "--body-file", sandbox.bodyFile, "--slug", slug, "--tier", "1", "--kind", "change", "--area", AREA_A];

    const first = sandbox.run("gh-project.mjs", [...args("First", "first"), "--priority", "P2", "--queue", "after:3"]);
    assert.equal(first.code, 0, first.out);
    const firstNumber = JSON.parse(first.stdout.trim().split(/\r?\n/).pop()).number;

    const second = sandbox.run("gh-project.mjs", [...args("Second part", "second"), "--parent", "9"]);
    assert.equal(second.code, 0, second.out);
    const secondNumber = JSON.parse(second.stdout.trim().split(/\r?\n/).pop()).number;

    const sent = positions(sandbox);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].itemId, `ITEM_${firstNumber}`);
    assert.equal(sent[0].afterId, "ITEM_3");
    assert.equal(sent[1].itemId, `ITEM_${secondNumber}`);
    assert.equal(sent[1].afterId, "ITEM_8");

    const fix = sandbox.run("gh-project.mjs", [...args("Third", "third").map((a) => (a === "change" ? "fix" : a)), "--priority", "P2"]);
    assert.notEqual(fix.code, 0, fix.out);
    assert.match(fix.out, /--kind must be one of: new, change, cleanup/);

    const { issues } = sandbox.state();
    assert.equal(issues[firstNumber].branch, "feat/first");
    assert.equal(issues[secondNumber].branch, "feat/second");
  } finally {
    sandbox.cleanup();
  }
});

test("list reads board order", () => {
  const sandbox = createSandbox(boardState());
  try {
    const { code, stdout, out } = sandbox.run("gh-project.mjs", ["list"]);

    assert.equal(code, 0, out);
    const items = sandbox.log().filter((e) => e.kind === "items");
    assert.ok(items.length > 0);
    assert.match(JSON.stringify(items[0]), /orderBy/);
    assert.match(JSON.stringify(items[0]), /POSITION/);

    const cards = JSON.parse(stdout.trim().split(/\r?\n/).pop());
    assert.deepEqual(
      cards.map((c) => c.number),
      [1, 4, 3, 5, 9, 8],
    );
    for (const c of cards) assert.equal(typeof c.epic, "boolean", `#${c.number}`);
    assert.equal(cards.find((c) => c.number === 9).epic, true);
    assert.deepEqual(cards.find((c) => c.number === 9).subIssues, [8]);
  } finally {
    sandbox.cleanup();
  }
});

const lastJson = (stdout) => JSON.parse(stdout.trim().split(/\r?\n/).pop());
const areaOptions = AREA_NAMES;

function areaState(extra = {}) {
  return buildState({
    issues: [
      { number: 1, status: "Done", area: AREA_A },
      { number: 4, status: "Todo", labels: ["spec"], area: AREA_B },
      { number: 3, status: "Todo", labels: ["spec"] },
      { number: 9, status: "Todo", labels: ["epic"] },
      { number: 8, status: "Todo", labels: ["spec"], parent: 9 },
    ],
    ...extra,
  });
}

const createArgs = (sandbox, slug, extra = []) => ["create", "--title", slug, "--body-file", sandbox.bodyFile, "--slug", slug, "--tier", "1", "--kind", "change", ...(extra.includes("--parent") || extra.includes("--priority") ? [] : ["--priority", "P2"]), ...extra];
const issueCreates = (sandbox) => sandbox.log().filter((e) => e.kind === "issueCreate");

test("list and get include area", () => {
  const sandbox = createSandbox(areaState());
  try {
    const listed = sandbox.run("gh-project.mjs", ["list"]);
    assert.equal(listed.code, 0, listed.out);
    const cards = lastJson(listed.stdout);
    assert.equal(cards.find((c) => c.number === 1).area, AREA_A);
    assert.equal(cards.find((c) => c.number === 4).area, AREA_B);
    assert.equal(cards.find((c) => c.number === 3).area, null);

    const queued = sandbox.run("gh-project.mjs", ["queue"]);
    assert.equal(queued.code, 0, queued.out);
    const queue = lastJson(queued.stdout);
    assert.equal(queue.find((c) => c.number === 4).area, AREA_B);
    assert.equal(queue.find((c) => c.number === 3).area, null);

    const got = sandbox.run("gh-project.mjs", ["get", "4"]);
    assert.equal(got.code, 0, got.out);
    assert.equal(lastJson(got.stdout).area, AREA_B);
    assert.equal(lastJson(sandbox.run("gh-project.mjs", ["get", "3"]).stdout).area, null);
  } finally {
    sandbox.cleanup();
  }
});

test("init creates Area", () => {
  const sandbox = createSandbox(areaState({ withArea: false }));
  try {
    const run = sandbox.run("gh-project.mjs", ["init"]);

    assert.equal(run.code, 0, run.out);
    const created = sandbox.log().filter((e) => e.kind === "fieldCreate");
    assert.equal(created.length, 1);
    assert.equal(created[0].name, "Area");
    assert.deepEqual(created[0].options, areaOptions);
  } finally {
    sandbox.cleanup();
  }
});

test("create sets Area", () => {
  const sandbox = createSandbox(areaState());
  try {
    const run = sandbox.run("gh-project.mjs", createArgs(sandbox, "areaful", ["--area", AREA_B.toLowerCase()]));

    assert.equal(run.code, 0, run.out);
    const { number } = lastJson(run.stdout);
    assert.equal(sandbox.state().issues[number].area, AREA_B);
  } finally {
    sandbox.cleanup();
  }
});

test("create rejects a bad or epic area", () => {
  const sandbox = createSandbox(areaState());
  try {
    const bad = sandbox.run("gh-project.mjs", createArgs(sandbox, "bad", ["--area", "nope"]));
    assert.notEqual(bad.code, 0, bad.out);
    for (const option of areaOptions) assert.ok(bad.out.includes(option), `${option} listed in: ${bad.out}`);

    const epic = sandbox.run("gh-project.mjs", createArgs(sandbox, "epicarea", ["--area", AREA_A, "--epic"]));
    assert.notEqual(epic.code, 0, epic.out);
    assert.match(epic.out, /--area/);

    assert.deepEqual(issueCreates(sandbox), []);
  } finally {
    sandbox.cleanup();
  }
});

test("create requires area unless epic", () => {
  const sandbox = createSandbox(areaState());
  try {
    const missing = sandbox.run("gh-project.mjs", createArgs(sandbox, "noarea"));
    assert.notEqual(missing.code, 0, missing.out);
    assert.match(missing.out, /--area/);
    assert.deepEqual(issueCreates(sandbox), []);

    const epic = sandbox.run("gh-project.mjs", createArgs(sandbox, "splitepic", ["--epic"]));
    assert.equal(epic.code, 0, epic.out);
    assert.equal(sandbox.state().issues[lastJson(epic.stdout).number].area ?? null, null);
  } finally {
    sandbox.cleanup();
  }
});

test("edit sets Area", () => {
  const sandbox = createSandbox(areaState());
  try {
    const run = sandbox.run("gh-project.mjs", ["edit", "3", "--area", AREA_B]);

    assert.equal(run.code, 0, run.out);
    assert.equal(sandbox.state().issues[3].area, AREA_B);
  } finally {
    sandbox.cleanup();
  }
});

test("create without the Area field fails first", () => {
  const sandbox = createSandbox(areaState({ withArea: false }));
  try {
    const run = sandbox.run("gh-project.mjs", createArgs(sandbox, "noarea", ["--area", AREA_A]));

    assert.notEqual(run.code, 0, run.out);
    assert.match(run.out, /node scripts\/gh-project\.mjs init/);
    assert.deepEqual(issueCreates(sandbox), []);
  } finally {
    sandbox.cleanup();
  }
});

test("prepare warns without area", () => {
  const warning = "No Area on #5 — set it: node scripts/gh-project.mjs set 5 Area <area>";
  const without = createSandbox(prepareState("Todo"), { branch: "feat/part-one" });
  try {
    const run = without.run("gh-project.mjs", ["prepare", "5"]);

    assert.equal(run.code, 0, run.out);
    const out = lastJson(run.stdout);
    assert.equal(out.ok, true);
    assert.ok(out.notes.includes(warning), JSON.stringify(out.notes));
    assert.ok(run.stderr.includes(warning), run.stderr);
  } finally {
    without.cleanup();
  }

  const state = prepareState("Todo");
  state.issues[5].area = AREA_B;
  const withArea = createSandbox(state, { branch: "feat/part-one" });
  try {
    const run = withArea.run("gh-project.mjs", ["prepare", "5"]);

    assert.equal(run.code, 0, run.out);
    assert.ok(!lastJson(run.stdout).notes.some((n) => n.includes("No Area on")));
    assert.ok(!run.stderr.includes("No Area on"));
  } finally {
    withArea.cleanup();
  }
});

function prepareState(epicStatus) {
  return buildState({
    issues: [
      { number: 9, status: epicStatus, labels: ["epic"], kind: null, tier: null },
      { number: 5, status: "Todo", labels: ["spec"], parent: 9, branch: "feat/part-one", body: "## Goal\n\nx\n" },
      { number: 6, status: "Todo", labels: ["spec"], parent: 9, branch: "feat/part-two" },
    ],
  });
}

test("prepare moves the epic with its part", () => {
  const todo = createSandbox(prepareState("Todo"), { branch: "feat/part-one" });
  try {
    const run = todo.run("gh-project.mjs", ["prepare", "5"]);

    assert.equal(run.code, 0, run.out);
    assert.equal(JSON.parse(run.stdout.trim().split(/\r?\n/).pop()).ok, true, run.out);
    const state = todo.state();
    assert.equal(state.issues[5].status, "In progress");
    assert.equal(state.issues[9].status, "In progress");
  } finally {
    todo.cleanup();
  }

  const started = createSandbox(prepareState("In progress"), { branch: "feat/part-one" });
  try {
    const run = started.run("gh-project.mjs", ["prepare", "5"]);

    assert.equal(run.code, 0, run.out);
    assert.equal(started.state().issues[5].status, "In progress");
    assert.deepEqual(
      setFields(started).filter((e) => e.item === "ITEM_9"),
      [],
    );
  } finally {
    started.cleanup();
  }
});

const P1 = "P1";
const P2 = "P2";
const priorityOptions = ["P0", "P1", "P2", "P3"];
const writesOf = (sandbox) => sandbox.log().filter((e) => ["setField", "fieldBatch", "position", "mutation", "issueCreate"].includes(e.kind));

function priorityState(extra = {}) {
  return buildState({
    issues: [
      { number: 1, status: "Done" },
      { number: 440, status: "Todo", labels: ["spec"], priority: P1 },
      { number: 441, status: "Todo", labels: ["spec"], priority: P2 },
      { number: 442, status: "Todo", labels: ["spec"], priority: P2 },
      { number: 443, status: "Todo", labels: ["spec"] },
    ],
    ...extra,
  });
}

test("init creates Priority", () => {
  const sandbox = createSandbox(priorityState({ withPriority: false }));
  try {
    const run = sandbox.run("gh-project.mjs", ["init"]);

    assert.equal(run.code, 0, run.out);
    const created = sandbox.log().filter((e) => e.kind === "fieldCreate");
    assert.equal(created.length, 1);
    assert.equal(created[0].name, "Priority");
    assert.deepEqual(created[0].options, priorityOptions);
  } finally {
    sandbox.cleanup();
  }
});

test("list and get include priority", () => {
  const sandbox = createSandbox(priorityState());
  try {
    const listed = sandbox.run("gh-project.mjs", ["list"]);
    assert.equal(listed.code, 0, listed.out);
    const cards = lastJson(listed.stdout);
    assert.equal(cards.find((c) => c.number === 440).priority, P1);
    assert.equal(cards.find((c) => c.number === 443).priority, null);

    const queued = sandbox.run("gh-project.mjs", ["queue"]);
    assert.equal(queued.code, 0, queued.out);
    const queue = lastJson(queued.stdout);
    assert.equal(queue.find((c) => c.number === 441).priority, P2);
    assert.equal(queue.find((c) => c.number === 443).priority, null);

    assert.equal(lastJson(sandbox.run("gh-project.mjs", ["get", "440"]).stdout).priority, P1);
    assert.equal(lastJson(sandbox.run("gh-project.mjs", ["get", "443"]).stdout).priority, null);
  } finally {
    sandbox.cleanup();
  }
});

test("create writes the board priority option", () => {
  const sandbox = createSandbox(priorityState());
  try {
    const run = sandbox.run("gh-project.mjs", createArgs(sandbox, "board-option", ["--area", AREA_A, "--priority", "P2"]));
    assert.equal(run.code, 0, run.out);
    const issue = sandbox.state().issues[lastJson(run.stdout).number];
    assert.equal(issue.priority, "P2");
    assert.equal(issue.branch, "feat/board-option");
  } finally {
    sandbox.cleanup();
  }
});

test("create places by priority", () => {
  const sandbox = createSandbox(priorityState());
  try {
    const urgent = sandbox.run("gh-project.mjs", createArgs(sandbox, "urgent", ["--area", AREA_A, "--priority", "p1"]));
    assert.equal(urgent.code, 0, urgent.out);
    const urgentNumber = lastJson(urgent.stdout).number;
    assert.equal(sandbox.state().issues[urgentNumber].priority, P1);

    const plain = sandbox.run("gh-project.mjs", createArgs(sandbox, "plain", ["--area", AREA_A]));
    assert.equal(plain.code, 0, plain.out);
    const plainNumber = lastJson(plain.stdout).number;
    assert.equal(sandbox.state().issues[plainNumber].priority, P2);

    const sent = positions(sandbox);
    assert.equal(sent[0].itemId, `ITEM_${urgentNumber}`);
    assert.equal(sent[0].afterId, "ITEM_440");
    assert.equal(sent[1].itemId, `ITEM_${plainNumber}`);
    assert.equal(sent[1].afterId, "ITEM_443");
  } finally {
    sandbox.cleanup();
  }
});

test("create refuses a cross-band queue", () => {
  const state = priorityState();
  state.issues[9] = { ...state.issues[442], number: 9, labels: ["epic"], priority: null };
  state.order.push(9);
  const sandbox = createSandbox(state);
  try {
    const cross = sandbox.run("gh-project.mjs", createArgs(sandbox, "cross", ["--area", AREA_A, "--priority", "P1", "--queue", "after:441"]));
    assert.notEqual(cross.code, 0, cross.out);
    assert.match(cross.out, /\/prio/);

    const part = sandbox.run("gh-project.mjs", createArgs(sandbox, "part", ["--area", AREA_A, "--priority", "P1", "--parent", "9"]));
    assert.notEqual(part.code, 0, part.out);

    assert.deepEqual(issueCreates(sandbox), []);
  } finally {
    sandbox.cleanup();
  }
});

test("create requires priority unless part", () => {
  const state = priorityState();
  state.issues[9] = { ...state.issues[442], number: 9, labels: ["epic"], priority: null };
  state.order.push(9);
  const sandbox = createSandbox(state);
  try {
    const bare = ["create", "--title", "noprio", "--body-file", sandbox.bodyFile, "--slug", "noprio", "--tier", "1", "--kind", "change", "--area", AREA_A];
    const missing = sandbox.run("gh-project.mjs", bare);
    assert.notEqual(missing.code, 0, missing.out);
    assert.match(missing.out, /--priority/);
    assert.deepEqual(issueCreates(sandbox), []);

    const part = sandbox.run("gh-project.mjs", createArgs(sandbox, "partnoprio", ["--parent", "9", "--area", AREA_A]));
    assert.equal(part.code, 0, part.out);
    assert.equal(issueCreates(sandbox).length, 1);
  } finally {
    sandbox.cleanup();
  }
});

test("priority sets and re-places", () => {
  const sandbox = createSandbox(priorityState());
  try {
    const run = sandbox.run("gh-project.mjs", ["priority", "442", "P1"]);

    assert.equal(run.code, 0, run.out);
    assert.equal(sandbox.state().issues[442].priority, P1);
    const sent = positions(sandbox);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].itemId, "ITEM_442");
    assert.equal(sent[0].afterId, "ITEM_440");
    assert.match(run.stdout, /#442 P2 → P1, 3\. → 2\. in the queue/);
  } finally {
    sandbox.cleanup();
  }

  const running = createSandbox(
    buildState({
      issues: [
        { number: 10, status: "In progress", labels: ["spec"], priority: P2 },
        { number: 11, status: "Todo", labels: ["spec"], priority: P2 },
      ],
    }),
  );
  try {
    const run = running.run("gh-project.mjs", ["priority", "10", "P1"]);

    assert.equal(run.code, 0, run.out);
    assert.equal(running.state().issues[10].priority, P1);
    assert.equal(positions(running).length, 0);
  } finally {
    running.cleanup();
  }
});

test("priority refuses a part", () => {
  const sandbox = createSandbox(
    buildState({
      issues: [
        { number: 9, status: "Todo", labels: ["epic"] },
        { number: 8, status: "Todo", labels: ["spec"], parent: 9 },
      ],
    }),
  );
  try {
    const run = sandbox.run("gh-project.mjs", ["priority", "8", "P1"]);

    assert.notEqual(run.code, 0, run.out);
    assert.match(run.out, /#8 is a part of epic #9/);
    assert.deepEqual(writesOf(sandbox), []);
  } finally {
    sandbox.cleanup();
  }
});

test("priority where previews", () => {
  const sandbox = createSandbox(priorityState());
  try {
    const run = sandbox.run("gh-project.mjs", ["priority", "--where", "P1"]);

    assert.equal(run.code, 0, run.out);
    assert.match(run.stdout, /2\. in the queue, after #440 \(P1\)/);
    assert.deepEqual(writesOf(sandbox), []);
  } finally {
    sandbox.cleanup();
  }
});

test("move stays in the band", () => {
  const sandbox = createSandbox(priorityState());
  try {
    const top = sandbox.run("gh-project.mjs", ["move", "442", "top"]);
    assert.equal(top.code, 0, top.out);
    assert.equal(positions(sandbox).length, 1);
    assert.equal(positions(sandbox)[0].afterId, "ITEM_440");

    const refused = sandbox.run("gh-project.mjs", ["move", "442", "before:440"]);
    assert.notEqual(refused.code, 0, refused.out);
    assert.match(refused.out, /\/prio/);
    assert.equal(positions(sandbox).length, 1);
  } finally {
    sandbox.cleanup();
  }
});

test("priority backfill batches and keeps order", () => {
  const issues = [
    { number: 1, status: "Done" },
    { number: 2, status: "Todo", labels: ["spec"], priority: P1 },
    { number: 9, status: "Todo", labels: ["epic"], priority: "P3" },
    { number: 8, status: "Todo", labels: ["spec"], parent: 9 },
  ];
  for (let n = 101; n <= 125; n++) issues.push({ number: n, status: "Todo", labels: ["spec"] });
  const sandbox = createSandbox(buildState({ issues }));
  try {
    const dry = sandbox.run("gh-project.mjs", ["priority", "--backfill"]);
    assert.equal(dry.code, 0, dry.out);
    for (let n = 101; n <= 125; n++) assert.match(dry.stdout, new RegExp(`#${n} → P2`));
    assert.doesNotMatch(dry.stdout, /#(1|2|8|9) →/);
    assert.deepEqual(writesOf(sandbox), []);

    const applied = sandbox.run("gh-project.mjs", ["priority", "--backfill", "--apply"]);
    assert.equal(applied.code, 0, applied.out);
    const batches = sandbox.log().filter((e) => e.kind === "fieldBatch");
    assert.deepEqual(
      batches.map((b) => b.size),
      [20, 5],
    );
    assert.equal(positions(sandbox).length, 0);
    const state = sandbox.state();
    for (let n = 101; n <= 125; n++) assert.equal(state.issues[n].priority, P2);
    assert.equal(state.issues[8].priority, null);
    assert.equal(state.issues[1].priority, null);
    assert.equal(state.issues[2].priority, P1);

    const again = sandbox.run("gh-project.mjs", ["priority", "--backfill", "--apply"]);
    assert.equal(again.code, 0, again.out);
    assert.equal(sandbox.log().filter((e) => e.kind === "fieldBatch").length, 2);
  } finally {
    sandbox.cleanup();
  }
});

const P3 = "P3";
const dependsBody = (...numbers) => `## Depends on\n\n${numbers.map((n) => `- #${n} — x`).join("\n")}\n`;
const jsonLine = (stdout) => JSON.parse(stdout.split(/\r?\n/).find((l) => l.startsWith("{")));
const orderOfState = (sandbox) => sandbox.state().order;

function dependencyState() {
  return buildState({
    issues: [
      { number: 450, status: "Todo", labels: ["spec"], priority: P1 },
      { number: 440, status: "Todo", labels: ["spec"], priority: P2, body: dependsBody(432) },
      { number: 441, status: "Todo", labels: ["spec"], priority: P2 },
      { number: 432, status: "Todo", labels: ["spec"], priority: P3 },
    ],
  });
}

test("cycle fails without writes", () => {
  const state = dependencyState();
  state.issues[432].body = dependsBody(440);
  const sandbox = createSandbox(state);
  try {
    const run = sandbox.run("gh-project.mjs", ["priority", "440", "P1"]);

    assert.notEqual(run.code, 0, run.out);
    assert.match(run.out, /dependency cycle: #440 → #432 → #440/);
    assert.deepEqual(writesOf(sandbox), []);
  } finally {
    sandbox.cleanup();
  }
});

test("priority raises dependencies", () => {
  const sandbox = createSandbox(dependencyState());
  try {
    const run = sandbox.run("gh-project.mjs", ["priority", "440", "P1"]);

    assert.equal(run.code, 0, run.out);
    assert.match(run.stdout, /raised #432 P3 → P1 \(dependency #440\)/);
    const state = sandbox.state();
    assert.equal(state.issues[440].priority, P1);
    assert.equal(state.issues[432].priority, P1);
    assert.deepEqual(state.order, [450, 432, 440, 441]);
  } finally {
    sandbox.cleanup();
  }
});

test("lowering the dependent keeps raised dependencies", () => {
  const sandbox = createSandbox(dependencyState());
  try {
    assert.equal(sandbox.run("gh-project.mjs", ["priority", "440", "P1"]).code, 0);

    const run = sandbox.run("gh-project.mjs", ["priority", "440", "P3"]);

    assert.equal(run.code, 0, run.out);
    const state = sandbox.state();
    assert.equal(state.issues[440].priority, P3);
    assert.equal(state.issues[432].priority, P1);
  } finally {
    sandbox.cleanup();
  }
});

test("create and edit raise dependencies", () => {
  const created = createSandbox(dependencyState());
  try {
    fs.writeFileSync(created.bodyFile, `${BODY}\n${dependsBody(432)}`);
    const run = created.run("gh-project.mjs", createArgs(created, "dependent", ["--area", AREA_A, "--priority", "P1"]));

    assert.equal(run.code, 0, run.out);
    const { number } = jsonLine(run.stdout);
    assert.match(run.stdout, /raised #432 P3 → P1 \(dependency #\d+\)/);
    const state = created.state();
    assert.equal(state.issues[432].priority, P1);
    assert.equal(state.order.indexOf(432) + 1, state.order.indexOf(number));
  } finally {
    created.cleanup();
  }

  const edited = createSandbox(dependencyState());
  try {
    fs.writeFileSync(edited.bodyFile, `${BODY}\n${dependsBody(432)}`);
    assert.equal(edited.run("gh-project.mjs", ["priority", "441", "P1"]).code, 0);

    const run = edited.run("gh-project.mjs", ["edit", "441", "--body-file", edited.bodyFile]);

    assert.equal(run.code, 0, run.out);
    assert.match(run.stdout, /raised #432 P3 → P1 \(dependency #441\)/);
    const state = edited.state();
    assert.equal(state.issues[432].priority, P1);
    assert.equal(state.order.indexOf(432) + 1, state.order.indexOf(441));
  } finally {
    edited.cleanup();
  }
});

test("priority where previews raises", () => {
  const sandbox = createSandbox(dependencyState());
  try {
    fs.writeFileSync(sandbox.bodyFile, `${BODY}\n${dependsBody(432)}`);

    const run = sandbox.run("gh-project.mjs", ["priority", "--where", "P1", "--body-file", sandbox.bodyFile]);

    assert.equal(run.code, 0, run.out);
    assert.match(run.stdout, /raised #432 P3 → P1/);
    assert.deepEqual(writesOf(sandbox), []);
  } finally {
    sandbox.cleanup();
  }
});

test("lowering a blocking dependency fails", () => {
  const sandbox = createSandbox(
    buildState({
      issues: [
        { number: 432, status: "Todo", labels: ["spec"], priority: P1 },
        { number: 440, status: "Todo", labels: ["spec"], priority: P1, body: dependsBody(432) },
      ],
    }),
  );
  try {
    const lowered = sandbox.run("gh-project.mjs", ["priority", "432", "P3"]);
    assert.notEqual(lowered.code, 0, lowered.out);
    assert.match(lowered.out, /#432 blocks #440 \(P1\)/);

    const moved = sandbox.run("gh-project.mjs", ["move", "432", "after:440"]);
    assert.notEqual(moved.code, 0, moved.out);
    assert.match(moved.out, /#432 blocks #440 \(P1\)/);

    assert.deepEqual(writesOf(sandbox), []);
    assert.deepEqual(orderOfState(sandbox), [432, 440]);
  } finally {
    sandbox.cleanup();
  }
});

test("get reports lastPart", () => {
  const lastPartOf = (sandbox, n) => {
    const got = sandbox.run("gh-project.mjs", ["get", String(n)]);
    assert.equal(got.code, 0, got.out);
    const card = lastJson(got.stdout);
    assert.equal("lastBuild" in card, false);
    return card.lastPart;
  };
  const epic = { number: 30, status: "Todo", labels: ["epic"] };
  const open = createSandbox(
    buildState({
      issues: [
        epic,
        { number: 31, status: "Todo", labels: ["spec"], parent: 30, area: AREA_A },
        { number: 32, status: "Todo", labels: ["spec"], parent: 30, area: AREA_B },
        { number: 34, status: "Todo", labels: ["spec"], area: AREA_A },
      ],
    }),
  );
  const firstClosed = createSandbox(
    buildState({
      issues: [
        epic,
        { number: 31, status: "Done", labels: ["spec"], parent: 30, area: AREA_A },
        { number: 32, status: "Todo", labels: ["spec"], parent: 30, area: AREA_B },
      ],
    }),
  );
  try {
    assert.equal(lastPartOf(open, 31), false);
    assert.equal(lastPartOf(open, 32), false);
    assert.equal(lastPartOf(open, 34), false);
    assert.equal(lastPartOf(firstClosed, 32), true);
  } finally {
    open.cleanup();
    firstClosed.cleanup();
  }
});

test("prepare workflowArgs verifyAll and area", () => {
  const first = prepareState("Todo");
  first.issues[5].area = AREA_B;
  const open = createSandbox(first, { branch: "feat/part-one" });
  try {
    const run = open.run("gh-project.mjs", ["prepare", "5"]);

    assert.equal(run.code, 0, run.out);
    const { workflowArgs } = lastJson(run.stdout);
    assert.equal(workflowArgs.verifyAll, false);
    assert.equal(workflowArgs.area, AREA_B);
  } finally {
    open.cleanup();
  }

  const last = prepareState("Todo");
  last.issues[5].status = "Done";
  last.issues[5].state = "CLOSED";
  const closed = createSandbox(last, { branch: "feat/part-two" });
  try {
    const run = closed.run("gh-project.mjs", ["prepare", "6"]);

    assert.equal(run.code, 0, run.out);
    const { workflowArgs } = lastJson(run.stdout);
    assert.equal(workflowArgs.verifyAll, true);
    assert.equal(workflowArgs.area, null);
  } finally {
    closed.cleanup();
  }
});

test("prepare workflowArgs profile", () => {
  const warning = "No Area on #5";
  for (const area of [AREA_B, null]) {
    const state = prepareState("Todo");
    if (area) state.issues[5].area = area;
    const sandbox = createSandbox(state, { branch: "feat/part-one" });
    try {
      const run = sandbox.run("gh-project.mjs", ["prepare", "5"]);

      assert.equal(run.code, 0, run.out);
      const out = lastJson(run.stdout);
      const { workflowArgs } = out;
      assert.deepEqual(workflowArgs.profile, profileOf(area, { skip: workflowArgs.skip }), String(area));
      assert.equal(out.notes.some((n) => n.startsWith(warning)), area === null);
    } finally {
      sandbox.cleanup();
    }
  }
});

test("prepare replay profile", () => {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), "profile-config-"));
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  const state = prepareState("Todo");
  state.issues[5].area = AREA_B;
  const sandbox = createSandbox(state, { branch: "feat/part-one" });
  process.env.CLAUDE_CONFIG_DIR = saved ?? "";
  if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  try {
    fs.mkdirSync(path.join(sandbox.dir, ".claude", "workflows"), { recursive: true });
    fs.writeFileSync(
      path.join(sandbox.dir, ".claude", "workflows", "build-feature.js"),
      'export const meta = { name: "build-feature" }\nconst REPLAY = {"steps":[],"interrupted":null} // @replay\n',
    );
    fs.writeFileSync(path.join(sandbox.dir, "scratch.txt"), "work in progress\n");

    const first = sandbox.run("gh-project.mjs", ["prepare", "5"]);
    assert.equal(first.code, 0, first.out);
    const { workflowArgs } = lastJson(first.stdout);
    assert.equal(typeof workflowArgs.profile?.label, "string", String(JSON.stringify(workflowArgs.profile)));

    const history = path.join(config, "projects", fs.realpathSync(sandbox.dir).replace(/[^A-Za-z0-9]/g, "-"));
    const record = (runId, label) => {
      const dir = path.join(history, "s1", "subagents", "workflows", runId);
      fs.mkdirSync(dir, { recursive: true });
      const journal = [
        { type: "started", key: "k0", agentId: "a0", label: "implement the spec", phase: "p" },
        { type: "result", key: "k0", agentId: "a0", result: { n: 0 } },
      ];
      fs.writeFileSync(path.join(dir, "journal.jsonl"), journal.map((e) => JSON.stringify(e)).join("\n") + "\n");
      fs.mkdirSync(path.join(history, "s1", "workflows"), { recursive: true });
      const args = { ...workflowArgs, profile: { ...workflowArgs.profile, label } };
      fs.writeFileSync(path.join(history, "s1", "workflows", `${runId}.json`), JSON.stringify({ runId, workflowName: "build-feature", args, result: { status: "ready" } }));
    };

    record("wf_changed", "Other (implementer → reviewer)");
    const changed = sandbox.run("gh-project.mjs", ["prepare", "5"]);
    assert.equal(changed.code, 0, changed.out);
    const changedOut = lastJson(changed.stdout);
    assert.equal(changedOut.replay, null);
    assert.ok(changedOut.replaySkipped, JSON.stringify(changedOut));

    fs.rmSync(path.join(history, "s1"), { recursive: true, force: true });
    record("wf_same", workflowArgs.profile.label);
    const same = sandbox.run("gh-project.mjs", ["prepare", "5"]);
    assert.equal(same.code, 0, same.out);
    const sameOut = lastJson(same.stdout);
    assert.deepEqual(sameOut.replay?.steps, ["implement the spec"], JSON.stringify(sameOut));
    assert.equal(sameOut.replaySkipped, undefined);
  } finally {
    sandbox.cleanup();
    fs.rmSync(config, { recursive: true, force: true });
  }
});

test("report Profile", () => {
  const sandbox = createSandbox(
    buildState({ issues: [{ number: 60, status: "In progress", labels: ["spec"], area: AREA_B, branch: "feat/profil" }] }),
  );
  try {
    const post = (extra) => {
      const run = sandbox.run("gh-project.mjs", [
        "report",
        "60",
        "--json",
        JSON.stringify({ status: "shipped", branch: "feat/profil", tests: [], rounds: 0, ...extra }),
      ]);
      assert.equal(run.code, 0, run.out);
      return sandbox.log().filter((e) => e.kind === "comment").at(-1).body;
    };

    assert.ok(post({ profile: "Docs (implementer → reviewer)" }).includes("**Profile:** Docs (implementer → reviewer)"));
    assert.ok(!post({}).includes("Profile"));
    assert.ok(!post({ profile: "" }).includes("Profile"));
  } finally {
    sandbox.cleanup();
  }
});

test("report Outside area", () => {
  const sandbox = createSandbox(
    buildState({ issues: [{ number: 60, status: "In progress", labels: ["spec"], area: AREA_A, branch: "feat/outside" }] }),
  );
  try {
    const post = (extra) => {
      const run = sandbox.run("gh-project.mjs", [
        "report",
        "60",
        "--json",
        JSON.stringify({ status: "shipped", branch: "feat/outside", tests: [], rounds: 0, ...extra }),
      ]);
      assert.equal(run.code, 0, run.out);
      return sandbox.log().filter((e) => e.kind === "comment").at(-1).body;
    };

    assert.ok(post({ outsideArea: ["a", "b"] }).includes("**Outside area:** a, b"));
    assert.ok(!post({ outsideArea: [] }).includes("Outside area"));
    assert.ok(!post({}).includes("Outside area"));
  } finally {
    sandbox.cleanup();
  }
});

test("create checks options before creating", () => {
  const cases = [
    { field: "Priority", state: (s) => (s.fields.Priority.options = s.fields.Priority.options.filter((o) => o.name !== "P2")), args: [] },
    { field: "Area", state: (s) => (s.fields.Area.options = s.fields.Area.options.filter((o) => o.name !== AREA_A)), args: [] },
    { field: "Kind", state: (s) => (s.fields.Kind.options = s.fields.Kind.options.filter((o) => o.name !== "Change")), args: [] },
    { field: "Tier", state: (s) => (s.fields.Tier.options = s.fields.Tier.options.filter((o) => o.name !== "1")), args: [] },
  ];
  for (const { field, state: strip, args } of cases) {
    const state = priorityState();
    strip(state);
    const sandbox = createSandbox(state);
    try {
      const run = sandbox.run("gh-project.mjs", createArgs(sandbox, "unknown-option", ["--area", AREA_A, ...args]));
      assert.notEqual(run.code, 0, run.out);
      assert.match(run.out, new RegExp(`${field} has no option`));
      assert.equal(sandbox.log().filter((e) => e.kind === "issueCreate").length, 0, field);
    } finally {
      sandbox.cleanup();
    }
  }
});

test("create retries a missing field", () => {
  const state = priorityState();
  state.failFieldsOnce = ["Branch"];
  const sandbox = createSandbox(state);
  try {
    const run = sandbox.run("gh-project.mjs", createArgs(sandbox, "retried", ["--area", AREA_A]));

    assert.equal(run.code, 0, run.out);
    const number = lastJson(run.stdout).number;
    assert.equal(sandbox.state().issues[number].branch, "feat/retried");
    const branchWrites = setFields(sandbox).filter((e) => e.field === "Branch");
    assert.equal(branchWrites.length, 1);
    assert.deepEqual(sandbox.state().failFieldsOnce, []);
  } finally {
    sandbox.cleanup();
  }
});

test("create reports fields still missing", () => {
  const state = priorityState();
  state.failFields = ["Tier", "Branch", "Area"];
  const sandbox = createSandbox(state);
  try {
    const run = sandbox.run("gh-project.mjs", createArgs(sandbox, "half", ["--area", AREA_A]));

    assert.notEqual(run.code, 0, run.out);
    const number = sandbox.log().find((e) => e.kind === "issueCreate").number;
    assert.match(run.out, new RegExp(`issue #${number} already created: https://github.com/[^ ]+/issues/${number}`));
    assert.match(run.stderr, new RegExp(`node scripts/gh-project\\.mjs set ${number} Tier 1\\b`));
    assert.match(run.stderr, new RegExp(`node scripts/gh-project\\.mjs set ${number} Branch feat/half\\b`));
    assert.match(run.stderr, new RegExp(`warning: Area is still missing on #${number}: node scripts/gh-project\\.mjs set ${number} Area ${AREA_A}`));
  } finally {
    sandbox.cleanup();
  }

  const recommended = priorityState();
  recommended.failFields = ["Area", "Priority"];
  const lenient = createSandbox(recommended);
  try {
    const run = lenient.run("gh-project.mjs", createArgs(lenient, "lenient", ["--area", AREA_A]));

    assert.equal(run.code, 0, run.out);
    assert.match(run.stderr, /warning: Area is still missing/);
    assert.match(run.stderr, /warning: Priority is still missing/);
    assert.doesNotMatch(run.stderr, /Branch|Tier/);
    assert.equal(lastJson(run.stdout).branch, "feat/lenient");
  } finally {
    lenient.cleanup();
  }
});

const healTitle = "Sidebar with groups";
const healBranchOf = (sandbox, n) => sandbox.state().issues[n].branch;
const branchWrites = (sandbox) => setFields(sandbox).filter((e) => e.field === "Branch");

function healState(card = {}, extra = {}) {
  const state = buildState({
    issues: [
      { number: 20, status: "Todo", labels: ["spec"], title: healTitle, kind: "Change", ...card },
      { number: 21, status: "Todo", labels: ["epic"], title: "An epic", kind: null, tier: null },
    ],
  });
  return Object.assign(state, extra);
}

test("heal derives the name", () => {
  const sandbox = createSandbox(healState());
  try {
    const run = sandbox.run("gh-project.mjs", ["heal", "20"]);

    assert.equal(run.code, 0, run.out);
    assert.deepEqual(lastJson(run.stdout), { branch: "feat/sidebar-with-groups", healed: true, source: "derived" });
    assert.match(run.stderr, /^#20: no Branch, set feat\/sidebar-with-groups$/m);
    assert.equal(healBranchOf(sandbox, 20), "feat/sidebar-with-groups");
  } finally {
    sandbox.cleanup();
  }

  const set = createSandbox(healState({ branch: "feat/already" }));
  try {
    const run = set.run("gh-project.mjs", ["heal", "20"]);

    assert.equal(run.code, 0, run.out);
    assert.deepEqual(lastJson(run.stdout), { branch: "feat/already", healed: false, source: "card" });
    assert.deepEqual(branchWrites(set), []);
    assert.doesNotMatch(run.stderr, /no Branch/);
  } finally {
    set.cleanup();
  }
});

test("heal uses the linked branch", () => {
  const sandbox = createSandbox(healState({}, { linkedBranches: { 20: ["feat/linked-name"] } }));
  try {
    const run = sandbox.run("gh-project.mjs", ["heal", "20"]);

    assert.equal(run.code, 0, run.out);
    assert.deepEqual(lastJson(run.stdout), { branch: "feat/linked-name", healed: true, source: "linked" });
    assert.equal(healBranchOf(sandbox, 20), "feat/linked-name");
  } finally {
    sandbox.cleanup();
  }
});

test("heal suffixes a collision", () => {
  const sandbox = createSandbox(healState(), { branch: "feat/sidebar-with-groups" });
  try {
    const run = sandbox.run("gh-project.mjs", ["heal", "20"]);

    assert.equal(run.code, 0, run.out);
    assert.deepEqual(lastJson(run.stdout), { branch: "feat/sidebar-with-groups-20", healed: true, source: "derived" });
    assert.equal(healBranchOf(sandbox, 20), "feat/sidebar-with-groups-20");
  } finally {
    sandbox.cleanup();
  }

  const linked = createSandbox(healState({}, { linkedBranches: { 20: ["feat/sidebar-with-groups"] } }), { branch: "feat/sidebar-with-groups" });
  try {
    const run = linked.run("gh-project.mjs", ["heal", "20"]);

    assert.equal(lastJson(run.stdout).branch, "feat/sidebar-with-groups");
  } finally {
    linked.cleanup();
  }
});

test("heal warns on a failed write", () => {
  const sandbox = createSandbox(healState({}, { failFields: ["Branch"] }));
  try {
    const run = sandbox.run("gh-project.mjs", ["heal", "20"]);

    assert.equal(run.code, 0, run.out);
    assert.match(run.stderr, /warning: could not write Branch on #20/);
    assert.equal(lastJson(run.stdout).branch, "feat/sidebar-with-groups");
    assert.equal(healBranchOf(sandbox, 20), null);
  } finally {
    sandbox.cleanup();
  }
});

test("heal leaves an epic alone", () => {
  const sandbox = createSandbox(healState());
  try {
    const run = sandbox.run("gh-project.mjs", ["heal", "21"]);

    assert.equal(run.code, 0, run.out);
    assert.deepEqual(lastJson(run.stdout), { branch: null, healed: false, source: "epic" });
    assert.deepEqual(branchWrites(sandbox), []);
  } finally {
    sandbox.cleanup();
  }
});

test("prepare heals a missing Branch", () => {
  const state = prepareState("Todo");
  state.issues[5].branch = null;
  state.issues[5].title = "Part one";
  const sandbox = createSandbox(state, { branch: "" });
  try {
    const run = sandbox.run("gh-project.mjs", ["prepare", "5"]);

    assert.equal(run.code, 0, run.out);
    const out = lastJson(run.stdout);
    assert.equal(out.ok, true, run.out);
    assert.deepEqual(out.branch, { name: "feat/part-one", action: "created" });
    assert.equal(healBranchOf(sandbox, 5), "feat/part-one");
    assert.match(run.stderr, /^#5: no Branch, set feat\/part-one$/m);
  } finally {
    sandbox.cleanup();
  }
});

test("check lints the body", () => {
  const sandbox = createSandbox(buildState({ issues: [{ number: 1, status: "Todo", labels: ["spec"] }] }));
  try {
    const check = (body, ...extra) => {
      fs.writeFileSync(sandbox.bodyFile, body);
      return sandbox.run("gh-project.mjs", ["check", "--body-file", sandbox.bodyFile, ...extra]);
    };

    assert.equal(check(BODY).code, 0);

    const noGoal = check(BODY.replace("## Goal", "## Aim"));
    assert.equal(noGoal.code, 1, noGoal.out);
    assert.match(noGoal.out, /## Goal/);

    const noScope = check(BODY.replace("## Out of scope", "## Elsewhere"));
    assert.equal(noScope.code, 1, noScope.out);
    assert.match(noScope.out, /## Out of scope/);

    const noProof = check(BODY.replace(' — proof: a.test.mjs "case"', ""));
    assert.equal(noProof.code, 1, noProof.out);
    assert.match(noProof.out, /AC-1 names no `proof:`/);

    const checkbox = check(BODY.replace("1. Open the board.", "- [ ] Open the board."));
    assert.equal(checkbox.code, 1, checkbox.out);
    assert.match(checkbox.out, /## Manual test/);

    const planned = check(BODY.replace("1. Open the board.", "Verified in the epic plan, step 2."));
    assert.equal(planned.code, 0, planned.out);

    const vague = check(BODY.replace("1. Open the board.", "Open the board."));
    assert.equal(vague.code, 1, vague.out);

    const depends = check(`${BODY}\n## Depends on\n\nnothing\n`);
    assert.equal(depends.code, 1, depends.out);
    assert.match(depends.out, /Depends on/);

    const epic = check("## Goal\n\nSplit it.\n\n## Parts\n\n1. one\n", "--epic");
    assert.equal(epic.code, 0, epic.out);
  } finally {
    sandbox.cleanup();
  }
});

const freshProjectState = (extra = {}) => {
  const state = buildState({ issues: [], withArea: false, withPriority: false, projectNumber: 0 });
  for (const field of ["Tier", "Kind", "Branch"]) delete state.fields[field];
  state.fields.Status = { id: "F_Status", options: ["Todo", "In Progress", "Done"].map((name) => ({ id: `O_${name}`, name })) };
  return Object.assign(state, extra);
};
const kindsOf = (sandbox, kind) => sandbox.log().filter((e) => e.kind === kind);

test("init creates the project, the fields, the Status options and the labels, and writes the number back", () => {
  const sandbox = createSandbox(freshProjectState(), { projectNumber: 0 });
  try {
    const run = sandbox.run("gh-project.mjs", ["init"]);

    assert.equal(run.code, 0, run.out);
    assert.match(run.stdout, new RegExp(`project "${CONFIG.name}": created as #7`));
    assert.deepEqual(kindsOf(sandbox, "projectCreate").map((e) => [e.title, e.owner]), [[CONFIG.name, "acme"]]);
    assert.deepEqual(kindsOf(sandbox, "projectLink").map((e) => [e.number, e.owner, e.repo]), [[7, "acme", "demo"]]);

    const raw = fs.readFileSync(sandbox.configFile, "utf8");
    const config = JSON.parse(raw);
    assert.equal(config.github.projectNumber, 7);
    assert.equal(raw, `${JSON.stringify(config, null, 2)}\n`);
    assert.deepEqual(config.areas, CONFIG.areas);
    assert.equal(config.name, CONFIG.name);

    const created = kindsOf(sandbox, "fieldCreate");
    assert.deepEqual(created.map((e) => e.name), ["Tier", "Kind", "Area", "Priority", "Branch"]);
    assert.deepEqual(created.find((e) => e.name === "Area").options, AREA_NAMES);
    assert.deepEqual(created.find((e) => e.name === "Kind").options, ["New", "Change", "Cleanup"]);
    assert.deepEqual(kindsOf(sandbox, "statusOptions").map((e) => e.options), [["Todo", "In progress", "Done"]]);
    assert.deepEqual(kindsOf(sandbox, "labelCreate").map((e) => e.name), ["spec", "epic", "skip-tests"]);

    const again = sandbox.run("gh-project.mjs", ["init"]);
    assert.equal(again.code, 0, again.out);
    assert.equal(kindsOf(sandbox, "projectCreate").length, 1);
    assert.equal(kindsOf(sandbox, "projectList").length, 1);
    assert.equal(kindsOf(sandbox, "projectLink").length, 1);
    assert.equal(kindsOf(sandbox, "fieldCreate").length, 5);
    assert.equal(kindsOf(sandbox, "statusOptions").length, 1);
    assert.equal(kindsOf(sandbox, "labelCreate").length, 3);
    assert.match(again.stdout, /field Status: ok/);
    assert.match(again.stdout, /label spec: exists/);
  } finally {
    sandbox.cleanup();
  }
});

test("init reuses a project with the configured title and leaves foreign Status options alone", () => {
  const state = freshProjectState({ projects: [{ number: 3, title: CONFIG.name }], labels: ["spec"] });
  state.fields.Status = { id: "F_Status", options: ["Backlog", "Done"].map((name) => ({ id: `O_${name}`, name })) };
  const sandbox = createSandbox(state, { projectNumber: 0 });
  try {
    const run = sandbox.run("gh-project.mjs", ["init"]);

    assert.equal(run.code, 0, run.out);
    assert.match(run.stdout, /found as #3/);
    assert.equal(kindsOf(sandbox, "projectCreate").length, 0);
    assert.deepEqual(kindsOf(sandbox, "projectLink").map((e) => e.number), [3]);
    assert.equal(JSON.parse(fs.readFileSync(sandbox.configFile, "utf8")).github.projectNumber, 3);
    assert.equal(kindsOf(sandbox, "statusOptions").length, 0);
    assert.match(run.stderr, /Status options are Backlog, Done/);
    assert.deepEqual(kindsOf(sandbox, "labelCreate").map((e) => e.name), ["epic", "skip-tests"]);
  } finally {
    sandbox.cleanup();
  }
});

test("every verb but init and check needs a configured project", () => {
  const sandbox = createSandbox(freshProjectState(), { projectNumber: 0 });
  try {
    const run = sandbox.run("gh-project.mjs", ["list"]);

    assert.equal(run.code, 1, run.out);
    assert.match(run.out, /run node scripts\/gh-project\.mjs init/);
    assert.deepEqual(sandbox.log(), []);
  } finally {
    sandbox.cleanup();
  }
});
