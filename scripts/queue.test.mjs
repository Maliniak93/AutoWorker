import assert from "node:assert/strict";
import test from "node:test";
import { positionTarget, queueLines, queueOf } from "./queue.mjs";

const card = (number, status, extra = {}) => ({
  number,
  title: `Issue ${number}`,
  id: `ITEM_${number}`,
  itemId: `ITEM_${number}`,
  status,
  tier: "1",
  kind: "Change",
  branch: null,
  epic: false,
  skipTests: false,
  parent: null,
  ...extra,
});

const epic = (number, status, parts) => card(number, status, { epic: true, subIssues: parts });
const part = (number, status, parent, extra = {}) => card(number, status, { parent, ...extra });

const numbers = (queue) => queue.map((q) => q.number);
const nextOf = (item) => (item.next && typeof item.next === "object" ? item.next.number : item.next);
const afterOf = (value) => (value && typeof value === "object" && "afterId" in value ? value.afterId : value);
const attempt = (fn) => {
  try {
    return { value: fn() };
  } catch (error) {
    return { error };
  }
};

test("queue orders In progress then Todo by position", () => {
  const queue = queueOf([
    card(10, "Done"),
    card(11, "Todo"),
    card(12, "In progress"),
    epic(13, "Todo", [14, 15]),
    part(14, "Todo", 13),
    part(15, "Todo", 13),
    card(16, "In progress"),
    card(17, "Todo"),
  ]);

  assert.deepEqual(numbers(queue), [12, 16, 11, 13, 17]);
});

test("P0 lifts above In progress", () => {
  const queue = queueOf([
    card(10, "In progress", { priority: "P2" }),
    card(11, "Todo", { priority: "P1" }),
    card(12, "Todo", { priority: "P0" }),
  ]);

  assert.deepEqual(numbers(queue), [12, 10, 11]);
});

test("epic next is first open part", () => {
  const queue = queueOf([
    part(33, "Todo", 30),
    part(31, "Todo", 30),
    part(32, "Done", 30),
    epic(30, "Todo", [32, 31, 33]),
  ]);

  assert.deepEqual(numbers(queue), [30]);
  assert.equal(nextOf(queue[0]), 31);
});

test("position target resolves", () => {
  const queue = queueOf([
    card(12, "In progress"),
    card(16, "In progress"),
    card(11, "Todo"),
    epic(13, "Todo", [14]),
    part(14, "Todo", 13),
  ]);

  assert.equal(afterOf(positionTarget(queue, "top")), null);
  assert.equal(afterOf(positionTarget(queue, "bottom")), "ITEM_13");
  assert.equal(afterOf(positionTarget(queue, "before:16")), "ITEM_12");
  assert.equal(afterOf(positionTarget(queue, "before:12")), null);
  assert.equal(afterOf(positionTarget(queue, "after:16")), "ITEM_16");

  for (const spec of ["before:99", "after:99", "before:14"]) {
    const { value, error } = attempt(() => positionTarget(queue, spec));
    assert.ok(error || value?.error, `${spec} must be an error`);
  }
});

test("position target uses board order when In progress sits below Todo", () => {
  const board = [card(1, "Todo"), card(2, "Todo"), card(3, "In progress")];
  const queue = queueOf(board);

  assert.deepEqual(numbers(queue), [3, 1, 2]);
  assert.equal(afterOf(positionTarget(queue, "before:1", board)), null);
  assert.equal(afterOf(positionTarget(queue, "before:2", board)), "ITEM_1");
  assert.equal(afterOf(positionTarget(queue, "before:3", board)), "ITEM_2");
  assert.equal(afterOf(positionTarget(queue, "bottom", board)), "ITEM_3");
});

test("queue lines show state, next part and area", () => {
  const queue = queueOf([
    card(1, "Todo", { area: "Backend" }),
    card(2, "Todo", { area: null }),
    epic(3, "Todo", [4, 5, 6]),
    card(7, "In progress", { priority: "P0", title: "Running" }),
    part(4, "Todo", 3, { area: "Backend" }),
    part(5, "Todo", 3, { area: "Frontend" }),
    part(6, "Todo", 3, { area: "Docs" }),
  ]);
  const [running, standalone, unlabelled, epicLine] = queueLines(queue);

  assert.match(running, /^1\. #7 Running \(In progress\) — \/build #7 \[P0 · —\]$/);
  assert.match(standalone, /^2\. #1 Issue 1 — \/build #1 \[P2\* · Backend\]$/);
  assert.match(unlabelled, /^3\. #2 Issue 2 — \/build #2 \[P2\* · —\]$/);
  assert.match(epicLine, /^4\. #3 Issue 3 — next #4 \[P2\* · Backend → Frontend → Docs\]$/);
});

test("a Todo P0 comes before a Todo P3", () => {
  const queue = queueOf([card(1, "Todo", { priority: "P3" }), card(2, "Todo", { priority: "P0" })]);

  assert.deepEqual(numbers(queue), [2, 1]);
});
