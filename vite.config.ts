import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base =
  process.env.GITHUB_ACTIONS && repositoryName ? `/${repositoryName}/` : "/";

export default defineConfig({
  base,
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["node_modules", "dist", "tests/e2e/**"],
    css: true,
  },
});
