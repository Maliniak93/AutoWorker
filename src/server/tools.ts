import { execFile } from "node:child_process";
import type { ToolStatus } from "../shared/health.ts";

const TIMEOUT_MS = 5000;
// Windows ships some CLIs as .cmd shims, which only a shell can start.
const SHELL = process.platform === "win32";

function run(
  cmd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    try {
      execFile(
        SHELL ? "cmd.exe" : cmd,
        SHELL ? ["/d", "/s", "/c", cmd, ...args] : args,
        { timeout: TIMEOUT_MS, windowsHide: true },
        (error, stdout) => resolve({ ok: !error, stdout: String(stdout) }),
      );
    } catch {
      resolve({ ok: false, stdout: "" });
    }
  });
}

/** Probes `<name> --version`. Never throws: any failure is "missing". */
export async function probeTool(name: string): Promise<ToolStatus> {
  const { ok, stdout } = await run(name, ["--version"]);
  if (!ok) return { status: "missing" };
  const version = stdout
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim();
  return version ? { status: "ok", version } : { status: "ok" };
}

/** True when `gh auth status` exits 0. Never throws. */
export async function probeGhAuth(): Promise<boolean> {
  return (await run("gh", ["auth", "status"])).ok;
}
