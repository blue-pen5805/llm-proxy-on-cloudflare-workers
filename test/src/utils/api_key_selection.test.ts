import { afterEach, describe, expect, it, vi } from "vitest";
import type { MiddlewareContext } from "~/src/middleware";
import type { ProviderBase } from "~/src/providers/provider";
import {
  apiKeySelectionPolicy,
  recordApiKeySelection,
  selectApiKeyIndex,
} from "~/src/utils/api_key_selection";
import { Secrets } from "~/src/utils/secrets";

describe("API key selection logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [2, "rotate", "explicit_index"],
    [{ start: 1, end: 3 }, "rotate", "explicit_range"],
    [undefined, "rotate", "automatic_rotation"],
    [undefined, "first", "default_first"],
  ] as const)(
    "classifies selection %j with %s fallback as %s",
    (selection, fallback, expected) => {
      expect(
        apiKeySelectionPolicy(
          selection as MiddlewareContext["apiKeyIndex"],
          fallback,
        ),
      ).toBe(expected);
    },
  );

  it("resolves explicit and fallback selections", async () => {
    const provider = {
      getApiKeys: vi.fn().mockReturnValue(["first", "second"]),
      getNextApiKeyIndex: vi.fn().mockResolvedValue(1),
    } as unknown as ProviderBase;
    vi.spyOn(Secrets, "resolveApiKeyIndex").mockReturnValue(0);

    await expect(
      selectApiKeyIndex(provider, { start: 0 }, "rotate"),
    ).resolves.toBe(0);
    await expect(
      selectApiKeyIndex(provider, undefined, "rotate"),
    ).resolves.toBe(1);
    await expect(selectApiKeyIndex(provider, undefined, "first")).resolves.toBe(
      0,
    );
  });

  it("records a safe zero-based key identifier", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    const fields = recordApiKeySelection({
      provider: "openai",
      operation: "proxy",
      keyIndex: 1,
      keyCount: 3,
      selectionPolicy: "automatic_rotation",
      viaAiGateway: true,
      providerRequestId: "provider-request",
      step: 2,
    });

    expect(fields).toEqual({
      provider_request_id: "provider-request",
      provider: "openai",
      operation: "proxy",
      key_index: 1,
      key_count: 3,
      credential_configured: true,
      selection_policy: "automatic_rotation",
      via_ai_gateway: true,
      step: 2,
    });
    expect(consoleInfo).toHaveBeenCalledWith({
      event: "provider.key.selected",
      request_id: null,
      ...fields,
    });
    expect(JSON.stringify(consoleInfo.mock.calls)).not.toContain("sk-");
  });

  it("uses null identifiers when no credential is configured", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    recordApiKeySelection({
      provider: "ollama",
      operation: "models",
      keyIndex: 0,
      keyCount: 0,
      selectionPolicy: "default_first",
      viaAiGateway: false,
      providerRequestId: "provider-request",
    });

    expect(consoleInfo).toHaveBeenCalledWith({
      event: "provider.key.selected",
      request_id: null,
      provider_request_id: "provider-request",
      provider: "ollama",
      operation: "models",
      key_index: null,
      key_count: 0,
      credential_configured: false,
      selection_policy: "default_first",
      via_ai_gateway: false,
    });
  });
});
