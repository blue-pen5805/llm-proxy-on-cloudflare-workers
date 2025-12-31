#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CliArgs {
  env?: string;
  help?: boolean;
}

export interface FileSystemOperations {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: BufferEncoding) => string;
  writeFileSync: (path: string, data: string) => void;
}

export interface GenerationResult {
  success: boolean;
  messages: string[];
}

export interface GenerationOptions {
  rootDir: string;
  env?: string;
  fsOps?: FileSystemOperations;
}

/**
 * Validate environment name
 */
export function validateEnvironmentName(env: string): boolean {
  // Allow alphanumeric characters, hyphens, and underscores
  return /^[a-zA-Z0-9_-]+$/.test(env);
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
  const args: CliArgs = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--env") {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("-")) {
        throw new Error("--env option requires a value");
      }
      args.env = argv[i + 1];
      i++; // Skip next argument as it's the value
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
 * Remove JSON comments and parse JSON with comments (JSONC)
 */
export function parseJsonc(content: string): Record<string, any> {
  // Use a regex that matches both strings and comments.
  // When a string is matched, we keep it as is.
  // When a comment is matched, we remove it.
  const regex = /"(?:[^"\\]|\\.)*"|(\/\/.*$|\/\*[\s\S]*?\*\/)/gm;

  const withoutComments = content.replace(regex, (match, comment) => {
    // If we matched a comment (capture group 1), return an empty string
    // Otherwise, we matched a string, so return it as is
    return comment ? "" : match;
  });

  // Remove trailing commas
  const withoutTrailingCommas = withoutComments.replace(/,(\s*[}\]])/g, "$1");

  return JSON.parse(withoutTrailingCommas);
}

/**
 * Convert a value to environment variable format
 */
export function valueToEnvVar(value: any): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    // For arrays, stringify the entire array
    return JSON.stringify(value);
  }

  return String(value);
}

/**
 * Convert JSON config to .dev.vars format
 */
export function configToDevVars(
  config: Record<string, any>,
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
    const errorMessage = error instanceof Error ? error.message : String(error);
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
function main(): void {
  let args: CliArgs;

  try {
    args = parseArgs();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error: ${errorMessage}`);
    console.error("Use --help or -h for usage information.");
    process.exit(1);
  }

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

  result.messages.forEach((message) => console.log(message));

  if (result.success) {
    console.log("🎉 Dev vars generation completed!");
  } else {
    process.exit(1);
  }
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
