#!/usr/bin/env node
// Usage: node scripts/review-diff.mjs [--stat] [-- <pathspec>...]   the full uncommitted change (tracked and untracked) without touching the index

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./config.mjs";

function git(argv, okCodes = [0]) {
  const res = spawnSync("git", argv, { cwd: ROOT, encoding: "utf8", windowsHide: true, shell: false, maxBuffer: 256 * 1024 * 1024 });
  if (res.error || !okCodes.includes(res.status)) throw new Error(`git ${argv[0]}: ${res.error?.message ?? res.stderr.trim()}`);
  return res.stdout;
}

process.stdout.on("error", (err) => process.exit(err.code === "EPIPE" ? 0 : 1));

const args = process.argv.slice(2);
const sep = args.indexOf("--");
const flagArgs = sep === -1 ? args : args.slice(0, sep);
const pathspec = sep === -1 ? [] : args.slice(sep + 1);
if (flagArgs.some((a) => a !== "--stat")) {
  console.error("usage: review-diff.mjs [--stat] [-- <pathspec>...]");
  process.exit(1);
}
const stat = flagArgs.includes("--stat");

try {
  const tail = pathspec.length ? ["--", ...pathspec] : [];
  process.stdout.write(git(["diff", "HEAD", ...(stat ? ["--stat"] : []), ...tail]));
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z", ...tail]).split("\0").filter(Boolean);
  for (const file of untracked) {
    if (stat) {
      const text = readFileSync(path.resolve(ROOT, file), "utf8");
      const lines = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
      console.log(` ${file} | ${lines} lines (new, untracked)`);
    } else {
      process.stdout.write(git(["diff", "--no-index", "--", "/dev/null", file], [0, 1]));
    }
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
