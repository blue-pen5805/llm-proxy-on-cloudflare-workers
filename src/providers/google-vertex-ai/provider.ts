import { Environments } from "../../utils/environments";
import { Secrets } from "../../utils/secrets";
import {
  DEFAULT_PROVIDER_PROFILE,
  PROVIDER_PROFILE_PATTERN,
} from "../../utils/secrets";
import {
  convertedChatEndpoint,
  jsonEndpoint,
  type ChatConversionCodec,
} from "../inference";
import { generateContentEndpoint, messagesEndpoint } from "../native";
import { unsupportedNativeField } from "../native_request";
import {
  defineProvider,
  ProviderNotSupportedError,
  type Provider,
} from "../provider";

interface ServiceAccountJson extends Record<string, unknown> {
  type: "service_account";
  project_id: string;
  private_key: string;
  client_email: string;
  region: string;
}

interface ParsedCredentials {
  credentials: ServiceAccountJson[];
  error?: string;
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const API_KEY_NAME = "GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON" as const;

const EMPTY_CREDENTIALS: ParsedCredentials = { credentials: [] };

// Parsing and validating the service-account JSON is a pure function of the
// raw secret, so the last result is memoized. Without this, every credential
// read re-parses multi-kilobyte key material several times per request.
let cachedCredentialsRaw: string | undefined;
let cachedCredentialsByProfile = new Map<string, ParsedCredentials>();

// The Gateway credential is the base64-encoded service-account JSON; encoding
// is likewise memoized by the parsed credentials' identity.
const encodedCredentialCache = new WeakMap<ServiceAccountJson[], string[]>();

// Profile discovery re-reads the same multi-kilobyte secret on every provider
// enumeration (`/models`, `/status`), so its result is memoized by raw value
// alongside the parsed credentials.
let cachedProfilesRaw: string | undefined;
let cachedProfiles: string[] = [];

function listCredentialProfiles(): string[] {
  const serializedCredentials = Environments.get(API_KEY_NAME, false);
  if (!serializedCredentials?.trim()) return [];
  if (serializedCredentials === cachedProfilesRaw) return cachedProfiles;

  cachedProfilesRaw = serializedCredentials;
  cachedProfiles = computeCredentialProfiles(serializedCredentials);
  return cachedProfiles;
}

function computeCredentialProfiles(serializedCredentials: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedCredentials);
  } catch {
    return [];
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    (parsed as Record<string, unknown>).type !== "service_account"
  ) {
    return Object.keys(parsed).filter((profile) =>
      PROVIDER_PROFILE_PATTERN.test(profile),
    );
  }
  return [DEFAULT_PROVIDER_PROFILE];
}

function parseServiceAccountCredentials(profile: string): ParsedCredentials {
  const serializedCredentials = Environments.get(API_KEY_NAME, false);
  if (!serializedCredentials?.trim()) return EMPTY_CREDENTIALS;

  if (serializedCredentials !== cachedCredentialsRaw) {
    cachedCredentialsByProfile = new Map();
    cachedCredentialsRaw = serializedCredentials;
  }
  let credentials = cachedCredentialsByProfile.get(profile);
  if (!credentials) {
    credentials = computeServiceAccountCredentials(
      serializedCredentials,
      profile,
    );
    cachedCredentialsByProfile.set(profile, credentials);
  }
  return credentials;
}

function computeServiceAccountCredentials(
  serializedCredentials: string,
  profile: string,
): ParsedCredentials {
  let parsedCredentials: unknown;
  try {
    parsedCredentials = JSON.parse(serializedCredentials);
  } catch {
    return {
      credentials: [],
      error: `${API_KEY_NAME} must contain valid JSON.`,
    };
  }

  const isUnprofiledCredential =
    typeof parsedCredentials === "object" &&
    parsedCredentials !== null &&
    !Array.isArray(parsedCredentials) &&
    (parsedCredentials as Record<string, unknown>).type === "service_account";
  const selectedCredentials =
    isUnprofiledCredential || Array.isArray(parsedCredentials)
      ? profile === DEFAULT_PROVIDER_PROFILE
        ? parsedCredentials
        : undefined
      : typeof parsedCredentials === "object" && parsedCredentials !== null
        ? (parsedCredentials as Record<string, unknown>)[profile]
        : parsedCredentials;
  const credentialCandidates = Array.isArray(selectedCredentials)
    ? selectedCredentials
    : selectedCredentials === undefined
      ? []
      : [selectedCredentials];
  if (credentialCandidates.length === 0) return { credentials: [] };

  const credentials: ServiceAccountJson[] = [];
  for (const credentialCandidate of credentialCandidates) {
    if (
      typeof credentialCandidate !== "object" ||
      credentialCandidate === null ||
      Array.isArray(credentialCandidate) ||
      (credentialCandidate as Record<string, unknown>).type !==
        "service_account" ||
      !isNonEmptyString(
        (credentialCandidate as Record<string, unknown>).project_id,
      ) ||
      !isNonEmptyString(
        (credentialCandidate as Record<string, unknown>).private_key,
      ) ||
      !isNonEmptyString(
        (credentialCandidate as Record<string, unknown>).client_email,
      ) ||
      !isNonEmptyString((credentialCandidate as Record<string, unknown>).region)
    ) {
      return {
        credentials: [],
        error: `${API_KEY_NAME} must be a service-account JSON object (or array of objects) with non-empty type, project_id, private_key, client_email, and region fields.`,
      };
    }
    credentials.push(credentialCandidate as ServiceAccountJson);
  }

  return { credentials };
}

