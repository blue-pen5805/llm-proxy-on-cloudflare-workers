#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  getErrorMessage,
  parseJsonc,
  parseCliArgumentsOrExit,
  parseEnvironmentCliArguments,
  reportCliResult,
  validateEnvironmentName,
} from "./utils.ts";
import type { FileSystemOperations, OperationResult } from "./utils.ts";

export type { FileSystemOperations } from "./utils.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface GenerateDevVarsCliArguments {
  env?: string;
  help?: boolean;
}

export type GenerationResult = OperationResult;

/**
 * Get file paths for given environment
 */
export function getConfigAndDevVarsPaths(
  repositoryRoot: string,
  environmentName?: string,
): { configPath: string; devVarsPath: string } {
  if (environmentName) {
    return {
      configPath: path.join(repositoryRoot, `config.${environmentName}.jsonc`),
      devVarsPath: path.join(repositoryRoot, `.dev.vars.${environmentName}`),
    };
  } else {
    return {
      configPath: path.join(repositoryRoot, "config.jsonc"),
      devVarsPath: path.join(repositoryRoot, ".dev.vars"),
    };
  }
}

/**
 * Parse command line arguments
 */
export function parseGenerateDevVarsArguments(
  commandLineArguments: string[] = process.argv.slice(2),
): GenerateDevVarsCliArguments {
  const commonArguments = parseEnvironmentCliArguments(commandLineArguments);
  const generationArguments: GenerateDevVarsCliArguments = {};
  if (commonArguments.env !== undefined) {
    generationArguments.env = commonArguments.env;
  }
  if (commonArguments.help) generationArguments.help = true;
  return generationArguments;
}

/**
 * Show help message
 */
export function showHelp(): string {
  return `
Usage: generate-dev-vars [options]

Options:
  --env <name>    Specify environment name
                  - No env: Generate .dev.vars from config.jsonc
                  - With env: Generate .dev.vars.<env> from config.<env>.jsonc
  --help, -h      Show this help message

Examples:
  npx tsx scripts/generate-dev-vars.ts                    # Generate .dev.vars from config.jsonc
  npx tsx scripts/generate-dev-vars.ts -- --env example   # Generate .dev.vars.example from config.example.jsonc
  npx tsx scripts/generate-dev-vars.ts -- --env staging   # Generate .dev.vars.staging from config.staging.jsonc
  npx tsx scripts/generate-dev-vars.ts -- --env prod      # Generate .dev.vars.prod from config.prod.jsonc

Note: .dev.vars files contain sensitive authentication credentials for development environments.
`;
}

/**
 * Convert a value to environment variable format
 */
export function serializeEnvironmentValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    // Structured secrets (including service-account JSON) must remain JSON.
    return JSON.stringify(value);
  }

  return String(value);
}

/**
 * Quote a value so Wrangler's dotenv parser returns it byte-for-byte.
 *
 * In particular, double-quoted dotenv values do not JSON-unescape `\"`.
 * Using JSON.stringify() around JSON arrays therefore leaves backslashes in
 * API keys at runtime. Single quotes (or backticks when needed) preserve JSON
 * strings without adding those escapes.
 */
