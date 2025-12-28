import { KeyRotationManager } from "../../../src/utils/key_rotation_manager";
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("KeyRotationManager", () => {
  let sql: any;
  let data: Record<string, number> = {};

  beforeEach(() => {
    data = {};
    sql = {
      exec: vi.fn((query: string, ...bindings: any[]) => {
        if (query.includes("SELECT")) {
          const keyName = bindings[0];
          const row = keyName in data ? { current_index: data[keyName] } : null;
          return {
            next: () => ({ value: row, done: row === null }),
          };
        }
        if (query.includes("INSERT")) {
          const keyName = bindings[0];
          data[keyName] = 0;
          return { next: () => ({ value: undefined, done: true }) };
        }
        if (query.includes("UPDATE")) {
          const nextIndex = bindings[0];
          const keyName = bindings[1];
          data[keyName] = nextIndex;
          return { next: () => ({ value: undefined, done: true }) };
        }
        return { next: () => ({ value: undefined, done: true }) };
      }),
    };
  });

  it("should return index and increment counter for a new keyName", async () => {
    const index1 = await KeyRotationManager.getNextIndexFromSql(
      sql,
      "TEST_KEY",
      3,
    );
    expect(index1).toBe(0);
    expect(data["TEST_KEY"]).toBe(1);

    const index2 = await KeyRotationManager.getNextIndexFromSql(
      sql,
      "TEST_KEY",
      3,
    );
    expect(index2).toBe(1);
    expect(data["TEST_KEY"]).toBe(2);

    const index3 = await KeyRotationManager.getNextIndexFromSql(
      sql,
      "TEST_KEY",
      3,
    );
    expect(index3).toBe(2);
    expect(data["TEST_KEY"]).toBe(0); // Wraps around at length 3
  });

  it("should wrap around when total is reached", async () => {
    await KeyRotationManager.getNextIndexFromSql(sql, "TEST_KEY", 2); // 0 -> 1
    await KeyRotationManager.getNextIndexFromSql(sql, "TEST_KEY", 2); // 1 -> 0
    const index3 = await KeyRotationManager.getNextIndexFromSql(
      sql,
      "TEST_KEY",
      2,
    );
    expect(index3).toBe(0);
    expect(data["TEST_KEY"]).toBe(1);
  });

  it("should handle multiple keys independently", async () => {
    const indexA = await KeyRotationManager.getNextIndexFromSql(
      sql,
      "KEY_A",
      2,
    );
    const indexB = await KeyRotationManager.getNextIndexFromSql(
      sql,
      "KEY_B",
      2,
    );
    expect(indexA).toBe(0);
    expect(indexB).toBe(0);

    const indexA2 = await KeyRotationManager.getNextIndexFromSql(
      sql,
      "KEY_A",
      2,
    );
    expect(indexA2).toBe(1);
    expect(data["KEY_A"]).toBe(0);
    expect(data["KEY_B"]).toBe(1);
  });

  it("should handle a decrease in length gracefully", async () => {
    // Set counter to 9 for a length of 10
    data["TEST_KEY"] = 9;

    // Now length decreases to 5
    const index = await KeyRotationManager.getNextIndexFromSql(
      sql,
      "TEST_KEY",
      5,
    );

    // It should reset or adjust to be within bounds [0, 4]
    expect(index).toBeLessThan(5);
    expect(index).toBe(0);
    expect(data["TEST_KEY"]).toBe(1);
  });
});
