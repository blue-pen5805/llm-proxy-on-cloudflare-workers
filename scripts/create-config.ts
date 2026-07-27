#!/usr/bin/env tsx
import configSchema from "../schemas/config-schema.json";
import { ENGLISH_CREATE_CONFIG_MESSAGES } from "./locales/create-config/en.ts";
import { JAPANESE_CREATE_CONFIG_MESSAGES } from "./locales/create-config/ja.ts";
import type { CreateConfigMessages } from "./locales/create-config/types.ts";
import {
  getErrorMessage,
  parseEnvironmentCliArguments,
  parseJsonc,
  validateEnvironmentName,
} from "./utils.ts";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  multiline,
  note,
  outro,
  password,
  select,
  text,
} from "@clack/prompts";
import Ajv, { type ErrorObject } from "ajv";
import { applyEdits, modify } from "jsonc-parser";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CONFIG_EXAMPLE_PATH = "config.example.jsonc";

type Config = Record<string, unknown>;
export type FieldKey = Exclude<keyof typeof configSchema.properties, "$schema">;
export type ConfigTuiLanguage = "en" | "ja";

interface FieldGroup {
  id: string;
  fields: readonly FieldKey[];
}

interface ProviderField {
  key: FieldKey;
  label:
    | "apiKey"
    | "resourceName"
    | "apiVersion"
    | "serviceAccountJson"
    | "bearerToken"
    | "region";
}

interface ProviderGroup {
  id: string;
  label: string;
  fields: readonly ProviderField[];
}

export interface CloudflareAccount {
  id: string;
  name: string;
}

export interface ConfigTuiArguments {
  env?: string;
  help?: boolean;
}

interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export interface ConfigTuiPrompts {
  intro: (message: string) => void;
  outro: (message: string) => void;
  cancel: (message: string) => void;
  note: (message: string, title?: string) => void;
  isCancel: (value: unknown) => value is symbol;
  isBack: (value: unknown) => value is symbol;
  select: (options: {
    message: string;
    options: SelectOption[];
    initialValue?: string;
    maxItems?: number;
  }) => Promise<string | symbol>;
  text: (options: {
    message: string;
    initialValue?: string;
    placeholder?: string;
    validate?: (value: string | undefined) => string | undefined;
  }) => Promise<string | symbol>;
  password: (options: {
    message: string;
    mask?: string;
    validate?: (value: string | undefined) => string | undefined;
  }) => Promise<string | symbol>;
  multiline: (options: {
    message: string;
    initialValue?: string;
    placeholder?: string;
    validate?: (value: string | undefined) => string | undefined;
  }) => Promise<string | symbol>;
  confirm: (options: {
    message: string;
    initialValue?: boolean;
  }) => Promise<boolean | symbol>;
}

export interface ConfigTuiFileSystem {
  existsSync: (filePath: string) => boolean;
  readFileSync: (filePath: string, encoding: BufferEncoding) => string;
  writeFileSync: (
    filePath: string,
    content: string,
    options: { mode: number },
  ) => void;
  chmodSync: (filePath: string, mode: number) => void;
}

export interface ConfigTuiDependencies {
  prompts?: ConfigTuiPrompts;
  fileSystem?: ConfigTuiFileSystem;
  discoverAccounts?: () => Promise<CloudflareAccount[]>;
  repositoryRoot?: string;
  language?: ConfigTuiLanguage;
}

export const CONFIG_TUI_BACK = Symbol("config-tui:back");

interface KeypressInput extends Readable {
  prependListener(
    event: "keypress",
    listener: (character: string, key: { name?: string }) => void,
  ): this;
  removeListener(
    event: "keypress",
    listener: (character: string, key: { name?: string }) => void,
  ): this;
}

export async function mapEscapeToBack<T>(
  runPrompt: () => Promise<T | symbol>,
  input: KeypressInput,
  isPromptCancel: (value: unknown) => boolean,
): Promise<T | symbol> {
  let escapePressed = false;
  const handleKeypress = (_character: string, key: { name?: string }): void => {
    if (key.name === "escape") escapePressed = true;
  };
  input.prependListener("keypress", handleKeypress);
  try {
    const result = await runPrompt();
    return escapePressed && isPromptCancel(result) ? CONFIG_TUI_BACK : result;
  } finally {
    input.removeListener("keypress", handleKeypress);
  }
}

/* istanbul ignore next -- thin adapter to the interactive terminal runtime */
function interactiveSelect(
  options: Parameters<ConfigTuiPrompts["select"]>[0],
): ReturnType<ConfigTuiPrompts["select"]> {
  return mapEscapeToBack(() => select(options), process.stdin, isCancel);
}

