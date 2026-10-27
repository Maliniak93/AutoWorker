import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";

describe("main", () => {
  it("a busy port exits with code 1 and a PORT hint", async () => {
    const blocker = createServer();
    blocker.listen(0, "127.0.0.1");
    await once(blocker, "listening");
    const port = (blocker.address() as { port: number }).port;
    try {
      const child = spawn(process.execPath, ["src/server/main.ts"], {
        env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      const [code] = (await once(child, "close")) as [number | null];
      expect(code).toBe(1);
      expect(out).toContain(`Port ${port} is already in use`);
      expect(out).toContain("PORT");
    } finally {
      blocker.close();
    }
  }, 30_000);
});
