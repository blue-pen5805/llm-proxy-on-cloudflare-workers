import { Environments } from "./environments";
import { shuffleArray } from "./helpers";
import { randomInt } from "node:crypto";

// Filtering is a pure function of the parsed value, and Environments memoizes
// parsing so multi-key arrays keep a stable identity. Caching by that identity
// avoids re-filtering on every credential read within a request.
const filteredSecretArrayCache = new WeakMap<readonly unknown[], string[]>();

// Striped round-robin state. Each isolate advances a perfect per-identifier
// rotation that starts at a random phase; isolates are not coordinated, but
// overlaying many perfect rotations with random phases keeps aggregate key
// usage near-uniform (deviation bounded by the number of live isolates, not
// by the request count). This serves the rate-limit-spreading purpose of
// rotation without any per-request cross-isolate coordination on the
// critical path.
const rotationCounters = new Map<string, number>();

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
    const configuredValue = Environments.get(keyName);

    if (configuredValue === undefined) {
      return [];
    }

    let secretValues: string[] = [];
    if (Array.isArray(configuredValue)) {
      const cachedValues = filteredSecretArrayCache.get(configuredValue);
      if (cachedValues) {
        secretValues = cachedValues;
      } else {
        secretValues = configuredValue.filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0,
        );
        filteredSecretArrayCache.set(configuredValue, secretValues);
      }
    } else if (typeof configuredValue === "string") {
      secretValues = configuredValue.trim().length > 0 ? [configuredValue] : [];
    }

    if (shuffle && secretValues.length > 1) {
      return shuffleArray(secretValues);
    }

    return secretValues;
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
    if (
      allKeys.length === 0 ||
      !Number.isSafeInteger(apiKeyIndex) ||
      apiKeyIndex < 0
    ) {
      return "";
    }
    return allKeys[apiKeyIndex % allKeys.length];
  }

  /**
   * Determines the next striped round-robin index for an identifier and length.
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

    let currentIndex = rotationCounters.get(identifier) ?? randomInt(length);
    // Bound a counter stored under a longer key array to the current length.
    if (currentIndex >= length) {
      currentIndex = 0;
    }
    rotationCounters.set(identifier, (currentIndex + 1) % length);
    return currentIndex;
  }

  /**
   * Determines the next striped round-robin index for a configured key name.
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
    if (!Number.isSafeInteger(length) || length <= 1) return 0;

    if (typeof selection === "number") {
      return Number.isSafeInteger(selection) && selection >= 0
        ? selection % length
        : 0;
    }

    const safeStart =
      selection.start !== undefined &&
      Number.isSafeInteger(selection.start) &&
      selection.start >= 0
        ? selection.start
        : 0;
    const safeEnd =
      selection.end !== undefined &&
      Number.isSafeInteger(selection.end) &&
      selection.end >= 0
        ? selection.end
        : undefined;
    const start = safeStart % length;
    const end =
      safeEnd === undefined ? length - 1 : Math.min(safeEnd, length - 1);

    if (start >= end) {
      return start;
    }

    // Random choice within the range [start, end]
    return randomInt(start, end + 1);
  }
}
