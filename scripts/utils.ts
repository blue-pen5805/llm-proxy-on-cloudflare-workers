import { parse as parseJsoncSource, type ParseError } from "jsonc-parser";

/** Return a stable message for values caught from an unknown exception source. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface FileSystemOperations {
  existsSync: (filePath: string) => boolean;
  readFileSync: (filePath: string, encoding: BufferEncoding) => string;
  writeFileSync: (
    filePath: string,
    fileContent: string,
    options?: { mode?: number },
  ) => void;
  chmodSync?: (filePath: string, mode: number) => void;
}

export interface OperationResult {
  success: boolean;
  messages: string[];
}

interface CommonCliArgs {
  env?: string;
  help?: boolean;
  flags: Set<string>;
}

/** Parse the common environment/help options and explicitly allowed flags. */
export function parseEnvironmentCliArguments(
  commandLineArguments: string[],
  booleanFlags: readonly string[] = [],
): CommonCliArgs {
  const parsedArguments: Omit<CommonCliArgs, "flags"> = {};
  const enabledFlags = new Set<string>();

  for (
    let argumentIndex = 0;
    argumentIndex < commandLineArguments.length;
    argumentIndex++
  ) {
    const currentArgument = commandLineArguments[argumentIndex];
    if (currentArgument === "--env") {
      if (
        argumentIndex + 1 >= commandLineArguments.length ||
        commandLineArguments[argumentIndex + 1].startsWith("-")
      ) {
        throw new Error("--env option requires a value");
      }
      argumentIndex++;
      parsedArguments.env = commandLineArguments[argumentIndex];
    } else if (currentArgument === "--help" || currentArgument === "-h") {
      parsedArguments.help = true;
    } else if (booleanFlags.includes(currentArgument)) {
      enabledFlags.add(currentArgument);
    } else if (currentArgument.startsWith("-")) {
      throw new Error(`Unknown option: ${currentArgument}`);
    } else {
      throw new Error(`Unexpected argument: ${currentArgument}`);
    }
  }

  return { ...parsedArguments, flags: enabledFlags };
}

/** Parse CLI arguments with the shared error reporting and exit behavior. */
export function parseCliArgumentsOrExit<T>(parseArguments: () => T): T {
  try {
    return parseArguments();
  } catch (error) {
    console.error(`❌ Error: ${getErrorMessage(error)}`);
    console.error("Use --help or -h for usage information.");
    process.exit(1);
  }
}

/** Print operation messages, then report success or terminate on failure. */
export function reportCliResult(
  result: OperationResult,
  successMessage?: string,
): void {
  result.messages.forEach((message) => console.log(message));

  if (!result.success) {
    process.exit(1);
  }
  if (successMessage) {
    console.log(successMessage);
  }
}

/** Validate a Wrangler environment suffix. */
export function validateEnvironmentName(environmentName: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(environmentName);
}

/**
 * Parse a JSONC configuration object.
 *
 * A real tokenizer is required rather than comment- and comma-stripping
 * regular expressions: those cannot tell a `,` inside a string value from a
 * trailing comma, so a credential containing `", }"` was silently rewritten
 * before being written to `.dev.vars` or deployed as a Worker secret. This is
 * the same parser the interactive editor writes configuration files with, so
 * the reader and the writer agree on every value.
 */
export function parseJsonc(jsoncText: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const parsed = parseJsoncSource(jsoncText, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;

  if (errors.length > 0) {
    throw new SyntaxError("The configuration file is not valid JSONC.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SyntaxError("The configuration file must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}
