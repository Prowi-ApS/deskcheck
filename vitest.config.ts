import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Don't pull in test files from the demo project — those are fixtures
    // for the demo's own code, not tests for deskcheck itself.
    exclude: ["node_modules/**", "build/**", "ui/**", "examples/**"],
  },
});
