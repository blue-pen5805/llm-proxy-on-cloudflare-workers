import * as process from "node:process";

/**
 * Utility class for accessing and manipulating environment variables
 * in a type-safe way with parsing capabilities.
 *
 * @class Environments
 */
export class Environments {
  private static currentEnv: Env | undefined;

  /**
   * Sets the current environment object.
   *
   * @param {Env} env - The environment object from Cloudflare Workers
   */
  static setEnv(env: Env): void {
    this.currentEnv = env;
  }

  /**
   * Gets the current environment object.
   *
   * @returns {Env | undefined} The current environment object
   */
  static getEnv(): Env | undefined {
    return this.currentEnv;
  }

  /**
   * Returns all environment variables cast as the Env type.
   *
   * @returns {Env} All environment variables
   */
  static all(): Env {
    return (this.currentEnv || process.env) as unknown as Env;
  }

  /**
   * Checks if an environment variable exists.
   *
   * @param {keyof Env} key - The environment variable key to check
   * @returns {boolean} True if the environment variable exists, false otherwise
   */
  static has(key: keyof Env): key is keyof Env {
    const env = this.all();
    return env[key] !== undefined;
  }

  /**
   * Gets a specific environment variable by key and returns it as a string.
   *
   * @param {keyof Env} key - The environment variable key to retrieve
   * @param {false} parse - Set to false to prevent parsing and return the raw string
   * @returns {string | undefined} The environment variable value as a string, or undefined if not found
   */
  static get(key: keyof Env, parse: false): string | undefined;

  /**
   * Gets a specific environment variable by key and parses it.
   * Parsing attempts to convert the value to a JSON object, array, or number.
   * If JSON parsing fails, it tries to parse as comma-separated values.
   *
   * @param {keyof Env} key - The environment variable key to retrieve
   * @param {boolean} [parse=true] - Whether to parse the value
   * @returns {string | Array<any> | Object | number | undefined} The environment variable value,
   * parsed according to the parse parameter
   */
  static get(
    key: keyof Env,
    parse?: boolean,
  ): string | Array<any> | object | number | undefined;

  static get(
    key: keyof Env,
    parse: boolean = true,
  ): string | Array<any> | object | number | undefined {
    const env = this.all();
    const value = env[key] as string | undefined;

    if (value === undefined) {
      return undefined;
    }

    if (!parse) {
      return value;
    }

    // Try to parse as JSON first
    const jsonValue = this.parseJson(value);
    if (jsonValue !== undefined) {
      return jsonValue;
    }

    // If JSON parsing fails, try to parse as comma-separated values
    const separatedTexts = this.parseCommaSeparatedText(value);

    // If parsing fails, return the original value
    return separatedTexts ?? value;
  }

  /**
   * Attempts to parse a string as JSON.
   *
   * @private
   * @param {string} value - The string to parse
   * @returns {Array<any> | Object | number | undefined} The parsed JSON value or undefined if parsing fails
   */
  private static parseJson(
    value: string,
  ): Array<any> | object | number | undefined {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  /**
   * Parses a comma-separated string into an array of trimmed strings.
   *
   * @private
   * @param {string} value - The comma-separated string to parse
   * @returns {Array<string> | undefined} An array of trimmed strings
   */
  private static parseCommaSeparatedText(
    value: string,
  ): Array<string> | undefined {
    if (value.includes(",")) {
      return value.split(",").map((item) => item.trim());
    }
    return undefined;
  }
}