const vertexGenerateContentEndpoint: ChatConversionCodec = {
  ...generateContentEndpoint,
  prepare(data) {
    if (data.model.includes("/") && !data.model.startsWith("google/"))
      return unsupportedNativeField("this Vertex publisher");
    const prepared = generateContentEndpoint.prepare({
      ...data,
      model: data.model.replace(/^google\//, ""),
    });
    return {
      path: `/publishers/google${prepared.path.replace("/v1beta", "")}`,
      data: prepared.data,
    };
  },
};

const vertexMessagesEndpoint: ChatConversionCodec = {
  ...messagesEndpoint,
  prepare(data) {
    const prepared = messagesEndpoint.prepare(data);
    delete prepared.data.model;
    prepared.data.anthropic_version = "vertex-2023-10-16";
    return {
      path: `/publishers/anthropic/models/${encodeURIComponent(data.model.slice("anthropic/".length))}:${data.stream ? "streamRawPredict" : "rawPredict"}`,
      data: prepared.data,
    };
  },
};

function vertexPath(
  provider: Provider,
  path: string,
  apiKeyIndex?: number,
): string {
  const credentials = parseServiceAccountCredentials(
    provider.credentialProfile,
  ).credentials;
  // Configuration validation requires at least one valid service account.
  const credential = credentials[(apiKeyIndex ?? 0) % credentials.length]!;
  return `/v1/projects/${encodeURIComponent(credential.project_id)}/locations/${encodeURIComponent(credential.region)}${path}`;
}

function vertexChatEndpoint(codec: ChatConversionCodec) {
  return convertedChatEndpoint(codec, {
    prepareGateway(data, apiKeyIndex) {
      const prepared = codec.prepare(data);
      return {
        ...prepared,
        path: vertexPath(this, prepared.path, apiKeyIndex),
      };
    },
  });
}

const vertexAnthropicChatEndpoint = vertexChatEndpoint(vertexMessagesEndpoint);

const vertexNativeMessagesEndpoint = jsonEndpoint(function (data, apiKeyIndex) {
  const { model: _model, ...body } = data;
  return {
    path: vertexPath(
      this,
      `/publishers/anthropic/models/${encodeURIComponent(data.model.slice("anthropic/".length))}:${data.stream ? "streamRawPredict" : "rawPredict"}`,
      apiKeyIndex,
    ),
    data: { ...body, anthropic_version: "vertex-2023-10-16" },
  };
});

const vertexNativeChatEndpoint = jsonEndpoint(function (data, apiKeyIndex) {
  return {
    path: vertexPath(this, "/endpoints/openapi/chat/completions", apiKeyIndex),
    data: {
      ...data,
      model: data.model.startsWith("google/")
        ? data.model
        : `google/${data.model}`,
    },
  };
});

export const GoogleVertexAi = defineProvider({
  resolveEndpoint(model, protocol) {
    if (
      protocol === "chat_completions" &&
      (!model.includes("/") || model.startsWith("google/"))
    )
      return vertexNativeChatEndpoint;
    return protocol === "messages" && model.startsWith("anthropic/")
      ? vertexNativeMessagesEndpoint
      : undefined;
  },
  openAICompatible: true,
  chatFallback: vertexChatEndpoint(vertexGenerateContentEndpoint),
  resolveChatFallback(model) {
    return model.startsWith("anthropic/")
      ? vertexAnthropicChatEndpoint
      : undefined;
  },
  apiKeyName: API_KEY_NAME,
  requiresAiGateway: true,
  requiresAuthenticatedAiGateway: true,
  requiresProviderCredentials: true,

  getApiKeys(): string[] {
    const { credentials, error } = parseServiceAccountCredentials(
      this.credentialProfile,
    );
    if (error) return [];
    let encodedCredentials = encodedCredentialCache.get(credentials);
    if (!encodedCredentials) {
      encodedCredentials = credentials.map((credential) =>
        encodeBase64Utf8(JSON.stringify(credential)),
      );
      encodedCredentialCache.set(credentials, encodedCredentials);
    }
    return encodedCredentials;
  },

  getCredentialProfiles(): string[] {
    return listCredentialProfiles();
  },

  getAiGatewayApiKeys(): string[] {
    return this.getApiKeys();
  },

  async getNextApiKeyIndex(): Promise<number> {
    return Secrets.getNextIndex(
      this.credentialProfile === DEFAULT_PROVIDER_PROFILE
        ? API_KEY_NAME
        : `${API_KEY_NAME}:${this.credentialProfile}`,
      this.getApiKeys().length,
    );
  },

  configurationError(): string | undefined {
    return parseServiceAccountCredentials(this.credentialProfile).error;
  },

  async fetch(): Promise<Response> {
    throw new ProviderNotSupportedError(
      "Google Vertex AI requires Cloudflare AI Gateway.",
    );
  },
});
