import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { probeGhAuth, probeTool } from "./tools.ts";

const { host, port } = loadConfig(process.env);
const app = buildApp({ probe: { probeTool, probeGhAuth } });

try {
  await app.listen({ host, port });
  console.log(`AutoWorker listening on http://${host}:${port}`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use — set PORT in .env to use another one.`,
    );
  } else {
    console.error(error);
  }
  process.exit(1);
}
