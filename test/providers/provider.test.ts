import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProviderBase } from "~/src/providers/provider";
import { EndpointBase } from "~/src/providers/endpoint";

vi.mock("~/src/utils", () => ({
  fetch2: vi.fn().mockImplementation(() => Promise.resolve(new Response())),
}));

describe("ProviderBase", () => {
  let providerBase: ProviderBase;
  let mockEndpoint: EndpointBase;

  beforeEach(() => {
    // Create a mock endpoint
    mockEndpoint = {
      available: vi.fn().mockReturnValue(true),
      baseUrl: vi.fn().mockReturnValue("https://api.example.com"),
      pathnamePrefix: vi.fn().mockReturnValue(""),
      headers: vi.fn().mockReturnValue({ "Content-Type": "application/json" }),
      fetch: vi.fn().mockResolvedValue(new Response()),
      requestData: vi.fn().mockReturnValue([
        "https://api.example.com/test",
        {
          headers: { "Content-Type": "application/json" },
          method: "GET",
        },
      ]),
    } as unknown as EndpointBase;

    // Initialize the provider base with mock endpoint
    providerBase = new ProviderBase({ apiKey: "TEST_API_KEY" });
    providerBase.endpoint = mockEndpoint;
  });

  describe("constructor", () => {
    it("should initialize with correct apiKey", () => {
      expect(providerBase.apiKey).toBe("TEST_API_KEY");
      expect(providerBase.endpoint).toBeDefined();
    });
  });

  describe("available", () => {
    it("should return endpoint availability", () => {
      const result = providerBase.available();
      expect(mockEndpoint.available).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });

  describe("fetch", () => {
    it("should call endpoint.fetch with correct parameters", async () => {
      await providerBase.fetch("/test", { method: "GET" });
      expect(mockEndpoint.fetch).toHaveBeenCalledWith("/test", {
        method: "GET",
      });
    });
  });

  describe("chatCompletionsRequestBody", () => {
    it("should filter unsupported parameters", () => {
      const body = JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
        model: "test-model",
        unsupported_param: "value",
      });

      const result = providerBase.chatCompletionsRequestBody(body);
      const parsed = JSON.parse(result);

      expect(parsed).toHaveProperty("messages");
      expect(parsed).toHaveProperty("model");
      expect(parsed).not.toHaveProperty("unsupported_param");
    });

    it("should keep supported parameters", () => {
      const body = JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
        model: "test-model",
        temperature: 0.7,
        max_tokens: 100,
      });

      const result = providerBase.chatCompletionsRequestBody(body);
      const parsed = JSON.parse(result);

      expect(parsed).toHaveProperty("messages");
      expect(parsed).toHaveProperty("model");
      expect(parsed).toHaveProperty("temperature", 0.7);
      expect(parsed).toHaveProperty("max_tokens", 100);
    });
  });

  describe("chatCompletionsRequestData", () => {
    it("should return endpoint.requestData with correct parameters", () => {
      const body = "test body";
      const headers = { "Test-Header": "value" };

      providerBase.chatCompletionsRequestData({ body, headers });

      expect(mockEndpoint.requestData).toHaveBeenCalledWith(
        "/chat/completions",
        {
          method: "POST",
          headers,
          body,
        },
      );
    });
  });

  describe("chatCompletions", () => {
    beforeEach(() => {
      vi.spyOn(providerBase, "chatCompletionsRequestData").mockReturnValue([
        "https://api.example.com/chat/completions",
        { method: "POST", headers: {}, body: "" },
      ]);
      vi.spyOn(providerBase, "chatCompletionsRequestBody").mockReturnValue("");
      vi.spyOn(providerBase, "processChatCompletions").mockResolvedValue(
        new Response(),
      );
      vi.spyOn(providerBase, "processChatCompletionsStream").mockResolvedValue(
        new Response(),
      );
    });

    it("should call correct methods for non-streaming request", async () => {
      const body = JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
        model: "test-model",
        stream: false,
      });

      await providerBase.chatCompletions({ body, headers: {} });

      expect(providerBase.chatCompletionsRequestBody).toHaveBeenCalledWith(
        body,
      );
      expect(providerBase.chatCompletionsRequestData).toHaveBeenCalled();
      expect(providerBase.processChatCompletions).toHaveBeenCalled();
      expect(providerBase.processChatCompletionsStream).not.toHaveBeenCalled();
    });

    it("should call correct methods for streaming request", async () => {
      const body = JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
        model: "test-model",
        stream: true,
      });

      await providerBase.chatCompletions({ body, headers: {} });

      expect(providerBase.chatCompletionsRequestBody).toHaveBeenCalledWith(
        body,
      );
      expect(providerBase.chatCompletionsRequestData).toHaveBeenCalled();
      expect(providerBase.processChatCompletionsStream).toHaveBeenCalled();
      expect(providerBase.processChatCompletions).not.toHaveBeenCalled();
    });
  });

  describe("listModels and fetchModels", () => {
    beforeEach(() => {
      vi.spyOn(providerBase, "fetchModels").mockResolvedValue(
        new Response(
          JSON.stringify({
            object: "list",
            data: [
              {
                id: "test-model",
                object: "model",
                created: 1234567890,
                owned_by: "test-owner",
              },
            ],
          }),
        ),
      );
    });

    it("should fetch and return models data", async () => {
      const result = await providerBase.listModels();

      expect(providerBase.fetchModels).toHaveBeenCalled();
      expect(result).toEqual({
        object: "list",
        data: [
          {
            id: "test-model",
            object: "model",
            created: 1234567890,
            owned_by: "test-owner",
          },
        ],
      });
    });

    // it("should call fetch with correct path for fetchModels", async () => {
    //   await providerBase.fetchModels();

    //   expect(mockEndpoint.fetch).toHaveBeenCalledWith("/models", {
    //     method: "GET",
    //   });
    // });
  });
});
