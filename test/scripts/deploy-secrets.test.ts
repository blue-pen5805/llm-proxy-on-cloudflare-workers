import {
  deploySecrets,
  filterSecretsForDeployment,
  generateSecretsJson,
  getConfigPath,
  parseArgs,
  parseJsonc,
  showHelp,
  validateEnvironmentName,
  valueToSecret,
  type FileSystemOperations,
} from "../../scripts/deploy-secrets";
import { describe, expect, it, vi } from "vitest";

// Mock child_process module
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

// Mock fs module
vi.mock("fs", () => ({
  default: {
    writeFileSync: vi.fn(),
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

describe("deploy-secrets", () => {
  describe("parseArgs", () => {
    it("should parse empty arguments", () => {
      const result = parseArgs([]);
      expect(result).toEqual({});
    });

    it("should parse --env argument", () => {
      const result = parseArgs(["--env", "production"]);
      expect(result).toEqual({ env: "production" });
    });

    it("should parse --dry-run argument", () => {
      const result = parseArgs(["--dry-run"]);
      expect(result).toEqual({ dryRun: true });
    });

    it("should parse --help argument", () => {
      const result = parseArgs(["--help"]);
      expect(result).toEqual({ help: true });
    });

    it("should parse multiple arguments", () => {
      const result = parseArgs(["--env", "prod", "--dry-run"]);
      expect(result).toEqual({
        env: "prod",
        dryRun: true,
      });
    });

    it("should throw error for unknown option", () => {
      expect(() => parseArgs(["--unknown"])).toThrow(
        "Unknown option: --unknown",
      );
    });

    it("should throw error for missing env value", () => {
      expect(() => parseArgs(["--env"])).toThrow(
        "--env option requires a value",
      );
    });
  });

  describe("validateEnvironmentName", () => {
    it("should validate valid environment names", () => {
      expect(validateEnvironmentName("production")).toBe(true);
      expect(validateEnvironmentName("staging")).toBe(true);
      expect(validateEnvironmentName("dev-env")).toBe(true);
      expect(validateEnvironmentName("test_env")).toBe(true);
      expect(validateEnvironmentName("env123")).toBe(true);
    });

    it("should reject invalid environment names", () => {
      expect(validateEnvironmentName("env with spaces")).toBe(false);
      expect(validateEnvironmentName("env@special")).toBe(false);
      expect(validateEnvironmentName("env.dot")).toBe(false);
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

  describe("parseJsonc", () => {
    it("should parse valid JSON", () => {
      const json = '{"key": "value"}';
      const result = parseJsonc(json);
      expect(result).toEqual({ key: "value" });
    });

    it("should parse JSONC with line comments", () => {
      const jsonc = `{
        "key": "value", // This is a comment
        "another": "test"
      }`;
      const result = parseJsonc(jsonc);
      expect(result).toEqual({ key: "value", another: "test" });
    });

    it("should parse JSONC with block comments", () => {
      const jsonc = `{
        "key": "value", /* This is a
        multi-line comment */
        "another": "test"
      }`;
      const result = parseJsonc(jsonc);
      expect(result).toEqual({ key: "value", another: "test" });
    });

    it("should parse JSONC with trailing commas", () => {
      const jsonc = `{
        "key": "value",
        "another": "test",
      }`;
      const result = parseJsonc(jsonc);
      expect(result).toEqual({ key: "value", another: "test" });
    });

    it("should parse JSON with URLs containing // and /* */", () => {
      const jsonString = `{
        "url1": "https://example.com",
        "url2": "http://test.com/path",
        "text": "This is not a /* block comment */"
      }`;
      const result = parseJsonc(jsonString);
      expect(result).toEqual({
        url1: "https://example.com",
        url2: "http://test.com/path",
        text: "This is not a /* block comment */",
      });
    });
  });

  describe("valueToSecret", () => {
    it("should handle string values", () => {
      expect(valueToSecret("test")).toBe("test");
    });

    it("should handle number values", () => {
      expect(valueToSecret(123)).toBe("123");
    });

    it("should handle boolean values", () => {
      expect(valueToSecret(true)).toBe("true");
      expect(valueToSecret(false)).toBe("false");
    });

    it("should handle array values", () => {
      expect(valueToSecret(["a", "b", "c"])).toBe('["a","b","c"]');
    });

    it("should handle null/undefined/empty values", () => {
      expect(valueToSecret(null)).toBe("");
      expect(valueToSecret(undefined)).toBe("");
      expect(valueToSecret("")).toBe("");
    });

    it("should handle empty arrays", () => {
      expect(valueToSecret([])).toBe("");
    });

    it("should handle empty objects", () => {
      expect(valueToSecret({})).toBe("");
    });

    it("should handle whitespace-only strings", () => {
      expect(valueToSecret("   ")).toBe("");
      expect(valueToSecret("\t\n")).toBe("");
    });
  });

  describe("filterSecretsForDeployment", () => {
    it("should filter out empty and null values", () => {
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
        ARRAY_KEY: '["item1","item2"]',
      });
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
  });

  describe("generateSecretsJson", () => {
    it("should generate properly formatted JSON", () => {
      const secrets = {
        API_KEY: "secret",
        ANOTHER_KEY: "value",
      };

      const result = generateSecretsJson(secrets);
      const parsed = JSON.parse(result);
      expect(parsed).toEqual(secrets);
    });
  });

  describe("deploySecrets", () => {
    it("should return error when config file does not exist", () => {
      const mockFs = createMockFsOps({});
      const result = deploySecrets("/root", undefined, true, mockFs);

      expect(result.success).toBe(false);
      expect(result.messages[0]).toContain("config.jsonc not found");
    });

    it("should return warning when no secrets with values found", () => {
      const configContent = `{
        "$schema": "schema.json",
        "EMPTY_KEY": null,
        "ANOTHER_EMPTY": ""
      }`;
      const mockFs = createMockFsOps({
        "/root/config.jsonc": configContent,
      });

      const result = deploySecrets("/root", undefined, true, mockFs);

      expect(result.success).toBe(true);
      expect(result.messages[0]).toContain("No secrets with values found");
    });

    it("should process valid config in dry run mode", () => {
      const configContent = `{
        "$schema": "schema.json",
        "API_KEY": "secret-value",
        "ANOTHER_KEY": "another-secret"
      }`;
      const mockFs = createMockFsOps({
        "/root/config.jsonc": configContent,
      });

      const result = deploySecrets("/root", undefined, true, mockFs);

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
    });

    it("should handle environment-specific config", () => {
      const configContent = `{
        "PROD_API_KEY": "production-secret"
      }`;
      const mockFs = createMockFsOps({
        "/root/config.prod.jsonc": configContent,
      });

      const result = deploySecrets("/root", "prod", true, mockFs);

      expect(result.success).toBe(true);
      expect(
        result.messages.some((msg) => msg.includes("config.prod.jsonc")),
      ).toBe(true);
      expect(
        result.messages.some((msg) => msg.includes("Target environment: prod")),
      ).toBe(true);
    });

    it("should validate environment names", () => {
      const result = deploySecrets("/root", "invalid env", true);

      expect(result.success).toBe(false);
      expect(result.messages[0]).toContain("Invalid environment name");
    });

    it("should truncate long secret values in display", () => {
      const longSecret = "a".repeat(30);
      const configContent = `{
        "LONG_SECRET": "${longSecret}"
      }`;
      const mockFs = createMockFsOps({
        "/root/config.jsonc": configContent,
      });

      const result = deploySecrets("/root", undefined, true, mockFs);

      expect(result.success).toBe(true);
      const secretLine = result.messages.find((msg) =>
        msg.includes("LONG_SECRET:"),
      );
      expect(secretLine).toContain("...");
      expect(secretLine?.length).toBeLessThan(longSecret.length + 20);
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
});
