import { spawnSync } from "node:child_process";
import * as pty from "node-pty";
import { describe, expect, it } from "vitest";

function runInPty(
  cmd: string,
  args: string[],
): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    const term = pty.spawn(cmd, args, {
      name: "xterm",
      cols: 80,
      rows: 24,
      env: process.env as Record<string, string>,
    });
    let output = "";
    term.onData((d) => (output += d));
    term.onExit(({ exitCode }) => resolve({ output, exitCode }));
  });
}

const which = process.platform === "win32" ? "where" : "which";
const hasClaude = spawnSync(which, ["claude"]).status === 0;

describe("node-pty", () => {
  it("node-pty runs node --version", async () => {
    const { output, exitCode } = await runInPty(process.execPath, [
      "--version",
    ]);
    expect(output).toMatch(/v\d+\./);
    expect(exitCode).toBe(0);
  });

  // Skipped only when `claude` is not on PATH (AC-10).
  it.skipIf(!hasClaude)("node-pty runs claude --version", async () => {
    // On Windows `claude` is a .cmd shim that node-pty cannot spawn directly.
    const [cmd, args] =
      process.platform === "win32"
        ? ["cmd.exe", ["/d", "/s", "/c", "claude", "--version"]]
        : ["claude", ["--version"]];
    const { output, exitCode } = await runInPty(cmd, args);
    expect(output).toMatch(/\d+\.\d+/);
    expect(exitCode).toBe(0);
  });
});
