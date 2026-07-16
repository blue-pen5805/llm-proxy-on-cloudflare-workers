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
  },
});
