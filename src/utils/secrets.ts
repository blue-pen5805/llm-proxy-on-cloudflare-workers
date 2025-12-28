import { Config } from "./config";
import { Environments } from "./environments";
import { shuffleArray } from "./helpers";

/**
 * A utility class for managing and retrieving secrets from environment variables.
 * Provides functionality to access all values for a key or get a single value with optional rotation.
 */
export class Secrets {
  static readonly loaded: { [key: string]: string[] } = {};

  /**
   * Retrieves all values for a specified environment key.
   *
   * @param keyName - The name of the environment variable to retrieve
   * @returns An array of string values, or an empty array if the key doesn't exist
   */
  static getAll(keyName: keyof Env, shuffle: boolean = false): string[] {
    const value = Environments.get(keyName);

    if (value === undefined) {
      return [];
    }

    if (Array.isArray(value)) {
      return shuffle ? shuffleArray(value) : value;
    }

    if (typeof value === "string") {
      return [value];
    }

    return [];
  }

  /**
   * Retrieves a single value for a specified environment key asynchronously.
   * If global round-robin is enabled, it uses a Durable Object to maintain consistency.
   * Otherwise, it falls back to the synchronous rotation logic.
   *
   * @param keyName - The name of the environment variable to retrieve
   * @returns A Promise that resolves to a string value for the specified key
   */
  static async getAsync(keyName: keyof Env): Promise<string> {
    const allKeys = this.getAll(keyName);
    if (allKeys.length <= 1) {
      return allKeys[0] || "";
    }

    const env = Environments.getEnv();
    if (env && env.KEY_ROTATION_MANAGER && Config.isGlobalRoundRobinEnabled()) {
      const id = env.KEY_ROTATION_MANAGER.idFromName(keyName);
      const obj = env.KEY_ROTATION_MANAGER.get(id);
      const index = await obj.getNextIndex(keyName, allKeys.length);
      return allKeys[index];
    }

    return this.get(keyName, true);
  }

  /**
   * Retrieves a single secret for a given key name.
   *
   * @param keyName - The name of the environment variable to retrieve
   * @param rotate - Whether to rotate through multiple keys if available
   * @returns A single string value for the specified key
   */
  static get(keyName: keyof Env, rotate: boolean = true): string {
    if (rotate) {
      if (!Secrets.loaded[keyName]) {
        Secrets.loaded[keyName] = this.getAll(keyName, true);
      }

      const apiKey = Secrets.loaded[keyName][0];
      Secrets.loaded[keyName].push(Secrets.loaded[keyName].shift() as string);

      return apiKey;
    } else {
      const secrets = this.getAll(keyName, true);

      return secrets[0];
    }
  }
}
