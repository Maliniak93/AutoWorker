import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  server: { proxy: { "/api": "http://127.0.0.1:4280" } },
  build: { outDir: "../../dist/client", emptyOutDir: true },
  test: {
    root: ".",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
