import { describe, it, expect, vi, beforeEach } from "vitest";
import { CloudflareAIGateway } from "~/src/ai_gateway";
import { Providers } from "~/src/providers";
import { ProviderNotSupportedError } from "~/src/providers/provider";
import { models } from "~/src/requests/models";
import * as helpers from "~/src/utils/helpers";
import { Secrets } from "~/src/utils/secrets";

vi.mock("~/src/ai_gateway");
vi.mock("~/src/providers");
vi.mock("~/src/utils/helpers");
vi.mock("~/src/utils/secrets");

interface ModelData {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface ModelsResponse {
  object: string;
  data: ModelData[];
}

describe("models", () => {
  const mockProviderClass = {
    available: vi.fn(),
    buildModelsRequest: vi.fn(),
    modelsToOpenAIFormat: vi.fn(),
    fetch: vi.fn(),
    headers: vi.fn(),
  };

  const mockAIGateway = {
    buildProviderEndpointRequest: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Clear Providers object
    Object.keys(Providers).forEach((key) => {
      delete Providers[key];
    });

    vi.mocked(helpers.fetch2).mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [] }))),
    );
    vi.mocked(CloudflareAIGateway.isSupportedProvider).mockReturnValue(true);
    vi.mocked(Secrets.getAll).mockReturnValue(["test-key"]);
    vi.mocked(Secrets.getNext).mockResolvedValue(0);

    // Set up default mock providers in a specific order
    Providers.openai = vi.fn().mockReturnValue(mockProviderClass);
    Providers.anthropic = vi.fn().mockReturnValue(mockProviderClass);

    mockProviderClass.available.mockReturnValue(true);
    mockProviderClass.buildModelsRequest.mockReturnValue([
      "/models",
      { method: "GET" },
    ]);
    mockProviderClass.modelsToOpenAIFormat.mockReturnValue({
      object: "list",
      data: [
        {
          id: "gpt-4",
          object: "model",
          created: 1234567890,
          owned_by: "openai",
        },
      ],
    });
    mockProviderClass.headers.mockReturnValue({
      "Content-Type": "application/json",
    });
    mockProviderClass.fetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [] }))),
    );
  });

  it("should return models from all available providers", async () => {
    const response = await models();

    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = (await response.json()) as ModelsResponse;
    expect(body).toEqual({
      object: "list",
      data: [
        {
          id: "openai/gpt-4",
          object: "model",
          created: 1234567890,
          owned_by: "openai",
        },
        {
          id: "anthropic/gpt-4",
          object: "model",
          created: 1234567890,
          owned_by: "openai",
        },
      ],
    });
  });

  it("should skip unavailable providers", async () => {
    const unavailableProviderClass = {
      ...mockProviderClass,
      available: vi.fn().mockReturnValue(false),
    };

    // Clear and reset providers
    Object.keys(Providers).forEach((key) => {
      delete Providers[key];
    });

    Providers.openai = vi.fn().mockReturnValue(mockProviderClass);
    Providers.unavailable = vi.fn().mockReturnValue(unavailableProviderClass);

    const response = await models();
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("openai/gpt-4");
  });

  it("should use AI Gateway when available and provider supported", async () => {
    mockAIGateway.buildProviderEndpointRequest.mockReturnValue([
      "https://gateway.ai.cloudflare.com/v1/account/gateway/openai/models",
      { method: "GET", headers: {} },
    ]);

    await models(mockAIGateway as any);

    expect(CloudflareAIGateway.isSupportedProvider).toHaveBeenCalledWith(
      "openai",
    );
    expect(mockAIGateway.buildProviderEndpointRequest).toHaveBeenCalledWith({
      provider: "openai",
      method: "GET",
      path: "/models",
      headers: { "Content-Type": "application/json" },
    });
    expect(helpers.fetch2).toHaveBeenCalled();
  });

  it("should handle provider errors gracefully", async () => {
    const errorProviderClass = {
      ...mockProviderClass,
      fetch: vi.fn().mockRejectedValue(new Error("Network error")),
    };

    // Clear and reset providers
    Object.keys(Providers).forEach((key) => {
      delete Providers[key];
    });

    Providers.openai = vi.fn().mockReturnValue(mockProviderClass);
    Providers.error = vi.fn().mockReturnValue(errorProviderClass);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await models();
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("openai/gpt-4");
    expect(consoleSpy).toHaveBeenCalledWith(
      "Error fetching models for provider error:",
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it("should handle ProviderNotSupportedError specially", async () => {
    const notSupportedProviderClass = {
      ...mockProviderClass,
      fetch: vi
        .fn()
        .mockRejectedValue(new ProviderNotSupportedError("Not supported")),
    };

    // Clear and reset providers
    Object.keys(Providers).forEach((key) => {
      delete Providers[key];
    });

    Providers.openai = vi.fn().mockReturnValue(mockProviderClass);
    Providers.notsupported = vi.fn().mockReturnValue(notSupportedProviderClass);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await models();
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("openai/gpt-4");
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("should handle invalid response format", async () => {
    const invalidResponseProviderClass = {
      ...mockProviderClass,
      fetch: vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify({ data: [] }))),
        ),
      modelsToOpenAIFormat: vi.fn().mockReturnValue(null),
    };

    // Clear and reset providers
    Object.keys(Providers).forEach((key) => {
      delete Providers[key];
    });

    Providers.openai = vi.fn().mockReturnValue(mockProviderClass);
    Providers.invalid = vi.fn().mockReturnValue(invalidResponseProviderClass);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await models();
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("openai/gpt-4");
    expect(consoleSpy).toHaveBeenCalledWith(
      "Invalid response for provider invalid:",
      null,
    );

    consoleSpy.mockRestore();
  });

  it("should handle response without data field", async () => {
    const noDataProviderClass = {
      ...mockProviderClass,
      fetch: vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify({ data: [] }))),
        ),
      modelsToOpenAIFormat: vi.fn().mockReturnValue({ object: "list" }),
    };

    // Clear and reset providers
    Object.keys(Providers).forEach((key) => {
      delete Providers[key];
    });

    Providers.openai = vi.fn().mockReturnValue(mockProviderClass);
    Providers.nodata = vi.fn().mockReturnValue(noDataProviderClass);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await models();
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("openai/gpt-4");
    expect(consoleSpy).toHaveBeenCalledWith(
      "Invalid response for provider nodata:",
      { object: "list" },
    );

    consoleSpy.mockRestore();
  });

  it("should prefix model IDs with provider name", async () => {
    const multiModelProviderClass = {
      ...mockProviderClass,
      modelsToOpenAIFormat: vi.fn().mockReturnValue({
        object: "list",
        data: [
          {
            id: "gpt-4",
            object: "model",
            created: 1234567890,
            owned_by: "openai",
          },
          {
            id: "gpt-3.5-turbo",
            object: "model",
            created: 1234567890,
            owned_by: "openai",
          },
        ],
      }),
    };

    // Clear and reset providers
    Object.keys(Providers).forEach((key) => {
      delete Providers[key];
    });

    Providers.openai = vi.fn().mockReturnValue(multiModelProviderClass);

    const response = await models();
    const body = (await response.json()) as ModelsResponse;

    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("openai/gpt-4");
    expect(body.data[1].id).toBe("openai/gpt-3.5-turbo");
  });
});
