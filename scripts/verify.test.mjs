import assert from "node:assert/strict";
import test from "node:test";
import { changedFiles, computeScope, computeTreeHash, failureOf, findCacheHit, isFullScope, loadCache, parseArgs, parsePorcelain, resolveCommand, saveGreen, withGreen } from "./verify.mjs";

const STEPS = [
  { name: "format", cmd: ["fmt"], fix: ["fmt", "--write"], areas: ["Code"] },
  { name: "build", cmd: ["build"], areas: ["Code"] },
  { name: "test", cmd: ["test"], areas: ["Code"] },
  { name: "scripts-test", cmd: ["node", "--test"], areas: ["Scripts"] },
  { name: "lint-all", cmd: ["lint"], areas: "*" },
];
const AREA_NAMES = ["Code", "Scripts", "Docs"];
const areaOf = (f) => (f.startsWith("src/") ? "Code" : f.startsWith("scripts/") ? "Scripts" : f.endsWith(".md") ? "Docs" : null);
const FULL = ["package.json", ".github/workflows/"];
const scopeOf = (files, args = {}, over = {}) =>
  computeScope({ args: { quick: false, all: false, projects: null, ...args }, changed: { files, base: "main...HEAD", treatAsAll: false }, steps: STEPS, fullScope: FULL, areaOf, areaNames: AREA_NAMES, ...over });
const names = (scope) => scope.steps.map((s) => s.name);

test("changed files map to the steps of their areas, wildcard steps always run", () => {
  assert.deepEqual(names(scopeOf(["src/a.ts"])), ["format", "build", "test", "lint-all"]);
  assert.deepEqual(names(scopeOf(["scripts/x.mjs", "README.md"])), ["scripts-test", "lint-all"]);
  assert.deepEqual(names(scopeOf([])), ["lint-all"]);
  assert.deepEqual(names(scopeOf(["unknown/file.bin"])), ["lint-all"]);
});

test("a full-scope path, --all and a missing base ref run everything", () => {
  const all = STEPS.map((s) => s.name);
  assert.deepEqual(names(scopeOf(["package.json"])), all);
  assert.deepEqual(names(scopeOf([".github/workflows/ci.yml"])), all);
  assert.equal(scopeOf(["package.json"]).full, true);
  assert.deepEqual(names(scopeOf([], { all: true })), all);
  assert.deepEqual(names(computeScope({ args: { quick: false, all: false, projects: null }, changed: { files: [], base: null, treatAsAll: true }, steps: STEPS, areaOf, areaNames: AREA_NAMES })), all);
});

test("--projects takes area names case-insensitively and rejects unknown ones", () => {
  assert.deepEqual(names(scopeOf(["src/a.ts"], { projects: ["scripts"] })), ["scripts-test", "lint-all"]);
  assert.throws(() => scopeOf([], { projects: ["Nope"] }), /unknown --projects entry: Nope/);
});

test("--quick keeps only format and build within the scope", () => {
  assert.deepEqual(names(scopeOf(["src/a.ts"], { quick: true })), ["format", "build"]);
  assert.deepEqual(names(scopeOf(["scripts/x.mjs"], { quick: true })), []);
  assert.deepEqual(names(scopeOf([], { quick: true, all: true })), ["format", "build"]);
});

test("isFullScope: a trailing slash is a prefix, anything else an exact path", () => {
  assert.equal(isFullScope("package.json", FULL), true);
  assert.equal(isFullScope("web/package.json", FULL), false);
  assert.equal(isFullScope(".github\\workflows\\ci.yml", FULL), true);
});

test("parseArgs", () => {
  assert.deepEqual(parseArgs(["--fix", "--cache", "--projects", "Code, Docs"]), { quick: false, all: false, fix: true, cache: true, cacheCheck: false, projects: ["Code", "Docs"] });
  assert.deepEqual(parseArgs(["--projects=Code"]).projects, ["Code"]);
  assert.throws(() => parseArgs(["--e2e"]), /unknown argument/);
  assert.throws(() => parseArgs(["--projects"]), /requires/);
});

test("parsePorcelain handles renames and quoted names", () => {
  assert.deepEqual(parsePorcelain(' M src/a.ts\n?? new file.txt\nR  old.ts -> src/b.ts\n?? "d\\u00e9j\\u00e0.md"\n'), ["src/a.ts", "new file.txt", "old.ts", "src/b.ts", "déjà.md"]);
});

