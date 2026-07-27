import {
  deploySecrets,
  executeWranglerSecretBulk,
  listExistingSecretNames,
  filterSecretsForDeployment,
  MAX_WORKER_SECRET_BYTES,
  serializeSecretsJson,
  getConfigPath,
  runDeploySecretsCli,
  parseDeploySecretsArguments,
  showHelp,
  serializeSecretValue,
  type FileSystemOperations,
} from "../../scripts/deploy-secrets";
import { syncAiGatewayCustomProviders } from "../../scripts/sync-ai-gateway-custom-providers";
import { execFileSync, spawn } from "child_process";
import fs from "fs";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process module
vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("../../scripts/sync-ai-gateway-custom-providers", () => ({
  syncAiGatewayCustomProviders: vi.fn(),
}));

// Mock fs module
vi.mock("fs", () => ({
  default: {
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    existsSync: vi.fn(() => true),
  },
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

// Mock FileSystemOperations
const createMockFsOps = (
  files: Record<string, string> = {},
): FileSystemOperations => ({
  existsSync: vi.fn((path: string) => path in files),
  readFileSync: vi.fn((path: string) => {
    if (!(path in files)) {
      throw new Error(`File not found: ${path}`);
    }
    return files[path];
  }),
  writeFileSync: vi.fn(),
});

function mockWranglerSpawn(
  code: number | null = 0,
  signal: NodeJS.Signals | null = null,
) {
  const kill = vi.fn(() => true);
  const child = Object.assign(new EventEmitter(), { kill });
  vi.mocked(spawn).mockImplementationOnce(() => {
    queueMicrotask(() => child.emit("exit", code, signal));
    return child as never;
  });
  return { child, kill };
}

describe("deploy-secrets", () => {
  beforeEach(() => {
    vi.mocked(execFileSync).mockReset();
    vi.mocked(spawn).mockReset();
    mockWranglerSpawn();
    vi.mocked(fs.writeFileSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
    vi.mocked(fs.unlinkSync).mockReset();
    vi.mocked(fs.existsSync).mockReset().mockReturnValue(true);
    vi.mocked(syncAiGatewayCustomProviders).mockResolvedValue({
      enabled: false,
      desired: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      dryRun: false,
    });
  });

  describe("parseDeploySecretsArguments", () => {
    // The shared option grammar is covered by the scripts/utils suite; only the
    // mapping onto this command's own argument shape is asserted here.
    it("maps the shared options onto deployment arguments", () => {
      expect(parseDeploySecretsArguments([])).toEqual({});
      expect(
        parseDeploySecretsArguments(["--env", "prod", "--dry-run", "--help"]),
      ).toEqual({ env: "prod", dryRun: true, help: true });
    });
  });

  describe("getConfigPath", () => {
    it("should return default config path when no env provided", () => {
      const result = getConfigPath("/root", undefined);
      expect(result).toBe("/root/config.jsonc");
    });

    it("should return environment-specific config path", () => {
      const result = getConfigPath("/root", "production");
      expect(result).toBe("/root/config.production.jsonc");
    });
  });

  describe("serializeSecretValue", () => {
    it("should handle string values", () => {
      expect(serializeSecretValue("test")).toBe("test");
    });

    it("should handle number values", () => {
      expect(serializeSecretValue(123)).toBe("123");
    });

    it("should handle boolean values", () => {
      expect(serializeSecretValue(true)).toBe("true");
      expect(serializeSecretValue(false)).toBe("false");
    });

    it("should handle array values", () => {
      expect(serializeSecretValue(["a", "b", "c"])).toBe('["a","b","c"]');
    });

    it("should stringify object secrets", () => {
      expect(
        serializeSecretValue({
          type: "service_account",
          region: "us-central1",
        }),
      ).toBe('{"type":"service_account","region":"us-central1"}');
    });

    it("should preserve null as a secret deletion", () => {
      expect(serializeSecretValue(null)).toBeNull();
    });

    it("should handle undefined and empty values", () => {
      expect(serializeSecretValue(undefined)).toBe("");
      expect(serializeSecretValue("")).toBe("");
    });

    it("should handle empty arrays", () => {
      expect(serializeSecretValue([])).toBe("");
    });

    it("should handle empty objects", () => {
      expect(serializeSecretValue({})).toBe("");
    });

    it("should handle whitespace-only strings", () => {
      expect(serializeSecretValue("   ")).toBe("");
      expect(serializeSecretValue("\t\n")).toBe("");
    });
  });

  describe("filterSecretsForDeployment", () => {
    it("should filter empty values and preserve null deletions", () => {
      const config = {
        $schema: "schema.json",
        VALID_KEY: "valid-value",
        EMPTY_KEY: "",
        NULL_KEY: null,
        UNDEFINED_KEY: undefined,
        ARRAY_KEY: ["item1", "item2"],
        EMPTY_ARRAY: [],
        EMPTY_OBJECT: {},
        WHITESPACE_KEY: "   ",
      };

      const result = filterSecretsForDeployment(config);
      expect(result).toEqual({
        VALID_KEY: "valid-value",
        NULL_KEY: null,
        ARRAY_KEY: '["item1","item2"]',
      });
    });

    it("accepts a secret exactly at Cloudflare's byte limit", () => {
      const value = "a".repeat(MAX_WORKER_SECRET_BYTES);
      expect(filterSecretsForDeployment({ KEY: value })).toEqual({
        KEY: value,
      });
    });

    it("rejects a secret above Cloudflare's UTF-8 byte limit", () => {
      const value = "é".repeat(MAX_WORKER_SECRET_BYTES / 2 + 1);
      expect(() => filterSecretsForDeployment({ LARGE_SECRET: value })).toThrow(
        `LARGE_SECRET exceeds Cloudflare's ${MAX_WORKER_SECRET_BYTES}-byte secret limit.`,
      );
    });

    it("should exclude $schema field", () => {
      const config = {
        $schema: "schema.json",
        API_KEY: "secret-key",
      };

      const result = filterSecretsForDeployment(config);
      expect(result).toEqual({
        API_KEY: "secret-key",
      });
    });

    it("never deploys the development-only DEV flag", () => {
      const result = filterSecretsForDeployment({
        API_KEY: "secret-key",
        DEV: true,
      });

      expect(result).toEqual({ API_KEY: "secret-key" });
      expect(result).not.toHaveProperty("DEV");
    });

    it("never deploys the deprecated round-robin setting", () => {
      const result = filterSecretsForDeployment({
        API_KEY: "secret-key",
        ENABLE_GLOBAL_ROUND_ROBIN: false,
      });

      expect(result).toEqual({ API_KEY: "secret-key" });
      expect(result).not.toHaveProperty("ENABLE_GLOBAL_ROUND_ROBIN");
    });
  });

  describe("serializeSecretsJson", () => {
    it("should generate properly formatted JSON", () => {
      const secrets = {
        API_KEY: "secret",
        ANOTHER_KEY: "value",
        DELETED_KEY: null,
      };

      const result = serializeSecretsJson(secrets);
      const parsed = JSON.parse(result);
      expect(parsed).toEqual(secrets);
    });
  });

  describe("deploySecrets", () => {
    it("should return error when config file does not exist", async () => {
      const mockFs = createMockFsOps({});
      const result = await deploySecrets("/root", undefined, true, mockFs);

      expect(result.success).toBe(false);
      expect(result.messages[0]).toContain("config.jsonc not found");
    });

    it("accepts an acyclic virtual-model reference graph during dry-run", async () => {
      const mockFs = createMockFsOps({
        "/root/config.jsonc": JSON.stringify({
          CUSTOM_OPENAI_ENDPOINTS: null,
          VIRTUAL_MODELS: {
            "virtual/front": ["virtual/fallback"],
            "virtual/fallback": ["openai/gpt-4o-mini"],
          },
        }),
      });

      const result = await deploySecrets("/root", undefined, true, mockFs);

      expect(result.success).toBe(true);
      expect(result.messages).toContain("   - VIRTUAL_MODELS: [set]");
    });

    it("honors custom-provider precedence while checking graph edges", async () => {
      const mockFs = createMockFsOps({
        "/root/config.jsonc": JSON.stringify({
          CUSTOM_OPENAI_ENDPOINTS: [
            { name: "custom", baseUrl: "https://custom.example/v1" },
          ],
          VIRTUAL_MODELS: { "custom/model": ["custom/model"] },
        }),
      });

      const result = await deploySecrets("/root", undefined, true, mockFs);

      expect(result.success).toBe(true);
      expect(result.messages).toContain("   - VIRTUAL_MODELS: [set]");
    });

    it("rejects configuration the Worker's own readers refuse", async () => {
      // The JSON Schema cannot express these rules, so without this check the
      // configuration deploys and then fails every request with HTTP 503.
      const mockFs = createMockFsOps({
        "/root/config.jsonc": JSON.stringify({
          CUSTOM_OPENAI_ENDPOINTS: [
            null,
            "invalid",
            {},
            { name: 42 },
            { name: "custom" },
          ],
          VIRTUAL_MODELS: { "custom/model": ["custom/model"] },
        }),
      });

      await expect(
        deploySecrets("/root", undefined, true, mockFs),
      ).resolves.toEqual({
        success: false,
        messages: [
          "❌ Error processing config.jsonc: Invalid configuration for CUSTOM_OPENAI_ENDPOINTS.",
        ],
      });
    });

    it.each([
      ["omitted partner", { CUSTOM_OPENAI_ENDPOINTS: null }],
      [
        "omitted partner, reversed",
        { VIRTUAL_MODELS: { "virtual/a": ["openai/gpt-4"] } },
      ],
      // An empty value satisfies key presence while deploying nothing, so
      // testing presence rather than the effective operation would let a
      // partial update through under the guise of a complete declaration.
      [
        "partner present but empty",
        { CUSTOM_OPENAI_ENDPOINTS: null, VIRTUAL_MODELS: {} },
      ],
      [
        "partner present but an empty array",
        { CUSTOM_OPENAI_ENDPOINTS: null, VIRTUAL_MODELS: [] },
      ],
      [
        "partner present but an empty string",
        {
          CUSTOM_OPENAI_ENDPOINTS: [
            { name: "custom", baseUrl: "https://custom.example/v1" },
          ],
          VIRTUAL_MODELS: "",
        },
      ],
    ])(
      "requires the interdependent settings to change together: %s",
      async (_name, config) => {
        // A setting this file does not deploy keeps its deployed value, which
        // this command cannot read back. Deleting CUSTOM_OPENAI_ENDPOINTS on
        // its own would otherwise pass while turning a retained VIRTUAL_MODELS
        // entry that referenced that endpoint into a self-reference, so every
        // request would fail with HTTP 503 after a successful deployment.
        const mockFs = createMockFsOps({
          "/root/config.jsonc": JSON.stringify(config),
        });

        const result = await deploySecrets("/root", undefined, true, mockFs);

        expect(result.success).toBe(false);
        expect(result.messages[0]).toContain("is left unchanged");
      },
    );

    it("accepts deleting both interdependent settings together", async () => {
      const mockFs = createMockFsOps({
        "/root/config.jsonc": JSON.stringify({
          CUSTOM_OPENAI_ENDPOINTS: null,
          VIRTUAL_MODELS: null,
        }),
      });

      const result = await deploySecrets("/root", undefined, true, mockFs);

      expect(result.success).toBe(true);
      expect(result.messages).toContain(
        "   - CUSTOM_OPENAI_ENDPOINTS: [delete]",
      );
      expect(result.messages).toContain("   - VIRTUAL_MODELS: [delete]");
    });

    it.each([
      ["on its own", { VIRTUAL_MODELS: null }],
      [
        "with an untouched endpoint setting",
        { VIRTUAL_MODELS: null, CUSTOM_OPENAI_ENDPOINTS: {} },
      ],
    ])("accepts deleting the virtual models %s", async (_name, config) => {
      // The dependency runs one way. Deleting VIRTUAL_MODELS leaves no
      // reference that could name an endpoint, and both cycles and the
      // attempt limit are properties of that graph alone, so the result is
      // verifiable whatever CUSTOM_OPENAI_ENDPOINTS still holds.
      const mockFs = createMockFsOps({
        "/root/config.jsonc": JSON.stringify(config),
      });

      const result = await deploySecrets("/root", undefined, true, mockFs);

      expect(result.success).toBe(true);
      expect(result.messages).toContain("   - VIRTUAL_MODELS: [delete]");
    });

    it("still rejects changing the endpoints on their own", async () => {
      // The reverse direction stays unverifiable: a retained virtual model may
      // reference an endpoint this deployment adds or removes.
      const mockFs = createMockFsOps({
        "/root/config.jsonc": JSON.stringify({
          CUSTOM_OPENAI_ENDPOINTS: [
            { name: "custom", baseUrl: "https://custom.example/v1" },
          ],
        }),
      });

      const result = await deploySecrets("/root", undefined, true, mockFs);

      expect(result.success).toBe(false);
      expect(result.messages[0]).toContain("is left unchanged");
    });

    it("detects the cycle that deleting a custom endpoint would create", async () => {
      const mockFs = createMockFsOps({
        "/root/config.jsonc": JSON.stringify({
          CUSTOM_OPENAI_ENDPOINTS: null,
          VIRTUAL_MODELS: { "custom/model": ["custom/model"] },
        }),
      });

      const result = await deploySecrets("/root", undefined, true, mockFs);

      expect(result.success).toBe(false);
      expect(result.messages[0]).toContain("circular reference");
    });

    it.each([
      ["an empty allowed-origin string", { ALLOWED_ORIGINS: "" }],
      ["an empty endpoint object", { CUSTOM_OPENAI_ENDPOINTS: {} }],
      ["an empty virtual-model array", { VIRTUAL_MODELS: [] }],
      [
        "both interdependent settings empty",
        { CUSTOM_OPENAI_ENDPOINTS: {}, VIRTUAL_MODELS: [] },
      ],
    ])("does not validate %s that is never deployed", async (_name, config) => {
      // These values are documented no-ops that filterSecretsForDeployment
      // drops. A file built only from them deploys nothing, so it must be
      // accepted rather than validated as Worker configuration. No partner
      // key is added here: null would be a real deletion and would stop this
      // from testing a file that changes nothing.
      const mockFs = createMockFsOps({
        "/root/config.jsonc": JSON.stringify(config),
      });

      const result = await deploySecrets("/root", undefined, true, mockFs);

      expect(result.success).toBe(true);
      expect(result.messages).toContain(
        "⚠️  No secret operations found in config.jsonc",
      );
    });

    it("rejects an invalid allowed-origin list before deployment", async () => {
      const mockFs = createMockFsOps({
        "/root/config.jsonc": JSON.stringify({
          ALLOWED_ORIGINS: ["https://client.example/path"],
        }),
      });

      await expect(
        deploySecrets("/root", undefined, true, mockFs),
      ).resolves.toEqual({
        success: false,
        messages: [
          "❌ Error processing config.jsonc: Invalid configuration for ALLOWED_ORIGINS.",
        ],
      });
    });

    it("rejects malformed virtual models before deployment", async () => {
      const mockFs = createMockFsOps({
        "/root/config.jsonc":
          '{"CUSTOM_OPENAI_ENDPOINTS":null,"VIRTUAL_MODELS":{"virtual/route":[]}}',
      });

      await expect(
        deploySecrets("/root", undefined, true, mockFs),
      ).resolves.toEqual({
        success: false,
        messages: [
          "❌ Error processing config.jsonc: VIRTUAL_MODELS is invalid.",
        ],
      });
      expect(execFileSync).not.toHaveBeenCalled();
    });

    it.each([
      {
        "virtual/self": ["virtual/self"],
      },
      {
        "virtual/one": ["virtual/two"],
        "virtual/two": [{ model: "virtual/three", retries: 1 }],
        "virtual/three": ["virtual/one"],
      },
    ])(
      "rejects a virtual-model cycle before deployment: %j",
      async (models) => {
        const mockFs = createMockFsOps({
          "/root/config.jsonc": JSON.stringify({
            CUSTOM_OPENAI_ENDPOINTS: null,
            VIRTUAL_MODELS: models,
          }),
        });

        const result = await deploySecrets("/root", undefined, true, mockFs);

        expect(result).toEqual({
          success: false,
          messages: [
            "❌ Error processing config.jsonc: VIRTUAL_MODELS contains a circular reference.",
          ],
        });
        expect(execFileSync).not.toHaveBeenCalled();
      },
    );

    it("rejects a cycle before a real deployment invokes Wrangler", async () => {
      const mockFs = createMockFsOps({
        "/root/config.jsonc": JSON.stringify({
          CUSTOM_OPENAI_ENDPOINTS: null,
          VIRTUAL_MODELS: { "virtual/self": ["virtual/self"] },
        }),
      });

      const result = await deploySecrets("/root", undefined, false, mockFs);

      expect(result.success).toBe(false);
      expect(result.messages[0]).toContain("circular reference");
      expect(execFileSync).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it("rejects a nested graph above the expanded attempt limit", async () => {
      const mockFs = createMockFsOps({
        "/root/config.jsonc": JSON.stringify({
          CUSTOM_OPENAI_ENDPOINTS: null,
          VIRTUAL_MODELS: {
            "virtual/leaf": Array.from({ length: 16 }, (_, index) => ({
              model: `openai/model-${index}`,
              retries: 5,
            })),
            "virtual/root": ["virtual/leaf", "virtual/leaf"],
          },
        }),
      });

      const result = await deploySecrets("/root", undefined, true, mockFs);

      expect(result.success).toBe(false);
      expect(result.messages).toEqual([
        "❌ Error processing config.jsonc: VIRTUAL_MODELS exceeds the 96-attempt expansion limit.",
      ]);
      expect(execFileSync).not.toHaveBeenCalled();
    });

    it("uses the default dry-run value", async () => {
      const mockFs = createMockFsOps({
        "/root/config.jsonc": '{"KEY":"value"}',
      });

      expect(
        (await deploySecrets("/root", undefined, undefined, mockFs)).success,
      ).toBe(true);
      expect(spawn).toHaveBeenCalled();
    });

    it("should return warning when no secret operations are found", async () => {
      const configContent = `{
        "$schema": "schema.json",
        "EMPTY_KEY": "",
        "ANOTHER_EMPTY": ""
      }`;
      const mockFs = createMockFsOps({
        "/root/config.jsonc": configContent,
      });

      const result = await deploySecrets("/root", undefined, true, mockFs);

      expect(result.success).toBe(true);
      expect(result.messages[0]).toContain("No secret operations found");
    });

    it("warns and succeeds when only the deprecated setting remains", async () => {
      const mockFs = createMockFsOps({
        "/root/config.jsonc": '{"ENABLE_GLOBAL_ROUND_ROBIN":false}',
      });

      const result = await deploySecrets("/root", undefined, true, mockFs);

      expect(result.success).toBe(true);
      expect(result.messages).toEqual([
        expect.stringContaining(
          "WARNING: ENABLE_GLOBAL_ROUND_ROBIN is deprecated and ignored",
        ),
        expect.stringContaining("No secret operations found"),
      ]);
      expect(execFileSync).not.toHaveBeenCalled();
    });

    it("warns and excludes the deprecated setting from deployment", async () => {
      const mockFs = createMockFsOps({
        "/root/config.jsonc": JSON.stringify({
          ENABLE_GLOBAL_ROUND_ROBIN: true,
          API_KEY: "secret-value",
        }),
      });

      const result = await deploySecrets("/root", undefined, true, mockFs);

      expect(result.success).toBe(true);
      expect(result.messages[0]).toContain(
        "WARNING: ENABLE_GLOBAL_ROUND_ROBIN is deprecated and ignored",
      );
      expect(result.messages).toContain("   - API_KEY: [set]");
      expect(result.messages.join("\n")).not.toContain(
        "ENABLE_GLOBAL_ROUND_ROBIN: [set]",
      );
      expect(result.messages.join("\n")).not.toContain("secret-value");
    });

    it("should include null values as redacted delete operations", async () => {
      const mockFs = createMockFsOps({
        "/root/config.jsonc": '{"OLD_API_KEY":null}',
      });

      const result = await deploySecrets("/root", undefined, true, mockFs);

      expect(result.success).toBe(true);
      expect(result.messages).toContain("   - OLD_API_KEY: [delete]");
      expect(result.messages.join("\n")).not.toContain("null");
    });

    it("should reject oversized serialized secrets before invoking Wrangler", async () => {
      const mockFs = createMockFsOps({
        "/root/config.jsonc": JSON.stringify({
          LARGE_SECRET: "x".repeat(MAX_WORKER_SECRET_BYTES + 1),
        }),
      });

      const result = await deploySecrets("/root", undefined, true, mockFs);

      expect(result.success).toBe(false);
      expect(result.messages[0]).toContain("exceeds Cloudflare's");
      expect(execFileSync).not.toHaveBeenCalled();
    });

    it("should process valid config in dry run mode", async () => {
      const configContent = `{
        "$schema": "schema.json",
        "API_KEY": "secret-value",
        "ANOTHER_KEY": "another-secret"
      }`;
      const mockFs = createMockFsOps({
        "/root/config.jsonc": configContent,
      });

      const result = await deploySecrets("/root", undefined, true, mockFs);

      expect(result.success).toBe(true);
      expect(
        result.messages.some((msg) => msg.includes("Found 2 secrets")),
      ).toBe(true);
      expect(result.messages.some((msg) => msg.includes("API_KEY:"))).toBe(
        true,
      );
      expect(result.messages.some((msg) => msg.includes("ANOTHER_KEY:"))).toBe(
        true,
      );
      expect(result.messages.some((msg) => msg.includes("Dry run mode"))).toBe(
        true,
      );
      expect(result.messages.join("\n")).not.toContain("secret-value");
      expect(result.messages.join("\n")).not.toContain("another-secret");
    });

    it("should handle environment-specific config", async () => {
      const configContent = `{
        "PROD_API_KEY": "production-secret"
      }`;
      const mockFs = createMockFsOps({
        "/root/config.prod.jsonc": configContent,
      });

      const result = await deploySecrets("/root", "prod", true, mockFs);

      expect(result.success).toBe(true);
      expect(
        result.messages.some((msg) => msg.includes("config.prod.jsonc")),
      ).toBe(true);
      expect(
        result.messages.some((msg) => msg.includes("Target environment: prod")),
      ).toBe(true);
    });

    it("should validate environment names", async () => {
      const result = await deploySecrets("/root", "invalid env", true);

      expect(result.success).toBe(false);
      expect(result.messages[0]).toContain("Invalid environment name");
    });

    it("should fully redact secret values in display", async () => {
      const longSecret = "a".repeat(30);
      const configContent = `{
        "LONG_SECRET": "${longSecret}"
      }`;
      const mockFs = createMockFsOps({
        "/root/config.jsonc": configContent,
      });

      const result = await deploySecrets("/root", undefined, true, mockFs);

      expect(result.success).toBe(true);
      const secretLine = result.messages.find((msg) =>
        msg.includes("LONG_SECRET:"),
      );
      expect(secretLine).toBe("   - LONG_SECRET: [set]");
      expect(result.messages.join("\n")).not.toContain(longSecret);
    });

    it("should report malformed configuration", async () => {
      const mockFs = createMockFsOps({
        "/root/config.jsonc": "{ malformed",
      });
      await expect(
        deploySecrets("/root", undefined, true, mockFs),
      ).resolves.toEqual({
        success: false,
        messages: [expect.stringContaining("Error processing config.jsonc")],
      });
    });

    it("should report non-Error filesystem failures", async () => {
      const mockFs = createMockFsOps({
        "/root/config.jsonc": "{}",
      });
      vi.mocked(mockFs.readFileSync).mockImplementation(() => {
        throw "unreadable";
      });
      await expect(
        deploySecrets("/root", undefined, true, mockFs),
      ).resolves.toMatchObject({
        messages: ["❌ Error processing config.jsonc: unreadable"],
      });
    });

    describe("deletion of non-existent secrets (non-dry-run)", () => {
      // Route the shared execFileSync mock used by `secret list`; the default
      // spawn mock completes `secret bulk`, whose payload is inspected via
      // writeFileSync.
      const routeWrangler = (listOutput: string | (() => never)) => {
        vi.mocked(execFileSync).mockImplementation(
          (_cmd, args?: readonly string[]) => {
            if (args?.includes("list")) {
              if (typeof listOutput === "function") return listOutput();
              return listOutput;
            }
            return "";
          },
        );
      };

      beforeEach(() => {
        vi.spyOn(console, "log").mockImplementation(() => undefined);
      });

      it("skips deletions for secrets that are not currently set", async () => {
        routeWrangler('[{"name":"API_KEY","type":"secret_text"}]');
        const mockFs = createMockFsOps({
          "/root/config.jsonc": '{"OLD_KEY":null,"API_KEY":"val"}',
        });

        const result = await deploySecrets("/root", undefined, false, mockFs);

        expect(result.success).toBe(true);
        expect(result.messages).toContain(
          "⏭️  Skipping deletion of 1 secret(s) not currently set: OLD_KEY",
        );
        expect(result.messages).toContain("   - API_KEY: [set]");
        expect(result.messages.join("\n")).not.toContain("OLD_KEY: [delete]");

        // OLD_KEY must be absent from the payload handed to `secret bulk`.
        const bulkPayload = vi.mocked(fs.writeFileSync).mock
          .calls[0][1] as string;
        expect(JSON.parse(bulkPayload)).toEqual({ API_KEY: "val" });
      });

      it("keeps deletions for secrets that currently exist", async () => {
        routeWrangler('[{"name":"OLD_KEY","type":"secret_text"}]');
        const mockFs = createMockFsOps({
          "/root/config.jsonc": '{"OLD_KEY":null}',
        });

        const result = await deploySecrets("/root", undefined, false, mockFs);

        expect(result.success).toBe(true);
        expect(result.messages).toContain("   - OLD_KEY: [delete]");
        expect(result.messages.join("\n")).not.toContain("Skipping deletion");

        const bulkPayload = vi.mocked(fs.writeFileSync).mock
          .calls[0][1] as string;
        expect(JSON.parse(bulkPayload)).toEqual({ OLD_KEY: null });
      });

      it("deploys nothing when every deletion targets an absent secret", async () => {
        routeWrangler("[]");
        const mockFs = createMockFsOps({
          "/root/config.jsonc": '{"OLD_KEY":null}',
        });

        const result = await deploySecrets("/root", undefined, false, mockFs);

        expect(result.success).toBe(true);
        expect(result.messages).toContain(
          "✅ Nothing to deploy — all requested deletions target secrets that are not set.",
        );
        // Only `secret list` runs; `secret bulk` is never invoked.
        expect(fs.writeFileSync).not.toHaveBeenCalled();
        expect(execFileSync).toHaveBeenCalledTimes(1);
      });

      it("falls back to sending deletions when existing secrets can't be listed", async () => {
        routeWrangler(() => {
          throw new Error("worker not found");
        });
        const mockFs = createMockFsOps({
          "/root/config.jsonc": '{"OLD_KEY":null}',
        });

        const result = await deploySecrets("/root", undefined, false, mockFs);

        expect(result.success).toBe(true);
        expect(result.messages).toContain("   - OLD_KEY: [delete]");
        expect(result.messages.join("\n")).not.toContain("Skipping deletion");

        const bulkPayload = vi.mocked(fs.writeFileSync).mock
          .calls[0][1] as string;
        expect(JSON.parse(bulkPayload)).toEqual({ OLD_KEY: null });
      });

      it("does not query existing secrets on a dry run", async () => {
        routeWrangler("[]");
        const mockFs = createMockFsOps({
          "/root/config.jsonc": '{"OLD_KEY":null}',
        });

        const result = await deploySecrets("/root", undefined, true, mockFs);

        expect(result.success).toBe(true);
        expect(result.messages).toContain("   - OLD_KEY: [delete]");
        expect(execFileSync).not.toHaveBeenCalled();
      });
    });
  });

  describe("listExistingSecretNames", () => {
    it("returns the set of configured secret names", () => {
      vi.mocked(execFileSync).mockReturnValue(
        '[{"name":"A","type":"secret_text"},{"name":"B","type":"secret_text"}]',
      );

      const names = listExistingSecretNames();

      expect(names).toEqual(new Set(["A", "B"]));
      expect(execFileSync).toHaveBeenCalledWith(
        "wrangler",
        ["secret", "list", "--format", "json"],
        { encoding: "utf8" },
      );
    });

    it("passes the environment through to Wrangler", () => {
      vi.mocked(execFileSync).mockReturnValue("[]");

      expect(listExistingSecretNames("prod")).toEqual(new Set());
      expect(execFileSync).toHaveBeenCalledWith(
        "wrangler",
        ["secret", "list", "--format", "json", "--env", "prod"],
        { encoding: "utf8" },
      );
    });

    it("tolerates surrounding output around the JSON array", () => {
      vi.mocked(execFileSync).mockReturnValue('⛅️ wrangler\n[{"name":"A"}]\n');

      expect(listExistingSecretNames()).toEqual(new Set(["A"]));
    });

    it("ignores malformed entries", () => {
      vi.mocked(execFileSync).mockReturnValue('[{"name":"A"},{},{"name":1}]');

      expect(listExistingSecretNames()).toEqual(new Set(["A"]));
    });

    it("returns null when the output is not a JSON array", () => {
      vi.mocked(execFileSync).mockReturnValue('{"name":"A"}');

      expect(listExistingSecretNames()).toBeNull();
    });

    it("returns null when parsing fails", () => {
      vi.mocked(execFileSync).mockReturnValue("[not json]");

      expect(listExistingSecretNames()).toBeNull();
    });

    it("returns null when Wrangler exits with an error", () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("no worker");
      });

      expect(listExistingSecretNames()).toBeNull();
    });
  });

  describe("executeWranglerSecretBulk", () => {
    it("builds a dry-run command without writing plaintext", async () => {
      const result = await executeWranglerSecretBulk(
        '{"KEY":"value"}',
        "prod",
        true,
      );

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(fs.unlinkSync).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: expect.stringContaining("--env prod"),
      });
    });

    it("executes Wrangler and cleans up on success", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

      const result = await executeWranglerSecretBulk('{"KEY":"value"}');

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/\.secrets-temp-.*\.json$/),
        '{"KEY":"value"}',
        { flag: "wx", mode: 0o600 },
      );
      expect(spawn).toHaveBeenCalledWith(
        "wrangler",
        ["secret", "bulk", expect.stringMatching(/\.secrets-temp-.*\.json$/)],
        { stdio: "inherit" },
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("🚀 Executing: wrangler secret bulk"),
      );
      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: "✅ Secrets deployed successfully",
      });
    });

    it("cleans up and reports execution failures", async () => {
      vi.mocked(spawn)
        .mockReset()
        .mockImplementation(() => {
          throw new Error("wrangler failed");
        });
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await expect(
        executeWranglerSecretBulk('{"KEY":"value"}'),
      ).resolves.toEqual({
        success: false,
        message: "❌ Error deploying secrets: wrangler failed",
      });
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it("reports a Wrangler process start error", async () => {
      vi.mocked(spawn).mockReset();
      const child = Object.assign(new EventEmitter(), {
        kill: vi.fn(() => true),
      });
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => child.emit("error", new Error("spawn failed")));
        return child as never;
      });

      await expect(executeWranglerSecretBulk("{}")).resolves.toEqual({
        success: false,
        message: "❌ Error deploying secrets: spawn failed",
      });
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it("handles non-Error failures without a temporary file", async () => {
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw "disk full";
      });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(executeWranglerSecretBulk("{}")).resolves.toEqual({
        success: false,
        message: "❌ Error deploying secrets: disk full",
      });
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it("skips deletion when the temporary file is already gone", async () => {
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(
        executeWranglerSecretBulk('{"KEY":"value"}'),
      ).resolves.toEqual({
        success: true,
        message: "✅ Secrets deployed successfully",
      });
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it("still reports success when deleting the temporary file fails", async () => {
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      vi.mocked(fs.unlinkSync).mockImplementation(() => {
        throw new Error("permission denied");
      });

      await expect(
        executeWranglerSecretBulk('{"KEY":"value"}'),
      ).resolves.toEqual({
        success: true,
        message: "✅ Secrets deployed successfully",
      });
    });

    it("deletes the temporary file and stops Wrangler when interrupted", async () => {
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      vi.mocked(spawn).mockReset();
      const kill = vi.fn(() => true);
      const child = Object.assign(new EventEmitter(), { kill });
      let interruptHandler: ((signal: NodeJS.Signals) => void) | undefined;
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => {
          interruptHandler = process.listeners("SIGINT").at(-1) as (
            signal: NodeJS.Signals,
          ) => void;
          interruptHandler("SIGINT");
          child.emit("exit", null, "SIGINT");
        });
        return child as never;
      });

      const result = await executeWranglerSecretBulk('{"KEY":"value"}');

      expect(interruptHandler).toBeDefined();
      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(kill).toHaveBeenCalledWith("SIGINT");
      expect(result).toEqual({
        success: false,
        message: "❌ Error deploying secrets: Wrangler interrupted by SIGINT.",
      });
      expect(process.listeners("SIGINT")).not.toContain(interruptHandler);
    });

    it("reports a Wrangler exit code", async () => {
      vi.mocked(spawn).mockReset();
      mockWranglerSpawn(2);

      await expect(executeWranglerSecretBulk("{}")).resolves.toEqual({
        success: false,
        message: "❌ Error deploying secrets: Wrangler exited with code 2.",
      });
    });

    it("reports a child termination signal", async () => {
      vi.mocked(spawn).mockReset();
      mockWranglerSpawn(null, "SIGTERM");

      await expect(executeWranglerSecretBulk("{}")).resolves.toEqual({
        success: false,
        message: "❌ Error deploying secrets: Wrangler terminated by SIGTERM.",
      });
    });

    it("still cleans up if signaling the child fails", async () => {
      vi.mocked(spawn).mockReset();
      const child = Object.assign(new EventEmitter(), {
        kill: vi.fn(() => {
          throw new Error("child already exited");
        }),
      });
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => {
          const interruptHandler = process.listeners("SIGTERM").at(-1) as (
            signal: NodeJS.Signals,
          ) => void;
          interruptHandler("SIGTERM");
          child.emit("exit", null, "SIGTERM");
        });
        return child as never;
      });

      const result = await executeWranglerSecretBulk("{}");

      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });
  });

  describe("showHelp", () => {
    it("should return help text", () => {
      const help = showHelp();
      expect(help).toContain("Usage: secrets:deploy");
      expect(help).toContain("--env");
      expect(help).toContain("--dry-run");
      expect(help).toContain("--help");
    });
  });

  describe("runDeploySecretsCli", () => {
    const originalArgv = process.argv;

    beforeEach(() => {
      process.argv = originalArgv;
      vi.restoreAllMocks();
    });

    it("prints help", async () => {
      process.argv = ["node", "deploy-secrets.ts", "--help"];
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

      await runDeploySecretsCli();

      expect(log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    });

    it("reports invalid arguments", async () => {
      process.argv = ["node", "deploy-secrets.ts", "--bad"];
      const error = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("exited");
      }) as never);

      await expect(runDeploySecretsCli()).rejects.toThrow("exited");
      expect(error).toHaveBeenCalledWith("❌ Error: Unknown option: --bad");
    });

    it("prints a successful dry run", async () => {
      process.argv = ["node", "deploy-secrets.ts", "--dry-run"];
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('{"KEY":"value"}');
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

      await runDeploySecretsCli();

      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("Deploying secrets from config.jsonc"),
      );
      expect(log).not.toHaveBeenCalledWith("🎉 Secret deployment completed!");
    });

    it("prints completion after a real deployment", async () => {
      process.argv = ["node", "deploy-secrets.ts"];
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('{"KEY":"value"}');
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

      await runDeploySecretsCli();

      expect(log).toHaveBeenCalledWith("🎉 Secret deployment completed!");
    });

    it("describes an environment-specific dry run", async () => {
      process.argv = [
        "node",
        "deploy-secrets.ts",
        "--env",
        "prod",
        "--dry-run",
      ];
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('{"KEY":"value"}');
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

      await runDeploySecretsCli();

      expect(log).toHaveBeenCalledWith(
        "🔐 Deploying secrets from config.prod.jsonc to prod environment (dry run)...",
      );
    });

    it.each([
      [
        true,
        "☁️  AI Gateway Custom Providers: 3 definitions would be reconciled.",
      ],
      [
        false,
        "☁️  AI Gateway Custom Providers: 1 created, 1 updated, 1 unchanged.",
      ],
    ])("reports Custom Provider synchronization", async (dryRun, message) => {
      process.argv = [
        "node",
        "deploy-secrets.ts",
        ...(dryRun ? ["--dry-run"] : []),
      ];
      vi.mocked(fs.readFileSync).mockReturnValue("{}");
      vi.mocked(syncAiGatewayCustomProviders).mockResolvedValue({
        enabled: true,
        desired: 3,
        created: 1,
        updated: 1,
        unchanged: 1,
        dryRun,
      });
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

      await runDeploySecretsCli();

      expect(log).toHaveBeenCalledWith(message);
    });

    it("reports Custom Provider synchronization failures", async () => {
      process.argv = ["node", "deploy-secrets.ts"];
      vi.mocked(fs.readFileSync).mockReturnValue("{}");
      vi.mocked(syncAiGatewayCustomProviders).mockRejectedValue(
        new Error("sync failed"),
      );
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const exit = vi
        .spyOn(process, "exit")
        .mockImplementation((() => undefined) as never);

      await runDeploySecretsCli();

      expect(log).toHaveBeenCalledWith(
        "❌ AI Gateway Custom Provider synchronization failed: sync failed",
      );
      expect(exit).toHaveBeenCalledWith(1);
    });

    it("exits when deployment fails", async () => {
      process.argv = ["node", "deploy-secrets.ts"];
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      const exit = vi
        .spyOn(process, "exit")
        .mockImplementation((() => undefined) as never);

      await runDeploySecretsCli();

      expect(exit).toHaveBeenCalledWith(1);
    });
  });
});
