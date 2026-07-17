/** Return a stable message for values caught from an unknown exception source. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface FileSystemOperations {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: BufferEncoding) => string;
  writeFileSync: (path: string, data: string) => void;
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
export function parseEnvCliArgs(
  argv: string[],
  booleanFlags: readonly string[] = [],
): CommonCliArgs {
  const args: Omit<CommonCliArgs, "flags"> = {};
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--env") {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("-")) {
        throw new Error("--env option requires a value");
      }
      args.env = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (booleanFlags.includes(arg)) {
      flags.add(arg);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return { ...args, flags };
}

/** Parse CLI arguments with the shared error reporting and exit behavior. */
export function parseCliArgsOrExit<T>(parse: () => T): T {
  try {
    return parse();
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
export function validateEnvironmentName(env: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(env);
}

/** Parse JSON with comments and trailing commas while preserving comment-like strings. */
export function parseJsonc(content: string): Record<string, unknown> {
  const stringsAndComments = /"(?:[^"\\]|\\.)*"|(\/\/.*$|\/\*[\s\S]*?\*\/)/gm;
  const withoutComments = content.replace(
    stringsAndComments,
    (match, comment) => (comment ? "" : match),
  );
  const withoutTrailingCommas = withoutComments.replace(/,(\s*[}\]])/g, "$1");

  return JSON.parse(withoutTrailingCommas) as Record<string, unknown>;
}
