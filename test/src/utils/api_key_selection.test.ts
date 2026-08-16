import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listApiKeyIndicesToTry,
  selectApiKeyIndex,
} from "~/src/utils/api_key_selection";
import { Secrets } from "~/src/utils/secrets";

vi.mock("~/src/utils/secrets");

describe("selectApiKeyIndex", () => {
  const provider = {
    getApiKeys: vi.fn().mockReturnValue(["k0", "k1", "k2"]),
    getNextApiKeyIndex: vi.fn().mockResolvedValue(1),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    provider.getApiKeys.mockReturnValue(["k0", "k1", "k2"]);
    provider.getNextApiKeyIndex.mockResolvedValue(1);
    vi.mocked(Secrets.resolveApiKeyIndex).mockImplementation(
      (selection, length) => {
        if (typeof selection === "number") {
          return selection % length;
        }
        return 0;
      },
    );
  });

  it("returns the first key when no selection is provided", async () => {
    await expect(
      selectApiKeyIndex(provider as any, undefined, "first"),
    ).resolves.toBe(0);
    expect(provider.getNextApiKeyIndex).not.toHaveBeenCalled();
    expect(Secrets.resolveApiKeyIndex).not.toHaveBeenCalled();
  });

  it("rotates when no selection is provided and fallback is rotate", async () => {
    await expect(
      selectApiKeyIndex(provider as any, undefined, "rotate"),
    ).resolves.toBe(1);
    expect(provider.getNextApiKeyIndex).toHaveBeenCalledOnce();
  });

  it("uses index 0 when a provider has no API keys", async () => {
    provider.getApiKeys.mockReturnValue([]);

    await expect(
      selectApiKeyIndex(provider as any, { start: 0 }, "first"),
    ).resolves.toBe(0);
    await expect(selectApiKeyIndex(provider as any, 2, "rotate")).resolves.toBe(
      0,
    );
    expect(Secrets.resolveApiKeyIndex).not.toHaveBeenCalled();
    expect(provider.getNextApiKeyIndex).not.toHaveBeenCalled();
  });
});

describe("listApiKeyIndicesToTry", () => {
  it("returns index 0 when at most one key is available", () => {
    expect(listApiKeyIndicesToTry(undefined, 1, 0)).toEqual([0]);
    expect(listApiKeyIndicesToTry(2, 0, 2)).toEqual([0]);
  });

  it("walks all keys from the first index when no selection is set", () => {
    expect(listApiKeyIndicesToTry(undefined, 3, 0)).toEqual([0, 1, 2]);
  });

  it("wraps from an explicit numeric selection", () => {
    expect(listApiKeyIndicesToTry(2, 3, 2)).toEqual([2, 0, 1]);
  });

  it("stays inside a range selection", () => {
    expect(listApiKeyIndicesToTry({ start: 1, end: 2 }, 4, 1)).toEqual([1, 2]);
    expect(listApiKeyIndicesToTry({ start: 1, end: 2 }, 4, 2)).toEqual([2, 1]);
  });

  it("uses a single-index range when start is not below end", () => {
    expect(listApiKeyIndicesToTry({ start: 3, end: 1 }, 5, 3)).toEqual([3]);
  });

  it("defaults an open-ended range to the last key", () => {
    expect(listApiKeyIndicesToTry({ start: 2 }, 4, 2)).toEqual([2, 3]);
  });

  it("defaults an unspecified range start to index 0", () => {
    expect(listApiKeyIndicesToTry({ end: 2 }, 5, 0)).toEqual([0, 1, 2]);
    expect(listApiKeyIndicesToTry({ end: 2 }, 5, 2)).toEqual([2, 0, 1]);
  });
});
