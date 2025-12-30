import { DurableObject } from "cloudflare:workers";

/**
 * KeyRotationManager is a Durable Object that maintains a round-robin counter for API keys.
 */
export class KeyRotationManager extends DurableObject {
  /**
   * Increments and returns the next index for a given key name.
   *
   * @param keyName - The name of the environment variable (e.g., "GEMINI_API_KEY")
   * @param length - The number of available keys for this provider
   * @returns The next index to use (0 to length - 1)
   */
  async getNextIndex(keyName: string, length: number): Promise<number> {
    return KeyRotationManager.getNextIndexFromSql(
      this.ctx.storage.sql,
      keyName,
      length,
    );
  }

  /**
   * static version of getNextIndex for easier testing
   */
  static async getNextIndexFromSql(
    sql: SqlStorage,
    keyName: string,
    length: number,
  ): Promise<number> {
    if (length <= 1) return 0;

    // Ensure the table exists
    sql.exec(`
      CREATE TABLE IF NOT EXISTS counters (
        key_name TEXT PRIMARY KEY,
        current_index INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Get current index
    const cursor = sql.exec(
      "SELECT current_index FROM counters WHERE key_name = ?",
      keyName,
    );
    const row = cursor.next().value;

    let index = 0;
    if (row) {
      index = row.current_index as number;
    } else {
      // Initialize if not exists
      sql.exec(
        "INSERT INTO counters (key_name, current_index) VALUES (?, 0)",
        keyName,
      );
    }

    // Ensure index is within current bounds
    if (index >= length) {
      index = 0;
    }

    const nextIndex = (index + 1) % length;

    // Update to next index
    sql.exec(
      "UPDATE counters SET current_index = ? WHERE key_name = ?",
      nextIndex,
      keyName,
    );

    return index;
  }
}
