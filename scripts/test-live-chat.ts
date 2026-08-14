#!/usr/bin/env tsx
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getErrorMessage, parseJsonc } from "./utils.ts";

const DEFAULT_CONFIG_PATH = "live-chat-models.jsonc";
const DEFAULT_WORKER_CONFIG_PATH = "config.develop.jsonc";
const DEFAULT_LOCAL_URL = "http://127.0.0.1:8787";
const DEFAULT_TIMEOUT_MS = 30_000;
export const MIN_COMPLETION_TOKENS = 100;
export const MAX_ERROR_DETAIL_BYTES = 16 * 1024;
const SENSITIVE_FIELD_NAME_PATTERN =
  /api.?key|authorization|credential|password|private.?key|secret|access.?token|refresh.?token|(?:^|[_-])token(?:$|[_-])/i;

export interface BuiltInLiveChatContract {
  directPath: string;
  supportsMaxCompletionTokens: boolean;
}

/** Node-compatible snapshot of providers routed through Gateway compatibility. */
export const AI_GATEWAY_COMPATIBILITY_PROVIDERS: ReadonlySet<string> = new Set([
  "anthropic",
  "aws-bedrock",
  "cerebras",
  "cohere",
  "deepseek",
  "google-ai-studio",
  "google-vertex-ai",
  "grok",
  "groq",
  "mistral",
  "openai",
  "openrouter",
  "perplexity-ai",
  "workers-ai",
]);

/**
 * Node-compatible snapshot of the provider properties needed by this CLI.
 * A Worker-runtime test keeps it synchronized with the provider registry.
 */
export const BUILT_IN_LIVE_CHAT_CONTRACTS = {
  anthropic: {
    directPath: "/v1/chat/completions",
    supportsMaxCompletionTokens: true,
  },
  "aws-bedrock": {
    directPath: "/chat/completions",
    supportsMaxCompletionTokens: true,
  },
  "azure-openai": {
    directPath: "/chat/completions",
    supportsMaxCompletionTokens: true,
  },
  cerebras: {
    directPath: "/chat/completions",
    supportsMaxCompletionTokens: true,
  },
  cohere: {
    directPath: "/compatibility/v1/chat/completions",
    supportsMaxCompletionTokens: false,
  },
  cline: {
    directPath: "/chat/completions",
    supportsMaxCompletionTokens: true,
  },
  deepseek: {
    directPath: "/chat/completions",
    supportsMaxCompletionTokens: true,
  },
  "google-ai-studio": {
    directPath: "/v1beta/openai/chat/completions",
    supportsMaxCompletionTokens: true,
  },
  "google-vertex-ai": {
    directPath: "/chat/completions",
    supportsMaxCompletionTokens: true,
  },
  grok: {
    directPath: "/v1/chat/completions",
    supportsMaxCompletionTokens: true,
  },
  groq: {
    directPath: "/chat/completions",
    supportsMaxCompletionTokens: true,
  },
  mistral: {
    directPath: "/v1/chat/completions",
    supportsMaxCompletionTokens: true,
  },
  "nvidia-nim": {
    directPath: "/chat/completions",
    supportsMaxCompletionTokens: true,
  },
  ollama: {
    directPath: "/chat/completions",
    supportsMaxCompletionTokens: true,
  },
  openai: {
    directPath: "/chat/completions",
    supportsMaxCompletionTokens: true,
  },
  openrouter: {
    directPath: "/v1/chat/completions",
    supportsMaxCompletionTokens: true,
  },
  "perplexity-ai": {
    directPath: "/v1/chat/completions",
    supportsMaxCompletionTokens: true,
  },
  "workers-ai": {
    directPath: "/v1/chat/completions",
    supportsMaxCompletionTokens: true,
  },
} as const satisfies Record<string, BuiltInLiveChatContract>;

export interface LiveChatTestCase {
  provider: string;
  model: string;
  directPath: string;
  supportsMaxCompletionTokens: boolean;
}

export interface LiveChatTestResult {
  provider: string;
  route: "direct" | "compatibility" | "ai-gateway";
  status?: number;
  error?: string;
}

