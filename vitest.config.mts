import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import { resolve } from "path";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
    alias: {
      "~/src": resolve(__dirname, "./src"),
    },
  },
});
