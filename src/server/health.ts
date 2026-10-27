import { readFileSync } from "node:fs";
import type { HealthResponse, ToolStatus } from "../shared/health.ts";

export interface Probe {
  probeTool: (name: string) => Promise<ToolStatus>;
  probeGhAuth: () => Promise<boolean>;
}

const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

export async function getHealth(probe: Probe): Promise<HealthResponse> {
  const [claude, git, gh] = await Promise.all([
    probe.probeTool("claude"),
    probe.probeTool("git"),
    probe.probeTool("gh"),
  ]);
  const loggedIn = gh.status === "ok" ? await probe.probeGhAuth() : false;
  return {
    status: "ok",
    version: pkg.version,
    tools: { claude, git, gh: { ...gh, loggedIn } },
  };
}