export function quoteEnvironmentValueForDotenv(value: string): string {
  // Keep physical newlines out of the generated file when double quotes can
  // represent them without changing an existing literal "\\n"/"\\r".
  if (/[\r\n]/.test(value) && !value.includes('"') && !/\\[nr]/.test(value)) {
    return `"${value.replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
  }

  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes("`")) {
    return `\`${value}\``;
  }

  // An unquoted dotenv value is exact only when comment parsing and trimming
  // cannot alter it.
  if (value === value.trim() && !/[#\r\n]/.test(value)) {
    return value;
  }

  // Double quotes are the final quoted form. Wrangler translates literal
  // "\\n" and "\\r" sequences in this form, so reject values that would be
  // silently changed.
  if (!value.includes('"') && !/\\[nr]/.test(value)) {
    return `"${value}"`;
  }

  throw new Error(
    "Environment value cannot be represented losslessly in dotenv format.",
  );
}

/**
 * Convert JSON config to .dev.vars format
 */
export function convertConfigToDevVars(
  config: Record<string, unknown>,
  environmentName?: string,
  includeNullPlaceholders: boolean = false,
): string {
  const outputLines: string[] = [];

  // Add header comment
  outputLines.push(
    `# Environment Variables${environmentName ? ` (${environmentName})` : ""}`,
  );
  outputLines.push(
    `# Generated from config${environmentName ? `.${environmentName}` : ""}.jsonc`,
  );
  outputLines.push("");

  // Skip $schema field
  for (const [key, value] of Object.entries(config)) {
    if (key === "$schema" || value === undefined) continue;
    if (value === null && !includeNullPlaceholders) continue;

    const environmentValue = serializeEnvironmentValue(value);
    outputLines.push(
      `${key}=${quoteEnvironmentValueForDotenv(environmentValue)}`,
    );
  }

  return outputLines.join("\n") + "\n";
}

/**
 * Generate a single dev vars file
 */
export function generateSingleDevVarsFile(
  configPath: string,
  devVarsPath: string,
  environmentName: string | undefined,
  fileSystem: FileSystemOperations,
  includeNullPlaceholders: boolean = false,
): { success: boolean; message: string } {
  const configFileName = path.basename(configPath);
  const devVarsFileName = path.basename(devVarsPath);

  if (!fileSystem.existsSync(configPath)) {
    return {
      success: true,
      message: `⚠️  ${configFileName} not found, skipping ${devVarsFileName} generation`,
    };
  }

  try {
    const configFileContent = fileSystem.readFileSync(configPath, "utf8");
    const parsedConfig = parseJsonc(configFileContent);

    const generatedDevVars = convertConfigToDevVars(
      parsedConfig,
      environmentName,
      includeNullPlaceholders,
    );

    fileSystem.writeFileSync(devVarsPath, generatedDevVars, { mode: 0o600 });
    fileSystem.chmodSync?.(devVarsPath, 0o600);

    return {
      success: true,
      message: `✅ Generated ${devVarsFileName} from ${configFileName}`,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return {
      success: false,
      message: `❌ Error generating ${devVarsFileName}: ${errorMessage}`,
    };
  }
}

/**
 * Generate dev vars files based on configuration
 */
export function generateDevVars(
  repositoryRoot: string,
  environmentName?: string,
  fileSystem: FileSystemOperations = fs,
  includeNullPlaceholders: boolean = false,
): GenerationResult {
  // Validate environment name if provided
  if (environmentName && !validateEnvironmentName(environmentName)) {
    return {
      success: false,
      messages: [`❌ Invalid environment name: ${environmentName}`],
    };
  }

  const { configPath, devVarsPath } = getConfigAndDevVarsPaths(
    repositoryRoot,
    environmentName,
  );

  const generationResult = generateSingleDevVarsFile(
    configPath,
    devVarsPath,
    environmentName,
    fileSystem,
    includeNullPlaceholders,
  );

  return {
    success: generationResult.success,
    messages: [generationResult.message],
  };
}

/**
 * Main function to generate .dev.vars files
 */
export function runGenerateDevVarsCli(): void {
  const generationArguments = parseCliArgumentsOrExit(() =>
    parseGenerateDevVarsArguments(),
  );

  if (generationArguments.help) {
    console.log(showHelp());
    return;
  }

  const repositoryRoot = path.resolve(__dirname, "..");
  const environmentName = generationArguments.env;

  console.log(
    `🔄 Generating .dev.vars files${environmentName ? ` for environment: ${environmentName}` : ""}...`,
  );

  const generationResult = generateDevVars(repositoryRoot, environmentName);

  reportCliResult(generationResult, "🎉 Dev vars generation completed!");
}

// Run the script if called directly
/* istanbul ignore next -- exercised by the runtime, not module tests */
if (import.meta.url === `file://${process.argv[1]}`) {
  runGenerateDevVarsCli();
}
