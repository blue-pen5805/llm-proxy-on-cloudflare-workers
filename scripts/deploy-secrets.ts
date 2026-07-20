#!/usr/bin/env node
import { syncAiGatewayCustomProviders } from "./sync-ai-gateway-custom-providers.ts";
import {
  getErrorMessage,
  parseCliArgumentsOrExit,
  parseEnvironmentCliArguments,
  parseJsonc,
  reportCliResult,
  validateEnvironmentName,
} from "./utils.ts";
import type { FileSystemOperations, OperationResult } from "./utils.ts";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
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
export type SecretOperationValue = string | null;

// Cloudflare limits each Worker environment variable/secret to 5 KiB.
export const MAX_WORKER_SECRET_BYTES = 5 * 1024;

// Development-only keys are never deployed. DEV enables the authentication
// bypass and must exist only in local `npm run dev` (.dev.vars); a deployed
// Worker therefore has no DEV binding and always runs authenticated.
export const DEVELOPMENT_ONLY_KEYS = new Set(["DEV"]);
export const DEPRECATED_CONFIG_KEYS = new Set(["ENABLE_GLOBAL_ROUND_ROBIN"]);

function deprecatedConfigWarnings(config: Record<string, unknown>): string[] {
  return [...DEPRECATED_CONFIG_KEYS]
    .filter((key) => Object.prototype.hasOwnProperty.call(config, key))
    .map(
      (key) =>
        `⚠️  WARNING: ${key} is deprecated and ignored; multi-key rotation is always enabled. Remove it from the configuration file.`,
    );
}

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
export function serializeSecretValue(value: unknown): SecretOperationValue {
  // In Wrangler's JSON bulk format, null is an explicit delete operation.
  if (value === null) {
    return null;
  }

  if (value === undefined || value === "") {
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
): Record<string, SecretOperationValue> {
  const secrets: Record<string, SecretOperationValue> = {};

  // Skip metadata, local-only settings, deprecated compatibility inputs, and
  // empty values. Preserve null as an explicit deletion.
  for (const [key, value] of Object.entries(config)) {
    if (
      key === "$schema" ||
      DEVELOPMENT_ONLY_KEYS.has(key) ||
      DEPRECATED_CONFIG_KEYS.has(key)
    )
      continue;

    const secretValue = serializeSecretValue(value);
    if (secretValue === "") continue;

    if (
      secretValue !== null &&
      Buffer.byteLength(secretValue, "utf8") > MAX_WORKER_SECRET_BYTES
    ) {
      throw new Error(
        `${key} exceeds Cloudflare's ${MAX_WORKER_SECRET_BYTES}-byte secret limit.`,
      );
    }

    secrets[key] = secretValue;
  }

  return secrets;
}

/**
 * Generate secrets JSON for wrangler secret bulk
 */
export function serializeSecretsJson(
  secrets: Record<string, SecretOperationValue>,
): string {
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
  const tempFilePath = path.join(
    process.cwd(),
    `.secrets-temp-${randomUUID()}.json`,
  );
  try {
    const wranglerArguments = ["secret", "bulk", tempFilePath];
    if (environmentName) wranglerArguments.push("--env", environmentName);
    const commandDisplay = `wrangler ${wranglerArguments.join(" ")}`;

    if (isDryRun) {
      return {
        success: true,
        message: `🔍 Dry run - would execute: ${commandDisplay}`,
      };
    }

    // Exclusive creation prevents a symlink or concurrent process from being
    // overwritten. Owner-only permissions protect the short-lived plaintext.
    fs.writeFileSync(tempFilePath, secretsJson, { flag: "wx", mode: 0o600 });
    console.log(`🚀 Executing: ${commandDisplay}`);
    execFileSync("wrangler", wranglerArguments, { stdio: "inherit" });

    // Clean up temp file
    fs.unlinkSync(tempFilePath);

    return {
      success: true,
      message: "✅ Secrets deployed successfully",
    };
  } catch (error) {
    // Clean up temp file if it exists
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
    const warnings = deprecatedConfigWarnings(parsedConfig);

    const deployableSecrets = filterSecretsForDeployment(parsedConfig);
    const secretCount = Object.keys(deployableSecrets).length;

    if (secretCount === 0) {
      return {
        success: true,
        messages: [
          ...warnings,
          `⚠️  No secret operations found in ${configFileName}`,
        ],
      };
    }

    const messages: string[] = [...warnings];
    messages.push(
      `📋 Found ${secretCount} secrets to deploy from ${configFileName}:`,
    );

    // List names only. Prefixes, lengths, and dry-run JSON are still secret
    // material and commonly end up in terminal scrollback or CI logs.
    Object.entries(deployableSecrets).forEach(([secretName, secretValue]) => {
      messages.push(
        `   - ${secretName}: ${secretValue === null ? "[delete]" : "[set]"}`,
      );
    });

    if (environmentName) {
      messages.push(`🎯 Target environment: ${environmentName}`);
    }

    const secretsJson = serializeSecretsJson(deployableSecrets);

    if (isDryRun) {
      messages.push("");
      messages.push("🔍 Dry run mode - values are intentionally redacted.");
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
export async function runDeploySecretsCli(): Promise<void> {
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

  const configPath = getConfigPath(repositoryRoot, environmentName);
  if (fs.existsSync(configPath)) {
    try {
      const config = parseJsonc(fs.readFileSync(configPath, "utf8"));
      const syncResult = await syncAiGatewayCustomProviders(config, isDryRun);
      if (syncResult.enabled) {
        console.log(
          syncResult.dryRun
            ? `☁️  AI Gateway Custom Providers: ${syncResult.desired} definitions would be reconciled.`
            : `☁️  AI Gateway Custom Providers: ${syncResult.created} created, ${syncResult.updated} updated, ${syncResult.unchanged} unchanged.`,
        );
      }
    } catch (error) {
      reportCliResult({
        success: false,
        messages: [
          `❌ AI Gateway Custom Provider synchronization failed: ${getErrorMessage(error)}`,
        ],
      });
      return;
    }
  }

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
  void runDeploySecretsCli().catch((error) => {
    console.error(`❌ ${getErrorMessage(error)}`);
    process.exit(1);
  });
}
