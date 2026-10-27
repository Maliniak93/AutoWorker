// Usage: imported by gh-project.mjs and plan-status.mjs - the build queue is the board order of the top-level, not-Done items

import { PRIORITIES, shortOf } from "./priority.mjs";

const itemIdOf = (card) => card.id ?? card.itemId ?? null;
const partNumbers = (epic) => (epic.subIssues ?? []).map((s) => (typeof s === "object" ? s.number : s));

export function queueOf(cards) {
  const byNumber = new Map(cards.map((c) => [c.number, c]));
  const parts = new Set(cards.flatMap((c) => (c.epic ? partNumbers(c) : [])));
  const topLevel = cards.filter((c) => c.parent == null && !parts.has(c.number));
  const inRank = (status, urgent) => topLevel.filter((c) => c.status === status && (c.priority === PRIORITIES[0]) === urgent);

  return [...inRank("In progress", true), ...inRank("Todo", true), ...inRank("In progress", false), ...inRank("Todo", false)].map((c) => {
    if (!c.epic) return c;

    const children = partNumbers(c)
      .map((n) => byNumber.get(n))
      .filter(Boolean);
    const next = children.find((p) => p.status !== "Done");
    return { ...c, next: next ? next.number : null, partAreas: children.map((p) => p.area ?? null) };
  });
}

export function withPartAreas(card, cards) {
  if (!card.epic) return card;
  const byNumber = new Map(cards.map((c) => [c.number, c]));
  const partAreas = partNumbers(card)
    .map((n) => byNumber.get(n))
    .filter(Boolean)
    .map((p) => p.area ?? null);
  return { ...card, partAreas };
}

export function areaText(item) {
  if (item.epic) return item.partAreas?.some(Boolean) ? item.partAreas.map((a) => a ?? "—").join(" → ") : (item.area ?? "—");
  return item.area ?? "—";
}

export const priorityText = (item) => (item.priority ? shortOf(item.priority) : `${shortOf(null)}*`);

export const itemTag = (item) => `${priorityText(item)} · ${areaText(item)}`;

export function positionTarget(queue, spec, board = queue) {
  const members = new Set(queue.map((q) => q.number));
  const ordered = board.filter((b) => members.has(b.number));
  if (spec === "top") return null;
  if (spec === "bottom") return ordered.length ? itemIdOf(ordered[ordered.length - 1]) : null;

  const match = /^(before|after):(\d+)$/.exec(spec ?? "");
  if (!match) throw new Error(`unknown queue position "${spec}": use top, bottom, before:N or after:N`);

  const at = ordered.findIndex((q) => q.number === Number(match[2]));
  if (at < 0) throw new Error(`#${match[2]} is not in the queue`);
  if (match[1] === "after") return itemIdOf(ordered[at]);
  return at === 0 ? null : itemIdOf(ordered[at - 1]);
}

export function queueLines(queue) {
  return queue.map((q, i) => {
    const state = q.status === "In progress" ? " (In progress)" : "";
    const action = q.epic ? (q.next ? `next #${q.next}` : "no open part") : `/build #${q.number}`;
    return `${i + 1}. #${q.number} ${q.title}${state} — ${action} [${itemTag(q)}]`;
  });
}
