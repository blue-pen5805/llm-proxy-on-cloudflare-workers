import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleVirtualModelsRequest } from "~/src/requests/virtual_models";
import { Config } from "~/src/utils/config";
import { ConfigurationError } from "~/src/utils/error";

vi.mock("~/src/utils/config");

describe("virtual models", () => {
  const context = {
    providers: {
      get: vi.fn((providerSelector: string) =>
        ["openai", "anthropic"].includes(providerSelector) ? {} : undefined,
      ),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists virtual models and their configured access order", async () => {
    vi.mocked(Config.virtualModels).mockReturnValue({
      "virtual/fast": [
        { model: "openai/gpt-4o-mini", retries: 0 },
        {
          model: "anthropic/claude-sonnet",
          retries: 2,
          timeout: 5_000,
        },
      ],
      "virtual/reliable": [
        { model: "virtual/fast", retries: 1, timeout: 10_000 },
      ],
    });

    const response = handleVirtualModelsRequest(context);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toEqual({
      object: "list",
      data: [
        {
          id: "virtual/fast",
          object: "model",
          created: 0,
          owned_by: "virtual",
          access_order: [
            {
              position: 1,
              model: "openai/gpt-4o-mini",
              retries: 0,
              attempts: 1,
            },
            {
              position: 2,
              model: "anthropic/claude-sonnet",
              retries: 2,
              attempts: 3,
              timeout_ms: 5_000,
            },
          ],
        },
        {
          id: "virtual/reliable",
          object: "model",
          created: 0,
          owned_by: "virtual",
          access_order: [
            {
              position: 1,
              model: "virtual/fast",
              retries: 1,
              attempts: 2,
              timeout_ms: 10_000,
              access_order: [
                {
                  position: 1,
                  model: "openai/gpt-4o-mini",
                  retries: 0,
                  attempts: 1,
                },
                {
                  position: 2,
                  model: "anthropic/claude-sonnet",
                  retries: 2,
                  attempts: 3,
                  timeout_ms: 5_000,
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("returns an empty list when virtual models are not configured", async () => {
    vi.mocked(Config.virtualModels).mockReturnValue(undefined);

    expect(await handleVirtualModelsRequest(context).json()).toEqual({
      object: "list",
      data: [],
    });
  });

  it("does not expand a virtual-model key shadowed by a real provider", async () => {
    vi.mocked(Config.virtualModels).mockReturnValue({
      "virtual/shadow-check": [{ model: "openai/fallback", retries: 0 }],
      "openai/fallback": [{ model: "anthropic/claude-sonnet", retries: 0 }],
    });

    const body = (await handleVirtualModelsRequest(context).json()) as any;

    expect(body.data[0].access_order).toEqual([
      {
        position: 1,
        model: "openai/fallback",
        retries: 0,
        attempts: 1,
      },
    ]);
  });

  it("rejects a cyclic graph if one reaches the renderer", () => {
    vi.mocked(Config.virtualModels).mockReturnValue({
      "virtual/one": [{ model: "virtual/two", retries: 0 }],
      "virtual/two": [{ model: "virtual/one", retries: 0 }],
    });

    expect(() => handleVirtualModelsRequest(context)).toThrow(
      ConfigurationError,
    );
  });
});
