#!/usr/bin/env node
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  generateDevVars,
  getConfigAndDevVarsPaths,
} from "./generate-dev-vars.ts";
import { getErrorMessage } from "./utils.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repositoryRoot = path.resolve(__dirname, "..");

interface WithSecretsArguments {
  env?: string;
  includeNullPlaceholders?: boolean;
  command: string[];
}

export function parseWithSecretsArguments(
  commandLineArguments: string[],
): WithSecretsArguments {
  let environmentName: string | undefined;
  const childCommand: string[] = [];
  let hasReachedCommand = false;
  let includeNullPlaceholders = false;

  for (
    let argumentIndex = 0;
    argumentIndex < commandLineArguments.length;
    argumentIndex++
  ) {
    const currentArgument = commandLineArguments[argumentIndex];
    if (hasReachedCommand) {
      childCommand.push(currentArgument);
      continue;
    }

    if (currentArgument === "--env") {
      if (argumentIndex + 1 >= commandLineArguments.length) {
        throw new Error("--env requires a value");
      }
      environmentName = commandLineArguments[argumentIndex + 1];
      argumentIndex++;
    } else if (currentArgument === "--include-null-placeholders") {
      includeNullPlaceholders = true;
    } else if (currentArgument === "--") {
      hasReachedCommand = true;
    } else {
      // If we encounter something that doesn't look like our flag, treat it as start of command if we haven't seen '--'
      // But typically, we expect structure: [our-flags] -- [command]
      // To be safe and flexible, if we see something unknown and haven't seen '--', we could error or assume it's part of command?
      // The requirement was `tsx scripts/with-secrets.ts --env develop -- wrangler dev ...`
      throw new Error(
        `Unknown argument: ${currentArgument}. Use '--' to separate the command.`,
      );
    }
  }

  if (childCommand.length === 0) {
    throw new Error("No command specified.");
  }

  return {
    env: environmentName,
    ...(includeNullPlaceholders ? { includeNullPlaceholders: true } : {}),
    command: childCommand,
  };
}

export function removeGeneratedDevVarsFile(devVarsPath: string): void {
  if (fs.existsSync(devVarsPath)) {
    try {
      fs.unlinkSync(devVarsPath);
      console.log(`🧹 Cleaned up ${path.basename(devVarsPath)}`);
    } catch (error) {
      console.error(
        `❌ Failed to cleanup ${path.basename(devVarsPath)}`,
        error,
      );
    }
  }
}

export async function runCommandWithSecretsCli() {
  const commandLineArguments = process.argv.slice(2);
  let parsedArguments: WithSecretsArguments;

  try {
    parsedArguments = parseWithSecretsArguments(commandLineArguments);
  } catch (error) {
    console.error(`❌ ${getErrorMessage(error)}`);
    process.exit(1);
  }

  // Generate .dev.vars
  console.log(
    `🔄 Generating secrets for env: ${parsedArguments.env || "default"}...`,
  );
  const generationResult = generateDevVars(
    repositoryRoot,
    parsedArguments.env,
    fs,
    parsedArguments.includeNullPlaceholders,
  );

  if (!generationResult.success) {
    generationResult.messages.forEach((message) => console.error(message));
    process.exit(1);
  }
  generationResult.messages.forEach((message) => console.log(message));

  const { devVarsPath } = getConfigAndDevVarsPaths(
    repositoryRoot,
    parsedArguments.env,
  );

  // Setup cleanup on exit
  const handleSignal = (signal: string) => {
    console.log(`\nReceived ${signal}. Cleaning up...`);
    removeGeneratedDevVarsFile(devVarsPath);
    process.exit();
  };

  process.on("exit", () => removeGeneratedDevVarsFile(devVarsPath));
  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));

  // Spawn command
  const [commandName, ...commandArguments] = parsedArguments.command;
  console.log(
    `🚀 Running command: ${commandName} ${commandArguments.join(" ")}`,
  );

  const childProcess = spawn(commandName, commandArguments, {
    stdio: "inherit",
    shell: process.platform === "win32", // Use shell only on Windows to resolve commands like 'wrangler'
  });

  // Without an "error" listener, a command that cannot be spawned (for example
  // a missing `wrangler` on PATH) turns into an unhandled 'error' event and a
  // raw stack trace.
  childProcess.on("error", (error) => {
    console.error(`❌ Failed to run ${commandName}: ${getErrorMessage(error)}`);
    removeGeneratedDevVarsFile(devVarsPath);
    process.exit(1);
  });

  childProcess.on("close", (exitCode) => {
    removeGeneratedDevVarsFile(devVarsPath);
    process.exit(exitCode ?? 0);
  });
}

/* istanbul ignore next -- exercised by the runtime, not module tests */
if (import.meta.url === `file://${process.argv[1]}`) {
  void runCommandWithSecretsCli().catch(console.error);
}