interface RunOptions {
  baseUrl: string;
  proxyApiKey?: string;
  sensitiveValues?: readonly string[];
  gatewayName?: string;
  keySelection?: string | null;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  providers?: ReadonlySet<string>;
}

type NormalizedRunOptions = Omit<
  RunOptions,
  "baseUrl" | "fetcher" | "keySelection" | "sensitiveValues" | "timeoutMs"
> & {
  baseUrl: string;
  fetcher: typeof fetch;
  keySelection: string | null;
  sensitiveValues: readonly string[];
  timeoutMs: number;
};

export interface LocalWorkerAuthentication {
  developmentMode: boolean;
  proxyApiKey?: string;
  sensitiveValues: readonly string[];
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

export function parseLocalWorkerAuthentication(
  source: string,
): LocalWorkerAuthentication {
  const parsed = parseJsonc(source);
  const developmentMode = parsed.DEV === true || parsed.DEV === "true";
  const configuredKeys = Array.isArray(parsed.PROXY_API_KEY)
    ? parsed.PROXY_API_KEY
    : [parsed.PROXY_API_KEY];
  const proxyApiKey = configuredKeys.find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
  const sensitiveValues = collectSensitiveConfigValues(parsed);

  if (!developmentMode && !proxyApiKey) {
    throw new Error(
      "config.develop.jsonc must set PROXY_API_KEY unless DEV is true.",
    );
  }
  return { developmentMode, proxyApiKey, sensitiveValues };
}

function collectSensitiveConfigValues(value: unknown): string[] {
  const collected = new Set<string>();
  const visit = (item: unknown, sensitive: boolean, depth: number): void => {
    if (depth > 20) return;
    if (typeof item === "string") {
      if (sensitive && item.length >= 4) {
        collected.add(item);
        try {
          visit(JSON.parse(item) as unknown, true, depth + 1);
        } catch {
          // Non-JSON credentials remain protected by their exact value.
        }
      }
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child, sensitive, depth + 1);
      return;
    }
    if (typeof item === "object" && item !== null) {
      for (const [key, child] of Object.entries(item)) {
        visit(
          child,
          sensitive || SENSITIVE_FIELD_NAME_PATTERN.test(key),
          depth + 1,
        );
      }
    }
  };
  visit(value, false, 0);
  return [...collected].sort((left, right) => right.length - left.length);
}

function normalizeDirectPath(value: string, provider: string): string {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f?#]/.test(value) ||
    value.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(
      `providers.${provider}.directPath must be a safe absolute path without a query string.`,
    );
  }
  return value;
}

function getBuiltInContract(
  providerName: string,
): BuiltInLiveChatContract | undefined {
  return (
    BUILT_IN_LIVE_CHAT_CONTRACTS as Record<
      string,
      BuiltInLiveChatContract | undefined
    >
  )[providerName];
}

export function parseLiveChatConfig(source: string): LiveChatTestCase[] {
  const parsed = parseJsonc(source);
  const providers = parsed.providers;
  if (
    typeof providers !== "object" ||
    providers === null ||
    Array.isArray(providers)
  ) {
    throw new Error("providers must be an object.");
  }

  const testCases: LiveChatTestCase[] = [];
  for (const [provider, rawValue] of Object.entries(providers)) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(provider)) {
      throw new Error(`Invalid provider route name: ${provider}`);
    }
    if (rawValue === null) continue;

    const builtInContract = getBuiltInContract(provider);
    let model: string;
    let configuredDirectPath: string | undefined;
    if (typeof rawValue === "string") {
      model = requireNonEmptyString(rawValue, `providers.${provider}`);
    } else if (
      typeof rawValue === "object" &&
      rawValue !== null &&
      !Array.isArray(rawValue)
    ) {
      const providerConfig = rawValue as Record<string, unknown>;
      model = requireNonEmptyString(
        providerConfig.model,
        `providers.${provider}.model`,
      );
      if (providerConfig.directPath !== undefined) {
        configuredDirectPath = requireNonEmptyString(
          providerConfig.directPath,
          `providers.${provider}.directPath`,
        );
      }
    } else {
      throw new Error(
        `providers.${provider} must be a model string, an object, or null.`,
      );
    }

    const directPath = configuredDirectPath ?? builtInContract?.directPath;
    if (!directPath) {
      throw new Error(
        `${provider} has no Chat Completions direct path; set directPath only if the configured endpoint supports one.`,
      );
    }
    testCases.push({
      provider,
      model,
      directPath: normalizeDirectPath(directPath, provider),
      supportsMaxCompletionTokens:
        builtInContract?.supportsMaxCompletionTokens ?? true,
    });
  }

  if (testCases.length === 0) {
    throw new Error("Configure at least one provider model before running.");
  }
  return testCases;
}

