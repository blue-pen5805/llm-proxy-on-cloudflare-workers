/** Return a stable message for values caught from an unknown exception source. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
