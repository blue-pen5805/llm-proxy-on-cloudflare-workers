#!/usr/bin/env node
import { BUILT_IN_PROVIDER_NAME_SET } from "../src/providers/names.ts";
import { Config } from "../src/utils/config.ts";
import { Environments } from "../src/utils/environments.ts";
import {
  exceedsVirtualModelAttemptLimit,
  hasVirtualModelCycle,
  MAX_VIRTUAL_MODEL_EXPANDED_ATTEMPTS,
  parseVirtualModels,
} from "../src/utils/virtual_models.ts";
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
import { execFileSync, spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

// Whether a VIRTUAL_MODELS reference names a real provider depends on
// CUSTOM_OPENAI_ENDPOINTS, so neither setting can be validated without the
// other's final value.
const CUSTOM_ENDPOINTS_KEY = "CUSTOM_OPENAI_ENDPOINTS";
const VIRTUAL_MODELS_KEY = "VIRTUAL_MODELS";
const INTERDEPENDENT_CONFIG_KEYS = [
  CUSTOM_ENDPOINTS_KEY,
  VIRTUAL_MODELS_KEY,
] as const;

/**
 * The effect this file has on one deployed setting.
 *
 * Presence in the file is not the same as change: an empty string, array, or
 * object is dropped as a no-op and leaves the deployed value in place, exactly
 * as omitting the key does.
 */
function configOperation(
  config: Record<string, unknown>,
  key: string,
): "set" | "delete" | "unchanged" {
  if (!Object.prototype.hasOwnProperty.call(config, key)) return "unchanged";
  const secretValue = serializeSecretValue(config[key]);
  if (secretValue === null) return "delete";
  return secretValue === "" ? "unchanged" : "set";
}

/**
 * Require the interdependent settings to change together.
 *
 * A setting this file leaves alone keeps whatever is already deployed, and this
 * command cannot read deployed secret values back, so validating the file alone
 * describes the resulting configuration only when both halves of the pair are
 * known. Deleting CUSTOM_OPENAI_ENDPOINTS on its own, for example, would
 * otherwise pass while turning a retained VIRTUAL_MODELS entry that referenced
 * that endpoint into a self-reference the Worker rejects with HTTP 503.
 *
 * The test is the effective operation rather than key presence, because an
 * empty value satisfies presence while deploying nothing, which would reopen
 * exactly that gap.
 *
 * The dependency runs one way, so the pairing is not symmetric. Deleting
 * VIRTUAL_MODELS leaves no reference that could name an endpoint, and both
 * cycles and the attempt limit are properties of that graph alone, so the
 * result is verifiable whatever CUSTOM_OPENAI_ENDPOINTS holds. Every other
 * one-sided change leaves the retained half unknown.
 */
function assertInterdependentConfigIsComplete(
  config: Record<string, unknown>,
): void {
  if (configOperation(config, VIRTUAL_MODELS_KEY) === "delete") return;

  const changing = INTERDEPENDENT_CONFIG_KEYS.filter(
    (key) => configOperation(config, key) !== "unchanged",
  );
  if (
    changing.length === 0 ||
    changing.length === INTERDEPENDENT_CONFIG_KEYS.length
  ) {
    return;
  }
  const unchanged = INTERDEPENDENT_CONFIG_KEYS.filter(
    (key) => !changing.includes(key),
  );
  throw new Error(
    `${changing.join(", ")} cannot be deployed while ${unchanged.join(", ")} ` +
      `is left unchanged, whether by omitting it or by giving it an empty ` +
      `value that deploys nothing. A setting that is not deployed keeps its ` +
      `deployed value, which cannot be read back, so give both their final ` +
      `value or null for the resulting configuration to be verifiable.`,
  );
}

/**
 * The configuration this deployment actually installs.
 *
 * Metadata, local-only keys, deprecated keys, and the empty values that
 * `filterSecretsForDeployment` treats as no-ops are removed, and a null
 * deletion contributes nothing to the resulting Worker configuration. Runtime
 * validation must see this rather than the raw file, so a value that is never
 * deployed is never rejected.
 */
export function deployableConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const deployable: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (
      key === "$schema" ||
      DEVELOPMENT_ONLY_KEYS.has(key) ||
      DEPRECATED_CONFIG_KEYS.has(key)
    ) {
      continue;
    }
    const secretValue = serializeSecretValue(value);
    if (secretValue === "" || secretValue === null) continue;
    deployable[key] = value;
  }

  return deployable;
}

