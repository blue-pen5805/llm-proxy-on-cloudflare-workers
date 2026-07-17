#!/usr/bin/env node
import {
  getErrorMessage,
  parseJsonc,
  parseCliArgsOrExit,
  parseEnvCliArgs,
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

export interface CliArgs {
  env?: string;
  help?: boolean;
}

export type GenerationResult = OperationResult;

export interface GenerationOptions {
  rootDir: string;
  env?: string;
  fsOps?: FileSystemOperations;
}

/**
 * Get file paths for given environment
 */
export function getFilePaths(
  rootDir: string,
  env?: string,
): { configPath: string; devVarsPath: string } {
  if (env) {
    return {
      configPath: path.join(rootDir, `config.${env}.jsonc`),
      devVarsPath: path.join(rootDir, `.dev.vars.${env}`),
    };
  } else {
    return {
      configPath: path.join(rootDir, "config.jsonc"),
      devVarsPath: path.join(rootDir, ".dev.vars"),
    };
  }
}

/**
 * Parse command line arguments
 */
export function parseArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const parsed = parseEnvCliArgs(argv);
  const args: CliArgs = {};
  if (parsed.env !== undefined) args.env = parsed.env;
  if (parsed.help) args.help = true;
  return args;
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
export function valueToEnvVar(value: unknown): string {
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
export function configToDevVars(
  config: Record<string, unknown>,
  env?: string,
): string {
  const lines: string[] = [];

  // Add header comment
  lines.push(`# Environment Variables${env ? ` (${env})` : ""}`);
  lines.push(`# Generated from config${env ? `.${env}` : ""}.jsonc`);
  lines.push("");

  // Skip $schema field
  for (const [key, value] of Object.entries(config)) {
    if (key === "$schema") continue;

    const envValue = valueToEnvVar(value);
    lines.push(`${key}=${envValue}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Generate a single dev vars file
 */
export function generateSingleDevVarsFile(
  configPath: string,
  devVarsPath: string,
  env: string | undefined,
  fsOps: FileSystemOperations,
): { success: boolean; message: string } {
  const configFileName = path.basename(configPath);
  const devVarsFileName = path.basename(devVarsPath);

  if (!fsOps.existsSync(configPath)) {
    return {
      success: true,
      message: `⚠️  ${configFileName} not found, skipping ${devVarsFileName} generation`,
    };
  }

  try {
    const configContent = fsOps.readFileSync(configPath, "utf8");
    const config = parseJsonc(configContent);

    const devVarsContent = configToDevVars(config, env);

    fsOps.writeFileSync(devVarsPath, devVarsContent);

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
  rootDir: string,
  env?: string,
  fsOps: FileSystemOperations = fs,
): GenerationResult {
  // Validate environment name if provided
  if (env && !validateEnvironmentName(env)) {
    return {
      success: false,
      messages: [`❌ Invalid environment name: ${env}`],
    };
  }

  const { configPath, devVarsPath } = getFilePaths(rootDir, env);

  const result = generateSingleDevVarsFile(configPath, devVarsPath, env, fsOps);

  return {
    success: result.success,
    messages: [result.message],
  };
}

/**
 * Main function to generate .dev.vars files
 */
export function main(): void {
  const args = parseCliArgsOrExit(() => parseArgs());

  if (args.help) {
    console.log(showHelp());
    return;
  }

  const rootDir = path.resolve(__dirname, "..");
  const env = args.env;

  console.log(
    `🔄 Generating .dev.vars files${env ? ` for environment: ${env}` : ""}...`,
  );

  const result = generateDevVars(rootDir, env);

  reportCliResult(result, "🎉 Dev vars generation completed!");
}

// Run the script if called directly
/* istanbul ignore next -- exercised by the runtime, not module tests */
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
