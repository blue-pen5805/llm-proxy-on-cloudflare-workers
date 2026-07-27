import { CustomOpenAI } from "../providers/custom-openai";
import type { CustomOpenAIEndpointConfig } from "../providers/custom-openai";
import {
  formatProviderSelector,
  parseProviderSelector,
} from "../providers/profile";
import { ProviderBase, withProviderProfile } from "../providers/provider";

export type ProviderConstructor = new () => ProviderBase;

export interface ProviderRoute {
  providerName: string;
  pathname: string;
}

export interface ProviderEnumerationResult {
  providers: Record<string, ProviderBase>;
  failures: { providerName: string; error: unknown }[];
}

/**
 * Owns provider discovery and construction for a single request.
 *
 * Instances are created lazily and cached so routing, model discovery, and
 * request handlers share one consistent view of the configured providers.
 */
export class ProviderRegistry {
  private readonly builtInInstances = new Map<string, ProviderBase>();
  private readonly profiledInstances = new Map<string, ProviderBase>();
  private readonly customInstances = new Map<
    CustomOpenAIEndpointConfig,
    CustomOpenAI
  >();
  private readonly customEndpoints: readonly CustomOpenAIEndpointConfig[];
  private readonly firstCustomEndpointByName: ReadonlyMap<
    string,
    CustomOpenAIEndpointConfig
  >;
  private readonly providerNames: readonly string[];
  private readonly providerNameSet: ReadonlySet<string>;

  constructor(
    private readonly builtIns: Readonly<Record<string, ProviderConstructor>>,
    customEndpoints: readonly CustomOpenAIEndpointConfig[] = [],
  ) {
    this.customEndpoints = [...customEndpoints];
    const configuredNames = new Set(Object.keys(this.builtIns));
    const firstCustomEndpointByName = new Map<
      string,
      CustomOpenAIEndpointConfig
    >();
    for (const endpoint of this.customEndpoints) {
      if (configuredNames.has(endpoint.name)) {
        throw new Error(
          `Custom endpoint name is duplicated or reserved: ${endpoint.name}`,
        );
      }
      configuredNames.add(endpoint.name);
      firstCustomEndpointByName.set(endpoint.name, endpoint);
    }
    this.firstCustomEndpointByName = firstCustomEndpointByName;
    this.providerNames = [
      ...new Set([
        ...Object.keys(this.builtIns),
        ...this.customEndpoints.map(({ name }) => name),
      ]),
    ];
    this.providerNameSet = new Set(this.providerNames);
  }

  names(): string[] {
    return [...this.providerNames];
  }

  get(providerSelector: string): ProviderBase | undefined {
    const parsedSelector = parseProviderSelector(providerSelector);
    if (!parsedSelector) return undefined;
    const { providerName, profile } = parsedSelector;
    const existingProvider = this.builtInInstances.get(providerName);
    // Only own properties name a configured provider. Without this guard a
    // client-supplied selector such as "toString" or "constructor" would
    // resolve to an inherited Object.prototype member and be constructed.
    const BuiltInProvider = Object.prototype.hasOwnProperty.call(
      this.builtIns,
      providerName,
    )
      ? this.builtIns[providerName]
      : undefined;
    const customEndpoint = this.firstCustomEndpointByName.get(providerName);
    const baseProvider =
      existingProvider ??
      (BuiltInProvider
        ? new BuiltInProvider()
        : customEndpoint
          ? this.getCustom(customEndpoint)
          : undefined);

    if (baseProvider && BuiltInProvider && !existingProvider) {
      this.builtInInstances.set(providerName, baseProvider);
    }
    if (!baseProvider) return undefined;
    if (
      profile !== "default" &&
      !baseProvider.getCredentialProfiles().includes(profile)
    ) {
      return undefined;
    }
    const existingProfiledProvider =
      this.profiledInstances.get(providerSelector);
    if (existingProfiledProvider) return existingProfiledProvider;
    const providerInstance = withProviderProfile(baseProvider, profile);
    this.profiledInstances.set(providerSelector, providerInstance);
    return providerInstance;
  }

  all(): Record<string, ProviderBase> {
    const { providers, failures } = this.allSettled();
    if (failures.length > 0) throw failures[0].error;
    return providers;
  }

  /**
   * Enumerate each provider independently for best-effort diagnostics.
   *
   * A provider's default and named-profile instances are added atomically, so
   * a profile-discovery failure cannot leave a misleading partial description.
   */
  allSettled(): ProviderEnumerationResult {
    // Null-prototype maps: a configured endpoint may legitimately be named
    // "__proto__", and assigning that key on an ordinary object literal
    // replaces the prototype instead of creating an own entry, which would
    // drop the endpoint from every enumeration while routing still resolved it.
    const providerInstances = Object.create(null) as Record<
      string,
      ProviderBase
    >;
    const failures: ProviderEnumerationResult["failures"] = [];
    for (const providerName of this.providerNames) {
      try {
        const instances = Object.create(null) as Record<string, ProviderBase>;
        const defaultProvider = this.get(providerName);
        /* istanbul ignore next -- names() contains only constructible registry entries */
        if (!defaultProvider) {
          throw new Error(`Provider could not be constructed: ${providerName}`);
        }
        instances[providerName] = defaultProvider;
        for (const profile of defaultProvider.getCredentialProfiles()) {
          const selector = formatProviderSelector(providerName, profile);
          const profiledProvider = this.get(selector);
          if (!profiledProvider) {
            throw new Error(
              `Provider profile could not be constructed: ${selector}`,
            );
          }
          instances[selector] = profiledProvider;
        }
        Object.assign(providerInstances, instances);
      } catch (error) {
        failures.push({ providerName, error });
      }
    }
    return { providers: providerInstances, failures };
  }

  match(pathname: string): ProviderRoute | undefined {
    // Provider names never contain "/", so the first path segment identifies
    // the route with one set lookup instead of a scan over every name.
    if (!pathname.startsWith("/")) {
      return undefined;
    }
    const separatorIndex = pathname.indexOf("/", 1);
    if (separatorIndex === -1) {
      return undefined;
    }
    const providerSelector = pathname.slice(1, separatorIndex);
    const parsedSelector = parseProviderSelector(providerSelector);
    if (
      !parsedSelector ||
      !this.providerNameSet.has(parsedSelector.providerName)
    ) {
      return undefined;
    }

    return {
      providerName: providerSelector,
      pathname: pathname.slice(separatorIndex),
    };
  }

  private getCustom(endpointConfig: CustomOpenAIEndpointConfig): CustomOpenAI {
    let providerInstance = this.customInstances.get(endpointConfig);
    if (!providerInstance) {
      providerInstance = new CustomOpenAI(endpointConfig);
      this.customInstances.set(endpointConfig, providerInstance);
    }
    return providerInstance;
  }
}
