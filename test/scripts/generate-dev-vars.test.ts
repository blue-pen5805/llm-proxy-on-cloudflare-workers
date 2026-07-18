import {
  convertConfigToDevVars,
  generateDevVars,
  generateSingleDevVarsFile,
  getConfigAndDevVarsPaths,
  runGenerateDevVarsCli,
  parseGenerateDevVarsArguments,
  parseJsonc,
  quoteEnvironmentValueForDotenv,
  showHelp,
  validateEnvironmentName,
  serializeEnvironmentValue,
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
    chmodSync: vi.fn(),
  };
  return mockFs;
};

describe("parseGenerateDevVarsArguments", () => {
  it("should parse empty arguments", () => {
    const result = parseGenerateDevVarsArguments([]);
    expect(result).toEqual({});
  });

  it("should parse --env argument", () => {
    const result = parseGenerateDevVarsArguments(["--env", "staging"]);
    expect(result).toEqual({ env: "staging" });
  });

  it("should parse --help argument", () => {
    const result = parseGenerateDevVarsArguments(["--help"]);
    expect(result).toEqual({ help: true });
  });

  it("should parse -h argument", () => {
    const result = parseGenerateDevVarsArguments(["-h"]);
    expect(result).toEqual({ help: true });
  });

  it("should parse multiple arguments", () => {
    const result = parseGenerateDevVarsArguments(["--env", "prod", "--help"]);
    expect(result).toEqual({ env: "prod", help: true });
  });

  it("should throw error for unknown options", () => {
    expect(() => parseGenerateDevVarsArguments(["--invalid"])).toThrow(
      "Unknown option: --invalid",
    );
    expect(() => parseGenerateDevVarsArguments(["--unknown", "value"])).toThrow(
      "Unknown option: --unknown",
    );
  });

  it("should throw error for unexpected arguments", () => {
    expect(() => parseGenerateDevVarsArguments(["somearg"])).toThrow(
      "Unexpected argument: somearg",
    );
    expect(() => parseGenerateDevVarsArguments(["arg1", "arg2"])).toThrow(
      "Unexpected argument: arg1",
    );
  });

  it("should throw error for --env without value", () => {
    expect(() => parseGenerateDevVarsArguments(["--env"])).toThrow(
      "--env option requires a value",
    );
    expect(() => parseGenerateDevVarsArguments(["--env", "--help"])).toThrow(
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

describe("serializeEnvironmentValue", () => {
  it("should convert null to empty string", () => {
    expect(serializeEnvironmentValue(null)).toBe("");
  });

  it("should convert undefined to empty string", () => {
    expect(serializeEnvironmentValue(undefined)).toBe("");
  });

  it("should convert string values", () => {
    expect(serializeEnvironmentValue("test")).toBe("test");
  });

  it("should convert number values", () => {
    expect(serializeEnvironmentValue(42)).toBe("42");
  });

  it("should convert boolean values", () => {
    expect(serializeEnvironmentValue(true)).toBe("true");
    expect(serializeEnvironmentValue(false)).toBe("false");
  });

  it("should stringify arrays", () => {
    expect(serializeEnvironmentValue(["a", "b", "c"])).toBe('["a","b","c"]');
  });

  it("should stringify objects within arrays", () => {
    expect(serializeEnvironmentValue([{ name: "test" }])).toBe(
      '[{"name":"test"}]',
    );
  });

  it("should stringify object secrets", () => {
    expect(
      serializeEnvironmentValue({
        type: "service_account",
        region: "us-central1",
      }),
    ).toBe('{"type":"service_account","region":"us-central1"}');
  });
});

describe("convertConfigToDevVars", () => {
  it("should convert simple config to dev vars format", () => {
    const config = {
      API_KEY: "test-key",
      DEBUG: true,
      PORT: 3000,
    };
    const result = convertConfigToDevVars(config);

    expect(result).toContain("# Environment Variables");
    expect(result).toContain("# Generated from config.jsonc");
    expect(result).toContain("API_KEY='test-key'");
    expect(result).toContain("DEBUG='true'");
    expect(result).toContain("PORT='3000'");
  });

  it("should skip $schema field", () => {
    const config = {
      $schema: "./config-schema.json",
      API_KEY: "test-key",
    };
    const result = convertConfigToDevVars(config);

    expect(result).not.toContain("$schema");
    expect(result).toContain("API_KEY='test-key'");
  });

  it("should handle arrays", () => {
    const config = {
      FEATURES: ["feature1", "feature2"],
    };
    const result = convertConfigToDevVars(config);

    expect(result).toContain(`FEATURES='["feature1","feature2"]'`);
  });

  it("omits null and undefined values", () => {
    const config = {
      OPTIONAL_KEY: null,
      MISSING_KEY: undefined,
      PRESENT_KEY: "configured",
    };
    const result = convertConfigToDevVars(config);

    expect(result).not.toContain("OPTIONAL_KEY=");
    expect(result).not.toContain("MISSING_KEY=");
    expect(result).toContain("PRESENT_KEY='configured'");
  });

  it("includes null placeholders only for Wrangler type generation", () => {
    const result = convertConfigToDevVars(
      { OPTIONAL_KEY: null, MISSING_KEY: undefined },
      "example",
      true,
    );

    expect(result).toContain("OPTIONAL_KEY=''");
    expect(result).not.toContain("MISSING_KEY=");
  });

  it("should add environment-specific header", () => {
    const config = { API_KEY: "test" };
    const result = convertConfigToDevVars(config, "staging");

    expect(result).toContain("# Environment Variables (staging)");
    expect(result).toContain("# Generated from config.staging.jsonc");
  });

  it("should not add environment header when no env is provided", () => {
    const config = { API_KEY: "test" };
    const result = convertConfigToDevVars(config);

    expect(result).toContain("# Environment Variables");
    expect(result).not.toContain("# Environment Variables (");
    expect(result).toContain("# Generated from config.jsonc");
  });

  it("escapes newlines so values cannot inject additional variables", () => {
    const result = convertConfigToDevVars({
      API_KEY: "safe\nDEV=true",
    });

    expect(result).toContain('API_KEY="safe\\nDEV=true"');
    expect(result).not.toContain("\nDEV=true\n");
  });
});

describe("quoteEnvironmentValueForDotenv", () => {
  // This mirrors the relevant behavior of the dotenv parser bundled with
  // Wrangler: surrounding quotes are removed, but escaped double quotes are
  // not JSON-decoded.
  function parseWranglerDotenvValue(serializedValue: string): string {
    const quote = serializedValue[0];
    let parsed =
      quote && quote === serializedValue.at(-1)
        ? serializedValue.slice(1, -1)
        : serializedValue;
    if (quote === '"') {
      parsed = parsed.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    }
    return parsed;
  }

  it("round-trips JSON arrays without leaving escaped quotes in API keys", () => {
    const value = '["first-key","second-key"]';
    const serialized = quoteEnvironmentValueForDotenv(value);

    expect(serialized).toBe(`'["first-key","second-key"]'`);
    expect(parseWranglerDotenvValue(serialized)).toBe(value);
    expect(JSON.parse(parseWranglerDotenvValue(serialized))).toEqual([
      "first-key",
      "second-key",
    ]);
  });

  it("uses backticks when a value contains a single quote", () => {
    const value = "key-with-'quote";
    const serialized = quoteEnvironmentValueForDotenv(value);

    expect(serialized).toBe("`key-with-'quote`");
    expect(parseWranglerDotenvValue(serialized)).toBe(value);
  });

  it("round-trips embedded newlines without creating a new variable line", () => {
    const value = "safe\nDEV=true";
    const serialized = quoteEnvironmentValueForDotenv(value);

    expect(serialized).toBe('"safe\\nDEV=true"');
    expect(serialized).not.toContain("\nDEV=true");
    expect(parseWranglerDotenvValue(serialized)).toBe(value);
  });

  it("uses the remaining lossless dotenv representations", () => {
    expect(quoteEnvironmentValueForDotenv("both-'and-`quotes")).toBe(
      "both-'and-`quotes",
    );
    expect(quoteEnvironmentValueForDotenv(" both-'and-`quotes ")).toBe(
      '" both-\'and-`quotes "',
    );
    expect(() =>
      quoteEnvironmentValueForDotenv(" both-'and-`and-\"quotes "),
    ).toThrow("cannot be represented losslessly");
    expect(() =>
      quoteEnvironmentValueForDotenv(" both-'and-`quotes\\n "),
    ).toThrow("cannot be represented losslessly");
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

describe("getConfigAndDevVarsPaths", () => {
  it("should return default paths when no env is provided", () => {
    const result = getConfigAndDevVarsPaths("/test");
    expect(result).toEqual({
      configPath: "/test/config.jsonc",
      devVarsPath: "/test/.dev.vars",
    });
  });

  it("should return example paths for env=example", () => {
    const result = getConfigAndDevVarsPaths("/test", "example");
    expect(result).toEqual({
      configPath: "/test/config.example.jsonc",
      devVarsPath: "/test/.dev.vars.example",
    });
  });

  it("should return environment-specific paths for custom env", () => {
    const result = getConfigAndDevVarsPaths("/test", "staging");
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
      expect.stringContaining("API_KEY='test-key'"),
      { mode: 0o600 },
    );
    expect(mockFs.chmodSync).toHaveBeenCalledWith("/test/.dev.vars", 0o600);
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
      expect.stringContaining("API_KEY='YOUR-API-KEY'"),
      { mode: 0o600 },
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

describe("runGenerateDevVarsCli", () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it("prints help and returns", () => {
    process.argv = ["node", "generate-dev-vars.ts", "--help"];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    runGenerateDevVarsCli();

    expect(log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
  });

  it("reports invalid arguments", () => {
    process.argv = ["node", "generate-dev-vars.ts", "--bad"];
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exited");
    }) as never);

    expect(() => runGenerateDevVarsCli()).toThrow("exited");
    expect(error).toHaveBeenCalledWith("❌ Error: Unknown option: --bad");
    expect(error).toHaveBeenCalledWith(
      "Use --help or -h for usage information.",
    );
  });

  it("runs default generation", () => {
    process.argv = ["node", "generate-dev-vars.ts"];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    runGenerateDevVarsCli();

    expect(log).toHaveBeenCalledWith("🔄 Generating .dev.vars files...");
    expect(log).toHaveBeenCalledWith("🎉 Dev vars generation completed!");
  });

  it("exits when generation fails", () => {
    process.argv = ["node", "generate-dev-vars.ts", "--env", "invalid.env"];
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    runGenerateDevVarsCli();

    expect(exit).toHaveBeenCalledWith(1);
  });
});