/**
 * Run the Worker's own configuration readers against the resulting
 * configuration before any secret is deployed.
 *
 * The JSON Schema cannot express these rules, so a configuration that passes
 * schema validation can still make every request fail with HTTP 503 the moment
 * the Worker first reads it. Evaluating them here turns that into a deployment
 * error the operator sees immediately.
 */
function validateRuntimeConfig(config: Record<string, unknown>): void {
  Environments.runWithConfig(config, () => {
    Config.customOpenAIEndpoints();
    Config.allowedOrigins();
  });
}

function validateVirtualModelGraph(config: Record<string, unknown>): void {
  const rawVirtualModels = config.VIRTUAL_MODELS;
  if (rawVirtualModels === undefined || rawVirtualModels === null) return;

  const virtualModels = parseVirtualModels(rawVirtualModels);
  if (!virtualModels) {
    throw new Error("VIRTUAL_MODELS is invalid.");
  }
  const customProviderNames = Array.isArray(config.CUSTOM_OPENAI_ENDPOINTS)
    ? config.CUSTOM_OPENAI_ENDPOINTS.flatMap((endpoint) =>
        typeof endpoint === "object" &&
        endpoint !== null &&
        typeof (endpoint as { name?: unknown }).name === "string"
          ? [(endpoint as { name: string }).name]
          : [],
      )
    : [];
  const realProviderNames = new Set([
    ...BUILT_IN_PROVIDER_NAME_SET,
    ...customProviderNames,
  ]);
  if (hasVirtualModelCycle(virtualModels, realProviderNames)) {
    throw new Error("VIRTUAL_MODELS contains a circular reference.");
  }
  if (exceedsVirtualModelAttemptLimit(virtualModels, realProviderNames)) {
    throw new Error(
      `VIRTUAL_MODELS exceeds the ${MAX_VIRTUAL_MODEL_EXPANDED_ATTEMPTS}-attempt expansion limit.`,
    );
  }
}

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
export async function executeWranglerSecretBulk(
  secretsJson: string,
  environmentName?: string,
  isDryRun: boolean = false,
): Promise<{ success: boolean; message: string }> {
  const tempFilePath = path.join(
    process.cwd(),
    `.secrets-temp-${randomUUID()}.json`,
  );
  const wranglerArguments = ["secret", "bulk", tempFilePath];
  if (environmentName) wranglerArguments.push("--env", environmentName);
  const commandDisplay = `wrangler ${wranglerArguments.join(" ")}`;

  if (isDryRun) {
    return {
      success: true,
      message: `🔍 Dry run - would execute: ${commandDisplay}`,
    };
  }

  let created = false;
  const removeTempFile = (): void => {
    if (!created) return;
    try {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    } catch {
      // Deletion is best effort; the file is owner-only and version-ignored.
    }
  };
  // Use an asynchronous child so signal callbacks can run while Wrangler is
  // active. Synchronous child-process APIs block JavaScript signal handlers and
  // can leave the plaintext file behind when the parent is terminated.
  const interruptSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  let child: ReturnType<typeof spawn> | undefined;
  let interruptedBy: NodeJS.Signals | undefined;
  const onInterrupt = (signal: NodeJS.Signals): void => {
    interruptedBy ??= signal;
    removeTempFile();
    try {
      child?.kill(signal);
    } catch {
      // The child may already have exited; final cleanup still runs below.
    }
  };
  for (const signal of interruptSignals) process.on(signal, onInterrupt);

  try {
    // Exclusive creation prevents a symlink or concurrent process from being
    // overwritten. Owner-only permissions protect the short-lived plaintext.
    fs.writeFileSync(tempFilePath, secretsJson, { flag: "wx", mode: 0o600 });
    created = true;
    console.log(`🚀 Executing: ${commandDisplay}`);
    child = spawn("wrangler", wranglerArguments, { stdio: "inherit" });
    await new Promise<void>((resolve, reject) => {
      child!.once("error", reject);
      child!.once("exit", (code, signal) => {
        if (code === 0 && signal === null && interruptedBy === undefined) {
          resolve();
          return;
        }
        const outcome = interruptedBy
          ? `interrupted by ${interruptedBy}`
          : signal
            ? `terminated by ${signal}`
            : `exited with code ${code}`;
        reject(new Error(`Wrangler ${outcome}.`));
      });
    });

    return {
      success: true,
      message: "✅ Secrets deployed successfully",
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return {
      success: false,
      message: `❌ Error deploying secrets: ${errorMessage}`,
    };
  } finally {
    removeTempFile();
    for (const signal of interruptSignals) {
      process.removeListener(signal, onInterrupt);
    }
  }
}

/**
 * List the names of secrets currently configured on the Worker.
 *
 * Returns `null` when the set of existing secrets can't be determined (for
 * example the Worker doesn't exist yet, or Wrangler emitted non-JSON output).
 * Callers treat `null` as "unknown" and fall back to their previous behaviour
 * rather than blocking a deploy.
 */
export function listExistingSecretNames(
  environmentName?: string,
): Set<string> | null {
  const wranglerArguments = ["secret", "list", "--format", "json"];
  if (environmentName) wranglerArguments.push("--env", environmentName);

  try {
    // Capture stdout (default "pipe") instead of inheriting, so the JSON is
    // available to parse and Wrangler's own listing isn't echoed to the user.
    const output = execFileSync("wrangler", wranglerArguments, {
      encoding: "utf8",
    });

    // Isolate the JSON array in case Wrangler prints anything alongside it.
    const start = output.indexOf("[");
    const end = output.lastIndexOf("]");
    if (start === -1 || end === -1 || end < start) return null;

    // The slice starts with "[" and ends with "]", so any value JSON.parse
    // accepts here is an array; malformed output throws and is handled below.
    const parsed = JSON.parse(output.slice(start, end + 1)) as unknown[];

    const names = new Set<string>();
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as { name?: unknown }).name === "string"
      ) {
        names.add((entry as { name: string }).name);
      }
    }
    return names;
  } catch {
    return null;
  }
}

