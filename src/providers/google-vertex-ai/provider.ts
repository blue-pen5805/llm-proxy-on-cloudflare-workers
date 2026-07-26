import { Environments } from "../../utils/environments";
import { Secrets } from "../../utils/secrets";
import {
  DEFAULT_PROVIDER_PROFILE,
  PROVIDER_PROFILE_PATTERN,
} from "../../utils/secrets";
import { defineProvider, ProviderNotSupportedError } from "../provider";

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

export const GoogleVertexAi = defineProvider({
  openAICompatible: true,
  apiKeyName: API_KEY_NAME,
  supportsAiGatewayModels: false,
  requiresAiGateway: true,
  requiresAuthenticatedAiGateway: true,
  requiresProviderCredentials: true,
  modelsPath: "",
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

  async buildModelsRequest(): Promise<[string, RequestInit]> {
    throw new ProviderNotSupportedError(
      "Vertex AI does not expose OpenAI-compatible model discovery.",
    );
  },

  async fetch(): Promise<Response> {
    throw new ProviderNotSupportedError(
      "Google Vertex AI requires Cloudflare AI Gateway.",
    );
  },
});
