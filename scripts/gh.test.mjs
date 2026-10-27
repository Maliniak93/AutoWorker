import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GhLimitError,
  cardFromIssueNode,
  checkBuckets,
  classifyGhFailure,
  hasRunMarker,
  listPages,
  nextWait,
  reportUsage,
  runMarker,
  usageDelta,
  usageLine,
  waitForGh,
} from "./gh.mjs";
import { buildState, createSandbox } from "./fake-gh-sandbox.mjs";

const RESET = 1_800_000_000;
const snapshot = (graphqlRemaining, restRemaining, reset = RESET) => ({
  graphql: { limit: 5000, remaining: graphqlRemaining, reset },
  core: { limit: 5000, remaining: restRemaining, reset },
});

test("usageDelta same window", () => {
  const delta = usageDelta(snapshot(4900, 4990), snapshot(4897, 4985));
  assert.equal(delta.reset, false);
  assert.equal(delta.graphql, 3);
  assert.equal(delta.rest, 5);
});

test("usageDelta across reset", () => {
  const delta = usageDelta(snapshot(100, 100), snapshot(4999, 4999, RESET + 3600));
  assert.equal(delta.reset, true);
});

test("usageLine format", () => {
  const line = usageLine(snapshot(4812, 4990));
  assert.match(line, /^GitHub: GraphQL 4812\/5000, REST 4990\/5000, reset \d{2}:\d{2}$/);
});

const issueNode = (overrides = {}) => ({
  number: 347,
  title: "GitHub API budget 1",
  body: "# body\r\n",
  state: "OPEN",
  url: "https://github.com/acme/demo/issues/347",
  labels: { nodes: [{ name: "spec" }, { name: "skip-tests" }] },
  parent: { number: 346 },
  subIssues: { nodes: [] },
  projectItems: {
    nodes: [
      {
        id: "PVTI_1",
        project: { number: 1 },
        status: { name: "In progress" },
        tier: { name: "2" },
        kind: { name: "Change" },
        branch: { text: "feat/gh-api-lean-queries" },
      },
    ],
  },
  ...overrides,
});

test("cardFromIssueNode maps fields", () => {
  const card = cardFromIssueNode(issueNode(), 1);
  assert.equal(card.number, 347);
  assert.equal(card.title, "GitHub API budget 1");
  assert.equal(card.url, "https://github.com/acme/demo/issues/347");
  assert.equal(card.state, "OPEN");
  assert.deepEqual(card.labels, ["spec", "skip-tests"]);
  assert.equal(card.parent, 346);
  assert.equal(card.inProject, true);
  assert.equal(card.status, "In progress");
  assert.equal(card.tier, "2");
  assert.equal(card.kind, "Change");
  assert.equal(card.branch, "feat/gh-api-lean-queries");
  assert.equal(card.epic, false);
  assert.equal(card.skipTests, true);
  assert.deepEqual(card.subIssues, []);
});

test("cardFromIssueNode maps an epic outside the project", () => {
  const card = cardFromIssueNode(
    issueNode({
      labels: { nodes: [{ name: "epic" }] },
      parent: null,
      subIssues: { nodes: [{ number: 348, title: "part 2", state: "open" }] },
      projectItems: { nodes: [] },
    }),
  );
  assert.equal(card.epic, true);
  assert.equal(card.parent, null);
  assert.equal(card.inProject, false);
  assert.equal(card.status, null);
  assert.equal(card.branch, null);
  assert.deepEqual(card.subIssues, [{ number: 348, title: "part 2", state: "OPEN" }]);
});

test("listPages follows endCursor", async () => {
  const cursors = [];
  const pages = {
    start: { nodes: [1, 2], pageInfo: { hasNextPage: true, endCursor: "c1" } },
    c1: { nodes: [3], pageInfo: { hasNextPage: true, endCursor: "c2" } },
    c2: { nodes: [4, 5], pageInfo: { hasNextPage: false, endCursor: null } },
  };
  const all = await listPages(async (cursor) => {
    cursors.push(cursor ?? null);
    return pages[cursor ?? "start"];
  });
  assert.deepEqual(all, [1, 2, 3, 4, 5]);
  assert.deepEqual(cursors, [null, "c1", "c2"]);
});

test("checkBuckets maps conclusions", () => {
  const run = (name, status, conclusion) => ({ name, status, conclusion, html_url: `https://x/${name}` });
  const buckets = checkBuckets([
    run("ok", "completed", "success"),
    run("skipped", "completed", "skipped"),
    run("neutral", "completed", "neutral"),
    run("bad", "completed", "failure"),
    run("late", "completed", "timed_out"),
    run("stopped", "completed", "cancelled"),
    run("running", "in_progress", null),
    run("queued", "queued", null),
  ]);
  const byName = Object.fromEntries(buckets.map((c) => [c.name, c.bucket]));
  assert.deepEqual(byName, {
    ok: "pass",
    skipped: "skipping",
    neutral: "skipping",
    bad: "fail",
    late: "fail",
    stopped: "cancel",
    running: "pending",
    queued: "pending",
  });
  assert.deepEqual(checkBuckets([]), []);
});

test("reportUsage start and end", () => {
  const start = snapshot(4900, 4990);
  const end = snapshot(4850, 4950);
  const line = reportUsage(start, end);
  assert.equal(line.includes("\n"), false);
  assert.ok(line.includes(usageLine(start)));
  assert.ok(line.includes(usageLine(end)));
  assert.ok(line.indexOf(usageLine(start)) < line.indexOf(usageLine(end)));
});