function buildChatBody(
  testCase: LiveChatTestCase,
  qualifiedModel: boolean,
): Record<string, unknown> {
  return {
    model: qualifiedModel
      ? `${testCase.provider}/${testCase.model}`
      : testCase.model,
    messages: [{ role: "user", content: "Reply with OK." }],
    stream: false,
    [testCase.supportsMaxCompletionTokens
      ? "max_completion_tokens"
      : "max_tokens"]: MIN_COMPLETION_TOKENS,
  };
}

function joinRoute(
  baseUrl: string,
  gatewayName: string | undefined,
  keySelection: string | null,
  route: string,
): string {
  const keyPrefix = keySelection ? `/key/${keySelection}` : "";
  const gatewayPrefix = gatewayName
    ? `/g/${encodeURIComponent(gatewayName)}`
    : "";
  return `${baseUrl.replace(/\/+$/, "")}${keyPrefix}${gatewayPrefix}${route}`;
}

function createProxyHeaders(proxyApiKey?: string): Record<string, string> {
  return {
    ...(proxyApiKey ? { Authorization: `Bearer ${proxyApiKey}` } : {}),
    "Content-Type": "application/json",
  };
}

function normalizeLocalBaseUrl(baseUrl: string): string {
  const normalizedBaseUrl = requireNonEmptyString(
    baseUrl,
    "LLM_PROXY_LOCAL_URL",
  );
  const parsedBaseUrl = new URL(normalizedBaseUrl);
  if (
    parsedBaseUrl.protocol !== "https:" &&
    parsedBaseUrl.protocol !== "http:"
  ) {
    throw new Error("LLM_PROXY_LOCAL_URL must use http or https.");
  }
  if (
    parsedBaseUrl.username ||
    parsedBaseUrl.password ||
    parsedBaseUrl.search ||
    parsedBaseUrl.hash
  ) {
    throw new Error(
      "LLM_PROXY_LOCAL_URL must not contain credentials, a query, or a fragment.",
    );
  }
  if (
    !["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsedBaseUrl.hostname)
  ) {
    throw new Error(
      "LLM_PROXY_LOCAL_URL must target a loopback development server.",
    );
  }
  return normalizedBaseUrl;
}

function redactSensitiveString(
  value: string,
  sensitiveValues: readonly string[],
): string {
  let redacted = value
    .replace(/\bBearer\s+\S+/gi, "Bearer ***")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-***")
    .replace(/\bAIza[0-9A-Za-z_-]{16,}\b/g, "AIza***");
  for (const sensitiveValue of sensitiveValues) {
    redacted = redacted.split(sensitiveValue).join("***");
  }
  return redacted;
}

function redactSensitiveFields(
  value: unknown,
  sensitiveValues: readonly string[],
  depth = 0,
): unknown {
  if (depth > 20) return "[nested value omitted]";
  if (typeof value === "string") {
    return redactSensitiveString(value, sensitiveValues);
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      redactSensitiveFields(item, sensitiveValues, depth + 1),
    );
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_FIELD_NAME_PATTERN.test(key)
          ? "***"
          : redactSensitiveFields(item, sensitiveValues, depth + 1),
      ]),
    );
  }
  return value;
}

async function readBoundedErrorBody(response: Response): Promise<{
  text: string;
  truncated: boolean;
}> {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remainingBytes = MAX_ERROR_DETAIL_BYTES - totalBytes;
      if (value.byteLength > remainingBytes) {
        if (remainingBytes > 0) chunks.push(value.slice(0, remainingBytes));
        totalBytes += Math.max(remainingBytes, 0);
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const bodyBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bodyBytes), truncated };
}

