// Usage: imported by every script - the one place that reads project.config.json (areas, verify steps, GitHub coordinates); runs nothing on import

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CONFIG_PATH = path.join(ROOT, "project.config.json");

export const CONFIG = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

export const DEFAULT_BRANCH = CONFIG.defaultBranch ?? "main";
export const PLAN_DIR = path.join(ROOT, CONFIG.planDir ?? "docs/plan");
export const AREAS = CONFIG.areas ?? [];
export const AREA_NAMES = AREAS.map((a) => a.name);
export const PROJECT_NUMBER = CONFIG.github?.projectNumber || 0;

let slug;
export function repoSlug() {
  if (slug) return slug;
  const { owner, repo } = CONFIG.github ?? {};
  if (owner && repo) return (slug = `${owner}/${repo}`);
  const res = spawnSync(process.env.GH_BIN ?? "gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  const found = (res.stdout ?? "").trim();
  if (res.status !== 0 || !found) throw new Error("repo not resolved: set github.owner and github.repo in project.config.json, or run `gh auth login` inside a clone with a GitHub remote");
  return (slug = found);
}

export const ownerName = () => repoSlug().split("/")[0];
