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
    return KeyRotationManager.getNextIndexFromStorage(
      this.ctx.storage,
      keyName,
      length,
    );
  }

  /**
   * static version of getNextIndex for easier testing without DurableObject state
   */
  static async getNextIndexFromStorage(
    storage: DurableObjectStorage,
    keyName: string,
    length: number,
  ): Promise<number> {
    if (length <= 1) return 0;

    let index = (await storage.get<number>(`counter:${keyName}`)) || 0;

    // Ensure index is within current bounds in case length decreased
    if (index >= length) {
      index = 0;
    }

    const nextIndex = (index + 1) % length;

    await storage.put(`counter:${keyName}`, nextIndex);

    return index;
  }
}
