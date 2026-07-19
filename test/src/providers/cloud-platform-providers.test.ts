import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AwsBedrock } from "~/src/providers/aws-bedrock/provider";
import { AzureOpenAI } from "~/src/providers/azure-openai/provider";
import { GoogleVertexAi } from "~/src/providers/google-vertex-ai/provider";
import { ProviderNotSupportedError } from "~/src/providers/provider";
import { Environments } from "~/src/utils/environments";
import { Secrets } from "~/src/utils/secrets";

const values: Partial<Record<keyof Env, string>> = {
  AZURE_OPENAI_API_KEY: "azure-key",
  AZURE_OPENAI_RESOURCE_NAME: "example-resource",
  AZURE_OPENAI_API_VERSION: "2024-10-21",
  GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON: JSON.stringify({
    type: "service_account",
    project_id: "example-project",
    private_key:
      "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n",
    client_email: "vertex@example-project.iam.gserviceaccount.com",
    region: "us-central1",
  }),
  AWS_BEARER_TOKEN_BEDROCK: "bedrock-key",
  AWS_BEDROCK_REGION: "us-east-1",
};

describe("cloud platform providers", () => {
  beforeEach(() => {
    values.GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON = JSON.stringify({
      type: "service_account",
      project_id: "example-project",
      private_key:
        "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n",
      client_email: "vertex@example-project.iam.gserviceaccount.com",
      region: "us-central1",
    });
    Environments.setEnv(values as Env);
    vi.spyOn(Secrets, "get").mockImplementation((name) => values[name] ?? "");
    vi.spyOn(Secrets, "getAll").mockImplementation((name) => {
      const value = values[name];
      return value ? [value] : [];
    });
  });

  afterEach(() => {
    Environments.setEnv(undefined);
    vi.restoreAllMocks();
  });

  it("builds Azure OpenAI v1 direct requests", async () => {
    const provider = new AzureOpenAI();

    expect(provider.available()).toBe(true);
    expect(provider.requiresProviderCredentialsForModels).toBe(true);
    expect(provider.baseUrl()).toBe(
      "https://example-resource.openai.azure.com",
    );
    expect(provider.pathnamePrefix()).toBe("/openai/v1");
    await expect(provider.headers()).resolves.toEqual({
      "Content-Type": "application/json",
      "api-key": "azure-key",
    });
    await expect(provider.buildModelsRequest()).resolves.toEqual([
      "/models",
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "api-key": "azure-key",
        },
      },
    ]);
  });

  it("builds Azure provider-native AI Gateway chat requests", async () => {
    const provider = new AzureOpenAI();
    const [path, init] = await provider.buildAiGatewayChatCompletionsRequest({
      data: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
      headers: { "x-client": "kept" },
    });

    expect(path).toBe(
      "/example-resource/gpt-4o/chat/completions?api-version=2024-10-21",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(new Headers(init.headers).get("api-key")).toBe("azure-key");
    expect(new Headers(init.headers).get("x-client")).toBe("kept");
    expect(
      provider.aiGatewayPath(
        "/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21",
      ),
    ).toBe("/example-resource/gpt-4o/chat/completions?api-version=2024-10-21");
  });

  it("uses Azure defaults when optional credentials and paths are absent", async () => {
    delete values.AZURE_OPENAI_API_KEY;
    delete values.AZURE_OPENAI_API_VERSION;
    const provider = new AzureOpenAI();

    expect(provider.available()).toBe(false);
    await expect(provider.headers()).resolves.toEqual({
      "Content-Type": "application/json",
    });
    expect(provider.aiGatewayPath("/openai/v1/models")).toBe(
      "/openai/v1/models",
    );
    const [path] = await provider.buildAiGatewayChatCompletionsRequest({
      data: { model: "gpt-4o", messages: [] },
      headers: {},
    });
    expect(path).toContain("api-version=2024-10-21");
  });

  it("marks Azure OpenAI and Bedrock unavailable without their API credentials", () => {
    delete values.AZURE_OPENAI_API_KEY;
    delete values.AWS_BEARER_TOKEN_BEDROCK;
    try {
      expect(new AzureOpenAI().available()).toBe(false);
      expect(new AwsBedrock().available()).toBe(false);
    } finally {
      values.AZURE_OPENAI_API_KEY = "azure-key";
      values.AWS_BEARER_TOKEN_BEDROCK = "bedrock-key";
    }
  });

  it("encodes Vertex service-account JSON for authenticated Gateway use", async () => {
    const provider = new GoogleVertexAi();

    expect(provider.requiresAiGateway).toBe(true);
    expect(provider.requiresAuthenticatedAiGateway).toBe(true);
    expect(provider.requiresProviderCredentials).toBe(true);
    expect(provider.apiKeyName).toBe("GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON");
    const [credential] = provider.getApiKeys();
    expect(JSON.parse(atob(credential))).toEqual(
      JSON.parse(values.GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON!),
    );
    await expect(provider.headers()).resolves.toEqual({
      "Content-Type": "application/json",
      Authorization: `Bearer ${credential}`,
    });
    expect(provider.configurationError()).toBeUndefined();
    expect(provider.modelsPath).toBe("");
    await expect(provider.buildModelsRequest()).rejects.toBeInstanceOf(
      ProviderNotSupportedError,
    );
    await expect(provider.fetch()).rejects.toThrow(
      "Google Vertex AI requires Cloudflare AI Gateway.",
    );
  });

  it("rejects Vertex service-account JSON without a region", () => {
    values.GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON = JSON.stringify({
      type: "service_account",
      project_id: "example-project",
      private_key: "private-key",
      client_email: "vertex@example-project.iam.gserviceaccount.com",
    });

    const provider = new GoogleVertexAi();
    expect(provider.getApiKeys()).toEqual([]);
    expect(provider.configurationError()).toContain("region");
  });

  it("handles absent, malformed, empty, and array Vertex credentials", async () => {
    const provider = new GoogleVertexAi();

    delete values.GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON;
    expect(provider.getApiKeys()).toEqual([]);

    values.GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON = "not-json";
    expect(provider.configurationError()).toContain("valid JSON");

    values.GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON = "[]";
    expect(provider.getApiKeys()).toEqual([]);

    values.GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON = JSON.stringify([
      {
        type: "service_account",
        project_id: "example-project",
        private_key: "private-key",
        client_email: "vertex@example-project.iam.gserviceaccount.com",
        region: "us-central1",
      },
    ]);
    expect(provider.getAiGatewayApiKeys()).toHaveLength(1);
    vi.spyOn(Secrets, "getNextIndex").mockResolvedValue(0);
    await expect(provider.getNextApiKeyIndex()).resolves.toBe(0);
    expect(Secrets.getNextIndex).toHaveBeenCalledWith(
      "GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON",
      1,
    );
  });

  it("builds Bedrock Runtime OpenAI-compatible and Gateway paths", async () => {
    const provider = new AwsBedrock();

    expect(provider.available()).toBe(true);
    expect(provider.requiresProviderCredentialsForModels).toBe(true);
    expect(provider.apiKeyName).toBe("AWS_BEARER_TOKEN_BEDROCK");
    expect(provider.baseUrl()).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com",
    );
    expect(provider.pathnamePrefix()).toBe("/v1");
    await expect(provider.headers()).resolves.toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer bedrock-key",
    });
    expect(provider.aiGatewayPath("/v1/models")).toBe(
      "/bedrock-runtime/us-east-1/v1/models",
    );
  });

  it("silently omits Bedrock model discovery when no region is configured", async () => {
    delete values.AWS_BEDROCK_REGION;
    try {
      expect(new AwsBedrock().available()).toBe(false);
      await expect(
        new AwsBedrock().buildModelsRequest(),
      ).rejects.toBeInstanceOf(ProviderNotSupportedError);
    } finally {
      values.AWS_BEDROCK_REGION = "us-east-1";
    }
  });

  it("builds Bedrock model discovery when its region is configured", async () => {
    await expect(new AwsBedrock().buildModelsRequest()).resolves.toEqual([
      "/models",
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer bedrock-key",
        },
      },
    ]);
  });

  it.each([
    [
      new AzureOpenAI(),
      "https://example-resource.openai.azure.com/openai/v1/chat/completions",
    ],
    [
      new AwsBedrock(),
      "https://bedrock-runtime.us-east-1.amazonaws.com/v1/chat/completions",
    ],
  ])("builds the complete direct chat URL for %s", async (provider, url) => {
    const [path, init] = await provider.buildChatCompletionsRequest({
      body: JSON.stringify({ model: "model-id", messages: [] }),
      headers: {},
    });
    const [requestUrl, requestInit] = await provider.buildRequest(path, init);

    expect(requestUrl).toBe(url);
    expect(requestInit.method).toBe("POST");
    expect(JSON.parse(requestInit.body as string)).toEqual({
      model: "model-id",
      messages: [],
    });
  });

  it("rejects invalid host configuration instead of constructing URLs", () => {
    values.AZURE_OPENAI_RESOURCE_NAME = "bad.example/path";
    values.AWS_BEDROCK_REGION = "example.com";
    try {
      expect(new AzureOpenAI().available()).toBe(false);
      expect(new AwsBedrock().available()).toBe(false);
      expect(() => new AzureOpenAI().baseUrl()).toThrow(
        "AZURE_OPENAI_RESOURCE_NAME is missing or invalid.",
      );
      expect(() => new AwsBedrock().baseUrl()).toThrow(
        "AWS_BEDROCK_REGION is missing or invalid.",
      );
    } finally {
      values.AZURE_OPENAI_RESOURCE_NAME = "example-resource";
      values.AWS_BEDROCK_REGION = "us-east-1";
    }
  });
});
