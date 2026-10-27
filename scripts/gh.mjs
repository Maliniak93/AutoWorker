// Usage: imported by every script that runs gh - the one place that spawns it (GH_BIN overrides the binary), plus the rate-limit (read, classify, wait; exit 4) and pure card, paging and check helpers; runs nothing on import

import { spawnSync } from "node:child_process";
import { writeSync } from "node:fs";
import { PROJECT_NUMBER, ROOT, ownerName, repoSlug } from "./config.mjs";

export { PROJECT_NUMBER, ownerName, repoSlug };
export const REPO_ROOT = ROOT;

const MAX_BUFFER = 64 * 1024 * 1024;

export function spawnGh(argv, { input, cwd = REPO_ROOT, timeout } = {}) {
  return spawnSync(process.env.GH_BIN ?? "gh", argv, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    input,
    timeout,
    maxBuffer: MAX_BUFFER,
  });
}

export const GH_LIMIT_EXIT = 4;
const LIMIT_MARKER = "GITHUB_LIMIT ";
const LIMIT_KINDS = new Set(["primary-graphql", "primary-rest", "secondary"]);
const PRIMARY_RESET_MARGIN_MS = 30_000;
const SECONDARY_FIRST_WAIT_MS = 60_000;
const SECONDARY_MAX_WAIT_MS = 15 * 60_000;

export const TRANSIENT_RE = /(?:HTTP|status code:?) 5\d\d|Bad Gateway|Internal Server Error|Service Unavailable|Gateway Time-?out|timed? ?out|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|connection reset|TLS handshake/i;

export class GhLimitError extends Error {
  constructor(kind, resetAt, detail) {
    super(detail ?? `GitHub limit (${kind})`);
    this.kind = kind;
    this.resetAt = resetAt ?? null;
  }
}

export function classifyGhFailure(stderr, snapshot) {
  const text = String(stderr ?? "");
  if (/secondary rate limit|abuse detection/i.test(text)) return "secondary";
  if (/rate limit/i.test(text)) {
    const graphqlOnly = snapshot && snapshot.graphql.remaining === 0 && snapshot.core.remaining > 0;
    return /graphql/i.test(text) || graphqlOnly ? "primary-graphql" : "primary-rest";
  }
  if (TRANSIENT_RE.test(text)) return "transient";
  if (snapshot?.graphql.remaining === 0) return "primary-graphql";
  if (snapshot?.core.remaining === 0) return "primary-rest";
  return "other";
}

export function nextWait(kind, snapshot, attempt, nowMs) {
  const reset = kind === "primary-graphql" ? snapshot?.graphql?.reset : kind === "primary-rest" ? snapshot?.core?.reset : null;
  if (reset) return Math.max(reset * 1000 + PRIMARY_RESET_MARGIN_MS - nowMs, PRIMARY_RESET_MARGIN_MS);
  return Math.min(SECONDARY_FIRST_WAIT_MS * 2 ** (Math.max(attempt, 1) - 1), SECONDARY_MAX_WAIT_MS);
}

export function limitWait(err, attempt, nowMs) {
  const bucket = err.resetAt ? { reset: err.resetAt } : null;
  const ms = nextWait(err.kind, { graphql: bucket, core: bucket }, attempt, nowMs);
  return { ms, until: clockTime((nowMs + ms) / 1000) };
}

export async function waitForGh(fn, { log = console.log, sleep = defaultSleep, now = Date.now } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof GhLimitError)) throw err;
      const { ms, until } = limitWait(err, attempt, now());
      log(`GitHub limit (${err.kind}), waiting until ${until}`);
      await sleep(ms);
    }
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function limitFromText(text) {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.startsWith(LIMIT_MARKER));
  if (!line) return null;
  try {
    const { kind, resetAt } = JSON.parse(line.slice(LIMIT_MARKER.length));
    return LIMIT_KINDS.has(kind) ? { kind, resetAt: resetAt ?? null } : null;
  } catch {
    return null;
  }
}

function snapshotOrNull() {
  const res = spawnGh(["api", "rate_limit"], { timeout: 30_000 });
  if (res.error || res.status !== 0) return null;
  try {
    const { resources } = JSON.parse(res.stdout);
    return { graphql: bucketOf(resources.graphql), core: bucketOf(resources.core) };
  } catch {
    return null;
  }
}

export function limitFromGhFailure(stderr) {
  let snapshot = null;
  let kind = classifyGhFailure(stderr, null);
  if (kind === "other") {
    snapshot = snapshotOrNull();
    kind = classifyGhFailure(stderr, snapshot);
  }
  if (!LIMIT_KINDS.has(kind)) return null;
  if (kind !== "secondary") snapshot ??= snapshotOrNull();
  const reset = kind === "primary-graphql" ? snapshot?.graphql.reset : kind === "primary-rest" ? snapshot?.core.reset : null;
  return new GhLimitError(kind, reset, String(stderr).trim());
}

