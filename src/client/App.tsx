import { useEffect, useState } from "react";
import type { HealthResponse } from "../shared/health.ts";

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<HealthResponse>;
      })
      .then(setHealth)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  return (
    <main>
      <h1>AutoWorker</h1>
      {error && <p>Health check failed: {error}</p>}
      {!health && !error && <p>Loading…</p>}
      {health && (
        <>
          <p>Version {health.version}</p>
          <ul>
            {Object.entries(health.tools).map(([name, tool]) => (
              <li key={name}>
                {name}: {tool.status}
                {tool.version ? ` (${tool.version})` : ""}
                {"loggedIn" in tool && tool.status === "ok"
                  ? tool.loggedIn
                    ? " — logged in"
                    : " — not logged in"
                  : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