const at = (hh, mm) => new Date(2030, 0, 15, hh, mm, 0).getTime() / 1000;
const clockText = (epochSeconds) => {
  const d = new Date(epochSeconds * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

test("classifyGhFailure primary-graphql", () => {
  assert.equal(classifyGhFailure("gh api graphql: GraphQL: API rate limit already exceeded for user ID 1234.", snapshot(0, 5000)), "primary-graphql");
});

test("classifyGhFailure primary-rest", () => {
  assert.equal(classifyGhFailure("gh: API rate limit exceeded for user ID 1234. (HTTP 403)", snapshot(5000, 0)), "primary-rest");
});

test("classifyGhFailure secondary", () => {
  assert.equal(
    classifyGhFailure("gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)", snapshot(5000, 5000)),
    "secondary",
  );
});

test("classifyGhFailure transient", () => {
  assert.equal(classifyGhFailure("gh: Bad Gateway (HTTP 502)", snapshot(5000, 5000)), "transient");
});

test("classifyGhFailure other", () => {
  assert.equal(classifyGhFailure("gh: Could not resolve to an issue with the number of 99999. (HTTP 404)", snapshot(5000, 5000)), "other");
});

test("classifyGhFailure unclear text with graphql at zero", () => {
  assert.equal(classifyGhFailure("unknown owner type", snapshot(0, 5000)), "primary-graphql");
  assert.equal(classifyGhFailure("unknown owner type", snapshot(5000, 5000)), "other");
});

test("nextWait primary", () => {
  const now = at(2, 10) * 1000;
  const reset = at(2, 47);
  assert.equal(nextWait("primary-graphql", snapshot(0, 5000, reset), 1, now), reset * 1000 + 30_000 - now);
  assert.equal(nextWait("primary-rest", snapshot(5000, 0, reset), 1, now), reset * 1000 + 30_000 - now);
});

test("nextWait secondary backoff", () => {
  const now = at(2, 10) * 1000;
  const wait = (attempt) => nextWait("secondary", snapshot(5000, 5000), attempt, now);
  assert.equal(wait(1), 60_000);
  assert.equal(wait(2), 120_000);
  assert.equal(wait(6), 15 * 60_000);
});

test("waitForGh waits without cap and resumes", async () => {
  const start = at(2, 0) * 1000;
  const resets = [at(2, 10), at(14, 10)];
  const clock = { t: start, sleeps: [], logs: [] };
  let calls = 0;
  const result = await waitForGh(
    async () => {
      if (calls < resets.length) throw new GhLimitError("primary-graphql", resets[calls++]);
      return "ok";
    },
    {
      log: (line) => clock.logs.push(line),
      sleep: async (ms) => {
        clock.sleeps.push(ms);
        clock.t += ms;
      },
      now: () => clock.t,
    },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 2);
  assert.equal(clock.sleeps[0], resets[0] * 1000 + 30_000 - start);
  assert.equal(clock.sleeps[1], resets[1] * 1000 + 30_000 - (start + clock.sleeps[0]));
  assert.ok(clock.sleeps[1] > 11 * 3600 * 1000);
  assert.equal(clock.logs.length, 2);
  assert.equal(clock.logs[0], `GitHub limit (primary-graphql), waiting until ${clockText(resets[0])}`);
  assert.equal(clock.logs[1], `GitHub limit (primary-graphql), waiting until ${clockText(resets[1])}`);
});

test("waitForGh rethrows a non-limit error", async () => {
  await assert.rejects(
    waitForGh(
      async () => {
        throw new Error("boom");
      },
      { log() {}, sleep: async () => {}, now: () => 0 },
    ),
    /boom/,
  );
});

test("report marker found skips post", () => {
  const marker = runMarker({ issue: 348, branch: "feat/gh-api-limit-wait", sha: "abc1234" });
  assert.match(marker, /^<!-- kit-run:.*-->$/s);
  for (const part of ["348", "feat/gh-api-limit-wait", "abc1234"]) assert.ok(marker.includes(part));
  assert.equal(hasRunMarker([{ body: "other" }, { body: `report\n${marker}` }], marker), true);
  assert.equal(hasRunMarker([{ body: "other" }], marker), false);
  assert.notEqual(marker, runMarker({ issue: 348, branch: "feat/gh-api-limit-wait", sha: "def5678" }));
});

test("interactive scripts exit 4 on limit", () => {
  const state = buildState({ issues: [{ number: 1, status: "Todo", labels: ["spec"] }] });
  state.rateLimit = { reset: RESET };
  const sandbox = createSandbox(state);
  try {
    const hhmm = clockText(RESET);
    const { code, out } = sandbox.run("gh-project.mjs", ["get", "1"]);
    assert.equal(code, 4, out);
    assert.ok(out.includes(`GitHub limit (primary-graphql) exhausted, resets at ${hhmm}`), out);
    const line = out.split(/\r?\n/).find((l) => l.startsWith("GITHUB_LIMIT "));
    assert.ok(line, out);
    assert.deepEqual(JSON.parse(line.slice("GITHUB_LIMIT ".length)), { kind: "primary-graphql", resetAt: RESET });
  } finally {
    sandbox.cleanup();
  }
});

test("repo and owner come from project.config.json, not from gh", () => {
  const sandbox = createSandbox(buildState({ issues: [{ number: 1, status: "Todo", labels: ["spec"] }] }));
  try {
    const { code, stdout, out } = sandbox.run("gh-project.mjs", ["get", "1"]);
    assert.equal(code, 0, out);
    assert.equal(JSON.parse(stdout).url, "https://github.com/acme/demo/issues/1");
    assert.deepEqual(sandbox.log().filter((e) => e.kind === "other"), []);
  } finally {
    sandbox.cleanup();
  }
});
