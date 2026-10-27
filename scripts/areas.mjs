#!/usr/bin/env node
// Usage: node scripts/areas.mjs [of <path…> | outside <Area> [path…] | profile <Area> [--no-tests]]   no argument prints the area -> paths table (project.config.json); `of` prints the area of the given files (— when none)
//   outside prints the paths outside the ticket Area, one per line (no paths: the uncommitted change incl. untracked files)
//   profile prints the build profile of the Area as JSON (the workflow's `profile` arg); --no-tests drops the test-writer (implementer → reviewer)

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AREAS as CONFIGURED } from "./config.mjs";

const playbook = (name) => `.claude/skills/${name}/SKILL.md`;
const unique = (list) => [...new Set(list)];
const NO_AREA_LABEL = "No area - full path";

function patternOf(pattern) {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*$/, "\u0000")
    .replaceAll("*", "[^/]*")
    .replace("\u0000", ".*");
  return new RegExp(pattern.endsWith("/") ? `^${escaped}` : `^${escaped}$`);
}

const normalize = (file) => file.replaceAll("\\", "/").replace(/^\.\//, "");

export function buildAreaModel(areas) {
  const names = areas.map((a) => a.name);
  const byName = new Map(areas.map((a) => [a.name, a]));
  const rules = areas.flatMap(({ name, paths = [] }) => paths.map((p) => ({ area: name, regex: patternOf(p) })));

  const areaOfPath = (file) => rules.find((r) => r.regex.test(normalize(file)))?.area ?? null;

  const parseArea = (value) => {
    const wanted = String(value ?? "").toLowerCase();
    return names.find((a) => a.toLowerCase() === wanted) ?? null;
  };

  function profileOf(area, { skip = [] } = {}) {
    const known = byName.has(area ?? "");
    const testAreas = areas.filter((a) => a.tests);
    const entry = known
      ? byName.get(area)
      : {
          tests: testAreas.length > 0,
          implementer: unique(testAreas.flatMap((a) => a.implementer ?? [])),
          testWriter: unique(testAreas.flatMap((a) => a.testWriter ?? [])),
          checklist: unique(areas.flatMap((a) => a.checklist ?? [])),
        };
    const tests = Boolean(entry.tests) && !skip.includes("tests");
    const review = !skip.includes("review");
    const phases = [...(tests ? ["test-writer", "implementer"] : ["implementer"]), ...(review ? ["reviewer"] : [])];
    return {
      area: known ? area : null,
      known,
      tests,
      review,
      testWriterPlaybooks: tests ? (entry.testWriter ?? []).map(playbook) : [],
      implementerPlaybooks: (entry.implementer ?? []).map(playbook),
      checklist: ["Common", ...(entry.checklist ?? [])],
      label: known ? `${area} (${phases.join(" → ")})` : NO_AREA_LABEL,
    };
  }

  function areaOfFiles(paths) {
    const counts = new Map();
    for (const file of paths) {
      const area = areaOfPath(file);
      if (area) counts.set(area, (counts.get(area) ?? 0) + 1);
    }
    if (counts.size === 0) return null;
    const rank = (name) => (byName.get(name).tests ? 0 : 1);
    return [...counts].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1] || names.indexOf(a[0]) - names.indexOf(b[0]))[0][0];
  }

  const outsideArea = (area, paths) => paths.filter((f) => areaOfPath(f) !== area);

  return { names, areas, areaOfPath, parseArea, profileOf, areaOfFiles, outsideArea };
}

const model = buildAreaModel(CONFIGURED);

export const AREAS = model.names;
export const { areaOfPath, parseArea, profileOf, areaOfFiles, outsideArea } = model;

function uncommittedFiles() {
  const res = spawnSync("git", ["status", "--porcelain", "-uall"], { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (res.error || res.status !== 0) throw new Error(res.error?.message ?? res.stderr.trim());
  return res.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.slice(3).split(" -> ").pop().replace(/^"|"$/g, ""));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [verb, ...rest] = process.argv.slice(2);
  if (verb === "of") console.log(areaOfFiles(rest) ?? "—");
  else if (verb === "profile") console.log(JSON.stringify(profileOf(rest.find((a) => !a.startsWith("--")), { skip: rest.includes("--no-tests") ? ["tests"] : [] })));
  else if (verb === "outside") {
    const [area, ...paths] = rest;
    for (const f of outsideArea(area, paths.length ? paths : uncommittedFiles())) console.log(f);
  } else
    for (const { name, paths } of CONFIGURED) console.log(`${name.padEnd(10)} ${(paths ?? []).join(" ")}`);
}
