#!/usr/bin/env node
import {
  getErrorMessage,
  parseCliArgumentsOrExit,
  parseEnvironmentCliArguments,
  parseJsonc,
  reportCliResult,
  validateEnvironmentName,
} from "./utils.ts";
import type { FileSystemOperations, OperationResult } from "./utils.ts";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export { parseJsonc, validateEnvironmentName } from "./utils.ts";
export type { FileSystemOperations } from "./utils.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DeploySecretsCliArguments {
  env?: string;
  dryRun?: boolean;
  help?: boolean;
}

export type DeployResult = OperationResult;

/**
 * Get config file path for given environment
 */
export function getConfigPath(
  repositoryRoot: string,
  environmentName?: string,
): string {
  if (environmentName) {
    return path.join(repositoryRoot, `config.${environmentName}.jsonc`);
  } else {
    return path.join(repositoryRoot, "config.jsonc");
  }
}

/**
 * Parse command line arguments
 */
export function parseDeploySecretsArguments(
  commandLineArguments: string[] = process.argv.slice(2),
): DeploySecretsCliArguments {
  const commonArguments = parseEnvironmentCliArguments(commandLineArguments, [
    "--dry-run",
  ]);
  const deployArguments: DeploySecretsCliArguments = {};
  if (commonArguments.env !== undefined)
    deployArguments.env = commonArguments.env;
  if (commonArguments.flags.has("--dry-run")) deployArguments.dryRun = true;
  if (commonArguments.help) deployArguments.help = true;
  return deployArguments;
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
export function serializeSecretValue(value: unknown): string {
  // Check for null, undefined, or empty string
  if (value === null || value === undefined || value === "") {
    return "";
  }

  // Preserve structured secrets such as service-account JSON.
  if (typeof value === "object") {
    if (Object.keys(value).length === 0) {
      return "";
    }
    return JSON.stringify(value);
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

    const secretValue = serializeSecretValue(value);
    if (secretValue !== "") {
      secrets[key] = secretValue;
    }
  }

  return secrets;
}

/**
 * Generate secrets JSON for wrangler secret bulk
 */
export function serializeSecretsJson(secrets: Record<string, string>): string {
  return JSON.stringify(secrets, null, 2);
}

/**
 * Execute wrangler secret bulk command
 */
export function executeWranglerSecretBulk(
  secretsJson: string,
  environmentName?: string,
  isDryRun: boolean = false,
): { success: boolean; message: string } {
  try {
    // Create temporary file for secrets
    const tempFilePath = path.join(process.cwd(), ".secrets-temp.json");
    fs.writeFileSync(tempFilePath, secretsJson);

    // Build wrangler command
    let wranglerCommand = `wrangler secret bulk "${tempFilePath}"`;
    if (environmentName) {
      wranglerCommand += ` --env ${environmentName}`;
    }

    if (isDryRun) {
      // Clean up temp file
      fs.unlinkSync(tempFilePath);
      return {
        success: true,
        message: `🔍 Dry run - would execute: ${wranglerCommand}`,
      };
    }

    // Execute the command
    console.log(`🚀 Executing: ${wranglerCommand}`);
    execSync(wranglerCommand, { stdio: "inherit" });

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
  repositoryRoot: string,
  environmentName?: string,
  isDryRun: boolean = false,
  fileSystem: FileSystemOperations = fs,
): DeployResult {
  // Validate environment name if provided
  if (environmentName && !validateEnvironmentName(environmentName)) {
    return {
      success: false,
      messages: [`❌ Invalid environment name: ${environmentName}`],
    };
  }

  const configPath = getConfigPath(repositoryRoot, environmentName);
  const configFileName = path.basename(configPath);

  if (!fileSystem.existsSync(configPath)) {
    return {
      success: false,
      messages: [`❌ ${configFileName} not found`],
    };
  }

  try {
    const configFileContent = fileSystem.readFileSync(configPath, "utf8");
    const parsedConfig = parseJsonc(configFileContent);

    const deployableSecrets = filterSecretsForDeployment(parsedConfig);
    const secretCount = Object.keys(deployableSecrets).length;

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
    Object.keys(deployableSecrets).forEach((secretName) => {
      const secretValue = deployableSecrets[secretName];
      const maskedDisplayValue =
        secretValue.length > 20
          ? `${secretValue.substring(0, 20)}...`
          : secretValue;
      messages.push(`   - ${secretName}: ${maskedDisplayValue}`);
    });

    if (environmentName) {
      messages.push(`🎯 Target environment: ${environmentName}`);
    }

    const secretsJson = serializeSecretsJson(deployableSecrets);

    if (isDryRun) {
      messages.push("");
      messages.push("🔍 Dry run mode - JSON that would be deployed:");
      messages.push(secretsJson);
    }

    const deploymentResult = executeWranglerSecretBulk(
      secretsJson,
      environmentName,
      isDryRun,
    );
    messages.push(deploymentResult.message);

    return {
      success: deploymentResult.success,
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
export function runDeploySecretsCli(): void {
  const deployArguments = parseCliArgumentsOrExit(() =>
    parseDeploySecretsArguments(),
  );

  if (deployArguments.help) {
    console.log(showHelp());
    return;
  }

  const repositoryRoot = path.resolve(__dirname, "..");
  const { env: environmentName, dryRun: isDryRun = false } = deployArguments;

  console.log(
    `🔐 Deploying secrets${environmentName ? ` from config.${environmentName}.jsonc to ${environmentName} environment` : " from config.jsonc to default environment"}${isDryRun ? " (dry run)" : ""}...`,
  );

  const deploymentResult = deploySecrets(
    repositoryRoot,
    environmentName,
    isDryRun,
  );

  reportCliResult(
    deploymentResult,
    isDryRun ? undefined : "🎉 Secret deployment completed!",
  );
}

// Run the script if called directly
/* istanbul ignore next -- exercised by the runtime, not module tests */
if (import.meta.url === `file://${process.argv[1]}`) {
  runDeploySecretsCli();
}
