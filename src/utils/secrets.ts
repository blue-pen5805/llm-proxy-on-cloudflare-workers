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
   * Retrieves a single value for a specified environment key.
   * When rotation is enabled, it cycles through available values in a round-robin fashion.
   * When rotation is disabled, it returns a random value from the available options.
   *
   * @param keyName - The name of the environment variable to retrieve
   * @param rotate - Whether to rotate through available values (defaults to true)
   * @returns A string value for the specified key
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
