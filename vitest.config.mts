import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    alias: {
      "~/src": resolve(__dirname, "./src"),
    },
    // Suppress logger (console.*) output during tests. Tests that need to
    // assert on log records spy on console directly, so dropping the printed
    // output here keeps the terminal readable without affecting assertions.
    onConsoleLog: () => false,
    coverage: {
      provider: "istanbul",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts", "scripts/*.ts"],
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
