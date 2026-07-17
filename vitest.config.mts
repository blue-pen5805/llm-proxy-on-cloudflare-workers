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
    coverage: {
      provider: "istanbul",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts", "scripts/*.ts"],
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        statements: 99,
        branches: 97,
        functions: 100,
        lines: 99,
      },
    },
  },
});