test("changedFiles merges the committed diff with the working tree and falls back to origin", () => {
  const calls = [];
  const git = (a) => {
    calls.push(a.join(" "));
    if (a[0] === "diff") return a[2] === "origin/main...HEAD" ? "src/a.ts\n" : null;
    return " M scripts/b.mjs\n?? src/a.ts\n";
  };
  const got = changedFiles(git, "main");
  assert.deepEqual(got, { files: ["src/a.ts", "scripts/b.mjs"], base: "origin/main...HEAD", treatAsAll: false });
  assert.deepEqual(changedFiles(() => null, "main"), { files: [], base: null, treatAsAll: true });
});

test("cache hit: a superset entry satisfies a narrower scope, a red or different tree does not", () => {
  const entries = [
    { tree: "t1", steps: ["format", "build", "test"], result: { ok: true } },
    { tree: "t2", steps: ["format"], result: { ok: false } },
  ];
  assert.ok(findCacheHit(entries, { tree: "t1", steps: ["build"] }));
  assert.ok(findCacheHit(entries, { tree: "t1", steps: ["format", "build", "test"] }));
  assert.equal(findCacheHit(entries, { tree: "t1", steps: ["build", "lint"] }), null);
  assert.equal(findCacheHit(entries, { tree: "t2", steps: ["format"] }), null);
  assert.equal(findCacheHit(entries, { tree: "t3", steps: ["format"] }), null);
  assert.equal(findCacheHit(entries, { tree: null, steps: [] }), null);
});

test("withGreen replaces superseded entries and keeps the last 10", () => {
  let entries = withGreen([], { tree: "t", steps: ["build"] }, "a");
  entries = withGreen(entries, { tree: "t", steps: ["build", "test"] }, "b");
  assert.deepEqual(entries.map((e) => e.at), ["b"]);
  entries = withGreen(entries, { tree: "t", steps: ["format"] }, "c");
  assert.equal(entries.length, 2);
  for (let i = 0; i < 12; i++) entries = withGreen(entries, { tree: `x${i}`, steps: ["s"] });
  assert.equal(entries.length, 10);
});

test("saveGreen and loadCache go through the injected fs", () => {
  const files = new Map();
  const fs = { readFileSync: (f) => { if (!files.has(f)) throw new Error("ENOENT"); return files.get(f); }, writeFileSync: (f, d) => files.set(f, d) };
  assert.deepEqual(loadCache("c.json", fs), []);
  saveGreen("c.json", { tree: "t", steps: ["build"] }, fs);
  assert.ok(findCacheHit(loadCache("c.json", fs), { tree: "t", steps: ["build"] }));
  files.set("c.json", "{not json");
  assert.deepEqual(loadCache("c.json", fs), []);
});

test("computeTreeHash changes with untracked content and HEAD, and is null without git", () => {
  const git = (head, diff, untracked) => (a) => ({ "rev-parse": Buffer.from(head), diff: Buffer.from(diff), "ls-files": Buffer.from(untracked) })[a[0]];
  const read = (content) => () => Buffer.from(content);
  const base = computeTreeHash(git("h1", "", "a.txt\0"), read("1"));
  assert.equal(base, computeTreeHash(git("h1", "", "a.txt\0"), read("1")));
  assert.notEqual(base, computeTreeHash(git("h1", "", "a.txt\0"), read("2")));
  assert.notEqual(base, computeTreeHash(git("h2", "", "a.txt\0"), read("1")));
  assert.notEqual(base, computeTreeHash(git("h1", "diff", "a.txt\0"), read("1")));
  assert.equal(computeTreeHash(() => null), null);
});

test("failureOf prefers error lines and finds a file", () => {
  const out = failureOf("test", { output: "ok 1\nFAIL src/a.test.ts\n  Error: boom\nok 2\n", status: 1, durationMs: 5, cmdStr: "t" });
  assert.equal(out.step, "test");
  assert.match(out.summary, /FAIL src\/a\.test\.ts \| Error: boom/);
  assert.equal(out.file, "src/a.test.ts");
  assert.match(failureOf("x", { timedOut: true, durationMs: 2000, cmdStr: "c" }).summary, /timed out after 2\.0s/);
  assert.match(failureOf("x", { error: new Error("ENOENT"), durationMs: 0, cmdStr: "c" }).summary, /failed to start: ENOENT/);
});

test("resolveCommand: npm becomes npm.cmd through cmd.exe on Windows only", () => {
  assert.deepEqual(resolveCommand(["npm", "test"], false), { file: "npm", args: ["test"], verbatim: false });
  const win = resolveCommand(["npm", "run", "a b"], true);
  assert.deepEqual(win.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(win.args[3], '"npm.cmd run "a b""');
  assert.equal(win.verbatim, true);
  assert.deepEqual(resolveCommand(["node", "-v"], true), { file: "node", args: ["-v"], verbatim: false });
});
