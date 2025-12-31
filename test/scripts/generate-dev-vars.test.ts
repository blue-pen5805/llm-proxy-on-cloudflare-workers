import {
  configToDevVars,
  generateDevVars,
  generateSingleDevVarsFile,
  getFilePaths,
  parseArgs,
  parseJsonc,
  showHelp,
  validateEnvironmentName,
  valueToEnvVar,
  type FileSystemOperations,
} from "../../scripts/generate-dev-vars";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock file system operations
const createMockFileSystem = (files: Record<string, string> = {}) => {
  const mockFs: FileSystemOperations = {
    existsSync: vi.fn((path: string) => path in files),
    readFileSync: vi.fn((path: string) => {
      if (path in files) {
        return files[path];
      }
      throw new Error(`File not found: ${path}`);
    }),
    writeFileSync: vi.fn(),
  };
  return mockFs;
};

describe("parseArgs", () => {
  it("should parse empty arguments", () => {
    const result = parseArgs([]);
    expect(result).toEqual({});
  });

  it("should parse --env argument", () => {
    const result = parseArgs(["--env", "staging"]);
    expect(result).toEqual({ env: "staging" });
  });

  it("should parse --help argument", () => {
    const result = parseArgs(["--help"]);
    expect(result).toEqual({ help: true });
  });

  it("should parse -h argument", () => {
    const result = parseArgs(["-h"]);
    expect(result).toEqual({ help: true });
  });

  it("should parse multiple arguments", () => {
    const result = parseArgs(["--env", "prod", "--help"]);
    expect(result).toEqual({ env: "prod", help: true });
  });

  it("should throw error for unknown options", () => {
    expect(() => parseArgs(["--invalid"])).toThrow("Unknown option: --invalid");
    expect(() => parseArgs(["--unknown", "value"])).toThrow(
      "Unknown option: --unknown",
    );
  });

  it("should throw error for unexpected arguments", () => {
    expect(() => parseArgs(["somearg"])).toThrow(
      "Unexpected argument: somearg",
    );
    expect(() => parseArgs(["arg1", "arg2"])).toThrow(
      "Unexpected argument: arg1",
    );
  });

  it("should throw error for --env without value", () => {
    expect(() => parseArgs(["--env"])).toThrow("--env option requires a value");
    expect(() => parseArgs(["--env", "--help"])).toThrow(
      "--env option requires a value",
    );
  });
});

describe("showHelp", () => {
  it("should return help message", () => {
    const helpMessage = showHelp();
    expect(helpMessage).toContain("Usage: generate-dev-vars [options]");
    expect(helpMessage).toContain("--env <name>");
    expect(helpMessage).toContain("--help, -h");
    expect(helpMessage).toContain("Examples:");
  });
});

