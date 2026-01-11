import { Config } from "./config";
import { Environments } from "./environments";
import { shuffleArray } from "./helpers";
import { randomInt } from "node:crypto";

// Returns a cryptographically secure random integer in the range [0, max - 1].
export function getSecureRandomIndex(max: number): number {
  if (max <= 0) {
    throw new Error("max must be greater than 0");
  }

  // Browser / Cloudflare Workers / environments with Web Crypto
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const array = new Uint32Array(1);
    const maxUint32 = 0xffffffff;
    const limit = Math.floor((maxUint32 + 1) / max) * max;

    let value: number;
    do {
      (crypto as Crypto).getRandomValues(array);
      value = array[0];
    } while (value >= limit);

    return value % max;
  }

  // Node.js fallback using built-in crypto.randomInt
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require("crypto") as typeof import("crypto");
  return nodeCrypto.randomInt(0, max);
}

/**
 * A utility class for managing and retrieving secrets from environment variables.
 * Provides functionality to access all values for a key or get a single value with optional rotation.
 */
export class Secrets {
  /**
   * Retrieves all values for a specified environment key.
   *
   * @param keyName - The name of the environment variable to retrieve
   * @param shuffle - Whether to shuffle the array of values (default: false)
   * @returns An array of string values, or an empty array if the key doesn't exist
   */
  static getAll(keyName: keyof Env, shuffle: boolean = false): string[] {
    const value = Environments.get(keyName);

    if (value === undefined) {
      return [];
    }

    let result: string[] = [];
    if (Array.isArray(value)) {
      result = [...value];
    } else if (typeof value === "string") {
      result = [value];
    }

    if (shuffle && result.length > 1) {
      return shuffleArray(result);
    }

    return result;
  }

  /**
   * Retrieves a single value for a specified environment key at the given apiKeyIndex.
   *
   * @param keyName - The name of the environment variable to retrieve
   * @param apiKeyIndex - The apiKeyIndex of the value to retrieve (default: 0)
   * @returns A single string value for the specified key and apiKeyIndex
   */
  static get(keyName: keyof Env, apiKeyIndex: number = 0): string {
    const allKeys = this.getAll(keyName);
    if (allKeys.length === 0) {
      return "";
    }
    return allKeys[apiKeyIndex % allKeys.length];
  }

  /**
   * Determines the next index to use for a specified identifier and length, considering global round-robin configuration.
   *
   * @param identifier - A unique identifier for the key rotation (e.g., "GEMINI_API_KEY" or a custom endpoint name)
   * @param length - The number of available keys
   * @returns A Promise that resolves to the next index (0 to length - 1)
   */
  static async getNextIndex(
    identifier: string,
    length: number,
  ): Promise<number> {
    if (length <= 1) {
      return 0;
    }

    const env = Environments.getEnv();
    if (env && env.KEY_ROTATION_MANAGER && Config.isGlobalRoundRobinEnabled()) {
      const id = env.KEY_ROTATION_MANAGER.idFromName(identifier);
      const obj = env.KEY_ROTATION_MANAGER.get(id);
      return await obj.getNextIndex(identifier, length);
    }

    // Default to random if global round-robin is not enabled
    return randomInt(length);
  }

  /**
   * Determines the next index to use for a specified key name, considering global round-robin configuration.
   *
   * @param keyName - The name of the environment variable
   * @returns A Promise that resolves to the next index (0 to length - 1)
   */
  static async getNext(keyName: keyof Env): Promise<number> {
    const length = this.getAll(keyName).length;
    return this.getNextIndex(keyName, length);
  }

  /**
   * Resolves a selection (number or range) to a single apiKeyIndex.
   *
   * @param selection - The selection from MiddlewareContext
   * @param length - The total number of available API keys
   * @returns A single index within the range [0, length-1]
   */
  static resolveApiKeyIndex(
    selection: number | { start?: number; end?: number },
    length: number,
  ): number {
    if (typeof selection === "number") {
      return selection % length;
    }

    const start = (selection.start ?? 0) % length;
    const end =
      selection.end === undefined
        ? length - 1
        : Math.min(selection.end, length - 1);

    if (start >= end) {
      return start;
    }

    // Random choice within the range [start, end]
    return randomInt(start, end + 1);
  }
}
