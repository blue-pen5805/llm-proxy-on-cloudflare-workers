#!/usr/bin/env node
import { generateDevVars, getFilePaths } from "./generate-dev-vars.ts";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

interface ParsedArgs {
  env?: string;
  command: string[];
}

function parseArgs(args: string[]): ParsedArgs {
  let env: string | undefined;
  const command: string[] = [];
  let isCommand = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (isCommand) {
      command.push(arg);
      continue;
    }

    if (arg === "--env") {
      if (i + 1 >= args.length) {
        throw new Error("--env requires a value");
      }
      env = args[i + 1];
      i++;
    } else if (arg === "--") {
      isCommand = true;
    } else {
      // If we encounter something that doesn't look like our flag, treat it as start of command if we haven't seen '--'
      // But typically, we expect structure: [our-flags] -- [command]
      // To be safe and flexible, if we see something unknown and haven't seen '--', we could error or assume it's part of command?
      // The requirement was `ts-node scripts/with-secrets.ts --env develop -- wrangler dev ...`
      throw new Error(
        `Unknown argument: ${arg}. Use '--' to separate the command.`,
      );
    }
  }

  if (command.length === 0) {
    throw new Error("No command specified.");
  }

  return { env, command };
}

function cleanup(devVarsPath: string) {
  if (fs.existsSync(devVarsPath)) {
    try {
      fs.unlinkSync(devVarsPath);
      console.log(`🧹 Cleaned up ${path.basename(devVarsPath)}`);
    } catch (e) {
      console.error(`❌ Failed to cleanup ${path.basename(devVarsPath)}`, e);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  let parsed: ParsedArgs;

  try {
    parsed = parseArgs(args);
  } catch (e) {
    console.error(`❌ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  // Generate .dev.vars
  console.log(`🔄 Generating secrets for env: ${parsed.env || "default"}...`);
  const result = generateDevVars(rootDir, parsed.env);

  if (!result.success) {
    result.messages.forEach((msg) => console.error(msg));
    process.exit(1);
  }
  result.messages.forEach((msg) => console.log(msg));

  const { devVarsPath } = getFilePaths(rootDir, parsed.env);

  // Setup cleanup on exit
  const handleExit = () => {
    cleanup(devVarsPath);
    process.exit();
  };

  const handleSignal = (signal: string) => {
    console.log(`\nReceived ${signal}. Cleaning up...`);
    cleanup(devVarsPath);
    process.exit();
  };

  process.on("exit", () => cleanup(devVarsPath));
  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));

  // Spawn command
  const [cmd, ...cmdArgs] = parsed.command;
  console.log(`🚀 Running command: ${cmd} ${cmdArgs.join(" ")}`);

  const child = spawn(cmd, cmdArgs, {
    stdio: "inherit",
    shell: process.platform === "win32", // Use shell only on Windows to resolve commands like 'wrangler'
  });

  child.on("close", (code) => {
    cleanup(devVarsPath);
    process.exit(code ?? 0);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