describe("parseJsonc", () => {
  it("should parse valid JSON", () => {
    const jsonString = '{"key": "value"}';
    const result = parseJsonc(jsonString);
    expect(result).toEqual({ key: "value" });
  });

  it("should parse JSON with single-line comments", () => {
    const jsonString = `{
      // This is a comment
      "key": "value"
    }`;
    const result = parseJsonc(jsonString);
    expect(result).toEqual({ key: "value" });
  });

  it("should parse JSON with multi-line comments", () => {
    const jsonString = `{
      /* This is a
         multi-line comment */
      "key": "value"
    }`;
    const result = parseJsonc(jsonString);
    expect(result).toEqual({ key: "value" });
  });

  it("should parse JSON with trailing commas", () => {
    const jsonString = `{
      "key1": "value1",
      "key2": "value2",
    }`;
    const result = parseJsonc(jsonString);
    expect(result).toEqual({ key1: "value1", key2: "value2" });
  });

  it("should parse complex JSONC", () => {
    const jsonString = `{
      // Configuration file
      "$schema": "./config-schema.json",
      "API_KEY": "test-key", // API key
      "FEATURES": ["feature1", "feature2"],
      /* Multi-line
         comment */
      "DEBUG": true,
    }`;
    const result = parseJsonc(jsonString);
    expect(result).toEqual({
      $schema: "./config-schema.json",
      API_KEY: "test-key",
      FEATURES: ["feature1", "feature2"],
      DEBUG: true,
    });
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

  it("should throw error for invalid JSON", () => {
    const invalidJson = "{ invalid json }";
    expect(() => parseJsonc(invalidJson)).toThrow();
  });
});

describe("valueToEnvVar", () => {
  it("should convert null to empty string", () => {
    expect(valueToEnvVar(null)).toBe("");
  });

  it("should convert undefined to empty string", () => {
    expect(valueToEnvVar(undefined)).toBe("");
  });

  it("should convert string values", () => {
    expect(valueToEnvVar("test")).toBe("test");
  });

  it("should convert number values", () => {
    expect(valueToEnvVar(42)).toBe("42");
  });

  it("should convert boolean values", () => {
    expect(valueToEnvVar(true)).toBe("true");
    expect(valueToEnvVar(false)).toBe("false");
  });

  it("should stringify arrays", () => {
    expect(valueToEnvVar(["a", "b", "c"])).toBe('["a","b","c"]');
  });

  it("should stringify objects within arrays", () => {
    expect(valueToEnvVar([{ name: "test" }])).toBe('[{"name":"test"}]');
  });
});

describe("configToDevVars", () => {
  it("should convert simple config to dev vars format", () => {
    const config = {
      API_KEY: "test-key",
      DEBUG: true,
      PORT: 3000,
    };
    const result = configToDevVars(config);

    expect(result).toContain("# Environment Variables");
    expect(result).toContain("# Generated from config.jsonc");
    expect(result).toContain("API_KEY=test-key");
    expect(result).toContain("DEBUG=true");
    expect(result).toContain("PORT=3000");
  });

  it("should skip $schema field", () => {
    const config = {
      $schema: "./config-schema.json",
      API_KEY: "test-key",
    };
    const result = configToDevVars(config);

    expect(result).not.toContain("$schema");
    expect(result).toContain("API_KEY=test-key");
  });

  it("should handle arrays", () => {
    const config = {
      FEATURES: ["feature1", "feature2"],
    };
    const result = configToDevVars(config);

    expect(result).toContain('FEATURES=["feature1","feature2"]');
  });

  it("should handle null values", () => {
    const config = {
      OPTIONAL_KEY: null,
    };
    const result = configToDevVars(config);

    expect(result).toContain("OPTIONAL_KEY=");
  });

  it("should add environment-specific header", () => {
    const config = { API_KEY: "test" };
    const result = configToDevVars(config, "staging");

    expect(result).toContain("# Environment Variables (staging)");
    expect(result).toContain("# Generated from config.staging.jsonc");
  });

  it("should not add environment header when no env is provided", () => {
    const config = { API_KEY: "test" };
    const result = configToDevVars(config);

    expect(result).toContain("# Environment Variables");
    expect(result).not.toContain("# Environment Variables (");
    expect(result).toContain("# Generated from config.jsonc");
  });
});

describe("validateEnvironmentName", () => {
  it("should accept valid environment names", () => {
    expect(validateEnvironmentName("staging")).toBe(true);
    expect(validateEnvironmentName("prod")).toBe(true);
    expect(validateEnvironmentName("test_env")).toBe(true);
    expect(validateEnvironmentName("test-env")).toBe(true);
    expect(validateEnvironmentName("test123")).toBe(true);
  });

  it("should reject invalid environment names", () => {
    expect(validateEnvironmentName("test.env")).toBe(false);
    expect(validateEnvironmentName("test/env")).toBe(false);
    expect(validateEnvironmentName("test env")).toBe(false);
    expect(validateEnvironmentName("test@env")).toBe(false);
    expect(validateEnvironmentName("")).toBe(false);
  });
});

describe("getFilePaths", () => {
  it("should return default paths when no env is provided", () => {
    const result = getFilePaths("/test");
    expect(result).toEqual({
      configPath: "/test/config.jsonc",
      devVarsPath: "/test/.dev.vars",
    });
  });

  it("should return example paths for env=example", () => {
    const result = getFilePaths("/test", "example");
    expect(result).toEqual({
      configPath: "/test/config.example.jsonc",
      devVarsPath: "/test/.dev.vars.example",
    });
  });

  it("should return environment-specific paths for custom env", () => {
    const result = getFilePaths("/test", "staging");
    expect(result).toEqual({
      configPath: "/test/config.staging.jsonc",
      devVarsPath: "/test/.dev.vars.staging",
    });
  });
});

describe("generateSingleDevVarsFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should handle missing config file", () => {
    const mockFs = createMockFileSystem({});

    const result = generateSingleDevVarsFile(
      "/test/config.jsonc",
      "/test/.dev.vars",
      undefined,
      mockFs,
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("config.jsonc not found");
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it("should generate dev vars file successfully", () => {
    const mockFs = createMockFileSystem({
      "/test/config.jsonc": '{"API_KEY": "test-key"}',
    });

    const result = generateSingleDevVarsFile(
      "/test/config.jsonc",
      "/test/.dev.vars",
      undefined,
      mockFs,
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain(
      "✅ Generated .dev.vars from config.jsonc",
    );
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      "/test/.dev.vars",
      expect.stringContaining("API_KEY=test-key"),
    );
  });

  it("should generate example file with env=example", () => {
    const mockFs = createMockFileSystem({
      "/test/config.example.jsonc": '{"API_KEY": "YOUR-API-KEY"}',
    });

    const result = generateSingleDevVarsFile(
      "/test/config.example.jsonc",
      "/test/.dev.vars.example",
      "example",
      mockFs,
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain(
      "✅ Generated .dev.vars.example from config.example.jsonc",
    );
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      "/test/.dev.vars.example",
      expect.stringContaining("API_KEY=YOUR-API-KEY"),
    );
  });

  it("should handle JSON parsing errors", () => {
    const mockFs = createMockFileSystem({
      "/test/config.jsonc": "invalid json",
    });

    const result = generateSingleDevVarsFile(
      "/test/config.jsonc",
      "/test/.dev.vars",
      undefined,
      mockFs,
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("❌ Error generating .dev.vars:");
  });
});

describe("generateDevVars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should validate environment names including example", () => {
    const mockFs = createMockFileSystem({});

    const result = generateDevVars("/test", "invalid.env", mockFs);

    expect(result.success).toBe(false);
    expect(result.messages).toEqual([
      "❌ Invalid environment name: invalid.env",
    ]);
  });

  it("should allow 'example' as regular environment name", () => {
    const mockFs = createMockFileSystem({
      "/test/config.example.jsonc": '{"API_KEY": "YOUR-API-KEY"}',
    });

    const result = generateDevVars("/test", "example", mockFs);

    expect(result.success).toBe(true);
    expect(result.messages[0]).toContain("✅ Generated");
  });

  it("should generate .dev.vars from config.jsonc", () => {
    const mockFs = createMockFileSystem({
      "/test/config.jsonc": '{"API_KEY": "test-key"}',
    });

    const result = generateDevVars("/test", undefined, mockFs);

    expect(result.success).toBe(true);
    expect(result.messages).toContain(
      "✅ Generated .dev.vars from config.jsonc",
    );
  });

  it("should handle missing config.jsonc", () => {
    const mockFs = createMockFileSystem({});

    const result = generateDevVars("/test", undefined, mockFs);

    expect(result.success).toBe(true);
    expect(result.messages).toContain(
      "⚠️  config.jsonc not found, skipping .dev.vars generation",
    );
  });

  it("should generate environment-specific dev vars", () => {
    const mockFs = createMockFileSystem({
      "/test/config.staging.jsonc": '{"API_KEY": "staging-key"}',
    });

    const result = generateDevVars("/test", "staging", mockFs);

    expect(result.success).toBe(true);
    expect(result.messages[0]).toContain(
      "✅ Generated .dev.vars.staging from config.staging.jsonc",
    );
  });
});