export function limitText(err) {
  const until = err.resetAt ? `resets at ${clockTime(err.resetAt)}` : "resets within a few minutes";
  return `GitHub limit (${err.kind}) exhausted, ${until}\n${LIMIT_MARKER}${JSON.stringify({ kind: err.kind, resetAt: err.resetAt })}\n`;
}

export function exitOnGhLimit(err) {
  const text = limitText(err);
  try {
    writeSync(2, text);
  } catch {
    console.error(text.trimEnd());
  }
  process.exit(GH_LIMIT_EXIT);
}

export const runMarker = ({ issue, branch, sha }) => `<!-- kit-run:${issue}:${branch}:${sha} -->`;

export const hasRunMarker = (comments, marker) => comments.some((c) => String(c.body ?? "").includes(marker));

export function gh(argv, { input, timeout } = {}) {
  const res = spawnGh(argv, { input, timeout });
  if (res.error) throw new Error(`gh ${argv[0]} ${argv[1] ?? ""}: ${res.error.message}`);
  if (res.status !== 0) throw failure(argv, (res.stderr ?? "").trim());
  return res.stdout.trim();
}

function failure(argv, stderr) {
  return limitFromGhFailure(stderr) ?? new Error(`gh ${argv.slice(0, 2).join(" ")}: ${stderr}`);
}

export function graphql(query, variables = {}) {
  const out = JSON.parse(gh(["api", "graphql", "--input", "-"], { input: JSON.stringify({ query, variables }) }));
  if (out.errors?.length) throw failure(["api", "graphql"], out.errors.map((e) => e.message).join("; "));
  return out.data;
}

const bucketOf = ({ limit, remaining, reset }) => ({ limit, remaining, reset });

export function rateLimit() {
  const { resources } = JSON.parse(gh(["api", "rate_limit"]));
  return { graphql: bucketOf(resources.graphql), core: bucketOf(resources.core) };
}

export const clockTime = (epochSeconds) => {
  const d = new Date(epochSeconds * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function usageLine(snapshot) {
  const { graphql: g, core } = snapshot;
  return `GitHub: GraphQL ${g.remaining}/${g.limit}, REST ${core.remaining}/${core.limit}, reset ${clockTime(g.reset)}`;
}

export function usageDelta(before, after) {
  const reset = before.graphql.reset !== after.graphql.reset || before.core.reset !== after.core.reset;
  return {
    reset,
    graphql: before.graphql.remaining - after.graphql.remaining,
    rest: before.core.remaining - after.core.remaining,
  };
}

export function reportUsage(start, end) {
  if (!start) return `Limit at report: ${usageLine(end)}`;
  const delta = usageDelta(start, end);
  const used = delta.reset ? "window reset in between" : `used GraphQL ${delta.graphql}, REST ${delta.rest}`;
  return `Limit at prepare: ${usageLine(start)} · at report: ${usageLine(end)} · ${used}`;
}

export function cardFromIssueNode(node, projectNumber = PROJECT_NUMBER) {
  const labels = node.labels.nodes.map((l) => l.name);
  const item = node.projectItems.nodes.find((i) => i.project.number === projectNumber);
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    state: node.state,
    labels,
    inProject: Boolean(item),
    status: item?.status?.name ?? null,
    tier: item?.tier?.name ?? null,
    kind: item?.kind?.name ?? null,
    area: item?.area?.name ?? null,
    priority: item?.priority?.name ?? null,
    branch: item?.branch?.text ?? null,
    epic: labels.includes("epic"),
    skipTests: labels.includes("skip-tests"),
    parent: node.parent?.number ?? null,
    subIssues: node.subIssues.nodes.map((s) => ({ number: s.number, title: s.title, state: s.state.toUpperCase() })),
  };
}

export async function listPages(fetchPage) {
  const nodes = [];
  let cursor;
  while (true) {
    const page = await fetchPage(cursor);
    nodes.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return nodes;
    cursor = page.pageInfo.endCursor;
  }
}

const CHECK_BUCKETS = {
  success: "pass",
  skipped: "skipping",
  neutral: "skipping",
  failure: "fail",
  timed_out: "fail",
  cancelled: "cancel",
};

export function checkBuckets(checkRuns) {
  return checkRuns.map((run) => ({
    name: run.name,
    state: run.conclusion ?? run.status,
    bucket: run.status !== "completed" ? "pending" : (CHECK_BUCKETS[run.conclusion] ?? "fail"),
    link: run.html_url,
  }));
}
