import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { getHealth, type Probe } from "./health.ts";

const DEFAULT_CLIENT_DIR = fileURLToPath(
  new URL("../../dist/client", import.meta.url),
);

export interface AppDeps {
  probe: Probe;
  /** Built client directory; defaults to `dist/client`. */
  clientDir?: string;
}

export function buildApp({ probe, clientDir = DEFAULT_CLIENT_DIR }: AppDeps) {
  const app = Fastify();

  app.get("/api/health", () => getHealth(probe));

  if (existsSync(clientDir)) {
    app.register(fastifyStatic, { root: clientDir });
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split("?")[0];
      if (
        req.method === "GET" &&
        path !== "/api" &&
        !path.startsWith("/api/")
      ) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not Found" });
    });
  }

  return app;
}
