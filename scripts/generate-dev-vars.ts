#!/usr/bin/env node
import {
  getErrorMessage,
  parseJsonc,
  parseCliArgumentsOrExit,
  parseEnvironmentCliArguments,
  reportCliResult,
  validateEnvironmentName,
} from "./utils.ts";
import type { FileSystemOperations, OperationResult } from "./utils.ts";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export { parseJsonc, validateEnvironmentName } from "./utils.ts";
export type { FileSystemOperations } from "./utils.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface GenerateDevVarsCliArguments {
  env?: string;
  help?: boolean;
}

export type GenerationResult = OperationResult;

export interface GenerationOptions {
  repositoryRoot: string;
  env?: string;
  fsOps?: FileSystemOperations;
}

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
  npm run generate-dev-vars                    # Generate .dev.vars from config.jsonc
  npm run generate-dev-vars -- --env example   # Generate .dev.vars.example from config.example.jsonc
  npm run generate-dev-vars -- --env staging   # Generate .dev.vars.staging from config.staging.jsonc
  npm run generate-dev-vars -- --env prod      # Generate .dev.vars.prod from config.prod.jsonc

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
 * Convert JSON config to .dev.vars format
 */
export function convertConfigToDevVars(
  config: Record<string, unknown>,
  environmentName?: string,
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
    if (key === "$schema") continue;

    const environmentValue = serializeEnvironmentValue(value);
    outputLines.push(`${key}=${environmentValue}`);
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
    );

    fileSystem.writeFileSync(devVarsPath, generatedDevVars);

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
