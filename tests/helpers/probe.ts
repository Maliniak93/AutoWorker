import type { ToolStatus } from "../../src/shared/health.ts";

export interface FakeProbe {
  probeTool: (name: string) => Promise<ToolStatus>;
  probeGhAuth: () => Promise<boolean>;
}

/** A prober where every tool is ok unless overridden. */
export function fakeProbe(
  opts: { missing?: string[]; ghLoggedIn?: boolean } = {},
): FakeProbe {
  const missing = opts.missing ?? [];
  return {
    probeTool: async (name) =>
      missing.includes(name)
        ? { status: "missing" }
        : { status: "ok", version: "1.0.0" },
    probeGhAuth: async () => opts.ghLoggedIn ?? true,
  };
}
