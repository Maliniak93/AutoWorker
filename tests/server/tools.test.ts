import { describe, expect, it } from "vitest";
import { probeTool } from "../../src/server/tools.ts";

describe("probeTool", () => {
  it("probeTool reports missing for an unknown command", async () => {
    await expect(probeTool("autoworker-no-such-command-xyz")).resolves.toEqual({
      status: "missing",
    });
  });

  it("probeTool reports ok with a version for node", async () => {
    const res = await probeTool("node");
    expect(res.status).toBe("ok");
    expect(res.version).toBeTruthy();
  });
});
