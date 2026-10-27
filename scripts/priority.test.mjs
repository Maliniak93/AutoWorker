import assert from "node:assert/strict";
import test from "node:test";
import { describeSpot, orderWarnings, parsePriority, placeTarget, rankOf, raisePlan } from "./priority.mjs";
import { queueOf } from "./queue.mjs";

const card = (number, status, priority = null) => ({
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
  priority,
});

const afterOf = (value) => (value && typeof value === "object" && "afterId" in value ? value.afterId : value);

function place(board, priority, spec = "bottom", self = 999) {
  const queue = queueOf(board);
  return afterOf(placeTarget(queue, board, { priority, spec, self }));
}

test("placement follows bands", () => {
  const board = [card(440, "Todo", "P1"), card(441, "Todo", "P2"), card(442, "Todo", "P2"), card(443, "Todo", null)];

  assert.equal(place(board, "P1"), "ITEM_440");
  assert.equal(place(board, "P0"), null);
  assert.equal(place(board, "P3"), "ITEM_443");
  assert.equal(place(board, "P2"), "ITEM_443");
});

test("parsePriority", () => {
  assert.equal(parsePriority("p1"), "P1");
  assert.equal(parsePriority("1"), "P1");
  assert.equal(parsePriority("P1"), "P1");
  assert.equal(parsePriority("P5"), null);
});

test("describeSpot", () => {
  const board = [card(440, "Todo", "P1"), card(441, "Todo", "P2"), card(442, "Todo", "P2"), card(443, "Todo", null)];
  const afterId = place(board, "P1");
  assert.equal(afterId, "ITEM_440");

  const withNew = [board[0], card(444, "Todo", "P1"), ...board.slice(1)];
  assert.equal(describeSpot(queueOf(withNew), 444), "2. in the queue, after #440 (P1)");

  const atTop = [card(445, "Todo", "P0"), ...board];
  assert.equal(describeSpot(queueOf(atTop), 445), "1. in the queue (top of Todo)");
});

const P1 = "P1";
const P3 = "P3";

const epicCard = (number, status, priority, parts) => ({ ...card(number, status, priority), epic: true, subIssues: parts });
const partCard = (number, parent, status = "Todo") => ({ ...card(number, status, null), parent });

function applyChanges(board, changes) {
  let cards = board.map((c) => ({ ...c }));
  for (const change of changes) {
    const moved = cards.find((c) => c.number === change.number);
    moved.priority = change.to;
    if (change.afterId !== undefined) {
      cards = cards.filter((c) => c !== moved);
      const at = change.afterId === null ? 0 : cards.findIndex((c) => c.id === change.afterId) + 1;
      cards.splice(at, 0, moved);
    }
  }
  return cards;
}

const orderOf = (cards) => queueOf(cards).map((q) => q.number);

test("raise follows the chain", () => {
  const board = [card(450, "Todo", P1), card(440, "Todo", P1), card(431, "Todo", P3), card(432, "Todo", P3)];
  const deps = new Map([
    [440, [432]],
    [432, [431]],
  ]);

  const changes = raisePlan(queueOf(board), deps, { number: 440, priority: P1 });

  assert.deepEqual(changes.map((c) => c.number).sort(), [431, 432]);
  for (const change of changes) {
    assert.equal(change.from, P3);
    assert.equal(change.to, P1);
  }
  assert.deepEqual(orderOf(applyChanges(board, changes)), [450, 431, 432, 440]);
  assert.ok(applyChanges(board, changes).every((c) => c.number === 450 || c.priority === P1));
});

test("raise re-places a moved dependency's own chain in a diamond", () => {
  const board = [10, 40, 30, 5, 20].map((n) => card(n, "Todo", P1));
  const deps = new Map([
    [40, [30, 10]],
    [30, [20]],
    [10, [20]],
    [20, [5]],
  ]);

  const changes = raisePlan(queueOf(board), deps, { number: 40, priority: P1 });
  const order = orderOf(applyChanges(board, changes));

  for (const [dependent, wanted] of deps) {
    for (const dep of wanted) assert.ok(order.indexOf(dep) < order.indexOf(dependent), `#${dep} before #${dependent} in ${order}`);
  }
});

test("raise skips and lifts whole epics", () => {
  const skipped = [
    card(435, "Todo", "P0"),
    card(433, "Todo", P1),
    card(440, "Todo", P1),
    card(432, "In progress", P3),
    card(431, "Done", P3),
  ];
  const skipDeps = new Map([[440, [431, 432, 433, 435]]]);
  assert.deepEqual(raisePlan(queueOf(skipped), skipDeps, { number: 440, priority: P1 }), []);

  const sameEpic = [epicCard(9, "Todo", P1, [7, 8]), partCard(7, 9), partCard(8, 9)];
  assert.deepEqual(raisePlan(queueOf(sameEpic), new Map([[9, [8]]]), { number: 9, priority: P1 }), []);

  const other = [card(440, "Todo", P1), epicCard(20, "Todo", P3, [8, 21]), partCard(8, 20), partCard(21, 20)];
  const changes = raisePlan(queueOf(other), new Map([[440, [8]]]), { number: 440, priority: P1 });

  assert.deepEqual(
    changes.map((c) => [c.number, c.from, c.to]),
    [[20, P3, P1]],
  );
  assert.deepEqual(orderOf(applyChanges(other, changes)), [20, 440]);
});

test("rankOf ranks P0-P3 and counts an unknown value as P2", () => {
  assert.deepEqual(["P0", "P1", "P2", "P3"].map((priority) => rankOf({ priority })), [0, 1, 2, 3]);
  assert.equal(rankOf({ priority: "Other" }), 2);
  assert.equal(rankOf({ priority: null }), 2);
});

test("orderWarnings names a missing and an unknown priority", () => {
  const queue = [card(1, "Todo", null), card(2, "Todo", "Urgent"), card(3, "Todo", "P2")];
  const texts = orderWarnings(queue, new Map()).map((w) => w.text);
  assert.deepEqual(texts, ["#1 has no priority — counted as P2", '#2 has an unknown priority "Urgent" — counted as P2']);
});
