function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Credential-like names removed from query strings and redacted from logs. */
export const SENSITIVE_CREDENTIAL_NAMES = new Set([
  "key",
  "api-key",
  "api_key",
  "apikey",
  "access_token",
  "token",
  "authorization",
  "auth",
  "password",
  "secret",
]);

export const SENSITIVE_CREDENTIAL_NAME_PATTERN = [...SENSITIVE_CREDENTIAL_NAMES]
  .map(escapeRegularExpression)
  .join("|");
