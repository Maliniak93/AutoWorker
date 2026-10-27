import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.ts";
import { fakeProbe } from "../helpers/probe.ts";

describe("static client", () => {
  it("serves the SPA and falls back for client routes only", async () => {
    const clientDir = mkdtempSync(join(tmpdir(), "aw-client-"));
    const html =
      '<!doctype html><html><body><div id="root"></div><!-- spa-marker --></body></html>';
    writeFileSync(join(clientDir, "index.html"), html);
    const app = buildApp({ probe: fakeProbe(), clientDir });

    const root = await app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(200);
    expect(root.headers["content-type"]).toContain("text/html");
    expect(root.body).toContain("spa-marker");

    const settings = await app.inject({ method: "GET", url: "/settings" });
    expect(settings.statusCode).toBe(200);
    expect(settings.body).toContain("spa-marker");

    const api = await app.inject({ method: "GET", url: "/api/unknown" });
    expect(api.statusCode).toBe(404);
  });
});
