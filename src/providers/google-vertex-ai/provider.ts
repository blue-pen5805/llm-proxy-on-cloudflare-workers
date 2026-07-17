import { Environments } from "../../utils/environments";
import { shuffleArray } from "../../utils/helpers";
import { Secrets } from "../../utils/secrets";
import {
  OpenAICompatibleProvider,
  ProviderNotSupportedError,
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

export class GoogleVertexAi extends OpenAICompatibleProvider {
  readonly apiKeyName = "GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON" as const;
  readonly supportsAiGatewayModels = false;
  readonly requiresAiGateway = true;
  readonly requiresAuthenticatedAiGateway = true;
  readonly requiresProviderCredentials = true;
  get modelsPath(): string {
    return "";
  }

  private parseCredentials(): ParsedCredentials {
    const raw = Environments.get(this.apiKeyName, false);
    if (!raw?.trim()) return { credentials: [] };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        credentials: [],
        error: `${this.apiKeyName} must contain valid JSON.`,
      };
    }

    const values = Array.isArray(parsed) ? parsed : [parsed];
    if (values.length === 0) return { credentials: [] };

    const credentials: ServiceAccountJson[] = [];
    for (const value of values) {
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        (value as Record<string, unknown>).type !== "service_account" ||
        !isNonEmptyString((value as Record<string, unknown>).project_id) ||
        !isNonEmptyString((value as Record<string, unknown>).private_key) ||
        !isNonEmptyString((value as Record<string, unknown>).client_email) ||
        !isNonEmptyString((value as Record<string, unknown>).region)
      ) {
        return {
          credentials: [],
          error: `${this.apiKeyName} must be a service-account JSON object (or array of objects) with non-empty type, project_id, private_key, client_email, and region fields.`,
        };
      }
      credentials.push(value as ServiceAccountJson);
    }

    return { credentials };
  }

  getApiKeys(): string[] {
    const { credentials, error } = this.parseCredentials();
    if (error) return [];
    return credentials.map((credential) =>
      encodeBase64Utf8(JSON.stringify(credential)),
    );
  }

  getAiGatewayApiKeys(): string[] {
    return shuffleArray(this.getApiKeys());
  }

  async getNextApiKeyIndex(): Promise<number> {
    return Secrets.getNextIndex(this.apiKeyName, this.getApiKeys().length);
  }

  configurationError(): string | undefined {
    return this.parseCredentials().error;
  }

  async buildModelsRequest(): Promise<[string, RequestInit]> {
    throw new ProviderNotSupportedError(
      "Vertex AI does not expose OpenAI-compatible model discovery.",
    );
  }

  async fetch(): Promise<Response> {
    throw new ProviderNotSupportedError(
      "Google Vertex AI requires Cloudflare AI Gateway.",
    );
  }
}
