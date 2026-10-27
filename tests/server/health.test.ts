import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.ts";
import { fakeProbe } from "../helpers/probe.ts";

const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

describe("GET /api/health", () => {
  it("GET /api/health returns 200 with version and ok tools", async () => {
    const app = buildApp({ probe: fakeProbe() });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe(pkg.version);
    for (const t of ["claude", "git", "gh"])
      expect(body.tools[t].status).toBe("ok");
  });

  it("a missing tool is reported as missing without failing the endpoint", async () => {
    const app = buildApp({ probe: fakeProbe({ missing: ["gh"] }) });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().tools.gh).toEqual({ status: "missing", loggedIn: false });
  });

  it("gh logged out is reported as loggedIn false", async () => {
    const app = buildApp({ probe: fakeProbe({ ghLoggedIn: false }) });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    const gh = res.json().tools.gh;
    expect(gh.loggedIn).toBe(false);
    expect(gh.status).toBe("ok");
  });
});
