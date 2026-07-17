import { describe, expect, it, vi } from "vitest";
import { ProviderBase } from "~/src/providers/provider";
import { createProviderConfigurationErrorResponse } from "~/src/requests/provider_request";

describe("provider request configuration", () => {
  it("accepts a provider without additional requirements", () => {
    expect(
      createProviderConfigurationErrorResponse("openai", new ProviderBase()),
    ).toBeUndefined();
  });

  it("reports a missing required provider credential", async () => {
    const provider = new ProviderBase();
    Object.defineProperties(provider, {
      apiKeyName: { value: "OPENAI_API_KEY" },
      requiresProviderCredentials: { value: true },
    });
    vi.spyOn(provider, "available").mockReturnValue(false);

    const response = createProviderConfigurationErrorResponse(
      "openai",
      provider,
    );

    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({
      error: "openai requires OPENAI_API_KEY.",
    });
  });

  it("accepts a configured required provider credential", () => {
    const provider = new ProviderBase();
    Object.defineProperty(provider, "requiresProviderCredentials", {
      value: true,
    });
    vi.spyOn(provider, "available").mockReturnValue(true);

    expect(
      createProviderConfigurationErrorResponse("openai", provider),
    ).toBeUndefined();
  });
});