async function formatHttpError(
  response: Response,
  sensitiveValues: readonly string[],
): Promise<string> {
  const status = `HTTP ${response.status} ${response.statusText}`.trim();
  const { text, truncated } = await readBoundedErrorBody(response);
  const trimmedText = text.trim();
  if (!trimmedText) return status;

  let detail: string;
  try {
    detail = JSON.stringify(
      redactSensitiveFields(
        JSON.parse(trimmedText) as unknown,
        sensitiveValues,
      ),
    );
  } catch {
    detail = redactSensitiveString(trimmedText, sensitiveValues).replace(
      /\s+/g,
      " ",
    );
  }
  const truncationNotice = truncated
    ? ` [truncated at ${MAX_ERROR_DETAIL_BYTES} bytes]`
    : "";
  return `${status}: ${detail}${truncationNotice}`;
}

async function executeRequest(
  testCase: LiveChatTestCase,
  route: LiveChatTestResult["route"],
  options: NormalizedRunOptions,
): Promise<LiveChatTestResult> {
  const usesCompatibilityFormat = route !== "direct";
  const requestPath =
    route === "direct"
      ? `/${testCase.provider}${testCase.directPath}`
      : route === "ai-gateway"
        ? "/chat/completions"
        : "/v1/chat/completions";
  const gatewayName =
    route === "ai-gateway"
      ? (options.gatewayName ?? "default")
      : options.gatewayName;
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), options.timeoutMs);

  try {
    const response = await options.fetcher(
      joinRoute(
        options.baseUrl,
        gatewayName,
        options.keySelection,
        requestPath,
      ),
      {
        method: "POST",
        headers: createProxyHeaders(options.proxyApiKey),
        body: JSON.stringify(buildChatBody(testCase, usesCompatibilityFormat)),
        signal: abortController.signal,
      },
    );
    if (response.ok) {
      if (response.body) {
        await response.body.cancel().catch(() => undefined);
      }
      return { provider: testCase.provider, route, status: response.status };
    }
    return {
      provider: testCase.provider,
      route,
      status: response.status,
      error: await formatHttpError(response, options.sensitiveValues),
    };
  } catch (error) {
    return {
      provider: testCase.provider,
      route,
      error:
        error instanceof Error && error.name === "AbortError"
          ? `Timed out after ${options.timeoutMs} ms`
          : redactSensitiveString(
              getErrorMessage(error),
              options.sensitiveValues,
            ),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runLiveChatTests(
  testCases: readonly LiveChatTestCase[],
  options: RunOptions,
): Promise<LiveChatTestResult[]> {
  const normalizedBaseUrl = normalizeLocalBaseUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120_000
  ) {
    throw new Error(
      "LIVE_CHAT_TIMEOUT_MS must be an integer from 1 to 120000.",
    );
  }
  const keySelection =
    options.keySelection === undefined ? "0" : options.keySelection;
  if (
    keySelection !== null &&
    !/^(?:\d+|\d+-\d+|\d+-|-\d+)$/.test(keySelection)
  ) {
    throw new Error(
      "LLM_PROXY_KEY_SELECTION must be a key index/range or the value none.",
    );
  }

  const selectedTestCases = options.providers
    ? testCases.filter((testCase) => options.providers?.has(testCase.provider))
    : testCases;
  if (selectedTestCases.length === 0) {
    throw new Error("No configured providers matched the requested names.");
  }

  const normalizedOptions = {
    ...options,
    baseUrl: normalizedBaseUrl,
    sensitiveValues: [
      ...(options.sensitiveValues ?? []),
      ...(options.proxyApiKey ? [options.proxyApiKey] : []),
    ],
    keySelection,
    timeoutMs,
    fetcher: options.fetcher ?? fetch,
  };
  const results: LiveChatTestResult[] = [];
  for (const testCase of selectedTestCases) {
    results.push(await executeRequest(testCase, "direct", normalizedOptions));
    results.push(
      await executeRequest(testCase, "compatibility", normalizedOptions),
    );
    if (AI_GATEWAY_COMPATIBILITY_PROVIDERS.has(testCase.provider)) {
      results.push(
        await executeRequest(testCase, "ai-gateway", normalizedOptions),
      );
    }
  }
  return results;
}

export async function verifyLocalDevelopmentServer(
  baseUrl: string,
  proxyApiKey?: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const normalizedBaseUrl = normalizeLocalBaseUrl(baseUrl);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 10_000);
  try {
    const response = await fetcher(
      `${normalizedBaseUrl.replace(/\/+$/, "")}/ping`,
      {
        headers: createProxyHeaders(proxyApiKey),
        signal: abortController.signal,
      },
    );
    if (response.body) {
      await response.body.cancel().catch(() => undefined);
    }
    if (!response.ok) {
      throw new Error(`local /ping returned HTTP ${response.status}.`);
    }
  } catch (error) {
    const safeError = redactSensitiveString(
      getErrorMessage(error),
      proxyApiKey ? [proxyApiKey] : [],
    );
    throw new Error(
      `Local development server is unavailable at ${normalizedBaseUrl}. Start it with npm run dev. ${safeError}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function parseLiveChatArguments(args: string[]): {
  configPath: string;
  providers?: ReadonlySet<string>;
  help: boolean;
} {
  let configPath = DEFAULT_CONFIG_PATH;
  const providers = new Set<string>();
  let help = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--config") {
      const value = args[++index];
      if (!value) throw new Error("--config requires a path.");
      configPath = value;
    } else if (argument === "--provider") {
      const value = args[++index];
      if (!value) throw new Error("--provider requires a provider name.");
      providers.add(value);
    } else if (argument === "--help" || argument === "-h") {
      help = true;
    } else if (!argument.startsWith("-")) {
      providers.add(argument);
    } else {
      throw new Error(`Unexpected argument: ${argument}`);
    }
  }
  return {
    configPath,
    providers: providers.size > 0 ? providers : undefined,
    help,
  };
}

function showHelp(): void {
  console.log(`Usage: npm run test:live-chat -- [options]

Options:
  --config <path>       Model selection JSONC (default: ${DEFAULT_CONFIG_PATH})
  --provider <name>     Run one configured provider; may be repeated
  --help, -h            Show this help

Provider names may also be passed directly, for example:
  npm run test:live-chat -- openai anthropic

Start the local Worker with "npm run dev" before running live checks.`);
}

export async function runLiveChatCli(): Promise<void> {
  try {
    const { configPath, providers, help } = parseLiveChatArguments(
      process.argv.slice(2),
    );
    if (help) {
      showHelp();
      return;
    }
    const testCases = parseLiveChatConfig(readFileSync(configPath, "utf8"));
    const { proxyApiKey, sensitiveValues } = parseLocalWorkerAuthentication(
      readFileSync(DEFAULT_WORKER_CONFIG_PATH, "utf8"),
    );
    const timeoutValue = process.env.LIVE_CHAT_TIMEOUT_MS;
    const keySelectionValue = process.env.LLM_PROXY_KEY_SELECTION;
    const baseUrl = process.env.LLM_PROXY_LOCAL_URL || DEFAULT_LOCAL_URL;
    await verifyLocalDevelopmentServer(baseUrl, proxyApiKey);
    const results = await runLiveChatTests(testCases, {
      baseUrl,
      proxyApiKey,
      sensitiveValues,
      gatewayName: process.env.LLM_PROXY_GATEWAY_NAME || undefined,
      keySelection:
        keySelectionValue?.toLowerCase() === "none"
          ? null
          : keySelectionValue || undefined,
      timeoutMs: timeoutValue ? Number(timeoutValue) : undefined,
      providers,
    });

    for (const result of results) {
      const label = `${result.provider} ${result.route}`;
      console.log(
        result.error
          ? `FAIL ${label}: ${result.error}`
          : `PASS ${label}: HTTP ${result.status}`,
      );
    }
    const failures = results.filter((result) => result.error);
    console.log(
      `${results.length - failures.length}/${results.length} live Chat Completions checks passed.`,
    );
    if (failures.length > 0) process.exitCode = 1;
  } catch (error) {
    console.error(
      `Live Chat Completions test failed: ${getErrorMessage(error)}`,
    );
    process.exitCode = 1;
  }
}

/* istanbul ignore next -- exercised by the runtime, not module tests */
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  void runLiveChatCli();
}