/* istanbul ignore next -- thin adapter to the interactive terminal runtime */
function interactiveText(
  options: Parameters<ConfigTuiPrompts["text"]>[0],
): ReturnType<ConfigTuiPrompts["text"]> {
  return mapEscapeToBack(() => text(options), process.stdin, isCancel);
}

/* istanbul ignore next -- thin adapter to the interactive terminal runtime */
function interactivePassword(
  options: Parameters<ConfigTuiPrompts["password"]>[0],
): ReturnType<ConfigTuiPrompts["password"]> {
  return mapEscapeToBack(() => password(options), process.stdin, isCancel);
}

/* istanbul ignore next -- thin adapter to the interactive terminal runtime */
function interactiveMultiline(
  options: Parameters<ConfigTuiPrompts["multiline"]>[0],
): ReturnType<ConfigTuiPrompts["multiline"]> {
  return mapEscapeToBack(() => multiline(options), process.stdin, isCancel);
}

/* istanbul ignore next -- thin adapter to the interactive terminal runtime */
function interactiveConfirm(
  options: Parameters<ConfigTuiPrompts["confirm"]>[0],
): ReturnType<ConfigTuiPrompts["confirm"]> {
  return mapEscapeToBack(() => confirm(options), process.stdin, isCancel);
}

/* istanbul ignore next -- thin adapter to the interactive terminal runtime */
function interactiveIsBack(value: unknown): value is symbol {
  return value === CONFIG_TUI_BACK;
}

const DEFAULT_PROMPTS: ConfigTuiPrompts = {
  intro,
  outro,
  cancel,
  note,
  isCancel,
  isBack: interactiveIsBack,
  select: interactiveSelect,
  text: interactiveText,
  password: interactivePassword,
  multiline: interactiveMultiline,
  confirm: interactiveConfirm,
};

export const FIELD_GROUPS: readonly FieldGroup[] = [
  {
    id: "authentication",
    fields: ["PROXY_API_KEY", "ALLOWED_ORIGINS"],
  },
  {
    id: "custom-endpoints",
    fields: ["CUSTOM_OPENAI_ENDPOINTS"],
  },
  {
    id: "virtual-models",
    fields: ["VIRTUAL_MODELS"],
  },
  {
    id: "gateway",
    fields: [
      "CLOUDFLARE_ACCOUNT_ID",
      "AI_GATEWAY_NAME",
      "ALWAYS_USE_AI_GATEWAY",
      "CF_AIG_TOKEN",
      "CLOUDFLARE_API_TOKEN",
    ],
  },
  {
    id: "behavior",
    fields: [
      "DEFAULT_MODEL",
      "CHAT_RESPONSE_METADATA_ENABLED",
      "API_KEY_COOLDOWN_SECONDS",
      "MODELS_CACHE_TTL_SECONDS",
      "STATUS_CACHE_TTL_SECONDS",
    ],
  },
] as const;