/**
 * Deploy secrets based on configuration
 */
export async function deploySecrets(
  repositoryRoot: string,
  environmentName?: string,
  isDryRun: boolean = false,
  fileSystem: FileSystemOperations = fs,
): Promise<DeployResult> {
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

    // Validate the configuration this deployment results in, not the file's
    // literal contents: no-op empty values are excluded, and the interdependent
    // settings must be declared together for that result to be knowable.
    assertInterdependentConfigIsComplete(parsedConfig);
    const resultingConfig = deployableConfig(parsedConfig);
    validateVirtualModelGraph(resultingConfig);
    validateRuntimeConfig(resultingConfig);

    const deployableSecrets = filterSecretsForDeployment(parsedConfig);

    if (Object.keys(deployableSecrets).length === 0) {
      return {
        success: true,
        messages: [
          ...warnings,
          `⚠️  No secret operations found in ${configFileName}`,
        ],
      };
    }

    const messages: string[] = [...warnings];

    // Resolve deletions against the Worker's current secrets so Wrangler only
    // reports keys it actually removed. Without this, `secret bulk` prints a
    // "deleted" line for every null entry, even ones that were never set. Dry
    // runs stay offline, so they still preview every requested deletion.
    if (!isDryRun) {
      const deleteKeys = Object.keys(deployableSecrets).filter(
        (key) => deployableSecrets[key] === null,
      );
      if (deleteKeys.length > 0) {
        const existingSecretNames = listExistingSecretNames(environmentName);
        if (existingSecretNames) {
          const skippedDeletions = deleteKeys.filter(
            (key) => !existingSecretNames.has(key),
          );
          for (const key of skippedDeletions) {
            delete deployableSecrets[key];
          }
          if (skippedDeletions.length > 0) {
            messages.push(
              `⏭️  Skipping deletion of ${skippedDeletions.length} secret(s) not currently set: ${skippedDeletions.join(", ")}`,
            );
          }
        }
      }
    }

    const secretCount = Object.keys(deployableSecrets).length;

    if (secretCount === 0) {
      messages.push(
        "✅ Nothing to deploy — all requested deletions target secrets that are not set.",
      );
      return {
        success: true,
        messages,
      };
    }

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

    const deploymentResult = await executeWranglerSecretBulk(
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

  const deploymentResult = await deploySecrets(
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
