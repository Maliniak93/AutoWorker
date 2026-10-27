#!/usr/bin/env node
// Usage: PostToolUse hook (Edit|Write) - runs the formatter project.config.json formatOnEdit maps to the edited file's extension; silent when none matches or the tool is missing

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

let ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
let RULES = [];
try {
  const config = await import("../../scripts/config.mjs");
  ROOT = process.env.CLAUDE_PROJECT_DIR || config.ROOT;
  RULES = config.CONFIG.formatOnEdit ?? [];
} catch {
  RULES = [];
}

const EXCLUDED = ["node_modules", "dist", "build", ".git"];

function main() {
  const payload = JSON.parse(readFileSync(0, "utf8"));

  const filePath = payload?.tool_input?.file_path;
  if (typeof filePath !== "string" || !filePath) return;

  const absPath = path.resolve(ROOT, filePath);
  const rel = path.relative(ROOT, absPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return;
  if (rel.split(path.sep).some((part) => EXCLUDED.includes(part))) return;

  const ext = path.extname(absPath).toLowerCase();
  const rule = RULES.find((r) => (r.ext ?? []).includes(ext));
  if (!rule || !Array.isArray(rule.cmd) || !rule.cmd.length) return;

  const [bin, ...args] = rule.cmd;
  const shell = process.platform === "win32";
  const res = spawnSync(bin, [...args, shell ? `"${absPath}"` : absPath], {
    cwd: ROOT,
    shell,
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
  });

  if (res.error) {
    if (res.error.code === "ENOENT") return;
    process.stderr.write(`format-on-edit: ${rel}: ${res.error.message}\n`);
    return;
  }
  if (res.status !== 0) {
    const raw = res.stderr || res.stdout || `${bin} exited ${res.status}`;
    const firstLine = String(raw).trim().split(/\r?\n/)[0] || "unknown error";
    process.stderr.write(`format-on-edit: ${rel}: ${firstLine}\n`);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`format-on-edit: ${err?.message ?? String(err)}\n`);
}
process.exit(0);