export const PROVIDER_GROUPS: readonly ProviderGroup[] = [
  {
    id: "openai",
    label: "OpenAI",
    fields: [{ key: "OPENAI_API_KEY", label: "apiKey" }],
  },
  {
    id: "google-ai-studio",
    label: "Google AI Studio",
    fields: [{ key: "GEMINI_API_KEY", label: "apiKey" }],
  },
  {
    id: "xai",
    label: "xAI",
    fields: [{ key: "GROK_API_KEY", label: "apiKey" }],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    fields: [{ key: "ANTHROPIC_API_KEY", label: "apiKey" }],
  },
  {
    id: "cerebras",
    label: "Cerebras",
    fields: [{ key: "CEREBRAS_API_KEY", label: "apiKey" }],
  },
  {
    id: "cohere",
    label: "Cohere",
    fields: [{ key: "COHERE_API_KEY", label: "apiKey" }],
  },
  {
    id: "cline",
    label: "Cline",
    fields: [{ key: "CLINE_API_KEY", label: "apiKey" }],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    fields: [{ key: "DEEPSEEK_API_KEY", label: "apiKey" }],
  },
  {
    id: "groq",
    label: "Groq",
    fields: [{ key: "GROQ_API_KEY", label: "apiKey" }],
  },
  {
    id: "mistral",
    label: "Mistral",
    fields: [{ key: "MISTRAL_API_KEY", label: "apiKey" }],
  },
  {
    id: "nvidia-nim",
    label: "NVIDIA NIM",
    fields: [{ key: "NVIDIA_NIM_API_KEY", label: "apiKey" }],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    fields: [{ key: "OPENROUTER_API_KEY", label: "apiKey" }],
  },
  {
    id: "hugging-face",
    label: "Hugging Face",
    fields: [{ key: "HUGGINGFACE_API_KEY", label: "apiKey" }],
  },
  {
    id: "perplexity-ai",
    label: "Perplexity AI",
    fields: [{ key: "PERPLEXITYAI_API_KEY", label: "apiKey" }],
  },
  {
    id: "replicate",
    label: "Replicate",
    fields: [{ key: "REPLICATE_API_KEY", label: "apiKey" }],
  },
  {
    id: "workers-ai",
    label: "Cloudflare Workers AI",
    fields: [{ key: "CLOUDFLARE_API_KEY", label: "apiKey" }],
  },
  {
    id: "ollama",
    label: "Ollama",
    fields: [{ key: "OLLAMA_API_KEY", label: "apiKey" }],
  },
  {
    id: "azure-openai",
    label: "Azure OpenAI",
    fields: [
      { key: "AZURE_OPENAI_API_KEY", label: "apiKey" },
      { key: "AZURE_OPENAI_RESOURCE_NAME", label: "resourceName" },
      { key: "AZURE_OPENAI_API_VERSION", label: "apiVersion" },
    ],
  },
  {
    id: "google-vertex-ai",
    label: "Google Vertex AI",
    fields: [
      {
        key: "GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON",
        label: "serviceAccountJson",
      },
    ],
  },
  {
    id: "aws-bedrock",
    label: "AWS Bedrock",
    fields: [
      { key: "AWS_BEARER_TOKEN_BEDROCK", label: "bearerToken" },
      { key: "AWS_BEDROCK_REGION", label: "region" },
    ],
  },
] as const;

export const MAIN_MENU_ORDER = [
  "authentication",
  "__providers",
  "custom-endpoints",
  "virtual-models",
  "gateway",
  "behavior",
] as const;

export const TUI_EXCLUDED_FIELDS = new Set<FieldKey>(["DEV"]);

const FIELD_DEFAULT_LABELS: Partial<Record<FieldKey, string>> = {
  ALLOWED_ORIGINS: "*",
  AI_GATEWAY_NAME: "default",
  ALWAYS_USE_AI_GATEWAY: "false",
  AZURE_OPENAI_API_VERSION: "2024-10-21",
  AWS_BEDROCK_REGION: "us-east-1",
  CHAT_RESPONSE_METADATA_ENABLED: "false",
  API_KEY_COOLDOWN_SECONDS: "60",
  MODELS_CACHE_TTL_SECONDS: "300",
  STATUS_CACHE_TTL_SECONDS: "0",
};

const SENSITIVE_FIELDS = new Set<FieldKey>([
  "PROXY_API_KEY",
  "CF_AIG_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CEREBRAS_API_KEY",
  "COHERE_API_KEY",
  "CLINE_API_KEY",
  "DEEPSEEK_API_KEY",
  "GROK_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "NVIDIA_NIM_API_KEY",
  "OPENROUTER_API_KEY",
  "HUGGINGFACE_API_KEY",
  "PERPLEXITYAI_API_KEY",
  "REPLICATE_API_KEY",
  "CLOUDFLARE_API_KEY",
  "OLLAMA_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON",
  "AWS_BEARER_TOKEN_BEDROCK",
  "CUSTOM_OPENAI_ENDPOINTS",
]);

const STRICT_JSON_FIELDS = new Set<FieldKey>([
  "ALLOWED_ORIGINS",
  "GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON",
  "CUSTOM_OPENAI_ENDPOINTS",
  "VIRTUAL_MODELS",
]);

const BOOLEAN_FIELDS = new Set<FieldKey>([
  "ALWAYS_USE_AI_GATEWAY",
  "CHAT_RESPONSE_METADATA_ENABLED",
]);

const NUMBER_FIELDS = new Set<FieldKey>([
  "API_KEY_COOLDOWN_SECONDS",
  "MODELS_CACHE_TTL_SECONDS",
  "STATUS_CACHE_TTL_SECONDS",
]);

const REQUIRED_FIELDS = new Set<FieldKey>(["PROXY_API_KEY"]);

const CREATE_CONFIG_MESSAGES: Record<ConfigTuiLanguage, CreateConfigMessages> =
  {
    en: ENGLISH_CREATE_CONFIG_MESSAGES,
    ja: JAPANESE_CREATE_CONFIG_MESSAGES,
  };

