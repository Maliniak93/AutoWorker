// Usage: imported by queue.mjs and gh-project.mjs - priority levels, their bands on the board and where an item lands in its band

import { queueOf } from "./queue.mjs";

export const PRIORITIES = ["P0", "P1", "P2", "P3"];
export const DEFAULT_PRIORITY = PRIORITIES[2];

const itemIdOf = (card) => card.id ?? card.itemId ?? null;

export function parsePriority(value) {
  const match = /^p?([0-3])(?:\s.*)?$/i.exec(String(value ?? "").trim());
  return match ? PRIORITIES[Number(match[1])] : null;
}

export const shortOf = (priority) => (priority ?? DEFAULT_PRIORITY).slice(0, 2);

export function rankOf(card) {
  const at = PRIORITIES.indexOf(card.priority);
  return at < 0 ? PRIORITIES.indexOf(DEFAULT_PRIORITY) : at;
}

export function placeTarget(queue, board, { priority, spec = "bottom", self = null }) {
  const rank = PRIORITIES.indexOf(priority);
  if (rank < 0) throw new Error(`unknown priority "${priority}"`);
  const members = new Set(queue.map((q) => q.number));
  const todo = board.filter((b) => members.has(b.number) && b.status === "Todo" && b.number !== self);
  const lastAt = (keep) => {
    const found = todo.filter(keep);
    return found.length ? itemIdOf(found[found.length - 1]) : null;
  };

  if (spec === "bottom") return lastAt((c) => rankOf(c) <= rank);
  if (spec === "top") return lastAt((c) => rankOf(c) < rank);

  const match = /^(before|after):(\d+)$/.exec(spec);
  if (!match) throw new Error(`unknown queue position "${spec}": use top, bottom, before:N or after:N`);

  const at = todo.findIndex((c) => c.number === Number(match[2]));
  if (at < 0) throw new Error(`#${match[2]} is not a Todo item in the queue`);
  const target = todo[at];
  if (rankOf(target) !== rank) {
    const band = shortOf(PRIORITIES[rankOf(target)]);
    const mine = shortOf(priority);
    throw new Error(
      self === null
        ? `#${target.number} is in band ${band}, the new item in ${mine} — set --priority ${band} or use /prio after creating it`
        : `#${target.number} is in band ${band}, #${self} in ${mine} — change the priority: /prio #${self} ${band}`,
    );
  }
  if (match[1] === "after") return itemIdOf(target);
  return at === 0 ? null : itemIdOf(todo[at - 1]);
}

export function inBand(board, card) {
  const todo = board.filter((b) => b.status === "Todo");
  const at = todo.findIndex((b) => b.number === card.number);
  const rank = rankOf(card);
  return todo.every((b, i) => i === at || (i < at ? rankOf(b) <= rank : rankOf(b) >= rank));
}

const partsOf = (epic) => (epic.subIssues ?? []).map((s) => (typeof s === "object" ? s.number : s));

function ownersOf(queue) {
  const owner = new Map();
  for (const item of queue) {
    owner.set(item.number, item.number);
    if (item.epic) for (const part of partsOf(item)) owner.set(part, item.number);
  }
  return owner;
}

function dependenciesOf(owner, deps, number) {
  const found = (deps.get(number) ?? []).map((d) => owner.get(d)).filter((d) => d !== undefined && d !== number);
  return [...new Set(found)];
}

export function raisePlan(queue, deps, { number, priority }) {
  const board = queue.map((q) => ({ ...q }));
  const byNumber = (n) => board.find((c) => c.number === n);
  const root = byNumber(number);
  if (!root) return [];
  root.priority = priority;

  const owner = ownersOf(board);
  const changes = [];
  const seen = new Map();
  const orderOf = () => queueOf(board).map((q) => q.number);

  const isAhead = (dep, dependent) => {
    const rank = rankOf(dependent);
    if (dependent.status === "Todo") {
      const order = orderOf();
      return rankOf(dep) <= rank && order.indexOf(dep.number) < order.indexOf(dependent.number);
    }
    if (rankOf(dep) < rank) return true;
    const first = queueOf(board).find((q) => q.status === "Todo" && rankOf(q) >= rank);
    return rankOf(dep) === rank && first?.number === dep.number;
  };

  const place = (dep, dependent) => {
    board.splice(board.indexOf(dep), 1);
    let at;
    if (dependent.status === "Todo") at = board.indexOf(dependent);
    else {
      const rank = rankOf(dependent);
      const lastUrgent = board.filter((c) => c.status === "Todo" && rankOf(c) < rank).pop();
      at = lastUrgent ? board.indexOf(lastUrgent) + 1 : 0;
    }
    board.splice(at, 0, dep);
    const before = board.slice(0, at).filter((c) => c.status === "Todo").pop();
    return before ? itemIdOf(before) : null;
  };

  const walk = (current, path) => {
    const dependent = byNumber(current);
    for (const dep of dependenciesOf(owner, deps, current)) {
      if (path.includes(dep)) {
        const loop = [...path.slice(path.indexOf(dep)), dep];
        throw new Error(`dependency cycle: ${loop.map((n) => `#${n}`).join(" → ")}`);
      }
      const card = byNumber(dep);
      if (card.status !== "Todo") continue;

      const from = card.priority ?? DEFAULT_PRIORITY;
      const raised = rankOf(card) > rankOf(dependent);
      if (raised) card.priority = PRIORITIES[rankOf(dependent)];
      let moved = false;
      if (raised || !isAhead(card, dependent)) {
        const afterId = place(card, dependent);
        changes.push({ number: dep, from, to: card.priority ?? DEFAULT_PRIORITY, afterId, for: current });
        moved = true;
      }

      const rank = rankOf(card);
      if (!moved && seen.has(dep) && seen.get(dep) <= rank) continue;
      seen.set(dep, rank);
      walk(dep, [...path, dep]);
    }
  };

  walk(number, [number]);
  return changes;
}

export function blockingDependent(queue, deps, number) {
  const owner = ownersOf(queue);
  const at = queue.findIndex((q) => q.number === number);
  return queue.find((q, i) => i < at && q.status === "Todo" && dependenciesOf(owner, deps, q.number).includes(number)) ?? null;
}

export function orderWarnings(queue, deps) {
  const owner = ownersOf(queue);
  const indexOf = new Map(queue.map((q, i) => [q.number, i]));
  const warnings = [];
  queue.forEach((item, i) => {
    if (!item.priority) warnings.push({ number: item.number, text: `#${item.number} has no priority — counted as ${DEFAULT_PRIORITY}` });
    else if (!PRIORITIES.includes(item.priority))
      warnings.push({ number: item.number, text: `#${item.number} has an unknown priority "${item.priority}" — counted as ${DEFAULT_PRIORITY}` });
    if (item.status !== "Todo") return;
    const lower = queue.slice(i + 1).find((q) => q.status === "Todo" && rankOf(q) < rankOf(item));
    if (lower) warnings.push({ number: item.number, text: `#${item.number} ${shortOf(item.priority)} sits above #${lower.number} ${shortOf(lower.priority)} — /prio or move` });
    for (const dep of dependenciesOf(owner, deps, item.number)) {
      if (indexOf.get(dep) > i) warnings.push({ number: item.number, text: `#${item.number} sits above its dependency #${dep} — /prio or move` });
    }
  });
  return warnings;
}

export function describeSpot(queue, number) {
  const at = queue.findIndex((q) => q.number === number);
  if (at <= 0) return "1. in the queue (top of Todo)";
  const before = queue[at - 1];
  return `${at + 1}. in the queue, after #${before.number} (${shortOf(before.priority)})`;
}
