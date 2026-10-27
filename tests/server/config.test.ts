import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/server/config.ts";

describe("loadConfig", () => {
  it("loadConfig defaults", () => {
    expect(loadConfig({})).toEqual({ host: "127.0.0.1", port: 4280 });
  });

  it("loadConfig reads PORT", () => {
    expect(loadConfig({ PORT: "4290" }).port).toBe(4290);
  });

  it("loadConfig rejects an invalid PORT", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/PORT/);
  });
});
