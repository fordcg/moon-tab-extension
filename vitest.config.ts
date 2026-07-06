import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["tests/setup.ts"],
    exclude: ["node_modules/**", "dist/**", "artifacts/**", ".tmp/**", ".worktrees/**", "tests/e2e/**", "src/pages/**/*.test.mjs"],
  },
});
