import { describe, expect, it } from "vitest";
import { addProxyAiGatewayMetadata } from "~/src/ai_gateway/metadata";

describe("AI Gateway proxy metadata", () => {
  it("adds routing tags while preserving client values on collisions", () => {
    const headers = new Headers({
      "cf-aig-metadata":
        '{"llm_proxy_provider":"client-provider","llm_proxy_credentials":"client-credentials"}',
    });

    addProxyAiGatewayMetadata(headers, {
      provider: "openai",
      model: "gpt-4.1",
      endpoint: "responses",
      virtualModel: "virtual/fast",
      credentials: {
        credentialProfile: "paid",
        providerKeyIndex: 2,
      },
    });

    expect(JSON.parse(headers.get("cf-aig-metadata")!)).toEqual({
      llm_proxy_provider: "client-provider",
      llm_proxy_credentials: "client-credentials",
      llm_proxy_virtual_model: "virtual/fast",
      llm_proxy_endpoint: "responses",
      llm_proxy_model: "gpt-4.1",
    });
  });

  it("orders proxy fields and encodes credentials as profile:key-index", () => {
    const headers = new Headers();

    addProxyAiGatewayMetadata(headers, {
      provider: "openai",
      model: "gpt-4.1",
      endpoint: "responses",
      virtualModel: "virtual/fast",
      credentials: {
        credentialProfile: "default",
        providerKeyIndex: null,
      },
    });

    const metadata = JSON.parse(headers.get("cf-aig-metadata")!) as Record<
      string,
      string
    >;
    expect(Object.keys(metadata)).toEqual([
      "llm_proxy_virtual_model",
      "llm_proxy_endpoint",
      "llm_proxy_provider",
      "llm_proxy_model",
      "llm_proxy_credentials",
    ]);
    expect(metadata.llm_proxy_credentials).toBe("default:null");
  });

  it("does not replace invalid or non-object client metadata", () => {
    for (const value of ["not-json", "[]", '"text"']) {
      const headers = new Headers({ "cf-aig-metadata": value });
      addProxyAiGatewayMetadata(headers, { provider: "openai" });
      expect(headers.get("cf-aig-metadata")).toBe(value);
    }
  });

  it("respects the five-entry Gateway limit and omits absent fields", () => {
    const headers = new Headers({
      "cf-aig-metadata": '{"a":1,"b":2,"c":3,"d":4}',
    });
    addProxyAiGatewayMetadata(headers, {
      provider: "openai",
      model: "ignored-at-limit",
      endpoint: "responses",
      virtualModel: "virtual/first-priority",
      credentials: {
        credentialProfile: "default",
        providerKeyIndex: 0,
      },
    });
    expect(JSON.parse(headers.get("cf-aig-metadata")!)).toEqual({
      a: 1,
      b: 2,
      c: 3,
      d: 4,
      llm_proxy_virtual_model: "virtual/first-priority",
    });

    const empty = new Headers();
    addProxyAiGatewayMetadata(empty, {});
    expect(empty.has("cf-aig-metadata")).toBe(false);
  });
});