function formatMessage(
  template: string,
  values: Record<string, string | number>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{${key}}`, String(value));
  }
  return result;
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validateCompleteConfig = ajv.compile(configSchema);
const fieldValidators = new Map<FieldKey, ReturnType<typeof ajv.compile>>();

function validationMessage(
  error: ErrorObject,
  language: ConfigTuiLanguage,
): string {
  const location =
    error.instancePath || error.params.missingProperty || "value";
  if (language === "en") {
    return `${location} ${String(error.message)}`.trim();
  }
  const messages = CREATE_CONFIG_MESSAGES[language];
  return `${location} ${messages.validationMessages[error.keyword] ?? messages.invalidConfigurationValue}`;
}

function validateField(
  field: FieldKey,
  value: unknown,
  language: ConfigTuiLanguage,
): string | undefined {
  let validator = fieldValidators.get(field);
  if (!validator) {
    validator = ajv.compile({
      ...(configSchema.properties[field] as object),
      definitions: configSchema.definitions,
    });
    fieldValidators.set(field, validator);
  }
  return validator(value)
    ? undefined
    : validationMessage(validator.errors?.[0] as ErrorObject, language);
}

export function validateConfig(
  config: Config,
  language: ConfigTuiLanguage = "en",
): string[] {
  return validateCompleteConfig(config)
    ? []
    : validateCompleteConfig.errors!.map((error) =>
        validationMessage(error, language),
      );
}

export function parseConfigTuiArguments(
  commandLineArguments: string[] = process.argv.slice(2),
): ConfigTuiArguments {
  const parsed = parseEnvironmentCliArguments(commandLineArguments);
  if (parsed.env && !validateEnvironmentName(parsed.env)) {
    throw new Error(
      "Environment name may contain only letters, numbers, underscores, and hyphens.",
    );
  }
  return { env: parsed.env, help: parsed.help };
}

export function configTuiHelp(): string {
  return `
Usage: secrets [options]

Create or edit a local JSONC configuration through an interactive terminal UI.

Options:
  --env <name>    Edit config.<name>.jsonc instead of config.jsonc
  --help, -h      Show this help message

Examples:
  npm run secrets
  npm run secrets -- --env production
`;
}

export function getConfigTuiPath(
  repositoryRoot: string,
  environmentName?: string,
): string {
  return path.join(
    repositoryRoot,
    environmentName ? `config.${environmentName}.jsonc` : "config.jsonc",
  );
}

export async function discoverCloudflareAccounts(
  execute?: typeof execFileAsync,
): Promise<CloudflareAccount[]> {
  /* istanbul ignore if -- omitted only when the real Wrangler CLI is invoked */
  if (!execute) execute = execFileAsync;
  const { stdout } = await execute("wrangler", ["whoami", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  const parsedOutput = JSON.parse(stdout) as {
    loggedIn?: unknown;
    accounts?: unknown;
  };
  if (parsedOutput.loggedIn !== true || !Array.isArray(parsedOutput.accounts)) {
    throw new Error("Wrangler returned an unexpected identity response.");
  }

  return parsedOutput.accounts.flatMap((account) => {
    if (
      typeof account === "object" &&
      account !== null &&
      typeof (account as { id?: unknown }).id === "string" &&
      typeof (account as { name?: unknown }).name === "string"
    ) {
      return [
        {
          id: (account as { id: string }).id,
          name: (account as { name: string }).name,
        },
      ];
    }
    return [];
  });
}

export function parseConfigSource(source: string): Config {
  try {
    return parseJsonc(source);
  } catch {
    throw new Error("The configuration file is not valid JSONC.");
  }
}

function updateConfigSource(
  source: string,
  field: FieldKey,
  value: unknown,
): string {
  return applyEdits(
    source,
    modify(source, [field], value, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
        eol: "\n",
      },
    }),
  );
}

function fieldDescription(
  field: FieldKey,
  language: ConfigTuiLanguage,
): string {
  return CREATE_CONFIG_MESSAGES[language].fieldDescriptions[field];
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function fieldStatus(
  field: FieldKey,
  value: unknown,
  language: ConfigTuiLanguage,
): string {
  const messages = CREATE_CONFIG_MESSAGES[language];
  const defaultLabel = FIELD_DEFAULT_LABELS[field];
  if (!hasValue(value)) {
    return defaultLabel
      ? formatMessage(messages.effectiveDefaultStatus, {
          default: defaultLabel,
        })
      : messages.notSet;
  }
  const status = SENSITIVE_FIELDS.has(field)
    ? messages.configuredHidden
    : Array.isArray(value)
      ? formatMessage(messages.itemCount, { count: value.length })
      : typeof value === "object"
        ? messages.configuredObject
        : String(value);
  return defaultLabel === status
    ? formatMessage(messages.defaultStatus, { status })
    : status;
}

function parseEnteredValue(field: FieldKey, enteredValue: string): unknown {
  if (NUMBER_FIELDS.has(field)) return Number(enteredValue);
  if (STRICT_JSON_FIELDS.has(field)) {
    return JSON.parse(enteredValue) as unknown;
  }
  if (
    enteredValue.trimStart().startsWith("[") ||
    enteredValue.trimStart().startsWith("{")
  ) {
    try {
      return JSON.parse(enteredValue) as unknown;
    } catch {
      // Provider credentials are opaque strings unless they contain valid JSON.
      return enteredValue;
    }
  }
  return enteredValue;
}

export function validateConfigFieldInput(
  field: FieldKey,
  enteredValue: string,
  language: ConfigTuiLanguage = "en",
): string | undefined {
  const messages = CREATE_CONFIG_MESSAGES[language];
  if (enteredValue.trim() === "") return messages.enterValue;
  try {
    return validateField(
      field,
      parseEnteredValue(field, enteredValue),
      language,
    );
  } catch {
    return messages.enterValidJson;
  }
}

async function promptForNewValue(
  prompts: ConfigTuiPrompts,
  field: FieldKey,
  currentValue: unknown,
  language: ConfigTuiLanguage,
  displayName?: string,
): Promise<unknown | symbol> {
  const messages = CREATE_CONFIG_MESSAGES[language];
  const message =
    displayName ?? `${field} — ${fieldDescription(field, language)}`;
  if (BOOLEAN_FIELDS.has(field)) {
    const selectedValue = await prompts.select({
      message,
      initialValue:
        typeof currentValue === "boolean" ? String(currentValue) : "null",
      options: [
        {
          value: "true",
          label: messages.enabled,
        },
        {
          value: "false",
          label: messages.disabledDefault,
        },
        {
          value: "null",
          label: messages.notSetEffectiveDefault,
        },
      ],
    });
    if (prompts.isCancel(selectedValue) || prompts.isBack(selectedValue)) {
      return selectedValue;
    }
    return selectedValue === "null" ? null : selectedValue === "true";
  }

  const validate = (value: string | undefined): string | undefined =>
    validateConfigFieldInput(field, value ?? "", language);

  let enteredValue: string | symbol;
  if (SENSITIVE_FIELDS.has(field)) {
    enteredValue = await prompts.password({
      message: formatMessage(messages.inputHidden, { message }),
      mask: "•",
      validate,
    });
  } else if (STRICT_JSON_FIELDS.has(field)) {
    enteredValue = await prompts.multiline({
      message: `${message} (JSON)`,
      initialValue: hasValue(currentValue)
        ? JSON.stringify(currentValue, null, 2)
        : undefined,
      placeholder: messages.enterJson,
      validate,
    });
  } else {
    enteredValue = await prompts.text({
      message,
      initialValue: hasValue(currentValue) ? String(currentValue) : undefined,
      placeholder: NUMBER_FIELDS.has(field) ? messages.enterNumber : undefined,
      validate,
    });
  }

  return prompts.isCancel(enteredValue) || prompts.isBack(enteredValue)
    ? enteredValue
    : parseEnteredValue(field, enteredValue);
}

async function chooseInitialAccount(
  prompts: ConfigTuiPrompts,
  accounts: CloudflareAccount[],
  language: ConfigTuiLanguage,
): Promise<string | null | symbol> {
  if (accounts.length === 0) return null;
  if (accounts.length === 1) return accounts[0].id;
  const messages = CREATE_CONFIG_MESSAGES[language];

  return prompts.select({
    message: messages.chooseAccount,
    options: [
      ...accounts.map((account) => ({
        value: account.id,
        label: account.name,
        hint: account.id,
      })),
      {
        value: "",
        label: messages.doNotSetAccount,
        hint: messages.manualAccountHint,
      },
    ],
  });
}

async function editField(
  prompts: ConfigTuiPrompts,
  field: FieldKey,
  currentValue: unknown,
  language: ConfigTuiLanguage,
  requireValue = false,
  displayName?: string,
): Promise<{
  changed: boolean;
  value?: unknown;
  cancelled?: boolean;
  back?: boolean;
}> {
  const messages = CREATE_CONFIG_MESSAGES[language];
  if (requireValue && !hasValue(currentValue)) {
    const value = await promptForNewValue(
      prompts,
      field,
      currentValue,
      language,
      displayName,
    );
    if (prompts.isBack(value)) return { changed: false, back: true };
    return prompts.isCancel(value)
      ? { changed: false, cancelled: true }
      : { changed: true, value };
  }

  while (true) {
    const action = await prompts.select({
      message: formatMessage(messages.fieldStatus, {
        field: displayName ?? field,
        status: fieldStatus(field, currentValue, language),
      }),
      options: [
        {
          value: "change",
          label: messages.changeValue,
        },
        {
          value: "clear",
          label: messages.setToNull,
          hint: messages.deleteOnNextDeployment,
          disabled: REQUIRED_FIELDS.has(field),
        },
        {
          value: "keep",
          label: messages.keepCurrentValue,
        },
      ],
    });
    if (prompts.isBack(action)) return { changed: false, back: true };
    if (prompts.isCancel(action)) return { changed: false, cancelled: true };
    if (action === "keep") return { changed: false };
    if (action === "clear") return { changed: true, value: null };

    const value = await promptForNewValue(
      prompts,
      field,
      currentValue,
      language,
      displayName,
    );
    if (prompts.isBack(value)) continue;
    return prompts.isCancel(value)
      ? { changed: false, cancelled: true }
      : { changed: true, value };
  }
}

async function runProviderFields(
  prompts: ConfigTuiPrompts,
  provider: ProviderGroup,
  config: Config,
  update: (field: FieldKey, value: unknown) => void,
  language: ConfigTuiLanguage,
): Promise<boolean> {
  const messages = CREATE_CONFIG_MESSAGES[language];
  while (true) {
    const selectedField = await prompts.select({
      message: provider.label,
      options: [
        ...provider.fields.map((field) => ({
          value: field.key,
          label: messages.providerFieldLabels[field.label],
          hint: fieldStatus(field.key, config[field.key], language),
        })),
        {
          value: "__back",
          label: messages.backToProviders,
        },
      ],
    });
    if (prompts.isBack(selectedField) || selectedField === "__back")
      return true;
    if (prompts.isCancel(selectedField)) return false;

    const providerField = provider.fields.find(
      (field) => field.key === selectedField,
    );
    /* istanbul ignore next -- every menu value is constructed from provider.fields */
    if (!providerField) throw new Error("Unknown provider setting.");
    const result = await editField(
      prompts,
      providerField.key,
      config[providerField.key],
      language,
      false,
      `${provider.label} — ${messages.providerFieldLabels[providerField.label]}`,
    );
    if (result.back) continue;
    if (result.cancelled) return false;
    if (result.changed) update(providerField.key, result.value);
  }
}

async function runProviderMenu(
  prompts: ConfigTuiPrompts,
  config: Config,
  update: (field: FieldKey, value: unknown) => void,
  language: ConfigTuiLanguage,
): Promise<boolean> {
  const messages = CREATE_CONFIG_MESSAGES[language];
  while (true) {
    const selectedProvider = await prompts.select({
      message: messages.providers,
      maxItems: 12,
      options: [
        ...PROVIDER_GROUPS.map((provider) => ({
          value: provider.id,
          label: provider.label,
          hint: formatMessage(messages.configuredCount, {
            configured: provider.fields.filter((field) =>
              hasValue(config[field.key]),
            ).length,
            total: provider.fields.length,
          }),
        })),
        {
          value: "__back",
          label: messages.backToMainMenu,
        },
      ],
    });
    if (prompts.isBack(selectedProvider) || selectedProvider === "__back") {
      return true;
    }
    if (prompts.isCancel(selectedProvider)) return false;

    const provider = PROVIDER_GROUPS.find(
      (candidate) => candidate.id === selectedProvider,
    );
    /* istanbul ignore next -- every menu value is constructed from PROVIDER_GROUPS */
    if (!provider) throw new Error("Unknown provider.");
    if (
      !(await runProviderFields(prompts, provider, config, update, language))
    ) {
      return false;
    }
  }
}

async function runFieldGroup(
  prompts: ConfigTuiPrompts,
  group: FieldGroup,
  config: Config,
  update: (field: FieldKey, value: unknown) => void,
  language: ConfigTuiLanguage,
): Promise<boolean> {
  const messages = CREATE_CONFIG_MESSAGES[language];
  while (true) {
    const selectedField = await prompts.select({
      message: messages.groupLabels[group.id],
      maxItems: 12,
      options: [
        ...group.fields.map((field) => ({
          value: field,
          label: field,
          hint: fieldStatus(field, config[field], language),
        })),
        {
          value: "__back",
          label: messages.backToMainMenu,
        },
      ],
    });
    if (prompts.isBack(selectedField)) return true;
    if (prompts.isCancel(selectedField)) return false;
    if (selectedField === "__back") return true;

    const field = selectedField as FieldKey;
    const result = await editField(prompts, field, config[field], language);
    if (result.back) continue;
    if (result.cancelled) return false;
    if (result.changed) update(field, result.value);
  }
}

export async function runConfigTui(
  arguments_: ConfigTuiArguments,
  dependencies: ConfigTuiDependencies,
): Promise<"saved" | "cancelled"> {
  /* istanbul ignore next -- default prompt implementation belongs to the interactive runtime */
  const prompts = dependencies.prompts ?? DEFAULT_PROMPTS;
  /* istanbul ignore next -- default filesystem implementation belongs to the interactive runtime */
  const fileSystem = dependencies.fileSystem ?? fs;
  /* istanbul ignore next -- process cwd is supplied by the interactive runtime */
  const repositoryRoot = dependencies.repositoryRoot ?? process.cwd();
  const configPath = getConfigTuiPath(repositoryRoot, arguments_.env);
  const examplePath = path.join(repositoryRoot, CONFIG_EXAMPLE_PATH);
  const isExistingConfig = fileSystem.existsSync(configPath);

  let language = dependencies.language;
  if (!language) {
    const selectedLanguage = await prompts.select({
      message: `${ENGLISH_CREATE_CONFIG_MESSAGES.languagePrompt} / ${JAPANESE_CREATE_CONFIG_MESSAGES.languagePrompt}`,
      initialValue: "en",
      options: [
        {
          value: "en",
          label: ENGLISH_CREATE_CONFIG_MESSAGES.languageName,
        },
        {
          value: "ja",
          label: JAPANESE_CREATE_CONFIG_MESSAGES.languageName,
        },
      ],
    });
    if (
      prompts.isCancel(selectedLanguage) ||
      prompts.isBack(selectedLanguage)
    ) {
      prompts.cancel(
        `${ENGLISH_CREATE_CONFIG_MESSAGES.cancelled} / ${JAPANESE_CREATE_CONFIG_MESSAGES.cancelled}`,
      );
      return "cancelled";
    }
    language = selectedLanguage as ConfigTuiLanguage;
  }
  const messages = CREATE_CONFIG_MESSAGES[language];
  prompts.intro(
    formatMessage(
      isExistingConfig ? messages.introEdit : messages.introCreate,
      {
        file: path.basename(configPath),
      },
    ),
  );
  prompts.note(messages.keyboardMessage, messages.keyboardTitle);

  if (!isExistingConfig && !fileSystem.existsSync(examplePath)) {
    throw new Error(
      formatMessage(messages.exampleNotFound, {
        file: CONFIG_EXAMPLE_PATH,
      }),
    );
  }

  const sourcePath = isExistingConfig ? configPath : examplePath;
  let configSource = fileSystem.readFileSync(sourcePath, "utf8");
  const config = parseConfigSource(configSource);
  let changed = !isExistingConfig;

  const update = (field: FieldKey, value: unknown): void => {
    config[field] = value;
    configSource = updateConfigSource(configSource, field, value);
    changed = true;
  };

  let accounts: CloudflareAccount[] = [];
  try {
    let discoverAccounts = dependencies.discoverAccounts;
    /* istanbul ignore if -- the default invokes the real Wrangler CLI */
    if (!discoverAccounts) discoverAccounts = discoverCloudflareAccounts;
    accounts = await discoverAccounts();
  } catch {
    prompts.note(
      messages.accountDiscoveryUnavailable,
      messages.cloudflareAccount,
    );
  }

  if (!isExistingConfig) {
    config.PROXY_API_KEY = null;

    while (true) {
      const proxyResult = await editField(
        prompts,
        "PROXY_API_KEY",
        config.PROXY_API_KEY,
        language,
        true,
      );
      if (proxyResult.back || proxyResult.cancelled) {
        prompts.cancel(messages.noConfigurationWritten);
        return "cancelled";
      }
      if (proxyResult.changed) update("PROXY_API_KEY", proxyResult.value);

      const accountId = await chooseInitialAccount(prompts, accounts, language);
      if (prompts.isBack(accountId)) continue;
      if (prompts.isCancel(accountId)) {
        prompts.cancel(messages.noConfigurationWritten);
        return "cancelled";
      }
      if (accountId) update("CLOUDFLARE_ACCOUNT_ID", accountId);
      break;
    }
  } else if (!hasValue(config.CLOUDFLARE_ACCOUNT_ID)) {
    const accountId = await chooseInitialAccount(prompts, accounts, language);
    if (prompts.isCancel(accountId)) {
      prompts.cancel(messages.noConfigurationWritten);
      return "cancelled";
    }
    if (!prompts.isBack(accountId) && accountId) {
      update("CLOUDFLARE_ACCOUNT_ID", accountId);
    }
  } else if (accounts.length > 0) {
    prompts.note(
      accounts.map((account) => `${account.name}: ${account.id}`).join("\n"),
      messages.accountsReported,
    );
  }

  while (true) {
    const action = await prompts.select({
      message: formatMessage(
        changed ? messages.configChanged : messages.configUnchanged,
        { file: path.basename(configPath) },
      ),
      options: [
        ...MAIN_MENU_ORDER.map((sectionId) => {
          if (sectionId === "__providers") {
            const providerFields = PROVIDER_GROUPS.flatMap(
              (provider) => provider.fields,
            );
            return {
              value: sectionId,
              label: messages.providers,
              hint: formatMessage(messages.configuredCount, {
                configured: providerFields.filter((field) =>
                  hasValue(config[field.key]),
                ).length,
                total: providerFields.length,
              }),
            };
          }
          const group = FIELD_GROUPS.find(
            (candidate) => candidate.id === sectionId,
          ) as FieldGroup;
          return {
            value: group.id,
            label: messages.groupLabels[group.id],
            hint: formatMessage(messages.configuredCount, {
              configured: group.fields.filter((field) =>
                hasValue(config[field]),
              ).length,
              total: group.fields.length,
            }),
          };
        }),
        {
          value: "__save",
          label: messages.reviewAndSave,
        },
        {
          value: "__cancel",
          label: messages.exitWithoutSaving,
        },
      ],
    });

    if (
      prompts.isBack(action) ||
      prompts.isCancel(action) ||
      action === "__cancel"
    ) {
      prompts.cancel(messages.noChangesWritten);
      return "cancelled";
    }

    if (action !== "__save") {
      if (action === "__providers") {
        if (!(await runProviderMenu(prompts, config, update, language))) {
          prompts.cancel(messages.noChangesWritten);
          return "cancelled";
        }
        continue;
      }
      const group = FIELD_GROUPS.find((candidate) => candidate.id === action);
      /* istanbul ignore next -- every menu value is constructed from FIELD_GROUPS */
      if (!group) throw new Error("Unknown configuration section.");
      if (!(await runFieldGroup(prompts, group, config, update, language))) {
        prompts.cancel(messages.noChangesWritten);
        return "cancelled";
      }
      continue;
    }

    const validationErrors = validateConfig(config, language);
    if (validationErrors.length > 0) {
      prompts.note(
        validationErrors.join("\n"),
        messages.configurationNeedsAttention,
      );
      continue;
    }

    prompts.note(
      [
        ...FIELD_GROUPS.flatMap((group) =>
          group.fields
            .filter((field) => hasValue(config[field]))
            .map(
              (field) =>
                `${field}: ${fieldStatus(field, config[field], language)}`,
            ),
        ),
        ...PROVIDER_GROUPS.flatMap((provider) =>
          provider.fields
            .filter((field) => hasValue(config[field.key]))
            .map(
              (field) =>
                `${provider.label} — ${messages.providerFieldLabels[field.label]}: ${fieldStatus(field.key, config[field.key], language)}`,
            ),
        ),
      ].join("\n"),
      messages.valuesToSave,
    );
    const shouldSave = await prompts.confirm({
      message: formatMessage(messages.saveConfirmation, {
        file: path.basename(configPath),
      }),
      initialValue: true,
    });
    if (prompts.isBack(shouldSave)) continue;
    if (prompts.isCancel(shouldSave)) {
      prompts.cancel(messages.noChangesWritten);
      return "cancelled";
    }
    if (!shouldSave) continue;

    fileSystem.writeFileSync(configPath, configSource, { mode: 0o600 });
    fileSystem.chmodSync(configPath, 0o600);
    prompts.outro(
      formatMessage(messages.completion, {
        file: path.basename(configPath),
        action: isExistingConfig ? messages.updated : messages.created,
      }),
    );
    return "saved";
  }
}

export async function runCreateConfigCli(
  commandLineArguments: string[] = process.argv.slice(2),
  dependencies: ConfigTuiDependencies = {},
): Promise<"saved" | "cancelled" | "help"> {
  const arguments_ = parseConfigTuiArguments(commandLineArguments);
  if (arguments_.help) {
    console.log(configTuiHelp());
    return "help";
  }
  return runConfigTui(arguments_, dependencies);
}

// Run the CLI only when this script is executed directly.
/* istanbul ignore next -- exercised by the Node.js CLI runtime */
if (import.meta.url === `file://${process.argv[1]}`) {
  void runCreateConfigCli().catch((error: unknown) => {
    console.error(`Error: ${getErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
