import assert from "node:assert/strict";
import test from "node:test";
import { AREA_NAMES } from "./config.mjs";
import { buildState, createSandbox } from "./fake-gh-sandbox.mjs";

const [CODE, , SCRIPTS, , DOCS] = AREA_NAMES;

// #1 Code, #2 no area, epic #3 whose parts #4-#6 are Code, Scripts, Docs
const areaState = () =>
  buildState({
    issues: [
      { number: 1, status: "Todo", title: "Code item", labels: ["spec"], area: CODE },
      { number: 2, status: "Todo", title: "Unlabelled item", labels: ["spec"] },
      { number: 3, status: "Todo", title: "Area epic", labels: ["epic"] },
      { number: 4, status: "Todo", title: "Code part", labels: ["spec"], parent: 3, area: CODE },
      { number: 5, status: "Todo", title: "Scripts part", labels: ["spec"], parent: 3, area: SCRIPTS },
      { number: 6, status: "Todo", title: "Docs part", labels: ["spec"], parent: 3, area: DOCS },
    ],
  });

const rowOf = (out, n) =>
  out
    .split(/\r?\n/)
    .filter((l) => l.startsWith("| #"))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
    .find((cells) => cells[0] === `#${n}`);

test("area column and epic sequence", () => {
  const sandbox = createSandbox(areaState(), { branch: "" });
  try {
    const { code, out } = sandbox.run("plan-status.mjs", []);

    assert.equal(code, 0, out);
    assert.match(out, /^\| Issue \| Title \| Status \| Area \| Priority \| Tier · Kind \| Where it stands \|$/m);
    assert.equal(rowOf(out, 1)?.[3], CODE);
    assert.equal(rowOf(out, 2)?.[3], "—");
    assert.equal(rowOf(out, 3)?.[3], `${CODE} → ${SCRIPTS} → ${DOCS}`);
  } finally {
    sandbox.cleanup();
  }
});

test("filter by area keeps matching epics", () => {
  const sandbox = createSandbox(areaState(), { branch: "" });
  try {
    const scripts = sandbox.run("plan-status.mjs", ["--area", SCRIPTS.toLowerCase()]);

    assert.equal(scripts.code, 0, scripts.out);
    assert.ok(rowOf(scripts.stdout, 3), "epic #3 has a part in Scripts and stays");
    assert.equal(rowOf(scripts.stdout, 1), undefined);
    assert.equal(rowOf(scripts.stdout, 2), undefined);
    const queued = scripts.stdout.split(/\r?\n/).filter((l) => /^\d+\. #/.test(l));
    assert.deepEqual(
      queued.map((l) => l.match(/#(\d+)/)[1]),
      ["3"],
    );

    const upper = sandbox.run("plan-status.mjs", ["--area", SCRIPTS.toUpperCase()]);
    assert.equal(upper.stdout, scripts.stdout);

    const bogus = sandbox.run("plan-status.mjs", ["--area", "nope"]);
    assert.notEqual(bogus.code, 0, bogus.out);
    for (const area of AREA_NAMES) assert.ok(bogus.out.includes(area), `${area} is listed`);
  } finally {
    sandbox.cleanup();
  }
});

const priorityState = () =>
  buildState({
    issues: [
      { number: 1, status: "Todo", title: "Code item", labels: ["spec"], area: CODE, priority: "P1" },
      { number: 2, status: "Todo", title: "Scripts item", labels: ["spec"], area: SCRIPTS },
      { number: 3, status: "Todo", title: "Urgent epic", labels: ["epic"], priority: "P0" },
      { number: 4, status: "Todo", title: "Urgent part", labels: ["spec"], parent: 3, area: CODE, priority: "P0" },
    ],
  });

const priorityCell = (out, n) => {
  const header = out.split(/\r?\n/).find((l) => l.startsWith("| Issue |"));
  const at = header.split("|").slice(1, -1).map((c) => c.trim()).indexOf("Priority");
  return at < 0 ? undefined : rowOf(out, n)?.[at];
};

test("priority column and tags", () => {
  const sandbox = createSandbox(priorityState(), { branch: "" });
  try {
    const { code, out, stdout } = sandbox.run("plan-status.mjs", []);

    assert.equal(code, 0, out);
    assert.equal(priorityCell(stdout, 1), "P1");
    assert.equal(priorityCell(stdout, 2), "P2*");
    assert.equal(priorityCell(stdout, 3), "P0");
    const queued = stdout.split(/\r?\n/).find((l) => /^\d+\. #1 /.test(l));
    assert.match(queued, new RegExp(`\\[P1 · ${CODE}\\]`));
  } finally {
    sandbox.cleanup();
  }
});

test("filter by priority", () => {
  const sandbox = createSandbox(priorityState(), { branch: "" });
  try {
    const p1 = sandbox.run("plan-status.mjs", ["--priority", "p1"]);

    assert.equal(p1.code, 0, p1.out);
    assert.ok(rowOf(p1.stdout, 1), "the P1 item stays");
    assert.equal(rowOf(p1.stdout, 2), undefined);
    assert.equal(rowOf(p1.stdout, 3), undefined);

    const bogus = sandbox.run("plan-status.mjs", ["--priority", "P5"]);
    assert.notEqual(bogus.code, 0, bogus.out);
    for (const level of ["P0", "P1", "P2", "P3"]) assert.ok(bogus.out.includes(level), `${level} is listed`);
  } finally {
    sandbox.cleanup();
  }
});

test("band and dependency warnings", () => {
  const state = buildState({
    issues: [
      { number: 450, status: "Todo", title: "Low one", labels: ["spec"], area: SCRIPTS, priority: "P3" },
      { number: 440, status: "Todo", title: "Needs the base", labels: ["spec"], area: SCRIPTS, priority: "P1", body: "## Depends on\n\n- #432\n" },
      { number: 432, status: "Todo", title: "The base", labels: ["spec"], area: SCRIPTS, priority: "P1" },
    ],
  });
  const sandbox = createSandbox(state, { branch: "" });
  try {
    const { code, out, stdout } = sandbox.run("plan-status.mjs", []);

    assert.equal(code, 0, out);
    assert.match(stdout, /#450 P3 .*#440 P1/);
    assert.match(stdout, /#440 .*dependency #432/);
    const writes = sandbox.log().filter((e) => ["setField", "fieldBatch", "position", "mutation", "issueCreate"].includes(e.kind));
    assert.deepEqual(writes, []);
  } finally {
    sandbox.cleanup();
  }
});

test("missing or unknown priority warns", () => {
  const state = buildState({
    issues: [
      { number: 1, status: "Todo", title: "No priority", labels: ["spec"], area: SCRIPTS },
      { number: 2, status: "Todo", title: "Odd priority", labels: ["spec"], area: SCRIPTS, priority: "Soon" },
      { number: 3, status: "Todo", title: "Epic", labels: ["epic"], priority: "P2" },
      { number: 4, status: "Todo", title: "Part", labels: ["spec"], parent: 3, area: SCRIPTS },
    ],
  });
  const sandbox = createSandbox(state, { branch: "" });
  try {
    const { code, out, stdout } = sandbox.run("plan-status.mjs", []);

    assert.equal(code, 0, out);
    assert.match(stdout, /#1 .*no priority.*P2/);
    assert.match(stdout, /#2 .*"Soon".*P2/);
    assert.doesNotMatch(stdout, /#4 .*no priority/);
  } finally {
    sandbox.cleanup();
  }
});
