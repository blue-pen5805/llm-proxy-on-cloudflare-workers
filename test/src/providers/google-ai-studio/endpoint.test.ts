import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  GoogleAiStudioEndpoint,
  GoogleAiStudioOpenAICompatibleEndpoint,
} from "~/src/providers/google-ai-studio/endpoint";
import { Secrets } from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");

describe("GoogleAiStudioEndpoint", () => {
  const testApiKey = "test-api-key";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.get).mockImplementation((key) => {
      if (key === "GEMINI_API_KEY") return testApiKey;
      return "";
    });
    vi.mocked(Secrets.getAll).mockImplementation((key) => {
      if (key === "GEMINI_API_KEY") return [testApiKey];
      return [];
    });
  });

  it("should return correct base URL", () => {
    const endpoint = new GoogleAiStudioEndpoint("GEMINI_API_KEY");
    expect(endpoint.baseUrl()).toBe(
      "https://generativelanguage.googleapis.com",
    );
  });

  it("should return correct headers", async () => {
    const endpoint = new GoogleAiStudioEndpoint("GEMINI_API_KEY");
    const headers = await endpoint.headers();
    expect(headers).toEqual({
      "Content-Type": "application/json",
      "x-goog-api-key": testApiKey,
    });
  });

  it("should be available if API key exists", () => {
    const endpoint = new GoogleAiStudioEndpoint("GEMINI_API_KEY");
    expect(endpoint.available()).toBe(true);
  });

  it("should not be available if API key is missing", () => {
    vi.mocked(Secrets.getAll).mockReturnValue([]);
    const endpoint = new GoogleAiStudioEndpoint("GEMINI_API_KEY");
    expect(endpoint.available()).toBe(false);
  });
});

describe("GoogleAiStudioOpenAICompatibleEndpoint", () => {
  const testApiKey = "test-api-key";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Secrets.get).mockImplementation((key) => {
      if (key === "GEMINI_API_KEY") return testApiKey;
      return "";
    });
    vi.mocked(Secrets.getAll).mockImplementation((key) => {
      if (key === "GEMINI_API_KEY") return [testApiKey];
      return [];
    });
  });

  it("should return correct headers with Authorization", async () => {
    const baseEndpoint = new GoogleAiStudioEndpoint("GEMINI_API_KEY");
    const endpoint = new GoogleAiStudioOpenAICompatibleEndpoint(baseEndpoint);
    const headers = await endpoint.headers();
    expect(headers).toEqual({
      "Content-Type": "application/json",
      Authorization: `Bearer ${testApiKey}`,
    });
  });

  it("should return correct pathname prefix", () => {
    const baseEndpoint = new GoogleAiStudioEndpoint("GEMINI_API_KEY");
    const endpoint = new GoogleAiStudioOpenAICompatibleEndpoint(baseEndpoint);
    expect(endpoint.pathnamePrefix()).toBe("/v1beta/openai");
  });
});
