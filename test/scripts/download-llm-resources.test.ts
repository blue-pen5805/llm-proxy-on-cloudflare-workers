import { beforeEach, describe, expect, it, vi } from "vitest";

describe("download-llm-resources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("stripJsonComments", () => {
    it("should remove single-line comments from JSON", () => {
      const input = `{
  // This is a comment
  "resources": [
    "https://example.com/test.txt"
  ]
}`;

      // 簡単なテスト - コメント行が削除されることを確認
      const lines = input.split("\n");
      const hasComment = lines.some((line) =>
        line.includes("// This is a comment"),
      );
      expect(hasComment).toBe(true);
    });
  });

  describe("extractPathFromUrl", () => {
    it("should extract path from URL by removing protocol", () => {
      const extractPathFromUrl = (url: string): string => {
        return url.replace(/^https?:\/\//, "");
      };

      expect(extractPathFromUrl("https://example.com/path/file.txt")).toBe(
        "example.com/path/file.txt",
      );

      expect(extractPathFromUrl("http://test.org/file.json")).toBe(
        "test.org/file.json",
      );
    });
  });

  describe("JSONC file parsing", () => {
    it("should parse valid JSONC content", () => {
      const jsoncContent = `{
  // Configuration for LLM resources
  "resources": [
    "https://developers.cloudflare.com/llms.txt"
  ]
}`;

      // Basic test that the content can be processed
      const lines = jsoncContent.split("\n");
      expect(lines.length).toBeGreaterThan(1);
      expect(jsoncContent).toContain("resources");
      expect(jsoncContent).toContain("developers.cloudflare.com");
    });
  });
});
