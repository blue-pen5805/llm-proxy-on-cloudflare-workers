import { defineConfig, exports, type CloudflareConfig } from "cf/config";

export default defineConfig(({ mode }) => {
  // Named deployment modes must be configured explicitly to avoid updating
  // the default Worker when a mode is misspelled or missing.
  if (mode !== undefined && mode !== "develop")
    throw new Error(`Unknown deployment mode: ${mode}`);
  return {
    worker: {
      name: mode === "develop" ? "llm-proxy-develop" : "llm-proxy",
      compatibilityDate: "2026-07-27",
      compatibilityFlags: ["nodejs_compat", "enable_request_signal"],
      entrypoint: "src/index.ts",
      // Preserve the deletion for installations with the old namespace.
      exports: {
        KeyRotationManager: exports.durableObject({ state: "deleted" }),
      },
      placement: {
        mode: "smart",
      },
      limits: {
        cpuMs: 1000,
      },
      observability: {
        enabled: true,
        logs: {
          enabled: true,
          headSamplingRate: 1,
          invocationLogs: true,
        },
        traces: {
          enabled: true,
          headSamplingRate: 0.05,
        },
      },
    },
  } satisfies CloudflareConfig;
});
