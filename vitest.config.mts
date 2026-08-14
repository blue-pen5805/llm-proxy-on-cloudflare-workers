import { resolve } from "path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    alias: {
      "~/src": resolve(import.meta.dirname, "./src"),
    },
    // Suppress logger (console.*) output during tests. Tests that need to
    // assert on log records spy on console directly, so dropping the printed
    // output here keeps the terminal readable without affecting assertions.
    onConsoleLog: () => false,
    coverage: {
      provider: "istanbul",
      // `skipFull` is passed to the text reporter so a passing run still lists
      // every measured file. Without it the CI log prints an empty table and a
      // summary, which cannot show that a file left the report entirely.
      reporter: [
        ["text", { skipFull: false }],
        ["json-summary", {}],
      ],
      reportOnFailure: true,
      // `scripts/**` rather than `scripts/*`: the deployment tooling has
      // subdirectories (locale message tables) that are part of the 100%
      // coverage contract.
      include: ["src/**/*.ts", "scripts/**/*.ts"],
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
