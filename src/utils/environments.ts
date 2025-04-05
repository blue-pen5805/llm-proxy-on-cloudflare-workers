import * as process from "node:process";

/**
 * Utility class for accessing and manipulating environment variables
 * in a type-safe way with parsing capabilities.
 *
 * @class Environments
 */
export class Environments {
  /**
   * Returns all environment variables cast as the Env type.
   *
   * @returns {Env} All environment variables
   */
  static all(): Env {
    return process.env as unknown as Env;
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
   * Gets a specific environment variable by key and optionally parses it.
   * Parsing attempts to convert the value to a JSON object, array, or number.
   * If JSON parsing fails, it tries to parse as comma-separated values.
   *
   * @param {keyof Env} key - The environment variable key to retrieve
   * @param {boolean} [parse=false] - Whether to parse the value
   * @returns {string | Array<any> | Object | number | undefined} The environment variable value,
   * parsed according to the parse parameter if specified
   */
  static get(
    key: keyof Env,
    parse: boolean = false,
  ): string | Array<any> | Object | number | undefined {
    const env = this.all();
    const value = env[key] as string | undefined;

    if (value === undefined || !parse) {
      return undefined;
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
  ): Array<any> | Object | number | undefined {
    try {
      return JSON.parse(value);
    } catch (e) {
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
