import { afterEach, describe, expect, it, vi } from "vitest";
import type { MiddlewareContext } from "~/src/middleware";
import type { ProviderBase } from "~/src/providers/provider";
import {
  determineApiKeySelectionPolicy,
  getEligibleApiKeyIndexes,
  recordApiKeyOutcome,
  recordApiKeySelection,
  selectApiKeyIndex,
} from "~/src/utils/api_key_selection";
import { Config } from "~/src/utils/config";
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
        determineApiKeySelectionPolicy(
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

  it("skips cooling keys during automatic rotation", async () => {
    const providerName = "cooldown-skip";
    const provider = {
      getApiKeys: vi.fn().mockReturnValue(["first", "second", "third"]),
      getNextApiKeyIndex: vi.fn().mockResolvedValue(0),
    } as unknown as ProviderBase;
    vi.spyOn(Config, "apiKeyCooldownSeconds").mockReturnValue(60);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    recordApiKeyOutcome(providerName, 0, 3, 429);
    recordApiKeyOutcome(providerName, 1, 3, 403);

    await expect(
      selectApiKeyIndex(provider, undefined, "rotate", providerName),
    ).resolves.toBe(2);
    expect(getEligibleApiKeyIndexes(providerName, 3)).toEqual([2]);
  });

  it("ignores cooldowns when every key is cooling", async () => {
    const providerName = "cooldown-all";
    const provider = {
      getApiKeys: vi.fn().mockReturnValue(["first", "second"]),
      getNextApiKeyIndex: vi.fn().mockResolvedValue(1),
    } as unknown as ProviderBase;
    vi.spyOn(Config, "apiKeyCooldownSeconds").mockReturnValue(60);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    recordApiKeyOutcome(providerName, 0, 2, 403);
    recordApiKeyOutcome(providerName, 1, 2, 503);

    await expect(
      selectApiKeyIndex(provider, undefined, "rotate", providerName),
    ).resolves.toBe(1);
    expect(getEligibleApiKeyIndexes(providerName, 2)).toBeUndefined();
  });

  it("does not cool a single key and clears a cooled slot on success", () => {
    const providerName = "cooldown-clear";
    vi.spyOn(Config, "apiKeyCooldownSeconds").mockReturnValue(60);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    recordApiKeyOutcome(providerName, 0, 1, 429);
    expect(getEligibleApiKeyIndexes(providerName, 1)).toBeUndefined();

    recordApiKeyOutcome(providerName, 0, 2, 403);
    expect(getEligibleApiKeyIndexes(providerName, 2)).toEqual([1]);
    recordApiKeyOutcome(providerName, 0, 2, 200);
    expect(getEligibleApiKeyIndexes(providerName, 2)).toBeUndefined();

    recordApiKeyOutcome("never-cooled", 0, 2, 200);
    expect(getEligibleApiKeyIndexes("never-cooled", 2)).toBeUndefined();
  });

  it("removes expired and out-of-range cooldown entries", () => {
    const expiredProvider = "cooldown-expired";
    const resizedProvider = "cooldown-resized";
    vi.spyOn(Config, "apiKeyCooldownSeconds").mockReturnValue(60);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    recordApiKeyOutcome(expiredProvider, 0, 2, 429);
    expect(
      getEligibleApiKeyIndexes(expiredProvider, 2, Date.now() + 60_001),
    ).toBeUndefined();

    recordApiKeyOutcome(resizedProvider, 2, 3, 429);
    expect(getEligibleApiKeyIndexes(resizedProvider, 2)).toBeUndefined();
  });

  it("does not cool deterministic client errors or when disabled", () => {
    const providerName = "cooldown-disabled";
    const cooldown = vi
      .spyOn(Config, "apiKeyCooldownSeconds")
      .mockReturnValue(60);
    recordApiKeyOutcome(providerName, 0, 2, 400);
    recordApiKeyOutcome(providerName, 0, 2, 404);
    expect(getEligibleApiKeyIndexes(providerName, 2)).toBeUndefined();

    cooldown.mockReturnValue(0);
    recordApiKeyOutcome(providerName, 0, 2, 429);
    expect(getEligibleApiKeyIndexes(providerName, 2)).toBeUndefined();
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
      message:
        "Provider credential selected: provider=openai, operation=proxy, key_index=1, key_count=3, credential_configured=true, selection_policy=automatic_rotation, via_ai_gateway=true, step=2",
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
      message:
        "Provider credential selected: provider=ollama, operation=models, key_index=null, key_count=0, credential_configured=false, selection_policy=default_first, via_ai_gateway=false",
    });
  });
});
