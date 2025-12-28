import { KeyRotationManager } from "../../../src/utils/key_rotation_manager";
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("KeyRotationManager", () => {
  let storage: any;

  beforeEach(() => {
    const data: Record<string, any> = {};
    storage = {
      get: vi.fn(async (key: string) => data[key]),
      put: vi.fn(async (key: string, value: any) => {
        data[key] = value;
      }),
    };
  });

  it("should return index and increment counter for a new keyName", async () => {
    const index1 = await KeyRotationManager.getNextIndexFromStorage(
      storage,
      "TEST_KEY",
      3,
    );
    expect(index1).toBe(0);
    expect(storage.put).toHaveBeenCalledWith("counter:TEST_KEY", 1);

    const index2 = await KeyRotationManager.getNextIndexFromStorage(
      storage,
      "TEST_KEY",
      3,
    );
    expect(index2).toBe(1);
    expect(storage.put).toHaveBeenCalledWith("counter:TEST_KEY", 2);

    const index3 = await KeyRotationManager.getNextIndexFromStorage(
      storage,
      "TEST_KEY",
      3,
    );
    expect(index3).toBe(2);
    expect(storage.put).toHaveBeenCalledWith("counter:TEST_KEY", 0); // Wraps around at length 3
  });

  it("should wrap around when total is reached", async () => {
    await KeyRotationManager.getNextIndexFromStorage(storage, "TEST_KEY", 2); // 0 -> 1
    await KeyRotationManager.getNextIndexFromStorage(storage, "TEST_KEY", 2); // 1 -> 0
    const index3 = await KeyRotationManager.getNextIndexFromStorage(
      storage,
      "TEST_KEY",
      2,
    );
    expect(index3).toBe(0);
    expect(storage.put).toHaveBeenCalledWith("counter:TEST_KEY", 1);
  });

  it("should handle multiple keys independently", async () => {
    const indexA = await KeyRotationManager.getNextIndexFromStorage(
      storage,
      "KEY_A",
      2,
    );
    const indexB = await KeyRotationManager.getNextIndexFromStorage(
      storage,
      "KEY_B",
      2,
    );
    expect(indexA).toBe(0);
    expect(indexB).toBe(0);

    const indexA2 = await KeyRotationManager.getNextIndexFromStorage(
      storage,
      "KEY_A",
      2,
    );
    expect(indexA2).toBe(1);
    expect(storage.get).toHaveBeenCalledWith("counter:KEY_A");
    expect(storage.get).toHaveBeenCalledWith("counter:KEY_B");
  });

  it("should handle a decrease in length gracefully", async () => {
    // Set counter to 9 for a length of 10
    await storage.put("counter:TEST_KEY", 9);

    // Now length decreases to 5
    const index = await KeyRotationManager.getNextIndexFromStorage(
      storage,
      "TEST_KEY",
      5,
    );

    // It should reset or adjust to be within bounds [0, 4]
    expect(index).toBeLessThan(5);
    expect(index).toBe(0); // My implementation resets to 0 if out of bounds
    expect(storage.put).toHaveBeenCalledWith("counter:TEST_KEY", 1);
  });
});
