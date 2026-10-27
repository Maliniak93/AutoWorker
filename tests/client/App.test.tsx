// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/client/App.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("shows the version and each tool status", async () => {
    const payload = {
      status: "ok",
      version: "0.1.0",
      tools: {
        claude: { status: "ok", version: "2.0.0" },
        git: { status: "ok", version: "2.40.0" },
        gh: { status: "missing", loggedIn: false },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    render(<App />);
    await waitFor(() => expect(document.body.textContent).toContain("0.1.0"));
    const text = document.body.textContent ?? "";
    expect(text).toContain("AutoWorker");
    expect(text).toMatch(/claude\W*ok/i);
    expect(text).toMatch(/git\W*ok/i);
    expect(text).toMatch(/gh\W*missing/i);
  });
});
