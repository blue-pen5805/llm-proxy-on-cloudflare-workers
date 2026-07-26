import { AsyncLocalStorage } from "node:async_hooks";
import * as process from "node:process";

const requestEnvironment = new AsyncLocalStorage<Env | Partial<Env>>();

// Parsing is a pure function of the raw value, and the JSON attempt throws for
// every plain-string secret, so results are memoized by value. Values are
// operator-controlled configuration, but the cache is still bounded.
const MAX_PARSED_VALUE_CACHE_ENTRIES = 512;
const parsedValueCache = new Map<
  string,
  string | Array<unknown> | object | number | undefined
>();

/**
 * Utility class for accessing and manipulating environment variables
 * in a type-safe way with parsing capabilities.
 *
 * @class Environments
 */
export class Environments {
  // Retained as a fallback for local tooling and callers that explicitly set an
  // environment outside a request. Worker requests use requestEnvironment so
  // concurrent requests cannot overwrite each other's bindings.
  private static currentEnv: Env | undefined;

  /**
   * Runs a callback with an environment isolated to its asynchronous request
   * context.
   */
  static run<T>(env: Env, callback: () => T): T {
    return requestEnvironment.run(env, callback);
  }

  /**
   * Install operator configuration for Node-based deployment tooling. Config
   * values are serialized exactly as Worker secret bindings would be.
   */
  static runWithConfig<T>(
    config: Record<string, unknown>,
    callback: () => T,
  ): T {
    const serializedConfig = Object.fromEntries(
      Object.entries(config)
        .filter(([key, value]) => key !== "$schema" && value != null)
        .map(([key, value]) => [
          key,
          typeof value === "object" ? JSON.stringify(value) : String(value),
        ]),
    ) as Partial<Env>;
    return requestEnvironment.run(serializedConfig, callback);
  }

  /**
   * Sets the current environment object.
   *
   * @param {Env} env - The environment object from Cloudflare Workers
   */
  static setEnv(env: Env | undefined): void {
    this.currentEnv = env;
  }

  /**
   * Gets the current environment object.
   *
   * @returns {Env | undefined} The current environment object
   */
  static getEnv(): Env | Partial<Env> | undefined {
    return requestEnvironment.getStore() ?? this.currentEnv;
  }

  /**
   * Returns all environment variables cast as the Env type.
   *
   * @returns {Env} All environment variables
   */
  static all(): Env {
    // Node's ProcessEnv cannot describe generated Workers bindings, but this
    // fallback is only used by local tooling before a Worker Env is installed.
    const environment = this.getEnv();
    return environment ? (environment as Env) : (process.env as unknown as Env);
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
   * Gets a specific environment variable by key and parses it as JSON.
   * A value that is not valid JSON is returned unchanged, so a credential is
   * never split or coerced: multiple values are configured explicitly as a
   * JSON array and profiles as a JSON object.
   *
   * @param {keyof Env} key - The environment variable key to retrieve
   * @param {boolean} [parse=true] - Whether to parse the value
   * @returns {string | Array<unknown> | Object | number | undefined} The environment variable value,
   * parsed according to the parse parameter
   */
  static get(
    key: keyof Env,
    parse?: boolean,
  ): string | Array<unknown> | object | number | undefined;

  static get(
    key: keyof Env,
    parse: boolean = true,
  ): string | Array<unknown> | object | number | undefined {
    const env = this.all();
    const configuredValue = env[key] as string | undefined;

    if (configuredValue === undefined) {
      return undefined;
    }

    if (!parse) {
      return configuredValue;
    }

    if (parsedValueCache.has(configuredValue)) {
      return parsedValueCache.get(configuredValue);
    }

    // A value that is not valid JSON is a single opaque secret. It must not be
    // split on any separator: provider credentials legitimately contain commas.
    const jsonValue = this.parseJson(configuredValue);
    const parsedValue = jsonValue !== undefined ? jsonValue : configuredValue;

    if (parsedValueCache.size >= MAX_PARSED_VALUE_CACHE_ENTRIES) {
      parsedValueCache.clear();
    }
    parsedValueCache.set(configuredValue, parsedValue);
    return parsedValue;
  }

  /**
   * Attempts to parse a string as JSON.
   *
   * @private
   * @param {string} value - The string to parse
   * @returns {Array<unknown> | Object | number | undefined} The parsed JSON value or undefined if parsing fails
   */
  private static parseJson(
    value: string,
  ): Array<unknown> | object | number | undefined {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
}
