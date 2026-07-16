#!/usr/bin/env node
import {
  getErrorMessage,
  parseJsonc,
  validateEnvironmentName,
} from "./utils.ts";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export { parseJsonc, validateEnvironmentName } from "./utils.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CliArgs {
  env?: string;
  dryRun?: boolean;
  help?: boolean;
}

export interface FileSystemOperations {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: BufferEncoding) => string;
  writeFileSync: (path: string, data: string) => void;
}

export interface DeployResult {
  success: boolean;
  messages: string[];
}

/**
 * Get config file path for given environment
 */
export function getConfigPath(rootDir: string, env?: string): string {
  if (env) {
    return path.join(rootDir, `config.${env}.jsonc`);
  } else {
    return path.join(rootDir, "config.jsonc");
  }
}

/**
 * Parse command line arguments
 */
export function parseArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const args: CliArgs = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--env") {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("-")) {
        throw new Error("--env option requires a value");
      }
      args.env = argv[i + 1];
      i++; // Skip next argument as it's the value
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return args;
}

/**
 * Show help message
 */
export function showHelp(): string {
  return `
Usage: secrets:deploy [options]

Options:
  --env <name>          Specify environment name for both config file and wrangler deployment
                        - No env: Use config.jsonc and deploy to default environment
                        - With env: Use config.<env>.jsonc and deploy to <env> environment
  --dry-run             Show what would be deployed without executing
  --help, -h            Show this help message

Examples:
  npm run secrets:deploy                      # Deploy from config.jsonc to default environment
  npm run secrets:deploy -- --env example    # Deploy from config.example.jsonc to example environment
  npm run secrets:deploy -- --env production # Deploy from config.production.jsonc to production environment
  npm run secrets:deploy -- --dry-run        # Show what would be deployed

Note: This script deploys secrets to Cloudflare Workers using 'wrangler secret bulk'.
Make sure you have authenticated with Wrangler before running this script.
`;
}

/**
 * Convert a value to secret format
 */
export function valueToSecret(value: unknown): string {
  // Check for null, undefined, or empty string
  if (value === null || value === undefined || value === "") {
    return "";
  }

  // Check for empty arrays
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "";
    }
    // For arrays, stringify the entire array
    return JSON.stringify(value);
  }

  // Check for empty objects
  if (typeof value === "object" && Object.keys(value).length === 0) {
    return "";
  }

  // Convert to string and check if it's just whitespace
  const stringValue = String(value).trim();
  if (stringValue === "") {
    return "";
  }

  return stringValue;
}

/**
 * Filter secrets that should be deployed
 */
export function filterSecretsForDeployment(
  config: Record<string, unknown>,
): Record<string, string> {
  const secrets: Record<string, string> = {};

  // Skip $schema field and empty values
  for (const [key, value] of Object.entries(config)) {
    if (key === "$schema") continue;

    const secretValue = valueToSecret(value);
    if (secretValue !== "") {
      secrets[key] = secretValue;
    }
  }

  return secrets;
}

/**
 * Generate secrets JSON for wrangler secret bulk
 */
export function generateSecretsJson(secrets: Record<string, string>): string {
  return JSON.stringify(secrets, null, 2);
}

/**
 * Execute wrangler secret bulk command
 */
export function executeWranglerSecretBulk(
  secretsJson: string,
  env?: string,
  dryRun: boolean = false,
): { success: boolean; message: string } {
  try {
    // Create temporary file for secrets
    const tempFilePath = path.join(process.cwd(), ".secrets-temp.json");
    fs.writeFileSync(tempFilePath, secretsJson);

    // Build wrangler command
    let command = `wrangler secret bulk "${tempFilePath}"`;
    if (env) {
      command += ` --env ${env}`;
    }

    if (dryRun) {
      // Clean up temp file
      fs.unlinkSync(tempFilePath);
      return {
        success: true,
        message: `🔍 Dry run - would execute: ${command}`,
      };
    }

    // Execute the command
    console.log(`🚀 Executing: ${command}`);
    execSync(command, { stdio: "inherit" });

    // Clean up temp file
    fs.unlinkSync(tempFilePath);

    return {
      success: true,
      message: "✅ Secrets deployed successfully",
    };
  } catch (error) {
    // Clean up temp file if it exists
    const tempFilePath = path.join(process.cwd(), ".secrets-temp.json");
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    const errorMessage = getErrorMessage(error);
    return {
      success: false,
      message: `❌ Error deploying secrets: ${errorMessage}`,
    };
  }
}

/**
 * Deploy secrets based on configuration
 */
export function deploySecrets(
  rootDir: string,
  env?: string,
  dryRun: boolean = false,
  fsOps: FileSystemOperations = fs,
): DeployResult {
  // Validate environment name if provided
  if (env && !validateEnvironmentName(env)) {
    return {
      success: false,
      messages: [`❌ Invalid environment name: ${env}`],
    };
  }

  const configPath = getConfigPath(rootDir, env);
  const configFileName = path.basename(configPath);

  if (!fsOps.existsSync(configPath)) {
    return {
      success: false,
      messages: [`❌ ${configFileName} not found`],
    };
  }

  try {
    const configContent = fsOps.readFileSync(configPath, "utf8");
    const config = parseJsonc(configContent);

    const secrets = filterSecretsForDeployment(config);
    const secretCount = Object.keys(secrets).length;

    if (secretCount === 0) {
      return {
        success: true,
        messages: [`⚠️  No secrets with values found in ${configFileName}`],
      };
    }

    const messages: string[] = [];
    messages.push(
      `📋 Found ${secretCount} secrets to deploy from ${configFileName}:`,
    );

    // List secrets (but don't show values for security)
    Object.keys(secrets).forEach((key) => {
      const value = secrets[key];
      const displayValue =
        value.length > 20 ? `${value.substring(0, 20)}...` : value;
      messages.push(`   - ${key}: ${displayValue}`);
    });

    if (env) {
      messages.push(`🎯 Target environment: ${env}`);
    }

    const secretsJson = generateSecretsJson(secrets);

    if (dryRun) {
      messages.push("");
      messages.push("🔍 Dry run mode - JSON that would be deployed:");
      messages.push(secretsJson);
    }

    const result = executeWranglerSecretBulk(secretsJson, env, dryRun);
    messages.push(result.message);

    return {
      success: result.success,
      messages,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return {
      success: false,
      messages: [`❌ Error processing ${configFileName}: ${errorMessage}`],
    };
  }
}

/**
 * Main function to deploy secrets
 */
export function main(): void {
  let args: CliArgs;

  try {
    args = parseArgs();
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error(`❌ Error: ${errorMessage}`);
    console.error("Use --help or -h for usage information.");
    process.exit(1);
  }

  if (args.help) {
    console.log(showHelp());
    return;
  }

  const rootDir = path.resolve(__dirname, "..");
  const { env, dryRun = false } = args;

  console.log(
    `🔐 Deploying secrets${env ? ` from config.${env}.jsonc to ${env} environment` : " from config.jsonc to default environment"}${dryRun ? " (dry run)" : ""}...`,
  );

  const result = deploySecrets(rootDir, env, dryRun);

  result.messages.forEach((message) => console.log(message));

  if (result.success) {
    if (!dryRun) {
      console.log("🎉 Secret deployment completed!");
    }
  } else {
    process.exit(1);
  }
}

// Run the script if called directly
/* istanbul ignore next -- exercised by the runtime, not module tests */
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
